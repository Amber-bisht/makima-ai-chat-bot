import {
  containsOwnerMention,
  displayName,
  getMessageTextAndEntities,
  isGroupChat,
  isPrivateChat,
  stripOwnerMention
} from "../utils/telegram.js";
import { formatNotificationMessage } from "../utils/formatting.js";
import { isContactRequestIntent } from "../ai/contactIntent.js";
import { extractJsonObjects } from "../ai/GroqService.js";

function toCommand(text) {
  const [head] = text.trim().split(/\s+/);
  return head.split("@")[0].toLowerCase();
}

async function sendOwnerNotification(bot, config, msg, cleanedText) {
  try {
    const body = formatNotificationMessage({ msg, cleanedText });
    await bot.sendMessage(config.ownerChatId, body);
  } catch (error) {
    console.error("Failed to notify owner:", error.message);
  }
}

async function sendWelcome(bot, chatId, members, { memoryService }) {
  try {
    if (!members || members.length === 0) return;
    const rules = await memoryService.getGroupRules(chatId);
    if (!rules || !rules.rulesText) return;

    if (rules.lastWelcomeId) {
      try {
        await bot.deleteMessage(chatId, rules.lastWelcomeId).catch(() => {});
      } catch (e) {}
    }

    const names = members.map(m => m.first_name || "New Member").join(", ");
    const usernames = members.map(m => m.username ? `@${m.username}` : "").filter(Boolean).join(", ");
    
    let welcomeText = rules.rulesText
      .replace(/\{name\}/ig, names)
      .replace(/\{username\}/ig, usernames || names);
    
    welcomeText = welcomeText.replace(/@@/g, "@");

    const options = { parse_mode: "Markdown" };
    if (rules.rulesButtons?.length > 0) {
      options.reply_markup = {
        inline_keyboard: [rules.rulesButtons.map(btn => ({ text: btn.text, url: btn.url }))]
      };
    }

    const sent = await bot.sendMessage(chatId, welcomeText, options).catch(err => {
      return bot.sendMessage(chatId, welcomeText, {
        reply_markup: options.reply_markup
      });
    });

    if (sent) {
      await memoryService.setLastWelcomeId(chatId, sent.message_id);
    }
  } catch (err) {
    console.error("sendWelcome error:", err.message);
  }
}

async function handlePrivateMessage(bot, msg, services, commandHandler, config) {
  const { text } = getMessageTextAndEntities(msg);
  const command = text?.trim() ? toCommand(text) : "";

  const isPublic = await commandHandler.handlePublic(command, msg);
  if (isPublic) return;

  if (msg.from.id === config.ownerUserId) {
    if (!text || !text.trim()) {
      await commandHandler.handlePublic('/help', msg);
      return;
    }
    const trimmedText = text.trim();
    if (!trimmedText.startsWith("/")) {
      const { memoryService } = services;
      const result = await memoryService.addOwnerFeed(config.ownerUserId, trimmedText);
      await bot.sendMessage(
        msg.chat.id,
        [
          "Feed saved.",
          "Non-command owner DM is stored as /feed memory.",
          `Total stored feed notes: ${result.notes.length}`
        ].join("\n")
      );
      return;
    }
    const args = text.trim().split(/\s+/).slice(1);
    const handled = await commandHandler.handleOwner(command, msg, text, args);
    if (!handled) {
      await commandHandler.handlePublic('/help', msg);
    }
    return;
  }

  const privateText = [
    "Welcome.",
    "This bot only works in Telegram groups.",
    `Please tag @${config.ownerUsername} in a group to interact.`,
    "",
    `${config.assistantName} is assistant to ${config.ownerName}.`,
    "",
    "This bot does not support private chat.",
    "Use it inside groups only."
  ].join("\n");

  await bot.sendMessage(msg.chat.id, privateText);
}

async function handleGroupMessage(bot, msg, services, commandHandler, config, state) {
  const { memoryService, groqService, webContextService } = services;
  const { botUserId, effectiveBotUsername, authorizedGroups } = state;
  if (!authorizedGroups.has(String(msg.chat.id))) return;

  const { text } = getMessageTextAndEntities(msg);
  if (!text || !text.trim()) return;

  const command = toCommand(text);
  
  if (command.startsWith('/')) {
      const chatAdmins = await bot.getChatAdministrators(msg.chat.id).catch(() => []);
      const isAdminOrOwner = msg.from.id === config.ownerUserId || chatAdmins.some(admin => admin.user.id === msg.from.id);
      
      if (isAdminOrOwner) {
         const args = text.trim().split(/\s+/).slice(1);
         try {
             const handled = await commandHandler.handleAdmin(command, msg, text, args);
             if (handled) return;
         } catch (err) {
             console.error("Admin command error:", err.message);
         }
      }
  }

  const ignoredUserIds = await memoryService.getIgnoredUserIds(config.ownerUserId);
  if (ignoredUserIds.includes(msg.from.id)) return;

  const repliedToUserId = msg.reply_to_message?.from?.id || null;
  const isReplyToBot = repliedToUserId === botUserId;
  const isReplyToOwner = repliedToUserId === config.ownerUserId;
  const hasOwnerMention = containsOwnerMention(
    msg,
    config.ownerUsername,
    config.ownerUserId,
    effectiveBotUsername,
    botUserId
  );
  if (!hasOwnerMention && !isReplyToBot && !isReplyToOwner) return;

  const cleanedText = hasOwnerMention
    ? stripOwnerMention(text, config.ownerUsername, effectiveBotUsername)
    : text.trim();
  await memoryService.touchUser(msg.from, msg.chat);
  await memoryService.logGroupMessage(msg.chat, msg.from, cleanedText || text);

  if (
    isContactRequestIntent(cleanedText, config.ownerUsername, {
      isReplyToBot,
      isReplyToOwner
    })
  ) {
    await bot.sendMessage(msg.chat.id, "Your message has been forwarded.", {
      reply_to_message_id: msg.message_id,
      allow_sending_without_reply: true
    });
    await memoryService.logContactRequest({
      message: cleanedText || text,
      user: msg.from,
      chat: msg.chat
    });
    await sendOwnerNotification(bot, config, msg, cleanedText || text);
    return;
  }

  const userMemory = await memoryService.getUserMemory(msg.from.id);
  const groupContextRaw = await memoryService.getGroupContext(msg.chat.id);
  const groupContext = groupContextRaw.map((m) => `[${m.name}]: ${m.text}`).join("\n");
  const ownerFeedNotes = await memoryService.getOwnerFeed(config.ownerUserId);
  const latestOwnerFeedNote = ownerFeedNotes.at(-1) || null;
  const ownerKnowledgeNotes = await memoryService.getOwnerKnowledge(config.ownerUserId);
  const externalWebContext = await webContextService.buildContextForMessage(cleanedText || text, groupContext);
  const reply = await groqService.generateOwnerReply({
    assistantName: config.assistantName,
    ownerName: config.ownerName,
    ownerUsername: config.ownerUsername,
    groupTitle: msg.chat.title,
    currentDateTime: new Date().toISOString(),
    ownerFeedNotes,
    latestOwnerFeedNote,
    ownerKnowledgeNotes,
    externalWebContext,
    sarcasmMode: Math.random() < 0.5 ? "sarcastic" : "neutral",
    messageText: cleanedText || text,
    userMemory,
    groupContext,
    fromName: displayName(msg.from)
  });

  const jsonObjects = extractJsonObjects(reply);
  const polls = jsonObjects.filter(obj => obj.type === "poll" && obj.question && Array.isArray(obj.options));
  
  let textToReply = reply;
  if (polls.length > 0) {
      // Remove JSON blocks from the reply text to send the greeting/intro separately
      for (const obj of jsonObjects) {
          try {
              const jsonStr = JSON.stringify(obj);
              textToReply = textToReply.replace(jsonStr, "").trim();
          } catch (e) {}
      }
      // Also try to remove any remaining braces or leftover JSON-like strings if the stringify above was slightly different
      textToReply = textToReply.replace(/\{[\s\S]*?\}/g, "").trim();

      if (textToReply) {
          await bot.sendMessage(msg.chat.id, textToReply, {
              reply_to_message_id: msg.message_id,
              allow_sending_without_reply: true
          });
      }

      for (const pollData of polls) {
          try {
              let correctIndex = parseInt(pollData.correct_option_id ?? pollData.correct_option_index);
              if (isNaN(correctIndex) || correctIndex < 0 || correctIndex >= pollData.options.length) {
                  correctIndex = 0; // fallback to first option if index is invalid
              }

              await bot.sendPoll(msg.chat.id, pollData.question, pollData.options, {
                  is_anonymous: false,
                  type: "quiz",
                  correct_option_id: correctIndex,
                  explanation: pollData.explanation || "",
                  reply_to_message_id: msg.message_id
              });
          } catch (pollErr) {
              console.error("Failed to send native poll:", pollErr.message);
          }
      }
      return;
  }

  await bot.sendMessage(msg.chat.id, reply, {
    reply_to_message_id: msg.message_id,
    allow_sending_without_reply: true
  });

  const extracted = await groqService.extractMeaningfulMemory({
    messageText: cleanedText || text,
    botReply: reply
  });
  await memoryService.mergeExtractedMemory(msg.from.id, extracted);
}

export function setupEvents(bot, services, commandHandler, config, state) {
  bot.on("message", async (msg) => {
    try {
      if (msg.new_chat_members) {
        const membersToWelcome = msg.new_chat_members.filter(m => !m.is_bot);
        if (membersToWelcome.length > 0) {
          await sendWelcome(bot, msg.chat.id, membersToWelcome, services);
        }
      }

      if (!msg?.from || msg.from.is_bot) return;
      if (isPrivateChat(msg.chat.type)) {
        await handlePrivateMessage(bot, msg, services, commandHandler, config);
        return;
      }
      if (isGroupChat(msg.chat.type)) {
        await handleGroupMessage(bot, msg, services, commandHandler, config, state);
      }
    } catch (error) {
      console.error("Message handler failed:", error);
    }
  });

  bot.on("my_chat_member", (msg) => {
    console.log(`[BOOTSTRAP] Bot status in ${msg.chat.id} (${msg.chat.title || "?"}) changed: ${msg.old_chat_member?.status} -> ${msg.new_chat_member?.status}`);
  });

  bot.on("chat_member", async (msg) => {
    try {
      if (!state.authorizedGroups.has(String(msg.chat.id))) return;

      const newStatus = msg.new_chat_member?.status;
      const oldStatus = msg.old_chat_member?.status;
      const member = msg.new_chat_member?.user;
      if (!member || member.is_bot) return;

      const isNewJoin =
        (newStatus === "member" || newStatus === "restricted") &&
        oldStatus !== "member" && oldStatus !== "restricted" &&
        oldStatus !== "administrator" && oldStatus !== "creator";

      if (!isNewJoin) return;
      await sendWelcome(bot, msg.chat.id, [member], services);
    } catch (err) {
      console.error("chat_member event error:", err.message);
    }
  });
}

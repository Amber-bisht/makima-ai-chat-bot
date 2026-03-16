import TelegramBot from "node-telegram-bot-api";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { connectMongo } from "./db/mongo.js";
import { FastMemoryIndex } from "./services/FastMemoryIndex.js";
import { GroqService } from "./services/GroqService.js";
import { isContactRequestIntent } from "./services/contactIntent.js";
import { MemoryService } from "./services/MemoryService.js";
import { WebContextService } from "./services/WebContextService.js";
import {
  containsOwnerMention,
  displayName,
  getMessageTextAndEntities,
  isGroupChat,
  isPrivateChat,
  stripOwnerMention
} from "./utils/telegram.js";

function toCommand(text) {
  const [head] = text.trim().split(/\s+/);
  return head.split("@")[0].toLowerCase();
}

function helpText() {
  return [
    "Owner commands:",
    "/stats",
    "/memory [user_id|object_id]",
    "/feed <text>",
    "/feed",
    "/text <knowledge>",
    "/text",
    "/data <user_id> <text>",
    "/ignore <user_id> (also /ingore)",
    "/clear_user <user_id>",
    "/reply <user_id> <message>"
  ].join("\n");
}

function formatGroupName(chat) {
  if (chat.title) return chat.title;
  if (chat.username) return `@${chat.username}`;
  return String(chat.id);
}

function formatNotificationMessage({ msg, cleanedText }) {
  const user = msg.from;
  const group = msg.chat;

  return [
    "User Request Notification",
    "",
    `User: ${displayName(user)}`,
    `User ID: ${user.id}`,
    `Group: ${formatGroupName(group)}`,
    "",
    "Message:",
    `"${cleanedText}"`
  ].join("\n");
}

const startImagePath = fileURLToPath(new URL("../public/image.png", import.meta.url));

function startWelcomeText(user) {
  const welcomeName = user?.username ? `@${user.username}` : displayName(user);
  return [
    `Welcome ${welcomeName}`,
    `I work in @${config.ownerUsername} Telegram Groups.`,
    `Please tag @${config.ownerUsername} or me or reply on my msg in a group to interact with me.`
  ].join("\n");
}

async function bootstrap() {
  await connectMongo(config.mongoUri);
  console.log("Connected to MongoDB");

  const cache = new FastMemoryIndex(config.cacheMaxUsers);
  const memoryService = new MemoryService({ cache });
  const groqService = new GroqService({
    apiKeys: config.groqApiKeys,
    model: config.groqModel
  });
  const webContextService = new WebContextService({
    newsApiKey: config.newsApiKey,
    tavilyApiKey: config.tavilyApiKey
  });
  const authorizedGroups = new Set(config.authGroupIds.map(String));

  function isTransientPollingError(error) {
    const msg = String(error?.message || "").toLowerCase();
    if (
      msg.includes("invalid token") ||
      msg.includes("401") ||
      msg.includes("unauthorized") ||
      msg.includes("forbidden")
    ) {
      return false;
    }
    return (
      msg.includes("etimedout") ||
      msg.includes("econnreset") ||
      msg.includes("eai_again") ||
      msg.includes("socket hang up") ||
      msg.includes("network")
    );
  }

  const bot = new TelegramBot(config.telegramBotToken, {
    polling: {
      autoStart: true,
      interval: 300,
      params: { 
        timeout: 25,
        allowed_updates: ["message", "edited_message", "channel_post", "edited_channel_post", "inline_query", "chosen_inline_result", "callback_query", "shipping_query", "pre_checkout_query", "poll", "poll_answer", "my_chat_member", "chat_member", "chat_join_request"]
      }
    }
  });
  const botProfile = await bot.getMe();
  const botUserId = botProfile.id;
  const effectiveBotUsername =
    (config.botUsername || botProfile.username || "").replace(/^@/, "").toLowerCase() || null;

  let pollingRestartTimer = null;
  async function schedulePollingRestart(delayMs = 5000) {
    if (pollingRestartTimer) return;
    pollingRestartTimer = setTimeout(async () => {
      pollingRestartTimer = null;
      try {
        const active = typeof bot.isPolling === "function" ? bot.isPolling() : false;
        if (!active && typeof bot.startPolling === "function") {
          await bot.startPolling();
          console.log("Telegram polling restarted after transient error.");
        }
      } catch (restartError) {
        console.error("Failed to restart Telegram polling:", restartError.message);
        await schedulePollingRestart(8000);
      }
    }, delayMs);
  }

  bot.on("polling_error", async (error) => {
    if (isTransientPollingError(error)) {
      console.warn("Telegram polling transient error:", error.message);
      await schedulePollingRestart();
      return;
    }
    console.error("Telegram polling error:", error.message);
  });

  async function sendOwnerNotification(msg, cleanedText) {
    try {
      const body = formatNotificationMessage({ msg, cleanedText });
      await bot.sendMessage(config.ownerChatId, body);
    } catch (error) {
      console.error("Failed to notify owner:", error.message);
    }
  }

  async function sendStartWelcome(msg) {
    const text = startWelcomeText(msg.from);
    if (existsSync(startImagePath)) {
      await bot.sendPhoto(msg.chat.id, startImagePath, { caption: text });
      return;
    }
    await bot.sendMessage(msg.chat.id, text);
  }

  async function handleOwnerPrivateMessage(msg, text) {
    const trimmedText = text.trim();
    if (!trimmedText.startsWith("/")) {
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

    const command = toCommand(text);
    const args = text.trim().split(/\s+/).slice(1);

    if (command === "/start" || command === "/help") {
      await bot.sendMessage(msg.chat.id, helpText());
      return;
    }

    if (command === "/stats") {
      const stats = await memoryService.getStats();
      const response = [
        "Bot Stats",
        "",
        `Total users in memory: ${stats.totalUsers}`,
        `Total contact requests: ${stats.totalContactRequests}`,
        `Cache size: ${stats.cache.size}`,
        `Cache hits: ${stats.cache.hits}`,
        `Cache misses: ${stats.cache.misses}`
      ].join("\n");
      await bot.sendMessage(msg.chat.id, response);
      return;
    }

    if (command === "/memory") {
      if (args[0]) {
        const lookup = args[0].trim();
        const memory = await memoryService.getUserMemoryByLookup(lookup);
        if (!memory) {
          await bot.sendMessage(msg.chat.id, `No memory found for lookup ${lookup}.`);
          return;
        }
        const details = [
          `_id: ${memory._id || "Unknown"}`,
          `User ID: ${memory.userId}`,
          `Name: ${memory.name || "Unknown"}`,
          `Username: ${memory.username ? `@${memory.username}` : "Unknown"}`,
          `About: ${(memory.about || []).join(" | ") || "None"}`,
          `Facts: ${(memory.facts || []).join(" | ") || "None"}`,
          `Past Questions: ${(memory.pastQuestions || []).join(" | ") || "None"}`,
          `Summaries: ${(memory.conversationSummaries || []).join(" | ") || "None"}`,
          `Last Seen Group: ${memory.lastSeenGroup?.title || memory.lastSeenGroup?.id || "Unknown"}`
        ].join("\n");
        await bot.sendMessage(msg.chat.id, details);
        return;
      }

      const items = await memoryService.listRecentMemories(15);
      if (!items.length) {
        await bot.sendMessage(msg.chat.id, "No user memory found yet.");
        return;
      }
      const lines = items.map((item) => {
        const label = item.name || item.username || item.userId;
        return `${item.userId} - ${label} (facts: ${item.facts?.length || 0}, questions: ${item.pastQuestions?.length || 0})`;
      });
      await bot.sendMessage(msg.chat.id, ["Recent memory entries:", ...lines].join("\n"));
      return;
    }

    if (command === "/feed") {
      const rawFeedText = text.replace(/^\/feed(?:@\w+)?\s*/i, "").trim();

      if (!rawFeedText) {
        const notes = await memoryService.getOwnerFeed(config.ownerUserId);
        if (!notes.length) {
          await bot.sendMessage(
            msg.chat.id,
            "No feed memory yet.\nUsage: /feed - your instruction or personal context"
          );
          return;
        }

        const recent = notes.slice(-15);
        const lines = recent.map((note, idx) => `${idx + 1}. ${note}`);
        await bot.sendMessage(msg.chat.id, ["Owner feed memory (latest):", ...lines].join("\n"));
        return;
      }

      const cleanedFeed = rawFeedText.replace(/^\-\s*/, "").trim();
      if (!cleanedFeed) {
        await bot.sendMessage(msg.chat.id, "Usage: /feed - your instruction or personal context");
        return;
      }

      const result = await memoryService.addOwnerFeed(config.ownerUserId, cleanedFeed);
      await bot.sendMessage(
        msg.chat.id,
        `Feed saved.\nTotal stored feed notes: ${result.notes.length}`
      );
      return;
    }

    if (command === "/text") {
      const rawText = text.replace(/^\/text(?:@\w+)?\s*/i, "").trim();

      if (!rawText) {
        const knowledgeNotes = await memoryService.getOwnerKnowledge(config.ownerUserId);
        if (!knowledgeNotes.length) {
          await bot.sendMessage(
            msg.chat.id,
            "No shared text knowledge yet.\nUsage: /text - knowledge you want bot to remember"
          );
          return;
        }

        const recent = knowledgeNotes.slice(-20);
        const lines = recent.map((note, idx) => `${idx + 1}. ${note}`);
        await bot.sendMessage(msg.chat.id, ["Shared text knowledge (latest):", ...lines].join("\n"));
        return;
      }

      const cleanedText = rawText.replace(/^\-\s*/, "").trim();
      if (!cleanedText) {
        await bot.sendMessage(msg.chat.id, "Usage: /text - knowledge you want bot to remember");
        return;
      }

      const result = await memoryService.addOwnerKnowledge(config.ownerUserId, cleanedText);
      await bot.sendMessage(
        msg.chat.id,
        `Text knowledge saved.\nTotal shared text notes: ${result.knowledgeNotes.length}`
      );
      return;
    }

    if (command === "/data") {
      const match = text.match(/^\/data(?:@\w+)?\s+(-?\d+)\s+([\s\S]+)/i);
      if (!match) {
        await bot.sendMessage(msg.chat.id, "Usage: /data <user_id> <text>");
        return;
      }

      const userId = Number(match[1]);
      const manualText = match[2]?.trim();
      if (!Number.isFinite(userId) || !manualText) {
        await bot.sendMessage(msg.chat.id, "Usage: /data <user_id> <text>");
        return;
      }

      const updated = await memoryService.addUserManualData(userId, manualText);
      const latestAbout = (updated.about || []).slice(-3);
      await bot.sendMessage(
        msg.chat.id,
        [
          `Manual user data saved for ${userId}.`,
          `About entries: ${(updated.about || []).length}`,
          `Latest about: ${latestAbout.join(" | ") || "None"}`
        ].join("\n")
      );
      return;
    }

    if (command === "/ignore" || command === "/ingore") {
      const userId = Number(args[0]);
      if (!Number.isFinite(userId)) {
        await bot.sendMessage(msg.chat.id, "Usage: /ignore <user_id>");
        return;
      }
      const ignored = await memoryService.addIgnoredUser(config.ownerUserId, userId);
      await bot.sendMessage(
        msg.chat.id,
        `User ${userId} added to ignore list.\nIgnored users count: ${ignored.length}`
      );
      return;
    }

    if (command === "/clear_user") {
      const userId = Number(args[0]);
      if (!Number.isFinite(userId)) {
        await bot.sendMessage(msg.chat.id, "Usage: /clear_user <user_id>");
        return;
      }
      await memoryService.clearUser(userId);
      await bot.sendMessage(msg.chat.id, `Cleared memory for user ${userId}.`);
      return;
    }

    if (command === "/reply") {
      const userId = Number(args[0]);
      const replyText = text.trim().split(/\s+/).slice(2).join(" ").trim();

      if (!Number.isFinite(userId) || !replyText) {
        await bot.sendMessage(msg.chat.id, "Usage: /reply <user_id> <message>");
        return;
      }

      try {
        await bot.sendMessage(userId, replyText);
        await bot.sendMessage(msg.chat.id, `Reply sent to ${userId}.`);
      } catch (error) {
        await bot.sendMessage(
          msg.chat.id,
          `Could not send message to ${userId}. They may not have started the bot in DM.`
        );
      }
      return;
    }

    await bot.sendMessage(msg.chat.id, helpText());
  }

  async function handlePrivateMessage(msg) {
    const { text } = getMessageTextAndEntities(msg);
    const command = text?.trim() ? toCommand(text) : "";

    if (command === "/start") {
      await sendStartWelcome(msg);
      if (msg.from.id === config.ownerUserId) {
        await bot.sendMessage(msg.chat.id, helpText());
      }
      return;
    }

    if (msg.from.id === config.ownerUserId) {
      if (!text || !text.trim()) {
        await bot.sendMessage(msg.chat.id, helpText());
        return;
      }
      await handleOwnerPrivateMessage(msg, text);
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

  async function handleGroupMessage(msg) {
    if (!authorizedGroups.has(String(msg.chat.id))) {
      return;
    }

    if (msg.new_chat_members) {
      console.log("[DEBUG] Received new_chat_members event for chat:", msg.chat.id, "Members:", msg.new_chat_members.map(m => m.id));
      try {
        const rules = await memoryService.getGroupRules(msg.chat.id);
        if (rules && rules.rulesText) {
          console.log("[DEBUG] Found rules for chat, triggering welcome...");
          for (const member of msg.new_chat_members) {
            if (member.is_bot) continue;
            let welcomeText = rules.rulesText
              .replace(/\{name\}/ig, member.first_name || "")
              .replace(/\{username\}/ig, member.username ? `@${member.username}` : "");
              
            const options = {};
            if (rules.rulesButtons && rules.rulesButtons.length > 0) {
              options.reply_markup = {
                 inline_keyboard: [
                   rules.rulesButtons.map(btn => ({ text: btn.text, url: btn.url }))
                 ]
              };
            }
            await bot.sendMessage(msg.chat.id, welcomeText, options);
            console.log("[DEBUG] Welcome message sent to", member.id);
          }
        } else {
          console.log("[DEBUG] No rules found for chat", msg.chat.id);
        }
      } catch (err) {
        console.error("Welcome message error:", err.message);
      }
      return;
    }

    const { text } = getMessageTextAndEntities(msg);
    if (!text || !text.trim()) return;

    const command = toCommand(text);
    if (["/rules", "/ban", "/fban"].includes(command)) {
       try {
         const chatAdmins = await bot.getChatAdministrators(msg.chat.id);
         const isAdminOrOwner = msg.from.id === config.ownerUserId || chatAdmins.some(admin => admin.user.id === msg.from.id);
         
         if (isAdminOrOwner) {
            if (command === "/rules" && msg.from.id === config.ownerUserId) {
               const rulesContent = text.substring(text.indexOf(" ") + 1).trim();
               if (!rulesContent || command === text.trim()) {
                 await bot.sendMessage(msg.chat.id, "Usage: /rules <welcome text> | <btn1 name> - <btn1 url> | <btn2 name> - <btn2 url>\nUse {name} and {username} in text.");
                 return;
               }
               const parts = rulesContent.split("|").map(p => p.trim());
               const rulesText = parts[0];
               const buttons = [];
               for (let i = 1; i < parts.length; i++) {
                  const btnParts = parts[i].split("-").map(p => p.trim());
                  if (btnParts.length >= 2) {
                     buttons.push({ text: btnParts[0], url: btnParts.slice(1).join("-") });
                  }
               }
               await memoryService.setGroupRules(msg.chat.id, rulesText, buttons);
               await bot.sendMessage(msg.chat.id, "Group rules and welcome message updated.");
               return;
            }

            if (command === "/ban") {
               const targetUser = msg.reply_to_message?.from;
               if (!targetUser) {
                 await bot.sendMessage(msg.chat.id, "Reply to a user to /ban them.");
                 return;
               }
               await bot.banChatMember(msg.chat.id, targetUser.id);
               await bot.sendMessage(msg.chat.id, `User ${displayName(targetUser)} has been banned from this group.`);
               return;
            }

            if (command === "/fban") {
               const targetUser = msg.reply_to_message?.from;
               if (!targetUser) {
                 await bot.sendMessage(msg.chat.id, "Reply to a user to /fban them.");
                 return;
               }
               let bannedCount = 0;
               for (const gid of config.authGroupIds) {
                 try {
                   await bot.banChatMember(gid, targetUser.id);
                   bannedCount++;
                 } catch (err) {
                   // ignore errors if bot can't ban in some groups
                 }
               }
               await bot.sendMessage(msg.chat.id, `User ${displayName(targetUser)} has been forcefully banned from ${bannedCount} authorized group(s).`);
               return;
            }
         }
       } catch (err) {
         console.error("Admin command error:", err.message);
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
      await sendOwnerNotification(msg, cleanedText || text);
      return;
    }

    const userMemory = await memoryService.getUserMemory(msg.from.id);
    const groupContextRaw = await memoryService.getGroupContext(msg.chat.id);
    const groupContext = groupContextRaw.map((m) => `[${m.name}]: ${m.text}`).join("\n");
    const ownerFeedNotes = await memoryService.getOwnerFeed(config.ownerUserId);
    const latestOwnerFeedNote = ownerFeedNotes.at(-1) || null;
    const ownerKnowledgeNotes = await memoryService.getOwnerKnowledge(config.ownerUserId);
    const externalWebContext = await webContextService.buildContextForMessage(cleanedText || text);
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

  bot.on("message", async (msg) => {
    try {
      if (msg.new_chat_members) {
        console.log("[DEBUG] Root message handler caught new_chat_members event.", msg.chat.id);
      }
      if (msg.new_chat_members && isGroupChat(msg.chat.type)) {
         await handleGroupMessage(msg);
         return;
      }
      if (!msg?.from || msg.from.is_bot) return;
      if (isPrivateChat(msg.chat.type)) {
        await handlePrivateMessage(msg);
        return;
      }
      if (isGroupChat(msg.chat.type)) {
        await handleGroupMessage(msg);
      }
    } catch (error) {
      console.error("Message handler failed:", error);
    }
  });

  console.log(
    `Bot is running as ${config.assistantName} (@${botProfile.username || "unknown"}). Authorized groups: ${config.authGroupIds.join(", ")}`
  );
}

bootstrap().catch((error) => {
  console.error("Fatal startup error:", error);
  process.exit(1);
});

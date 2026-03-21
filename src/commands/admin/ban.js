import { resolveTargetUser } from './utils.js';

export async function banCommand(bot, msg, args, { memoryService }) {
  const targetUser = await resolveTargetUser(msg, args, memoryService);
  if (!targetUser) {
    await bot.sendMessage(msg.chat.id, "Reply to a user or specify @username/ID to /ban them.");
    return;
  }
  await bot.banChatMember(msg.chat.id, targetUser.id);
  await bot.sendMessage(msg.chat.id, `User ${targetUser.first_name} has been banned from this group.`);
}

export async function dbanCommand(bot, msg, args, { memoryService }) {
  const targetMessage = msg.reply_to_message;
  const targetUser = await resolveTargetUser(msg, args, memoryService);
  if (!targetUser || !targetMessage) {
    await bot.sendMessage(msg.chat.id, "Reply to a user's message to /dban them.");
    return;
  }
  await bot.banChatMember(msg.chat.id, targetUser.id).catch(() => {});
  await bot.deleteMessage(msg.chat.id, targetMessage.message_id).catch(() => {});
  await bot.sendMessage(msg.chat.id, `User ${targetUser.first_name} has been banned from this group and their message deleted.`);
}

export async function fbanCommand(bot, msg, args, { memoryService, config }) {
  const targetUser = await resolveTargetUser(msg, args, memoryService);
  if (!targetUser) {
    await bot.sendMessage(msg.chat.id, "Reply to a user or specify @username/ID to /fban them.");
    return;
  }
  let bannedCount = 0;
  for (const gid of config.authGroupIds) {
    try {
      await bot.banChatMember(gid, targetUser.id);
      bannedCount++;
    } catch (err) {}
  }
  await bot.sendMessage(msg.chat.id, `User ${targetUser.first_name} has been forcefully banned from ${bannedCount} authorized group(s).`);
}

export async function unbanCommand(bot, msg, args, { memoryService }) {
  const targetUser = await resolveTargetUser(msg, args, memoryService);
  if (!targetUser) {
    await bot.sendMessage(msg.chat.id, "Reply to a user or specify @username/ID to /unban that user.");
    return;
  }
  await bot.unbanChatMember(msg.chat.id, targetUser.id, { only_if_banned: true });
  await bot.sendMessage(msg.chat.id, `User ${targetUser.first_name} has been unbanned from this group.`);
}

export async function funbanCommand(bot, msg, args, { memoryService, config }) {
  const targetUser = await resolveTargetUser(msg, args, memoryService);
  if (!targetUser) {
    await bot.sendMessage(msg.chat.id, "Reply to a user or specify @username/ID to /funban that user.");
    return;
  }
  let unbannedCount = 0;
  for (const gid of config.authGroupIds) {
    try {
      await bot.unbanChatMember(gid, targetUser.id, { only_if_banned: true });
      unbannedCount++;
    } catch (err) {}
  }
  await bot.sendMessage(msg.chat.id, `User ${targetUser.first_name} has been forcefully unbanned from ${unbannedCount} authorized group(s).`);
}

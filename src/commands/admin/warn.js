import { resolveTargetUser } from './utils.js';

export async function warnCommand(bot, msg, args, { memoryService }) {
  const targetUser = await resolveTargetUser(msg, args, memoryService);
  if (!targetUser) {
    await bot.sendMessage(msg.chat.id, "Reply to a user or specify @username/ID to /warn them.");
    return;
  }
  const warnings = await memoryService.addWarning(targetUser.id);
  if (warnings >= 3) {
    await bot.banChatMember(msg.chat.id, targetUser.id).catch(() => {});
    await bot.sendMessage(msg.chat.id, `User ${targetUser.first_name} has reached ${warnings} warnings and has been banned.`);
  } else {
    await bot.sendMessage(msg.chat.id, `User ${targetUser.first_name} has been warned. Total warnings: ${warnings}/3.`);
  }
}

export async function unwarnCommand(bot, msg, args, { memoryService }) {
  const targetUser = await resolveTargetUser(msg, args, memoryService);
  if (!targetUser) {
    await bot.sendMessage(msg.chat.id, "Reply to a user or specify @username/ID to /unwarn them.");
    return;
  }
  const warnings = await memoryService.removeWarning(targetUser.id);
  await bot.sendMessage(msg.chat.id, `User ${targetUser.first_name}'s warning has been removed. Total warnings: ${warnings}/3.`);
}

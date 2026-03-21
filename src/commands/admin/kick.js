import { resolveTargetUser } from './utils.js';

export async function kickCommand(bot, msg, args, { memoryService }) {
  const targetUser = await resolveTargetUser(msg, args, memoryService);
  if (!targetUser) {
    await bot.sendMessage(msg.chat.id, "Reply to a user or specify @username/ID to /kick them.");
    return;
  }
  try {
    await bot.banChatMember(msg.chat.id, targetUser.id);
    await bot.unbanChatMember(msg.chat.id, targetUser.id);
    await bot.sendMessage(msg.chat.id, `User ${targetUser.first_name || targetUser.id} has been kicked from this group.`);
  } catch (err) {
    await bot.sendMessage(msg.chat.id, `Failed to kick user: ${err.message}`);
  }
}

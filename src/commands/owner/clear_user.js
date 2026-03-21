export async function clearUserCommand(bot, msg, args, { memoryService }) {
  const userId = Number(args[0]);
  if (!Number.isFinite(userId)) {
    await bot.sendMessage(msg.chat.id, "Usage: /clear_user <user_id>");
    return;
  }
  await memoryService.clearUser(userId);
  await bot.sendMessage(msg.chat.id, `Cleared memory for user ${userId}.`);
}

export async function ignoreCommand(bot, msg, args, { memoryService, config }) {
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
}

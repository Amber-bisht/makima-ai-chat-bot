export async function statsCommand(bot, msg, { memoryService }) {
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
}

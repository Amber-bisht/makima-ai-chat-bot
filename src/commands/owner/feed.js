export async function feedCommand(bot, msg, text, { memoryService, config }) {
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
}

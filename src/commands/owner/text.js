export async function textCommand(bot, msg, messageText, { memoryService, config }) {
  const rawText = messageText.replace(/^\/text(?:@\w+)?\s*/i, "").trim();

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
}

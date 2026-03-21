export async function memoryCommand(bot, msg, args, { memoryService }) {
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
}

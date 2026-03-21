export async function dataCommand(bot, msg, text, { memoryService }) {
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
}

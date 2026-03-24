export async function ignoreCommand(bot, msg, args, { memoryService, config }) {
  let targetUserId = null;
  let lookupLabel = "";

  if (msg.reply_to_message) {
    targetUserId = msg.reply_to_message.from.id;
    lookupLabel = `user ${targetUserId} (from reply)`;
  } else if (args[0]) {
    const input = args[0].trim();
    if (input.startsWith('@') || !/^\d+$/.test(input)) {
      targetUserId = await memoryService.getUserIdByUsername(input);
      lookupLabel = targetUserId ? `${input} (${targetUserId})` : `username ${input}`;
    } else {
      targetUserId = Number(input);
      lookupLabel = `user ${targetUserId}`;
    }
  }

  if (!targetUserId || !Number.isFinite(targetUserId)) {
    const usage = "Usage: /ignore <user_id|@username> (or reply to a message)";
    const errorMsg = (args[0] && !msg.reply_to_message) 
      ? `Could not find or resolve ${lookupLabel}.\n${usage}`
      : usage;
    await bot.sendMessage(msg.chat.id, errorMsg);
    return;
  }

  const ignored = await memoryService.addIgnoredUser(config.ownerUserId, targetUserId);
  await bot.sendMessage(
    msg.chat.id,
    `User ${lookupLabel} added to ignore list.\nIgnored users count: ${ignored.length}`
  );
}

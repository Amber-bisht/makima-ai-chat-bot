export async function replyCommand(bot, msg, args, text) {
  const userId = Number(args[0]);
  const replyText = text.trim().split(/\s+/).slice(2).join(" ").trim();

  if (!Number.isFinite(userId) || !replyText) {
    await bot.sendMessage(msg.chat.id, "Usage: /reply <user_id> <message>");
    return;
  }

  try {
    await bot.sendMessage(userId, replyText);
    await bot.sendMessage(msg.chat.id, `Reply sent to ${userId}.`);
  } catch (error) {
    await bot.sendMessage(
      msg.chat.id,
      `Could not send message to ${userId}. They may not have started the bot in DM.`
    );
  }
}

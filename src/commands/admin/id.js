export async function idCommand(bot, msg) {
  if (msg.reply_to_message?.from) {
    const targetUser = msg.reply_to_message.from;
    const name = targetUser.first_name || targetUser.username || "User";
    await bot.sendMessage(msg.chat.id, `${name}'s ID is: <code>${targetUser.id}</code>`, { parse_mode: "HTML" });
    return;
  }
  await bot.sendMessage(msg.chat.id, `This Chat's ID is: <code>${msg.chat.id}</code>`, { parse_mode: "HTML" });
}

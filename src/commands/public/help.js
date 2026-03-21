export function helpText() {
  return [
    "Owner commands:",
    "/stats",
    "/memory [user_id|object_id]",
    "/feed <text>",
    "/feed",
    "/text <knowledge>",
    "/text",
    "/data <user_id> <text>",
    "/ignore <user_id> (also /ingore)",
    "/clear_user <user_id>",
    "/reply <user_id> <message>"
  ].join("\n");
}

export async function helpCommand(bot, msg) {
  await bot.sendMessage(msg.chat.id, helpText());
}

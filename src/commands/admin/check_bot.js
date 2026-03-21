export async function checkBotCommand(bot, msg, { memoryService, config, authorizedGroups }) {
  const botMember = await bot.getChatMember(msg.chat.id, config.botUserId || (await bot.getMe()).id);
  const rules = await memoryService.getGroupRules(msg.chat.id);
  const isAuth = authorizedGroups.has(String(msg.chat.id));
  
  let status = `🤖 **Bot Status for this Group:**\n`;
  status += `- **Authorized:** ${isAuth ? "✅ Yes" : "❌ No"}\n`;
  status += `- **Bot Permissions:** ${botMember.status === "administrator" || botMember.status === "creator" ? "✅ Admin" : "❌ Not Admin"} (${botMember.status})\n`;
  status += `- **Welcome Rules Set:** ${rules && rules.rulesText ? "✅ Yes" : "❌ No"}\n`;
  
  await bot.sendMessage(msg.chat.id, status, { parse_mode: "Markdown" });
}

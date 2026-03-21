export async function rulesCommand(bot, msg, text, { memoryService }) {
  const rulesContent = text.substring(text.indexOf(" ") + 1).trim();
  if (!rulesContent || toCommand(text) === text.trim()) {
    await bot.sendMessage(msg.chat.id, "Usage: /rules <welcome text> {btn1 name https://btn1.url} {btn2 name https://btn2.url}\nUse {name} and {username} in text.");
    return;
  }
  
  // Match everything inside { } as buttons, but ignore {name} and {username}
  const buttonRegex = /\{([^}]+)\}/g;
  const buttons = [];
  let match;
  let cleanText = rulesContent;
  
  while ((match = buttonRegex.exec(rulesContent)) !== null) {
    const inner = match[1].trim();
    if (inner.toLowerCase() === "name" || inner.toLowerCase() === "username") continue;
    
    // Split by last space (assuming URL has no spaces)
    const lastSpaceIdx = inner.lastIndexOf(" ");
    if (lastSpaceIdx > 0) {
      const btnText = inner.substring(0, lastSpaceIdx).trim();
      const btnUrl = inner.substring(lastSpaceIdx + 1).trim();
      if (btnUrl.startsWith("http")) {
        buttons.push({ text: btnText, url: btnUrl });
        // remove this button definition from the text
        cleanText = cleanText.replace(match[0], "");
      }
    }
  }
  
  const rulesText = cleanText.trim();
  await memoryService.setGroupRules(msg.chat.id, rulesText, buttons);
  await bot.sendMessage(msg.chat.id, "Group rules and welcome message updated.");
}

function toCommand(text) {
  const [head] = text.trim().split(/\s+/);
  return head.split("@")[0].toLowerCase();
}

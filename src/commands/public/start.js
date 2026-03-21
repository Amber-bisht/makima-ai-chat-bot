import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { displayName } from "../../utils/telegram.js";

const startImagePath = fileURLToPath(new URL("../../../public/image.png", import.meta.url));

export function startWelcomeText(user, config) {
  const welcomeName = user?.username ? `@${user.username}` : displayName(user);
  return [
    `Welcome ${welcomeName}`,
    `I work in @${config.ownerUsername} Telegram Groups.`,
    `Please tag @${config.ownerUsername} or me or reply on my msg in a group to interact with me.`
  ].join("\n");
}

export async function startCommand(bot, msg, { config }) {
  const text = startWelcomeText(msg.from, config);
  if (existsSync(startImagePath)) {
    await bot.sendPhoto(msg.chat.id, startImagePath, { caption: text });
    return;
  }
  await bot.sendMessage(msg.chat.id, text);
}

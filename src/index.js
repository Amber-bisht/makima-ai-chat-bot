import { config } from "./config.js";
import { connectMongo } from "./db/mongo.js";
import { FastMemoryIndex } from "./ai/FastMemoryIndex.js";
import { GroqService } from "./ai/GroqService.js";
import { MemoryService } from "./ai/MemoryService.js";
import { WebContextService } from "./ai/WebContextService.js";

import { createBot } from "./core/bot.js";
import { setupEvents } from "./core/events.js";
import { CommandHandler } from "./commands/CommandHandler.js";

async function bootstrap() {
  await connectMongo(config.mongoUri);
  console.log("Connected to MongoDB");

  const cache = new FastMemoryIndex(config.cacheMaxUsers);
  const memoryService = new MemoryService({ cache });
  const groqService = new GroqService({
    apiKeys: config.groqApiKeys,
    model: config.groqModel
  });
  const webContextService = new WebContextService({
    newsApiKey: config.newsApiKey,
    tavilyApiKey: config.tavilyApiKey
  });

  const services = {
    memoryService,
    groqService,
    webContextService
  };

  const bot = await createBot(config);
  
  const botProfile = await bot.getMe();
  const botUserId = botProfile.id;
  const effectiveBotUsername =
    (config.botUsername || botProfile.username || "").replace(/^@/, "").toLowerCase() || null;

  const state = {
    botUserId,
    effectiveBotUsername,
    authorizedGroups: new Set(config.authGroupIds.map(String))
  };

  const commandHandler = new CommandHandler(bot, services, config);

  setupEvents(bot, services, commandHandler, config, state);

  await bot.startPolling();
  console.log("[STARTUP] Polling started with chat_member updates enabled.");

  console.log(
    `Bot is running as ${config.assistantName} (@${botProfile.username || "unknown"}). Authorized groups: ${config.authGroupIds.join(", ")}`
  );

  // Diagnostic check
  for (const gid of config.authGroupIds) {
    try {
      const chat = await bot.getChat(gid);
      const member = await bot.getChatMember(gid, botUserId);
      console.log(`[BOOTSTRAP] Group ${gid} (${chat.title || "No Title"}): Bot status is "${member.status}". Admin: ${member.status === "administrator" || member.status === "creator"}`);
    } catch (err) {
      console.error(`[BOOTSTRAP] Error checking group ${gid}: ${err.message}`);
    }
  }
}

bootstrap().catch((error) => {
  console.error("Fatal startup error:", error);
  process.exit(1);
});

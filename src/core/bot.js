import TelegramBot from "node-telegram-bot-api";

export async function createBot(config) {
  const ALL_ALLOWED_UPDATES = [
    "message", "edited_message", "channel_post", "edited_channel_post",
    "inline_query", "chosen_inline_result", "callback_query",
    "shipping_query", "pre_checkout_query", "poll", "poll_answer",
    "my_chat_member", "chat_member", "chat_join_request"
  ];

  const bot = new TelegramBot(config.telegramBotToken, {
    polling: {
      autoStart: false,
      interval: 300,
      params: { 
        timeout: 25,
        allowed_updates: ALL_ALLOWED_UPDATES
      }
    }
  });

  // IMPORTANT: Telegram requires allowed_updates to be a JSON-encoded array in form data.
  // The library sends it as-is, which may cause Telegram to silently ignore it.
  if (Array.isArray(bot.options.polling?.params?.allowed_updates)) {
    bot.options.polling.params.allowed_updates = JSON.stringify(bot.options.polling.params.allowed_updates);
  }

  // Monkey-patch processUpdate to log ALL raw updates (especially non-message ones)
  const originalProcessUpdate = bot.processUpdate.bind(bot);
  bot.processUpdate = function(update) {
    const keys = Object.keys(update).filter(k => k !== 'update_id');
    const type = keys[0] || 'unknown';
    if (type !== 'message') {
      console.log(`[RAW UPDATE] Type: ${type}, ID: ${update.update_id}, Keys: ${keys.join(', ')}`);
    }
    return originalProcessUpdate(update);
  };

  // Force-register with JSON-stringified allowed_updates, then start polling
  try {
    await bot.getUpdates({ timeout: 0, offset: -1, allowed_updates: JSON.stringify(ALL_ALLOWED_UPDATES) });
    console.log("[STARTUP] Successfully registered chat_member in allowed_updates with Telegram.");
  } catch (e) {
    console.warn("[STARTUP] Could not pre-register allowed_updates:", e.message);
  }

  function isTransientPollingError(error) {
    const msg = String(error?.message || "").toLowerCase();
    if (
      msg.includes("invalid token") ||
      msg.includes("401") ||
      msg.includes("unauthorized") ||
      msg.includes("forbidden")
    ) {
      return false;
    }
    return (
      msg.includes("etimedout") ||
      msg.includes("econnreset") ||
      msg.includes("eai_again") ||
      msg.includes("socket hang up") ||
      msg.includes("network")
    );
  }

  let pollingRestartTimer = null;
  async function schedulePollingRestart(delayMs = 5000) {
    if (pollingRestartTimer) return;
    pollingRestartTimer = setTimeout(async () => {
      pollingRestartTimer = null;
      try {
        const active = typeof bot.isPolling === "function" ? bot.isPolling() : false;
        if (!active && typeof bot.startPolling === "function") {
          await bot.startPolling();
          console.log("Telegram polling restarted after transient error.");
        }
      } catch (restartError) {
        console.error("Failed to restart Telegram polling:", restartError.message);
        await schedulePollingRestart(8000);
      }
    }, delayMs);
  }

  bot.on("polling_error", async (error) => {
    if (isTransientPollingError(error)) {
      console.warn("Telegram polling transient error:", error.message);
      await schedulePollingRestart();
      return;
    }
    console.error("Telegram polling error:", error.message);
  });

  bot.on("error", (err) => {
    console.error(`[BOT ERROR] ${err.message}`);
  });

  return bot;
}

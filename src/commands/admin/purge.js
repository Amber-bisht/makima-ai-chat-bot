export async function purgeCommand(bot, msg) {
  const targetMessage = msg.reply_to_message;
  if (!targetMessage) {
    await bot.sendMessage(msg.chat.id, "Reply to a message to /purge up to it.");
    return;
  }
  const startId = targetMessage.message_id;
  const endId = msg.message_id;
  
  if (startId >= endId) {
    return;
  }
  
  await bot.sendMessage(msg.chat.id, "You've sent `/purge`, I'm processing that command.", { parse_mode: "Markdown" });

  try {
    const idsToDelete = [];
    for(let i = startId; i <= endId; i++) {
      idsToDelete.push(i);
    }
    
    for (let i = 0; i < idsToDelete.length; i += 100) {
      const chunk = idsToDelete.slice(i, i + 100);
      try {
        if (typeof bot.deleteMessages === "function") {
          await bot.deleteMessages(msg.chat.id, chunk, { revokable: true }).catch(() => {
             return Promise.allSettled(chunk.map(id => bot.deleteMessage(msg.chat.id, id).catch(() => {})));
          });
        } else {
          await Promise.allSettled(chunk.map(id => bot.deleteMessage(msg.chat.id, id).catch(() => {})));
        }
      } catch (e) {
        await Promise.allSettled(chunk.map(id => bot.deleteMessage(msg.chat.id, id).catch(() => {})));
      }
    }
  } catch(e) {
    console.error("Purge error", e);
  }
}

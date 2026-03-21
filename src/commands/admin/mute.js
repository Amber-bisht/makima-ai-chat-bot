import { resolveTargetUser } from './utils.js';

export async function muteCommand(bot, msg, args, { memoryService }) {
  const targetUser = await resolveTargetUser(msg, args, memoryService);
  if (!targetUser) {
    await bot.sendMessage(msg.chat.id, "Reply to a user or specify @username/ID to /mute them.");
    return;
  }
  await bot.restrictChatMember(msg.chat.id, targetUser.id, {
    permissions: JSON.stringify({
      can_send_messages: false,
      can_send_media_messages: false,
      can_send_polls: false,
      can_send_other_messages: false,
      can_add_web_page_previews: false,
      can_change_info: false,
      can_invite_users: false,
      can_pin_messages: false
    })
  });
  await bot.sendMessage(msg.chat.id, `User ${targetUser.first_name} has been muted in this group.`);
}

export async function unmuteCommand(bot, msg, args, { memoryService }) {
  const targetUser = await resolveTargetUser(msg, args, memoryService);
  if (!targetUser) {
    await bot.sendMessage(msg.chat.id, "Reply to a user or specify @username/ID to /unmute them.");
    return;
  }
  await bot.restrictChatMember(msg.chat.id, targetUser.id, {
    permissions: JSON.stringify({
      can_send_messages: true,
      can_send_media_messages: true,
      can_send_polls: true,
      can_send_other_messages: true,
      can_add_web_page_previews: true,
      can_invite_users: true,
      can_change_info: true,
      can_pin_messages: true
    })
  });
  await bot.sendMessage(msg.chat.id, `User ${targetUser.first_name} has been unmuted in this group.`);
}

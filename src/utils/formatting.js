import { displayName } from "./telegram.js";

export function formatGroupName(chat) {
  if (chat.title) return chat.title;
  if (chat.username) return `@${chat.username}`;
  return String(chat.id);
}

export function formatNotificationMessage({ msg, cleanedText }) {
  const user = msg.from;
  const group = msg.chat;

  return [
    "User Request Notification",
    "",
    `User: ${displayName(user)}`,
    `User ID: ${user.id}`,
    `Group: ${formatGroupName(group)}`,
    "",
    "Message:",
    `"${cleanedText}"`
  ].join("\n");
}

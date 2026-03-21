export const resolveTargetUser = async (msg, args, memoryService) => {
  if (msg.reply_to_message?.from) {
    return msg.reply_to_message.from;
  }
  const input = args[0];
  if (!input) return null;
  if (/^-?\d+$/.test(input)) {
    return { id: Number(input), first_name: `User ${input}` };
  }
  if (input.startsWith('@')) {
    const userId = await memoryService.getUserIdByUsername(input);
    if (userId) return { id: userId, first_name: input };
  }
  return null;
};

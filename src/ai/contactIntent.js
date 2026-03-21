function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function isContactRequestIntent(text, ownerUsername, context = {}) {
  if (!text || !text.trim()) return false;
  const normalized = text.trim();
  const ownerMention = `@${ownerUsername.toLowerCase()}`;
  const isReplyToBot = Boolean(context.isReplyToBot);
  const isReplyToOwner = Boolean(context.isReplyToOwner);

  const patterns = [
    /\b(?:tell|ask|notify|inform|ping)\b.{0,40}\b(?:boss|owner|admin)\b.{0,30}\b(?:message|dm|contact|reach)\b/i,
    /\b(?:can|could|please)\b.{0,20}\b(?:your|the)\b.{0,10}\b(?:boss|owner|admin)\b.{0,20}\b(?:dm|message|contact|reach)\b.{0,10}\bme\b/i,
    /\b(?:notify|message|dm|contact)\b.{0,20}\b(?:the\s+)?owner\b/i,
    /\b(?:ask|tell)\b.{0,20}@[\w_]+\b.{0,20}\b(?:contact|message|dm|reach)\b.{0,10}\bme\b/i,
    /\b(?:can|could|pls|please)?\s*(?:u|you)\s*(?:tell|ask|inform|notify)\s*(?:him|her|them|owner|boss|@[\w_]+)?\s*(?:to)?\s*(?:msg|message|dm|contact|reach)\s*me\b/i,
    /\b(?:tell|ask)\s*(?:him|her|them|owner|boss|@[\w_]+)\s*(?:to)?\s*(?:msg|message|dm|contact|reach)\s*me\b/i
  ];

  if (patterns.some((pattern) => pattern.test(normalized))) {
    return true;
  }

  const ownerMessageRegex = new RegExp(
    `${escapeRegex(ownerMention)}.{0,25}\\b(?:contact|message|dm|reach|ping)\\b.{0,15}\\bme\\b`,
    "i"
  );
  if (ownerMessageRegex.test(normalized)) return true;

  if (
    (isReplyToBot || isReplyToOwner) &&
    /\b(?:msg|message|dm|contact|reach)\s+me\b/i.test(normalized) &&
    /\b(?:tell|ask|can|could|please|u|you|him|her|them)\b/i.test(normalized)
  ) {
    return true;
  }

  return false;
}

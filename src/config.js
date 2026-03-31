import dotenv from "dotenv";

dotenv.config();

function requiredEnv(key) {
  const value = process.env[key];
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value.trim();
}

function toNumber(value, key) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric value for ${key}: ${value}`);
  }
  return parsed;
}

function toNumberList(value, key) {
  const tokens = String(value)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (!tokens.length) {
    throw new Error(`Missing numeric values for ${key}`);
  }

  const out = [];
  for (const token of tokens) {
    const num = Number(token);
    if (!Number.isFinite(num)) {
      throw new Error(`Invalid numeric value in ${key}: ${token}`);
    }
    out.push(num);
  }
  return out;
}

function toStringList(value, key) {
  const tokens = String(value)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (!tokens.length) {
    throw new Error(`Missing string values for ${key}`);
  }
  return tokens;
}

const ownerUsername = requiredEnv("OWNER_USERNAME").replace(/^@/, "").toLowerCase();
const botUsername = process.env.BOT_USERNAME?.trim().replace(/^@/, "").toLowerCase() || null;
const ownerUserId = toNumber(requiredEnv("OWNER_USER_ID"), "OWNER_USER_ID");
const ownerChatIdEnv = process.env.OWNER_CHAT_ID?.trim();
const groqApiKeysRaw = process.env.GROQ_API_KEYS?.trim();
const groqApiKeys = groqApiKeysRaw
  ? toStringList(groqApiKeysRaw, "GROQ_API_KEYS")
  : toStringList(requiredEnv("GROQ_API_KEY"), "GROQ_API_KEY");

export const config = {
  telegramBotToken: requiredEnv("TELEGRAM_BOT_TOKEN"),
  assistantName: process.env.ASSISTANT_NAME?.trim() || "Makima",
  ownerName: requiredEnv("OWNER_NAME"),
  ownerUsername,
  botUsername,
  ownerUserId,
  ownerChatId: ownerChatIdEnv ? toNumber(ownerChatIdEnv, "OWNER_CHAT_ID") : ownerUserId,
  authGroupIds: toNumberList(requiredEnv("AUTH_GROUP_IDS"), "AUTH_GROUP_IDS"),
  mongoUri: requiredEnv("MONGODB_URI"),
  groqApiKeys,
  newsApiKey: process.env.NEWS_API_KEY?.trim() || null,
  tavilyApiKey: process.env.TAVILY_API_KEY?.trim() || null,
  groqModel: process.env.GROQ_MODEL?.trim() || "qwen/qwen3-32b",
  cacheMaxUsers: Number(process.env.CACHE_MAX_USERS || 5000)
};

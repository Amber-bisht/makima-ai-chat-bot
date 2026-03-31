import dotenv from "dotenv";
import Groq from "groq-sdk";

dotenv.config();

function parseKeyList(raw) {
  return String(raw || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function maskKey(key) {
  if (!key) return "unknown";
  const normalized = String(key).trim();
  if (normalized.length <= 14) return `${normalized.slice(0, 4)}...`;
  return `${normalized.slice(0, 8)}...${normalized.slice(-4)}`;
}

function resolveKeysFromInput() {
  const cliValue = process.argv.slice(2).join(" ").trim();
  if (cliValue) {
    return parseKeyList(cliValue);
  }

  const keyListFromEnv = process.env.GROQ_API_KEYS?.trim();
  if (keyListFromEnv) {
    return parseKeyList(keyListFromEnv);
  }

  const singleOrList = process.env.GROQ_API_KEY?.trim();
  if (!singleOrList) return [];
  return parseKeyList(singleOrList);
}

function compactErrorMessage(error) {
  const status = error?.status || error?.response?.status || "unknown";
  const message = String(error?.message || "Unknown error").replace(/\s+/g, " ").trim();
  return `status=${status} message="${message}"`;
}

async function testOneKey({ key, model }) {
  const client = new Groq({ apiKey: key });

  await client.chat.completions.create({
    model,
    temperature: 0,
    max_tokens: 8,
    messages: [
      { role: "system", content: "Reply with one short word only." },
      { role: "user", content: "ping" }
    ]
  });
}

async function main() {
  const model = process.env.GROQ_MODEL?.trim() || "qwen/qwen3-32b";
  const keys = resolveKeysFromInput();

  if (!keys.length) {
    console.error("No Groq keys found. Set GROQ_API_KEYS or GROQ_API_KEY, or pass keys via CLI.");
    process.exit(1);
  }

  console.log(`Testing ${keys.length} key(s) with model: ${model}`);

  let okCount = 0;
  let failCount = 0;

  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    const label = `Key ${i + 1} (${maskKey(key)})`;
    try {
      await testOneKey({ key, model });
      okCount += 1;
      console.log(`PASS: ${label}`);
    } catch (error) {
      failCount += 1;
      console.log(`FAIL: ${label} -> ${compactErrorMessage(error)}`);
    }
  }

  console.log(`Summary: pass=${okCount} fail=${failCount}`);
  process.exit(okCount > 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("Groq key test script failed:", error);
  process.exit(1);
});

import Groq from "groq-sdk";

function compactText(value, maxLen = 240) {
  if (!value) return null;
  const cleaned = String(value).trim().replace(/\s+/g, " ");
  if (!cleaned) return null;
  return cleaned.length > maxLen ? `${cleaned.slice(0, maxLen - 3)}...` : cleaned;
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const item of value) {
    const text = compactText(item);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function extractJsonObject(text) {
  if (!text) return null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  const candidate = text.slice(start, end + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

function heuristicMemoryExtract(messageText) {
  const text = (messageText || "").trim();
  if (!text) {
    return {
      shouldStore: false,
      name: null,
      facts: [],
      pastQuestions: [],
      summary: null
    };
  }

  const lowered = text.toLowerCase();
  const nameMatch = text.match(/\b(?:my name is|i am|i'm)\s+([a-z][a-z0-9_-]{1,24})\b/i);
  const interestMatch = text.match(/\binterested in\s+([a-z0-9\s/+_-]{2,80})/i);
  const question = text.includes("?") ? compactText(text, 200) : null;
  const facts = [];

  if (interestMatch) {
    facts.push(`Interested in ${interestMatch[1].trim()}`);
  }

  const shouldStore =
    Boolean(nameMatch) ||
    Boolean(interestMatch) ||
    Boolean(question) ||
    /\bmy\s+name\s+is\b/.test(lowered);

  return {
    shouldStore,
    name: nameMatch ? nameMatch[1] : null,
    facts,
    pastQuestions: question ? [question] : [],
    summary: shouldStore ? compactText(text, 200) : null
  };
}

export class GroqService {
  constructor({ apiKeys = [], apiKey, model }) {
    const keys = Array.isArray(apiKeys) ? apiKeys : [];
    const mergedKeys = [...keys, apiKey].filter(Boolean);
    if (!mergedKeys.length) {
      throw new Error("GroqService requires at least one API key.");
    }

    this.clients = mergedKeys.map((key) => new Groq({ apiKey: key }));
    this.nextClientIndex = 0;
    this.model = model;
  }

  isRetryableKeyError(error) {
    const status = error?.status || error?.response?.status || 0;
    const message = String(error?.message || "").toLowerCase();
    const code = String(error?.code || error?.error?.code || "").toLowerCase();
    return (
      status === 429 ||
      status === 401 ||
      status === 403 ||
      code === "invalid_api_key" ||
      message.includes("invalid api key") ||
      message.includes("rate limit") ||
      message.includes("too many requests") ||
      message.includes("quota") ||
      message.includes("exceeded your current quota")
    );
  }

  async createCompletionWithFailover(payload) {
    let lastError = null;
    const total = this.clients.length;

    for (let attempt = 0; attempt < total; attempt += 1) {
      const idx = (this.nextClientIndex + attempt) % total;
      const client = this.clients[idx];

      try {
        const result = await client.chat.completions.create(payload);
        this.nextClientIndex = idx;
        return result;
      } catch (error) {
        lastError = error;
        if (this.isRetryableKeyError(error) && attempt < total - 1) {
          this.nextClientIndex = (idx + 1) % total;
          console.warn(
            `Groq key index ${idx + 1} failed (rate/auth/quota). Trying next key...`
          );
          continue;
        }
        throw error;
      }
    }

    throw lastError;
  }

  async generateOwnerReply({
    assistantName,
    ownerName,
    ownerUsername,
    groupTitle,
    currentDateTime,
    ownerFeedNotes,
    latestOwnerFeedNote,
    ownerKnowledgeNotes,
    externalWebContext,
    sarcasmMode,
    messageText,
    userMemory,
    groupContext,
    fromName
  }) {
    const memoryContext = {
      name: userMemory?.name || null,
      about: userMemory?.about || [],
      facts: userMemory?.facts || [],
      pastQuestions: userMemory?.pastQuestions || [],
      conversationSummaries: userMemory?.conversationSummaries || []
    };

    try {
      const completion = await this.createCompletionWithFailover({
        model: this.model,
        temperature: 0.4,
        max_tokens: 300,
        messages: [
          {
            role: "system",
            content: [
              `You are ${assistantName}, the personal AI assistant to ${ownerName}.`,
              `The owner's username is @${ownerUsername}.`,
              `Write replies in the first person as ${assistantName}. Only state that you are ${ownerName}'s assistant if explicitly asked who you are. Do not repeat it in every message.`,
              `Do NOT impersonate ${ownerName}.`,
              "Keep responses concise, conversational, and direct (1-4 short sentences).",
              "Do not ask too many questions to the user. Avoid ending your messages with questions unless absolutely necessary.",
              "You have been provided 'Shared owner knowledge' and 'Owner feed memory'.",
              "1. Owner /feed memory dictates the owner's current status, availability, and instructions.",
              "2. Shared owner knowledge represents factual ground truth about the owner and their work. If it contradicts your pre-trained AI knowledge, YOU MUST ABSOLUTELY TRUST AND USE THE PROVIDED KNOWLEDGE.",
              `Do not claim uncertainty when your provided memory or knowledge gives you the answer about ${ownerName}.`,
              sarcasmMode === "sarcastic"
                ? "Use a mildly sarcastic tone while still being helpful and respectful to users."
                : "Use a straightforward, friendly conversational tone.",
              "Provide answers smoothly. Do not say 'According to my memory' or 'My knowledge notes say'."
            ].join(" ")
          },
          {
            role: "user",
            content: [
              `Current datetime: ${currentDateTime || new Date().toISOString()}`,
              `Group: ${groupTitle || "Unknown Group"}`,
              `User: ${fromName || "Unknown"}`,
              `Recent Group Context:\n${groupContext || "None"}`,
              `Incoming message from user: ${messageText}`,
              `Known user memory for this specific user: ${JSON.stringify(memoryContext)}`,
              `Owner feed memory: ${JSON.stringify((ownerFeedNotes || []).slice(-25))}`,
              `Latest owner feed note: ${latestOwnerFeedNote || "None"}`,
              `Shared owner knowledge (/text): ${JSON.stringify((ownerKnowledgeNotes || []).slice(-80))}`,
              `External realtime context (weather/news/wiki/tavily): ${externalWebContext || "None"}`
            ].join("\n")
          }
        ]
      });

      const reply = completion.choices?.[0]?.message?.content?.trim();
      if (reply) return reply;
    } catch (error) {
      console.error("Groq reply generation failed:", error.message);
    }

    const knownName = userMemory?.name || fromName || "there";
    return `Hi ${knownName}, thanks for tagging me. Wait for sometime, I have hit my limit.`;
  }

  async extractMeaningfulMemory({ messageText, botReply }) {
    try {
      const completion = await this.createCompletionWithFailover({
        model: this.model,
        temperature: 0.1,
        max_tokens: 220,
        messages: [
          {
            role: "system",
            content: [
              "Extract only meaningful long-term user memory from one Telegram message.",
              "Ignore generic greetings and one-off chatter.",
              "Return ONLY valid JSON with keys:",
              'shouldStore (boolean), name (string|null), facts (string[]), pastQuestions (string[]), summary (string|null).'
            ].join(" ")
          },
          {
            role: "user",
            content: [
              `Message from user: ${messageText}`,
              `Bot reply: ${botReply}`
            ].join("\n")
          }
        ]
      });

      const content = completion.choices?.[0]?.message?.content || "";
      const parsed = extractJsonObject(content);
      if (!parsed) {
        return heuristicMemoryExtract(messageText);
      }

      const normalized = {
        shouldStore: Boolean(parsed.shouldStore ?? parsed.should_store),
        name: compactText(parsed.name, 80),
        facts: normalizeStringArray(parsed.facts),
        pastQuestions: normalizeStringArray(parsed.pastQuestions || parsed.past_questions),
        summary: compactText(parsed.summary, 220)
      };

      if (
        !normalized.shouldStore &&
        !normalized.name &&
        normalized.facts.length === 0 &&
        normalized.pastQuestions.length === 0 &&
        !normalized.summary
      ) {
        return { ...normalized, shouldStore: false };
      }

      return normalized;
    } catch (error) {
      console.error("Groq memory extraction failed:", error.message);
      return heuristicMemoryExtract(messageText);
    }
  }
}

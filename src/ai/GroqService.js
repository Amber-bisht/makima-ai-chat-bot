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

export function extractJsonObjects(text) {
  if (!text) return [];
  const results = [];
  let braceCount = 0;
  let startIdx = -1;

  for (let i = 0; i < text.length; i++) {
    if (text[i] === "{") {
      if (braceCount === 0) startIdx = i;
      braceCount++;
    } else if (text[i] === "}") {
      braceCount--;
      if (braceCount === 0 && startIdx !== -1) {
        const candidate = text.slice(startIdx, i + 1);
        try {
          const parsed = JSON.parse(candidate);
          if (parsed && typeof parsed === "object") {
            results.push(parsed);
          }
        } catch (e) {
          // ignore invalid partial matches
        }
        startIdx = -1;
      } else if (braceCount < 0) {
        braceCount = 0;
        startIdx = -1;
      }
    }
  }
  return results;
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
        max_tokens: 800,
        messages: [
          {
            role: "system",
            content: [
              `You are ${assistantName}, the personal AI assistant to ${ownerName}.`,
              `The owner's username is @${ownerUsername}.`,
              `The current date and time is ${currentDateTime || new Date().toLocaleString()}.`,
              `Knowledge Cutoff Note: Your internal training data is only up to mid-2023. FOR ANY QUESTIONS ABOUT CURRENT EVENTS, PUBLIC FIGURES, OR NEWS (like presidents, CMs, sports results), YOU MUST PRIORITIZE THE 'External realtime context' PROVIDED BELOW.`,
              `If you have already established a fact in this conversation based on 'External realtime context' (e.g., who a current leader is), CONTINUE to use that fact in follow-up messages, even if newer context is not provided for every single turn. Do NOT revert to your 2023 knowledge if you have already 'learned' a newer fact earlier in this chat.`,
              `Hallucination Guard: If 'External realtime context' is provided but doesn't clearly mention a specific name for a role (like a specific CM), do NOT guess or hallucinate a name. Instead, state what you know or admit the information is missing. Be extremely precise with names.`,
              `If the 'External realtime context' contains information that contradicts your training data, YOU MUST USE THE EXTERNAL CONTEXT.`,
              `Write replies in the first person as ${assistantName}. Only state that you are ${ownerName}'s assistant if explicitly asked who you are. Do not repeat it in every message.`,
              `Do NOT impersonate ${ownerName}.`,
              "Keep responses concise, conversational, and direct (1-4 short sentences).",
              "Do not ask too many questions to the user. Avoid ending your messages with questions unless absolutely necessary.",
              "If the user asks for an MCQ (Multiple Choice Question) or asks you to 'generate a question' (like for exams, AWS, etc.), YOU MUST RESPOND WITH A JSON OBJECT ONLY.",
              "If the user asks for multiple questions (e.g. 'mcq 5 about aws'), generate exactly that many JSON objects, one after another.",
              "The JSON object must have: { \"type\": \"poll\", \"question\": \"the question text\", \"options\": [\"opt1\", \"opt2\", \"opt3\", \"opt4\"], \"correct_option_id\": 0 }.",
              "CRITICAL: The 'correct_option_id' must be a 0-based index. If there are 4 options, the index must be 0, 1, 2, or 3. NEVER use an index out of bounds.",
              "The poll MUST be in 'quiz' mode (one correct answer).",
              "For ALL other normal conversation messages, respond with regular text as usual.",
              "You have been provided 'Shared owner knowledge' and 'Owner feed memory'.",
              "1. Owner /feed memory dictates the owner's current status, availability, and instructions.",
              "2. Shared owner knowledge represents factual ground truth about the owner and their work.",
              `Do not claim uncertainty when your provided memory, knowledge, or external context gives you the answer.`,
              sarcasmMode === "seductive"
                ? "Use a sexy, seductive, and playful tone that is alluring while still being helpful."
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
      const jsonObjects = extractJsonObjects(content);
      const parsed = jsonObjects[0] || null;
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

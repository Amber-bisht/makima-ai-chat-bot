import Groq from "groq-sdk";

const MODEL_ID = "qwen/qwen3-32b";

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

  async generateReply({
    assistantName,
    groupTitle,
    currentDateTime,
    messageText,
    userMemory,
    groupContext,
    fromName,
    webContextService
  }) {
    const memoryContext = {
      name: userMemory?.name || null,
      about: userMemory?.about || [],
      facts: userMemory?.facts || [],
      pastQuestions: userMemory?.pastQuestions || [],
      conversationSummaries: userMemory?.conversationSummaries || []
    };

    const messages = [
      {
        role: "system",
        content: [
          `You are ${assistantName}`,
          `The current date and time is ${currentDateTime || new Date().toLocaleString()}.`,
          `Knowledge Cutoff Note: Your internal training data is only up to mid-2023.`,
          `FOR ANY QUESTIONS ABOUT CURRENT EVENTS, PUBLIC FIGURES, OR NEWS, USE THE 'web_search' TOOL.`,
          `FOR GENERAL REFERENCE OR HISTORICAL FACTS ABOUT FAMOUS PEOPLE/PLACES, USE THE 'wiki_search' TOOL.`,
          `Use the provided 'User memory' and 'Recent Group Context' to make your replies personal, context-aware, and relevant to the ongoing conversation.`,
          `Write replies in the first person as ${assistantName}.`,
          "Keep responses concise, conversational, and direct (1-4 short sentences).",
          "If the user asks for an MCQ (Multiple Choice Question), YOU MUST RESPOND WITH A JSON OBJECT ONLY.",
          "The JSON object must have: { \"type\": \"poll\", \"question\": \"the question text\", \"options\": [\"opt1\", \"opt2\", \"opt3\", \"opt4\"], \"correct_option_id\": 0 }.",
          `Do not claim uncertainty when tools can give you the answer.`,
          "Use a seductive and playful tone that is alluring."
        ].join(" ")
      },
      {
        role: "user",
        content: [
          `Current datetime: ${currentDateTime || new Date().toISOString()}`,
          `Group: ${groupTitle || "Unknown Group"}`,
          `User: ${fromName || "Unknown"}`,
          `Recent Group Context:\n${groupContext || "None"}`,
          `Incoming message: ${messageText}`,
          `User memory: ${JSON.stringify(memoryContext)}`
        ].join("\n")
      }
    ];

    const tools = [
      {
        type: "function",
        function: {
          name: "web_search",
          description: "Search the web for current events, news, and real-time status updates.",
          parameters: {
            type: "object",
            properties: {
              query: { type: "string", description: "The search query." }
            },
            required: ["query"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "wiki_search",
          description: "Get summary of a topic from Wikipedia for historical facts or biography.",
          parameters: {
            type: "object",
            properties: {
              query: { type: "string", description: "The topic or person name." }
            },
            required: ["query"]
          }
        }
      }
    ];

    try {
      // Step 1: Initial call to see if tools are needed
      let completion = await this.createCompletionWithFailover({
        model: this.model,
        messages,
        tools,
        tool_choice: "auto",
        temperature: 0.4,
        max_tokens: 800
      });

      let responseMessage = completion.choices[0].message;

      // Step 2: Handle tool calls (up to 2 turns to prevent infinite loops)
      for (let turn = 0; turn < 2; turn++) {
        if (!responseMessage.tool_calls) break;

        messages.push(responseMessage);

        for (const toolCall of responseMessage.tool_calls) {
          const functionName = toolCall.function.name;
          const args = JSON.parse(toolCall.function.arguments);
          let result = "";

          if (functionName === "web_search") {
            result = await webContextService.getWebSearch(args.query);
          } else if (functionName === "wiki_search") {
            result = await webContextService.getWikipediaSummary(args.query);
          }

          messages.push({
            tool_call_id: toolCall.id,
            role: "tool",
            name: functionName,
            content: result
          });
        }

        completion = await this.createCompletionWithFailover({
          model: this.model,
          messages,
          tools,
          tool_choice: "auto"
        });
        responseMessage = completion.choices[0].message;
      }

      const reply = responseMessage.content?.trim();
      if (reply) return reply;
    } catch (error) {
      console.error("Groq tool-call reply generation failed:", error.message);
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

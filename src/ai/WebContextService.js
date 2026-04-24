function compactText(value, maxLen = 800) {
  if (!value) return "";
  const cleaned = String(value).replace(/\s+/g, " ").trim();
  return cleaned.length > maxLen ? `${cleaned.slice(0, maxLen - 3)}...` : cleaned;
}

async function fetchJson(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 100)}`);
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

export class WebContextService {
  constructor({ tavilyApiKey } = {}) {
    this.tavilyApiKey = tavilyApiKey || process.env.TAVILY_API_KEY || null;
  }

  async getWikipediaSummary(query) {
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query.replace(/\s+/g, "_"))}`;
    try {
      const data = await fetchJson(url, {}, 8000);
      return compactText(data.extract);
    } catch (err) {
      return `No Wikipedia entry found for "${query}".`;
    }
  }

  async getWebSearch(query) {
    if (!this.tavilyApiKey) return "Web search is currently disabled (missing API key).";
    try {
      const data = await fetchJson("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: this.tavilyApiKey,
          query: query,
          max_results: 3,
          search_depth: "basic"
        })
      }, 10000);

      if (data.answer) return compactText(data.answer);
      
      const results = (data.results || [])
        .map(r => `[${r.title}]: ${r.content}`)
        .join("\n\n");
      
      return results || `No web results found for "${query}".`;
    } catch (err) {
      return `Web search failed: ${err.message}`;
    }
  }
}

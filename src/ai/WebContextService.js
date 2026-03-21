function compactText(value, maxLen = 300) {
  if (!value) return "";
  const cleaned = String(value).replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  return cleaned.length > maxLen ? `${cleaned.slice(0, maxLen - 3)}...` : cleaned;
}

function containsAny(text, words) {
  const lower = text.toLowerCase();
  return words.some((word) => lower.includes(word));
}

function weatherCodeLabel(code) {
  const map = {
    0: "clear sky",
    1: "mainly clear",
    2: "partly cloudy",
    3: "overcast",
    45: "fog",
    48: "depositing rime fog",
    51: "light drizzle",
    53: "moderate drizzle",
    55: "dense drizzle",
    61: "slight rain",
    63: "moderate rain",
    65: "heavy rain",
    71: "slight snow",
    73: "moderate snow",
    75: "heavy snow",
    80: "rain showers",
    95: "thunderstorm"
  };
  return map[code] || "unknown weather";
}

async function fetchJson(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    const body = await response.text();
    let parsed = {};
    try {
      parsed = body ? JSON.parse(body) : {};
    } catch {
      parsed = {};
    }

    if (!response.ok) {
      const snippet = compactText(body, 180);
      throw new Error(`HTTP ${response.status} ${snippet}`.trim());
    }
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

function extractPersonQuery(text) {
  const patterns = [
    /\bwho is ([^?.,\n]{2,80})/i,
    /\btell me about ([^?.,\n]{2,80})/i,
    /\bdo you know(?: about)? ([^?.,\n]{2,80})/i,
    /\babout ([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})\b/
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const candidate = compactText(match[1], 90)
      .replace(/^@/, "")
      .replace(/[^\w\s.'-]/g, "")
      .trim();
    if (candidate.length >= 2) {
      return candidate;
    }
  }

  return null;
}

function extractWeatherLocation(text) {
  if (!containsAny(text, ["weather", "temperature", "forecast", "rain", "humidity"])) {
    return null;
  }

  const patterns = [
    /\b(?:weather|temperature|forecast)\s+(?:in|at|for)\s+([a-zA-Z][a-zA-Z\s,.-]{1,60})/i,
    /\bin\s+([a-zA-Z][a-zA-Z\s,.-]{1,60})\s+(?:today|now)\b/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return compactText(match[1], 70);
  }
  return null;
}

function extractNewsQuery(text) {
  if (!containsAny(text, ["news", "headline", "headlines", "latest", "update"])) {
    return null;
  }

  const explicit = text.match(/\b(?:news|headlines?)\s+(?:about|on|for)\s+([^?.,\n]{2,100})/i);
  if (explicit?.[1]) {
    return compactText(explicit[1], 80);
  }

  const cleaned = text
    .replace(/[@][a-zA-Z0-9_]+/g, "")
    .replace(/\b(?:latest|today|please|can you|could you)\b/gi, "")
    .replace(/\b(?:show|give|tell)\s+me\b/gi, "")
    .replace(/\b(?:news|headlines?)\b/gi, "")
    .replace(/[?]/g, "")
    .trim();

  return compactText(cleaned || "latest technology", 80);
}

export class WebContextService {
  constructor({ newsApiKey, tavilyApiKey }) {
    this.newsApiKey = newsApiKey || null;
    this.tavilyApiKey = tavilyApiKey || null;
  }

  async getWikipediaSummary(query) {
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`;
    try {
      const data = await fetchJson(url, {}, 9000);
      const extract = compactText(data.extract, 500);
      if (!extract) return null;

      return {
        source: "Wikipedia",
        text: `${data.title || query}: ${extract}`
      };
    } catch {
      return null;
    }
  }

  async getTavilySummary(query) {
    if (!this.tavilyApiKey) return null;
    try {
      const data = await fetchJson(
        "https://api.tavily.com/search",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            api_key: this.tavilyApiKey,
            query: `${query} person profile biography`,
            max_results: 3,
            search_depth: "basic"
          })
        },
        12000
      );

      const answer = compactText(data.answer, 400);
      if (answer) {
        return { source: "Tavily", text: answer };
      }

      const top = Array.isArray(data.results) ? data.results.slice(0, 3) : [];
      if (!top.length) return null;
      const joined = top
        .map((item) => compactText(item.content || item.snippet || item.title, 180))
        .filter(Boolean)
        .join(" | ");

      if (!joined) return null;
      return { source: "Tavily", text: joined };
    } catch {
      return null;
    }
  }

  async getWeatherContext(locationQuery) {
    if (!locationQuery) return null;
    try {
      const geocode = await fetchJson(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
          locationQuery
        )}&count=1&language=en&format=json`,
        {},
        9000
      );

      const place = geocode?.results?.[0];
      if (!place?.latitude || !place?.longitude) return null;

      const weather = await fetchJson(
        `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code&timezone=auto`,
        {},
        9000
      );

      const current = weather?.current;
      if (!current) return null;

      const locLabel = [place.name, place.admin1, place.country].filter(Boolean).join(", ");
      const line = [
        `Weather in ${locLabel}:`,
        `${current.temperature_2m}°C`,
        `${weatherCodeLabel(current.weather_code)}`,
        `humidity ${current.relative_humidity_2m}%`,
        `wind ${current.wind_speed_10m} km/h`
      ].join(", ");

      return compactText(line, 320);
    } catch {
      return null;
    }
  }

  async getNewsContext(newsQuery) {
    if (!this.newsApiKey || !newsQuery) return null;
    try {
      const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(
        newsQuery
      )}&pageSize=3&sortBy=publishedAt&language=en&apiKey=${encodeURIComponent(this.newsApiKey)}`;

      const data = await fetchJson(url, {}, 12000);
      const articles = Array.isArray(data.articles) ? data.articles.slice(0, 3) : [];
      if (!articles.length) return null;

      const lines = articles
        .map((article, idx) => {
          const title = compactText(article.title, 130);
          const source = compactText(article?.source?.name, 50);
          if (!title) return null;
          return `${idx + 1}. ${title}${source ? ` (${source})` : ""}`;
        })
        .filter(Boolean);

      if (!lines.length) return null;
      return `Latest news on "${newsQuery}": ${lines.join(" | ")}`;
    } catch {
      return null;
    }
  }

  async buildContextForMessage(messageText) {
    const text = compactText(messageText, 600);
    if (!text) return null;

    const sections = [];

    const personQuery = extractPersonQuery(text);
    if (personQuery) {
      const wiki = await this.getWikipediaSummary(personQuery);
      if (wiki?.text) {
        sections.push(`Person info (${wiki.source}): ${wiki.text}`);
      } else {
        const tavily = await this.getTavilySummary(personQuery);
        if (tavily?.text) {
          sections.push(`Person info (${tavily.source}): ${tavily.text}`);
        }
      }
    }

    const weatherLocation = extractWeatherLocation(text);
    if (weatherLocation) {
      const weather = await this.getWeatherContext(weatherLocation);
      if (weather) sections.push(weather);
    }

    const newsQuery = extractNewsQuery(text);
    if (newsQuery) {
      const news = await this.getNewsContext(newsQuery);
      if (news) sections.push(news);
    }

    return sections.length ? sections.join("\n") : null;
  }
}

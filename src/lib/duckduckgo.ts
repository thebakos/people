export interface SearchResult {
  url: string;
  title: string;
  snippet: string;
}

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
];

function randomUA(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/**
 * Search DuckDuckGo HTML endpoint with retry logic.
 * Tries POST first, then GET as fallback. Retries up to 2 times.
 */
export async function searchDuckDuckGo(
  query: string
): Promise<SearchResult[]> {
  // Try up to 3 attempts (initial + 2 retries) with increasing timeout
  for (let attempt = 0; attempt < 3; attempt++) {
    const timeoutMs = 15000 + attempt * 10000; // 15s, 25s, 35s

    try {
      const results = await ddgFetchPost(query, timeoutMs);
      if (results.length > 0) return results;

      // If POST returned 0 results, try GET on first attempt only
      if (attempt === 0) {
        const getResults = await ddgFetchGet(query, timeoutMs);
        if (getResults.length > 0) return getResults;
      }
    } catch (e) {
      console.error(`[ddg] Attempt ${attempt + 1} failed: ${e instanceof Error ? e.message : e}`);
    }

    // Wait before retrying (2s, 4s)
    if (attempt < 2) await delay(2000 * (attempt + 1));
  }

  return [];
}

/** POST to DuckDuckGo HTML endpoint */
async function ddgFetchPost(query: string, timeoutMs: number): Promise<SearchResult[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch("https://html.duckduckgo.com/html/", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": randomUA(),
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      body: `q=${encodeURIComponent(query)}`,
      signal: controller.signal,
    });

    if (!response.ok) {
      console.error(`[ddg] POST error: ${response.status}`);
      return [];
    }

    const html = await response.text();
    return parseDDGResults(html);
  } finally {
    clearTimeout(timeout);
  }
}

/** GET from DuckDuckGo lite endpoint (alternative to POST) */
async function ddgFetchGet(query: string, timeoutMs: number): Promise<SearchResult[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": randomUA(),
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      console.error(`[ddg] GET lite error: ${response.status}`);
      return [];
    }

    const html = await response.text();
    return parseDDGLiteResults(html);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Search Bing as a fallback when DuckDuckGo is unavailable.
 */
export async function searchBing(query: string): Promise<SearchResult[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=20`;
    const response = await fetch(url, {
      headers: {
        "User-Agent": randomUA(),
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      console.error(`[bing] Search error: ${response.status}`);
      return [];
    }

    const html = await response.text();
    return parseBingResults(html);
  } catch (e) {
    console.error(`[bing] Fetch failed: ${e instanceof Error ? e.message : e}`);
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Parse DuckDuckGo HTML search result page into structured results.
 */
function parseDDGResults(html: string): SearchResult[] {
  const results: SearchResult[] = [];

  // Match each result link and title
  const linkRegex =
    /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
  // Match snippets
  const snippetRegex =
    /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;

  const links: { url: string; title: string }[] = [];
  let match;

  while ((match = linkRegex.exec(html)) !== null) {
    const rawHref = match[1];
    const title = stripHtml(match[2]).trim();

    // Extract actual URL from DuckDuckGo redirect
    const url = extractUrl(rawHref);
    if (url && title) {
      links.push({ url, title });
    }
  }

  const snippets: string[] = [];
  while ((match = snippetRegex.exec(html)) !== null) {
    snippets.push(stripHtml(match[1]).trim());
  }

  for (let i = 0; i < links.length; i++) {
    results.push({
      url: links[i].url,
      title: links[i].title,
      snippet: snippets[i] || "",
    });
  }

  return results;
}

/**
 * Parse DuckDuckGo Lite search result page.
 */
function parseDDGLiteResults(html: string): SearchResult[] {
  const results: SearchResult[] = [];

  // DDG Lite uses a table-based layout
  // Links are in <a class="result-link"> or plain <a> inside result rows
  const linkRegex = /<a[^>]*href="([^"]*)"[^>]*class="result-link"[^>]*>([\s\S]*?)<\/a>/g;
  let match;

  while ((match = linkRegex.exec(html)) !== null) {
    const url = stripHtml(match[1]).trim();
    const title = stripHtml(match[2]).trim();
    if (url && title && url.startsWith("http")) {
      results.push({ url, title, snippet: "" });
    }
  }

  // Fallback: try to extract any http links that look like results
  if (results.length === 0) {
    const genericRegex = /<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    const seen = new Set<string>();
    while ((match = genericRegex.exec(html)) !== null) {
      const url = match[1];
      const title = stripHtml(match[2]).trim();
      if (
        url && title && title.length > 5 &&
        !url.includes("duckduckgo.com") &&
        !seen.has(url)
      ) {
        seen.add(url);
        results.push({ url, title, snippet: "" });
      }
    }
  }

  return results;
}

/**
 * Parse Bing search result page.
 */
function parseBingResults(html: string): SearchResult[] {
  const results: SearchResult[] = [];

  // Bing results are in <li class="b_algo"> blocks
  // Each has <h2><a href="URL">Title</a></h2> and <p class="b_lineclamp...">snippet</p>
  const blockRegex = /<li[^>]*class="b_algo"[^>]*>([\s\S]*?)<\/li>/g;
  let blockMatch;

  while ((blockMatch = blockRegex.exec(html)) !== null) {
    const block = blockMatch[1];

    // Extract link and title from <h2><a href="...">...</a></h2>
    const linkMatch = block.match(/<h2[^>]*>\s*<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/);
    if (!linkMatch) continue;

    const url = linkMatch[1];
    const title = stripHtml(linkMatch[2]).trim();

    // Extract snippet
    const snippetMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/);
    const snippet = snippetMatch ? stripHtml(snippetMatch[1]).trim() : "";

    if (url && title && url.startsWith("http")) {
      results.push({ url, title, snippet });
    }
  }

  return results;
}

/**
 * Extract the real URL from a DuckDuckGo redirect link.
 * DDG wraps results like: //duckduckgo.com/l/?uddg=https%3A%2F%2F...&rut=...
 */
function extractUrl(rawHref: string): string {
  // Check for uddg parameter (DDG redirect)
  const uddgMatch = rawHref.match(/[?&]uddg=([^&]+)/);
  if (uddgMatch) {
    return decodeURIComponent(uddgMatch[1]);
  }

  // Direct URL
  let url = rawHref;
  if (url.startsWith("//")) {
    url = "https:" + url;
  }
  if (url.startsWith("http")) {
    return url;
  }

  return "";
}

/**
 * Strip HTML tags from a string.
 */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

/**
 * Delay utility for rate limiting between searches.
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

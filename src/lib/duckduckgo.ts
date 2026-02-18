export interface SearchResult {
  url: string;
  title: string;
  snippet: string;
}

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/**
 * Search DuckDuckGo HTML endpoint (free, no API key required).
 * Returns parsed search results.
 */
export async function searchDuckDuckGo(
  query: string
): Promise<SearchResult[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch("https://html.duckduckgo.com/html/", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": USER_AGENT,
      },
      body: `q=${encodeURIComponent(query)}`,
      signal: controller.signal,
    });

    if (!response.ok) {
      console.error(`DuckDuckGo search error: ${response.status}`);
      return [];
    }

    const html = await response.text();
    return parseSearchResults(html);
  } catch (e) {
    console.error(`DuckDuckGo fetch failed: ${e instanceof Error ? e.message : e}`);
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Parse DuckDuckGo HTML search result page into structured results.
 */
function parseSearchResults(html: string): SearchResult[] {
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

import { searchDuckDuckGo, searchBing, delay, SearchResult } from "./duckduckgo";

export interface FoundEmployee {
  name: string;
  linkedinUrl: string;
  headline: string;
}

/**
 * Search using DuckDuckGo first, then Bing as fallback.
 */
async function webSearch(query: string): Promise<SearchResult[]> {
  const results = await searchDuckDuckGo(query);
  if (results.length > 0) return results;

  console.log(`[search] DDG returned 0 results, trying Bing...`);
  return searchBing(query);
}

/**
 * Extract the company name from a LinkedIn company URL by searching DuckDuckGo.
 * Falls back to Bing, then to parsing the URL slug.
 */
export async function getCompanyName(companyUrl: string): Promise<string> {
  try {
    const results = await webSearch(companyUrl);
    // The first result is usually the company's LinkedIn page
    // Title format: "Company Name | LinkedIn" or "Company Name: Overview | LinkedIn"
    for (const r of results) {
      if (r.url.includes("linkedin.com/company")) {
        const title = r.title;
        // Remove " | LinkedIn", " - LinkedIn", ": Overview | LinkedIn" etc.
        const cleaned = title
          .replace(/\s*[|\-–]\s*LinkedIn.*$/i, "")
          .replace(/:\s*Overview.*$/i, "")
          .trim();
        if (cleaned) {
          return cleaned;
        }
      }
    }
  } catch (e) {
    console.error("Company name lookup failed:", e);
  }

  return extractCompanySlug(companyUrl);
}

/**
 * Search for professionals at a company using web search (DDG → Bing).
 * Tries progressively broader queries to maximize results.
 */
export async function searchEmployees(
  companyUrl: string,
  companyName: string,
  limit: number = 5
): Promise<FoundEmployee[]> {
  const employees: FoundEmployee[] = [];
  const seenUrls = new Set<string>();

  // Progressively broader queries — stop as soon as we hit the limit
  const queries = [
    // Query 1: Role-specific (most precise)
    `site:linkedin.com/in "${companyName}" partner OR director OR principal OR associate OR VP`,
    // Query 2: Industry terms
    `site:linkedin.com/in "${companyName}" investment OR venture OR fund OR managing`,
    // Query 3: Broad — just company name on LinkedIn profiles
    `site:linkedin.com/in "${companyName}"`,
    // Query 4: Without quotes (catches partial matches)
    `site:linkedin.com/in ${companyName}`,
  ];

  for (let i = 0; i < queries.length && employees.length < limit; i++) {
    if (i > 0) await delay(1000);

    try {
      const results = await webSearch(queries[i]);
      console.log(`[search] Query ${i + 1}: "${queries[i].slice(0, 60)}..." → ${results.length} results`);

      for (const result of results) {
        if (employees.length >= limit) break;

        // Only consider linkedin.com/in/ profile pages
        if (!result.url.includes("linkedin.com/in/")) continue;

        // Normalize URL to avoid duplicates
        const normalizedUrl = normalizeLinkedInUrl(result.url);
        if (seenUrls.has(normalizedUrl)) continue;
        seenUrls.add(normalizedUrl);

        // Parse name from the LinkedIn title
        const name = parseNameFromTitle(result.title);
        if (!name) continue;

        const headline = parseHeadlineFromTitle(result.title);

        employees.push({
          name,
          linkedinUrl: normalizedUrl,
          headline,
        });
      }
    } catch (e) {
      console.error(`[search] Query ${i + 1} failed:`, e);
    }
  }

  return employees;
}

/**
 * Parse a person's name from a LinkedIn search result title.
 * LinkedIn titles are typically: "John Smith - Partner at Acme | LinkedIn"
 */
function parseNameFromTitle(title: string): string {
  // Remove " | LinkedIn", " - LinkedIn" suffix
  let cleaned = title
    .replace(/\s*[|\-–]\s*LinkedIn.*$/i, "")
    .trim();

  // The name is usually the first part before " - " or " – "
  const dashIndex = cleaned.search(/\s[-–]\s/);
  if (dashIndex > 0) {
    cleaned = cleaned.substring(0, dashIndex).trim();
  }

  // Validate: a name should have at least 2 parts and be reasonable length
  const parts = cleaned.split(/\s+/);
  if (parts.length >= 2 && cleaned.length <= 60 && cleaned.length >= 3) {
    return cleaned;
  }

  // If single word but looks like a name, still return it
  if (parts.length === 1 && cleaned.length >= 2 && cleaned.length <= 30) {
    return cleaned;
  }

  return "";
}

/**
 * Parse headline/title from a LinkedIn search result title.
 * From "John Smith - Partner at Acme | LinkedIn" → "Partner at Acme"
 */
function parseHeadlineFromTitle(title: string): string {
  let cleaned = title.replace(/\s*[|\-–]\s*LinkedIn.*$/i, "").trim();

  const dashMatch = cleaned.match(/\s[-–]\s(.+)/);
  if (dashMatch) {
    return dashMatch[1].trim();
  }

  return "";
}

/**
 * Normalize a LinkedIn profile URL to a consistent format.
 */
function normalizeLinkedInUrl(url: string): string {
  try {
    const parsed = new URL(url);
    // Remove query params and trailing slashes
    let path = parsed.pathname.replace(/\/+$/, "");
    return `https://www.linkedin.com${path}`;
  } catch {
    return url;
  }
}

/**
 * Extract a readable company name from the LinkedIn URL slug.
 */
function extractCompanySlug(url: string): string {
  const match = url.match(/linkedin\.com\/company\/([^/?#]+)/);
  if (match) {
    return match[1]
      .replace(/-/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return "Unknown Company";
}

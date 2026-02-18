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
 * Search for investment professionals at a company using DuckDuckGo.
 * Searches for LinkedIn profiles associated with the company in investment roles.
 */
export async function searchEmployees(
  companyUrl: string,
  companyName: string,
  limit: number = 5
): Promise<FoundEmployee[]> {
  const roleTerms = "partner OR director OR principal OR associate OR vice president";
  const query = `site:linkedin.com/in "${companyName}" ${roleTerms}`;

  const results = await webSearch(query);

  const employees: FoundEmployee[] = [];
  const seenUrls = new Set<string>();

  for (const result of results) {
    if (employees.length >= limit) break;

    // Only consider linkedin.com/in/ profile pages
    if (!result.url.includes("linkedin.com/in/")) continue;

    // Normalize URL to avoid duplicates
    const normalizedUrl = normalizeLinkedInUrl(result.url);
    if (seenUrls.has(normalizedUrl)) continue;
    seenUrls.add(normalizedUrl);

    // Parse name from the LinkedIn title
    // Format: "FirstName LastName - Title at Company | LinkedIn"
    const name = parseNameFromTitle(result.title);
    if (!name) continue;

    // Extract headline (the part after the name)
    const headline = parseHeadlineFromTitle(result.title);

    employees.push({
      name,
      linkedinUrl: normalizedUrl,
      headline,
    });
  }

  // If first query didn't find enough, try a more specific search
  if (employees.length < limit) {
    await delay(1000);
    const query2 = `site:linkedin.com/in "${companyName}" investment OR venture OR fund`;
    const results2 = await webSearch(query2);

    for (const result of results2) {
      if (employees.length >= limit) break;
      if (!result.url.includes("linkedin.com/in/")) continue;

      const normalizedUrl = normalizeLinkedInUrl(result.url);
      if (seenUrls.has(normalizedUrl)) continue;
      seenUrls.add(normalizedUrl);

      const name = parseNameFromTitle(result.title);
      if (!name) continue;

      const headline = parseHeadlineFromTitle(result.title);

      employees.push({
        name,
        linkedinUrl: normalizedUrl,
        headline,
      });
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

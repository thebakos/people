import { delay } from "./duckduckgo";
import { searchEmployees } from "./linkedinSearch";

const LINKEDIN_API_BASE = "https://www.linkedin.com/voyager/api";

interface LinkedInEmployee {
  name: string;
  headline: string;
  linkedinUrl: string;
}

/**
 * Build headers for LinkedIn Voyager API JSON requests.
 */
function buildApiHeaders(liAtCookie: string): Record<string, string> {
  const csrfToken = `ajax:${Date.now()}`;
  return {
    Cookie: `li_at=${liAtCookie}; JSESSIONID="${csrfToken}"`,
    "Csrf-Token": csrfToken,
    "X-Restli-Protocol-Version": "2.0.0",
    "X-Li-Lang": "en_US",
    "X-Li-Track": '{"clientVersion":"1.13.8286","mpVersion":"1.13.8286","osName":"web","timezoneOffset":-5,"deviceFormFactor":"DESKTOP","mpName":"voyager-web","displayDensity":1}',
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    Accept: "application/vnd.linkedin.normalized+json+2.1",
    "Accept-Language": "en-US,en;q=0.9",
    Referer: "https://www.linkedin.com/search/results/people/",
    Origin: "https://www.linkedin.com",
  };
}

/**
 * Build headers for fetching LinkedIn HTML pages (browser-like).
 */
function buildPageHeaders(liAtCookie: string): Record<string, string> {
  const csrfToken = `ajax:${Date.now()}`;
  return {
    Cookie: `li_at=${liAtCookie}; JSESSIONID="${csrfToken}"`,
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
  };
}

function extractCompanySlug(url: string): string {
  const match = url.match(/linkedin\.com\/company\/([^/?#]+)/);
  return match ? match[1] : "";
}

// ---------------------------------------------------------------------------
// COMPANY INFO (Voyager API — works reliably)
// ---------------------------------------------------------------------------

/**
 * Get company info (name, numeric ID, website) from LinkedIn Voyager API.
 */
export async function getCompanyInfo(
  companyUrl: string,
  liAtCookie: string
): Promise<{ companyName: string; companyId: string; websiteUrl: string }> {
  const slug = extractCompanySlug(companyUrl);
  if (!slug) throw new Error("Could not extract company slug from URL");

  const headers = buildApiHeaders(liAtCookie);
  const url = `${LINKEDIN_API_BASE}/organization/companies?decorationId=com.linkedin.voyager.deco.organization.web.WebFullCompanyMain-12&q=universalName&universalName=${encodeURIComponent(slug)}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(url, { headers, signal: controller.signal });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error("LinkedIn authentication failed. Your session cookie may have expired.");
      }
      throw new Error(`LinkedIn company lookup error: ${response.status}`);
    }

    const json = await response.json();
    const included = (json.included || []) as Record<string, unknown>[];
    const dataObj = json.data as Record<string, unknown> | undefined;

    let companyName = slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    let companyId = "";
    let websiteUrl = "";

    // Scan all included entities for company info
    for (const entity of included) {
      // Extract website URL from any entity that has one
      if (!websiteUrl) {
        const site = entity.companyPageUrl || entity.websiteUrl || entity.website || entity.url;
        if (typeof site === "string" && site.startsWith("http") && !site.includes("linkedin.com")) {
          websiteUrl = site;
        }
      }

      // Strategy 1: Entity whose universalName matches the slug
      if (!companyId && entity.universalName === slug) {
        if (entity.name) companyName = String(entity.name);
        const entityUrn = String(entity.entityUrn || "");
        const idMatch = entityUrn.match(/(?:company|fs_normalized_company|fsd_company):(\d+)/);
        if (idMatch) companyId = idMatch[1];
      }

      // Strategy 2: Company-typed entities
      if (!companyId) {
        const type = String(entity.$type || "");
        if (type.includes("organization.Company") || type.includes("organization.Organization")) {
          if (entity.name) companyName = String(entity.name);
          const entityUrn = String(entity.entityUrn || "");
          const idMatch = entityUrn.match(/(?:company|fs_normalized_company):(\d+)/);
          if (idMatch) companyId = idMatch[1];
        }
      }
    }

    // Strategy 3: data object reference
    if (!companyId && dataObj) {
      const dataStr = JSON.stringify(dataObj);
      const idMatch = dataStr.match(/urn:li:(?:company|fs_normalized_company|fsd_company):(\d+)/);
      if (idMatch) companyId = idMatch[1];
    }

    // Strategy 4: Any URN containing company:<id>
    if (!companyId) {
      for (const entity of included) {
        const entityUrn = String(entity.entityUrn || "");
        const idMatch = entityUrn.match(/urn:li:company:(\d+)/);
        if (idMatch) {
          companyId = idMatch[1];
          if (entity.name) companyName = String(entity.name);
          break;
        }
      }
    }

    // Strategy 5: Search all string values
    if (!companyId) {
      for (const entity of included) {
        for (const value of Object.values(entity)) {
          const str = String(value || "");
          const idMatch = str.match(/(?:company|fs_normalized_company|fs_miniCompany):(\d+)/);
          if (idMatch) { companyId = idMatch[1]; break; }
        }
        if (companyId) break;
      }
    }

    // Try to get company name from included entities if still default
    const defaultName = slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    if (companyId && companyName === defaultName) {
      for (const entity of included) {
        if (entity.name && String(entity.entityUrn || "").includes(companyId)) {
          companyName = String(entity.name);
          break;
        }
      }
    }

    if (!companyId) {
      throw new Error(`Could not find company ID for "${slug}".`);
    }

    console.log(`[company] Website URL from LinkedIn: ${websiteUrl || "(none)"}`);
    return { companyName, companyId, websiteUrl };
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// HTML PAGE SCRAPING — Primary approach for finding employees
// ---------------------------------------------------------------------------

/** Extract text from a LinkedIn title/subtitle field */
function extractText(value: unknown): string {
  if (!value) return "";
  if (typeof value === "object" && value !== null) {
    const obj = value as Record<string, unknown>;
    if (typeof obj.text === "string") return obj.text;
  }
  if (typeof value === "string") return value;
  return "";
}

/** Extract a clean LinkedIn profile URL from a navigation URL */
function extractProfileUrl(rawUrl: string): string {
  const match = rawUrl.match(/linkedin\.com\/in\/([^/?#]+)/);
  if (match) return `https://www.linkedin.com/in/${match[1]}`;
  return "";
}

/**
 * Parse all JSON payloads from <code> blocks in a LinkedIn HTML page.
 * Returns an array of all `included` entity arrays found.
 */
function parseCodeBlocks(html: string): Record<string, unknown>[][] {
  const results: Record<string, unknown>[][] = [];
  const codeRegex = /<code[^>]*>([\s\S]*?)<\/code>/g;
  let match;
  while ((match = codeRegex.exec(html)) !== null) {
    try {
      const decoded = match[1]
        .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&").replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
      const data = JSON.parse(decoded);
      if (data.included && Array.isArray(data.included)) {
        results.push(data.included as Record<string, unknown>[]);
      }
    } catch {
      // Not valid JSON — skip
    }
  }
  return results;
}

/**
 * Extract SEARCH RESULT employees from LinkedIn embedded JSON.
 * Only extracts from EntityResultViewModel (actual search results),
 * NOT from random MiniProfiles (which include sidebar, suggestions, etc.).
 */
function extractSearchResultEmployees(
  allIncluded: Record<string, unknown>[][],
  limit: number,
): LinkedInEmployee[] {
  const employees: LinkedInEmployee[] = [];
  const seen = new Set<string>();

  // Strategy 1: EntityResultViewModel — these ARE the search results
  for (const included of allIncluded) {
    for (const entity of included) {
      if (employees.length >= limit) break;

      const type = String(entity.$type || "");
      if (!type.includes("EntityResultViewModel") && !type.includes("SearchHitV2")) continue;

      const name = extractText(entity.title);
      if (!name || name === "LinkedIn Member") continue;

      // Get headline
      const headline = extractText(entity.primarySubtitle) || extractText(entity.headline);

      // Get profile URL from various fields
      let profileUrl = "";
      if (typeof entity.navigationUrl === "string") {
        profileUrl = extractProfileUrl(entity.navigationUrl);
      }
      if (!profileUrl) {
        const navCtx = entity.navigationContext;
        if (navCtx && typeof navCtx === "object") {
          const url = (navCtx as Record<string, unknown>).url;
          if (typeof url === "string") profileUrl = extractProfileUrl(url);
        }
      }

      if (!profileUrl) continue;
      if (seen.has(profileUrl)) continue;
      seen.add(profileUrl);

      employees.push({ name, headline, linkedinUrl: profileUrl });
    }
  }

  // Strategy 2: If no EntityResultViewModels found, try MiniProfiles
  // but only those that look like they're from search results
  // (have an occupation/headline, are not the same as the logged-in user)
  if (employees.length === 0) {
    // First, collect all MiniProfile URNs that are referenced by result entities
    const resultProfileUrns = new Set<string>();
    for (const included of allIncluded) {
      for (const entity of included) {
        const type = String(entity.$type || "");
        if (type.includes("SearchHit") || type.includes("EntityResult") || type.includes("ResultCard")) {
          // These entities reference profiles via URN strings in their fields
          const jsonStr = JSON.stringify(entity);
          const urnMatches = jsonStr.match(/urn:li:(?:fs_miniProfile|fsd_profile):[^"]+/g);
          if (urnMatches) {
            for (const urn of urnMatches) resultProfileUrns.add(urn);
          }
        }
      }
    }

    for (const included of allIncluded) {
      for (const entity of included) {
        if (employees.length >= limit) break;

        const type = String(entity.$type || "");
        if (!type.includes("MiniProfile") && !type.includes("identity.shared.MiniProfile")) continue;
        if (!entity.publicIdentifier || !entity.firstName) continue;

        // If we have result URNs, only include matching MiniProfiles
        if (resultProfileUrns.size > 0) {
          const entityUrn = String(entity.entityUrn || "");
          if (!resultProfileUrns.has(entityUrn)) continue;
        }

        const firstName = String(entity.firstName || "");
        const lastName = String(entity.lastName || "");
        const name = `${firstName} ${lastName}`.trim();
        const publicId = String(entity.publicIdentifier || "");

        if (!name || name === "LinkedIn Member" || !publicId) continue;

        const profileUrl = `https://www.linkedin.com/in/${publicId}`;
        if (seen.has(profileUrl)) continue;
        seen.add(profileUrl);

        employees.push({
          name,
          headline: String(entity.occupation || entity.headline || ""),
          linkedinUrl: profileUrl,
        });
      }
    }
  }

  return employees;
}

/**
 * Fetch a LinkedIn page and extract employee data from search results.
 */
async function fetchAndExtractSearchResults(
  pageUrl: string,
  headers: Record<string, string>,
  limit: number,
  employees: LinkedInEmployee[],
  seen: Set<string>
): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  let response: Response;
  try {
    response = await fetch(pageUrl, { headers, signal: controller.signal, redirect: "follow" });
  } finally {
    clearTimeout(timeout);
  }

  console.log(`[html] ${pageUrl.slice(0, 80)}... → ${response.status}`);
  if (!response.ok) return;

  const html = await response.text();
  console.log(`[html] Got ${html.length} chars`);

  const allIncluded = parseCodeBlocks(html);
  console.log(`[html] Found ${allIncluded.length} JSON payloads with included arrays`);

  const newEmployees = extractSearchResultEmployees(allIncluded, limit);
  console.log(`[html] Extracted ${newEmployees.length} search result employees`);

  for (const emp of newEmployees) {
    if (employees.length >= limit) break;
    if (seen.has(emp.linkedinUrl)) continue;
    seen.add(emp.linkedinUrl);
    employees.push(emp);
  }
}

/**
 * Search for company employees by scraping the LinkedIn search results page.
 */
async function scrapeSearchResults(
  companyId: string,
  liAtCookie: string,
  limit: number
): Promise<LinkedInEmployee[]> {
  const headers = buildPageHeaders(liAtCookie);
  const employees: LinkedInEmployee[] = [];
  const seen = new Set<string>();

  // Page 1
  const searchUrl = `https://www.linkedin.com/search/results/people/?currentCompany=%5B%22${companyId}%22%5D&origin=COMPANY_PAGE_CANNED_SEARCH`;
  console.log(`[html] Fetching search results page for company ${companyId}...`);
  await fetchAndExtractSearchResults(searchUrl, headers, limit, employees, seen);
  console.log(`[html] After page 1: ${employees.length} employees`);

  // Page 2 if needed
  if (employees.length > 0 && employees.length < limit) {
    await delay(800);
    await fetchAndExtractSearchResults(`${searchUrl}&page=2`, headers, limit, employees, seen);
    console.log(`[html] After page 2: ${employees.length} employees`);
  }

  return employees;
}

/**
 * Fallback: scrape the company's /people/ page.
 */
async function scrapeCompanyPeoplePage(
  companySlug: string,
  liAtCookie: string,
  limit: number
): Promise<LinkedInEmployee[]> {
  const headers = buildPageHeaders(liAtCookie);
  const employees: LinkedInEmployee[] = [];
  const seen = new Set<string>();

  const pageUrl = `https://www.linkedin.com/company/${companySlug}/people/`;
  console.log(`[html] Fetching company people page...`);
  await fetchAndExtractSearchResults(pageUrl, headers, limit, employees, seen);
  console.log(`[html] Company people page: ${employees.length} employees`);

  return employees;
}

// ---------------------------------------------------------------------------
// PUBLIC API
// ---------------------------------------------------------------------------

/**
 * Find employees at a LinkedIn company URL.
 *
 * Strategy: search page HTML → company /people/ page → web search
 */
export async function findCompanyEmployees(
  companyUrl: string,
  liAtCookie: string,
  limit: number = 10
): Promise<{
  companyName: string;
  employees: LinkedInEmployee[];
  websiteUrl: string;
}> {
  console.log(`[linkedin] Looking up company: ${companyUrl}`);
  const { companyName, companyId, websiteUrl } = await getCompanyInfo(companyUrl, liAtCookie);
  console.log(`[linkedin] Company: ${companyName} (ID: ${companyId}, website: ${websiteUrl || "none"})`);

  const slug = extractCompanySlug(companyUrl);
  await delay(500);

  // 1. Scrape LinkedIn search results page (primary)
  console.log(`[linkedin] Scraping search results page...`);
  let employees = await scrapeSearchResults(companyId, liAtCookie, limit);

  // 2. Scrape company people page (fallback)
  if (employees.length === 0 && slug) {
    console.log(`[linkedin] Search page empty, trying company people page...`);
    await delay(500);
    employees = await scrapeCompanyPeoplePage(slug, liAtCookie, limit);
  }

  // 3. Web search fallback (DDG → Bing)
  if (employees.length === 0) {
    console.log(`[linkedin] All LinkedIn methods failed, trying web search...`);
    employees = await searchEmployees(companyUrl, companyName, limit);
    console.log(`[linkedin] Web search: ${employees.length} employees`);
  } else {
    console.log(`[linkedin] Found: ${employees.length} employees`);
  }

  return { companyName, employees, websiteUrl };
}

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
 * Build headers for fetching LinkedIn HTML pages (like a browser).
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

/**
 * Get company info (name + numeric ID) from LinkedIn using the Voyager API.
 * This endpoint still works reliably.
 */
export async function getCompanyInfo(
  companyUrl: string,
  liAtCookie: string
): Promise<{ companyName: string; companyId: string }> {
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

    // Strategy 1: Entity whose universalName matches the slug
    for (const entity of included) {
      if (entity.universalName === slug) {
        if (entity.name) companyName = String(entity.name);
        const entityUrn = String(entity.entityUrn || "");
        const idMatch = entityUrn.match(/(?:company|fs_normalized_company|fsd_company):(\d+)/);
        if (idMatch) { companyId = idMatch[1]; break; }
      }
    }

    // Strategy 2: Company-typed entities
    if (!companyId) {
      for (const entity of included) {
        const type = String(entity.$type || "");
        if (type.includes("organization.Company") || type.includes("organization.Organization")) {
          if (entity.name) companyName = String(entity.name);
          const entityUrn = String(entity.entityUrn || "");
          const idMatch = entityUrn.match(/(?:company|fs_normalized_company):(\d+)/);
          if (idMatch) { companyId = idMatch[1]; break; }
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
      throw new Error(`Could not find company ID for "${slug}". Got ${included.length} included entities but no company URN found.`);
    }

    return { companyName, companyId };
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// PRIMARY APPROACH: Scrape LinkedIn search results HTML page
// ---------------------------------------------------------------------------

/**
 * Fetch a LinkedIn page and extract MiniProfile data from embedded JSON.
 * LinkedIn SSR pages contain <code> blocks with JSON payloads that include
 * the rendered data — this is the same data React hydrates on the client.
 */
async function fetchAndExtractProfiles(
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

  // Parse all <code> blocks — LinkedIn embeds JSON data in these
  const codeRegex = /<code[^>]*>([\s\S]*?)<\/code>/g;
  let match;
  while ((match = codeRegex.exec(html)) !== null && employees.length < limit) {
    try {
      const decoded = match[1]
        .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&").replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
      const data = JSON.parse(decoded);
      extractMiniProfiles(data, employees, seen, limit);
    } catch {
      // Not valid JSON — skip
    }
  }

  // Also check <script type="application/json"> blocks
  const scriptRegex = /<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/g;
  while ((match = scriptRegex.exec(html)) !== null && employees.length < limit) {
    try {
      const data = JSON.parse(match[1]);
      extractMiniProfiles(data, employees, seen, limit);
    } catch {
      // Not valid JSON
    }
  }
}

/**
 * Extract MiniProfile entities from a JSON structure (recursive).
 * LinkedIn includes profile data in `included` arrays within its JSON payloads.
 */
function extractMiniProfiles(
  data: unknown,
  employees: LinkedInEmployee[],
  seen: Set<string>,
  limit: number,
  depth: number = 0
): void {
  if (employees.length >= limit || depth > 5 || !data || typeof data !== "object") return;

  // If it has an `included` array, scan it for MiniProfile entities
  if (!Array.isArray(data) && typeof data === "object") {
    const obj = data as Record<string, unknown>;

    // Check `included` array (standard Voyager response shape)
    const included = obj.included;
    if (Array.isArray(included)) {
      for (const entity of included) {
        if (employees.length >= limit) break;
        if (!entity || typeof entity !== "object") continue;
        const record = entity as Record<string, unknown>;
        tryAddProfile(record, employees, seen);
      }
    }

    // Check if this object itself is a profile
    tryAddProfile(obj, employees, seen);

    // Recurse into object values
    for (const value of Object.values(obj)) {
      if (employees.length >= limit) break;
      if (typeof value === "object" && value !== null) {
        extractMiniProfiles(value, employees, seen, limit, depth + 1);
      }
    }
  }

  // Recurse into arrays
  if (Array.isArray(data)) {
    for (const item of data) {
      if (employees.length >= limit) break;
      extractMiniProfiles(item, employees, seen, limit, depth + 1);
    }
  }
}

/** Try to add a record as a profile if it has the right fields */
function tryAddProfile(
  record: Record<string, unknown>,
  employees: LinkedInEmployee[],
  seen: Set<string>
): boolean {
  const type = String(record.$type || "");

  // MiniProfile entity (most common)
  if (type.includes("MiniProfile") || type.includes("identity.shared.MiniProfile") ||
      (record.publicIdentifier && record.firstName)) {
    const firstName = String(record.firstName || "");
    const lastName = String(record.lastName || "");
    const name = `${firstName} ${lastName}`.trim();
    const publicId = String(record.publicIdentifier || "");

    if (!name || name === "LinkedIn Member" || !publicId) return false;

    const profileUrl = `https://www.linkedin.com/in/${publicId}`;
    if (seen.has(profileUrl)) return false;
    seen.add(profileUrl);

    employees.push({
      name,
      headline: String(record.occupation || record.headline || ""),
      linkedinUrl: profileUrl,
    });
    return true;
  }

  return false;
}

/**
 * Search for company employees by scraping the LinkedIn search results page.
 * This fetches the actual HTML that a browser would see and parses the
 * embedded JSON data from <code> blocks.
 */
async function scrapeSearchResults(
  companyId: string,
  liAtCookie: string,
  limit: number
): Promise<LinkedInEmployee[]> {
  const headers = buildPageHeaders(liAtCookie);
  const employees: LinkedInEmployee[] = [];
  const seen = new Set<string>();

  // Fetch the people search results page filtered by company
  const searchUrl = `https://www.linkedin.com/search/results/people/?currentCompany=%5B%22${companyId}%22%5D&origin=COMPANY_PAGE_CANNED_SEARCH`;
  console.log(`[html] Fetching search results page for company ${companyId}...`);
  await fetchAndExtractProfiles(searchUrl, headers, limit, employees, seen);
  console.log(`[html] Search page: ${employees.length} employees found`);

  // If we need more, try page 2
  if (employees.length > 0 && employees.length < limit) {
    await delay(800);
    const page2Url = `${searchUrl}&page=2`;
    await fetchAndExtractProfiles(page2Url, headers, limit, employees, seen);
    console.log(`[html] After page 2: ${employees.length} employees total`);
  }

  return employees;
}

/**
 * Fallback: scrape the company's /people/ page for embedded employee data.
 */
async function scrapeCompanyPeoplePage(
  companySlug: string,
  liAtCookie: string,
  limit: number
): Promise<LinkedInEmployee[]> {
  const headers = buildPageHeaders(liAtCookie);
  const employees: LinkedInEmployee[] = [];
  const seen = new Set<string>();

  // The company people page
  const pageUrl = `https://www.linkedin.com/company/${companySlug}/people/`;
  console.log(`[html] Fetching company people page...`);
  await fetchAndExtractProfiles(pageUrl, headers, limit, employees, seen);
  console.log(`[html] Company people page: ${employees.length} employees found`);

  // Also try the main company page
  if (employees.length < limit) {
    await delay(500);
    const mainUrl = `https://www.linkedin.com/company/${companySlug}/`;
    await fetchAndExtractProfiles(mainUrl, headers, limit, employees, seen);
    console.log(`[html] After main page: ${employees.length} employees total`);
  }

  return employees;
}

/**
 * High-level function: find employees at a LinkedIn company URL.
 *
 * Strategy (in order):
 * 1. Scrape LinkedIn search results page HTML (most reliable)
 * 2. Scrape company /people/ page HTML
 * 3. Fall back to web search (DDG → Bing)
 */
export async function findCompanyEmployees(
  companyUrl: string,
  liAtCookie: string,
  limit: number = 10
): Promise<{
  companyName: string;
  employees: LinkedInEmployee[];
}> {
  // Get company info via Voyager API (this endpoint works reliably)
  console.log(`[linkedin] Looking up company: ${companyUrl}`);
  const { companyName, companyId } = await getCompanyInfo(companyUrl, liAtCookie);
  console.log(`[linkedin] Company found: ${companyName} (ID: ${companyId})`);

  const slug = extractCompanySlug(companyUrl);
  await delay(500);

  // 1. Scrape LinkedIn search results page (primary)
  console.log(`[linkedin] Scraping search results page for employees...`);
  let employees = await scrapeSearchResults(companyId, liAtCookie, limit);

  // 2. Scrape company people page (fallback)
  if (employees.length === 0 && slug) {
    console.log(`[linkedin] Search page returned 0, trying company people page...`);
    await delay(500);
    employees = await scrapeCompanyPeoplePage(slug, liAtCookie, limit);
  }

  // 3. Web search fallback (DDG → Bing)
  if (employees.length === 0) {
    console.log(`[linkedin] All LinkedIn methods failed, falling back to web search...`);
    employees = await searchEmployees(companyUrl, companyName, limit);
    console.log(`[linkedin] Web search fallback found: ${employees.length} employees`);
  } else {
    console.log(`[linkedin] Found: ${employees.length} employees`);
  }

  return { companyName, employees };
}

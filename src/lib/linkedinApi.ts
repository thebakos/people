import { delay } from "./duckduckgo";
import { searchEmployees } from "./linkedinSearch";

const LINKEDIN_API_BASE = "https://www.linkedin.com/voyager/api";

interface LinkedInEmployee {
  name: string;
  headline: string;
  linkedinUrl: string;
}

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

function extractCompanySlug(url: string): string {
  const match = url.match(/linkedin\.com\/company\/([^/?#]+)/);
  return match ? match[1] : "";
}

/** Quick fetch with timeout */
async function apiFetch(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number = 10000
): Promise<{ ok: boolean; status: number; json: Record<string, unknown> | null }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    if (!response.ok) return { ok: false, status: response.status, json: null };
    const json = await response.json();
    return { ok: true, status: response.status, json };
  } catch {
    return { ok: false, status: -1, json: null };
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// LOGGED-IN USER IDENTIFICATION — to exclude from results
// ---------------------------------------------------------------------------

/**
 * Get the logged-in user's publicIdentifier via /voyager/api/me.
 * Returns null on failure (non-fatal).
 */
async function getLoggedInUserId(headers: Record<string, string>): Promise<string | null> {
  try {
    const result = await apiFetch(`${LINKEDIN_API_BASE}/me`, headers);
    if (!result.ok || !result.json) return null;

    const included = (result.json.included || []) as Record<string, unknown>[];
    for (const entity of included) {
      if (entity.publicIdentifier && typeof entity.publicIdentifier === "string") {
        console.log(`[linkedin] Logged-in user: ${entity.publicIdentifier}`);
        return entity.publicIdentifier;
      }
    }

    // Also check the top-level data
    const data = result.json.data as Record<string, unknown> | undefined;
    if (data?.publicIdentifier && typeof data.publicIdentifier === "string") {
      return data.publicIdentifier;
    }

    // Try miniProfile in data
    const mp = (data as Record<string, unknown>)?.["*miniProfile"];
    if (typeof mp === "string") {
      const match = mp.match(/fs_miniProfile:(.+)/);
      if (match) {
        // The miniProfile URN contains the member ID, not the publicIdentifier
        // Look through included for the matching profile
        for (const entity of included) {
          const urn = String(entity.entityUrn || "");
          if (urn.includes(match[1]) && entity.publicIdentifier) {
            return String(entity.publicIdentifier);
          }
        }
      }
    }
  } catch (e) {
    console.log(`[linkedin] Could not identify logged-in user: ${e instanceof Error ? e.message : e}`);
  }
  return null;
}

// ---------------------------------------------------------------------------
// COMPANY INFO (Voyager API — works reliably)
// ---------------------------------------------------------------------------

export async function getCompanyInfo(
  companyUrl: string,
  liAtCookie: string
): Promise<{ companyName: string; companyId: string; websiteUrl: string }> {
  const slug = extractCompanySlug(companyUrl);
  if (!slug) throw new Error("Could not extract company slug from URL");

  const headers = buildApiHeaders(liAtCookie);
  const url = `${LINKEDIN_API_BASE}/organization/companies?decorationId=com.linkedin.voyager.deco.organization.web.WebFullCompanyMain-12&q=universalName&universalName=${encodeURIComponent(slug)}`;

  const result = await apiFetch(url, headers);

  if (!result.ok || !result.json) {
    if (result.status === 401 || result.status === 403) {
      throw new Error("LinkedIn authentication failed. Your session cookie may have expired.");
    }
    throw new Error(`LinkedIn company lookup error: ${result.status}`);
  }

  const json = result.json;
  const included = (json.included || []) as Record<string, unknown>[];
  const dataObj = json.data as Record<string, unknown> | undefined;

  let companyName = slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  let companyId = "";
  let websiteUrl = "";

  for (const entity of included) {
    if (!websiteUrl) {
      const site = entity.companyPageUrl || entity.websiteUrl || entity.website || entity.url;
      if (typeof site === "string" && site.startsWith("http") && !site.includes("linkedin.com")) {
        websiteUrl = site;
      }
    }

    if (!companyId && entity.universalName === slug) {
      if (entity.name) companyName = String(entity.name);
      const entityUrn = String(entity.entityUrn || "");
      const idMatch = entityUrn.match(/(?:company|fs_normalized_company|fsd_company):(\d+)/);
      if (idMatch) companyId = idMatch[1];
    }

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

  if (!companyId && dataObj) {
    const dataStr = JSON.stringify(dataObj);
    const idMatch = dataStr.match(/urn:li:(?:company|fs_normalized_company|fsd_company):(\d+)/);
    if (idMatch) companyId = idMatch[1];
  }

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

  const defaultName = slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  if (companyId && companyName === defaultName) {
    for (const entity of included) {
      if (entity.name && String(entity.entityUrn || "").includes(companyId)) {
        companyName = String(entity.name);
        break;
      }
    }
  }

  if (!companyId) throw new Error(`Could not find company ID for "${slug}".`);

  console.log(`[company] ${companyName} (ID: ${companyId}, website: ${websiteUrl || "none"})`);
  return { companyName, companyId, websiteUrl };
}

// ---------------------------------------------------------------------------
// VOYAGER SEARCH API — Try Voyager search endpoints (may work for some cookies)
// ---------------------------------------------------------------------------

/**
 * Try the Voyager search/dash/clusters API with a few key formats.
 * Kept lean — only tries 2 decoration IDs × 2 query formats = 4 requests max.
 */
async function tryVoyagerSearch(
  companyId: string,
  headers: Record<string, string>,
  limit: number,
  excludeIds: Set<string>
): Promise<LinkedInEmployee[]> {
  const decoIds = [
    "com.linkedin.voyager.dash.deco.search.SearchClusterCollection-193",
    "com.linkedin.voyager.dash.deco.search.SearchClusterCollection-187",
  ];

  const queries = [
    `(flagshipSearchIntent:SEARCH_SRP,queryParameters:List((key:currentCompany,value:List(${companyId})),(key:resultType,value:List(PEOPLE))),includeFiltersInResponse:false)`,
    `(flagshipSearchIntent:SEARCH_SRP,queryParameters:(currentCompany:List(${companyId}),resultType:List(PEOPLE)),includeFiltersInResponse:false)`,
  ];

  for (const query of queries) {
    for (const decoId of decoIds) {
      const url =
        `${LINKEDIN_API_BASE}/search/dash/clusters` +
        `?decorationId=${encodeURIComponent(decoId)}` +
        `&origin=COMPANY_PAGE_CANNED_SEARCH` +
        `&q=all` +
        `&query=${encodeURIComponent(query)}` +
        `&start=0&count=${Math.min(49, limit)}`;

      const result = await apiFetch(url, headers);
      const decoShort = decoId.slice(-3);
      console.log(`[voyager] deco=${decoShort} → ${result.status}`);

      if (result.ok && result.json) {
        const employees = parseVoyagerSearchResults(result.json, limit, excludeIds);
        if (employees.length > 0) {
          console.log(`[voyager] Found ${employees.length} employees`);
          return employees;
        }
      }

      if (result.status === 400) continue; // Try next format
      if (result.status === 401 || result.status === 403) return []; // Auth issue, stop
    }
  }

  return [];
}

/**
 * Try Voyager GraphQL search endpoint.
 */
async function tryGraphQLSearch(
  companyId: string,
  headers: Record<string, string>,
  limit: number,
  excludeIds: Set<string>
): Promise<LinkedInEmployee[]> {
  const queryIds = [
    "voyagerSearchDashClusters.b0928897b71bd00a5a7291755dcd64f0",
    "voyagerSearchDashClusters.66adc6056cf4138949ca5dcb31bb1749",
  ];

  const variables = `(start:0,origin:COMPANY_PAGE_CANNED_SEARCH,query:(flagshipSearchIntent:SEARCH_SRP,queryParameters:List((key:currentCompany,value:List(${companyId})),(key:resultType,value:List(PEOPLE))),includeFiltersInResponse:false),count:${Math.min(49, limit)})`;

  for (const queryId of queryIds) {
    const url =
      `${LINKEDIN_API_BASE}/graphql` +
      `?includeWebMetadata=true` +
      `&variables=${encodeURIComponent(variables)}` +
      `&queryId=${queryId}`;

    const result = await apiFetch(url, headers);
    console.log(`[graphql] queryId=${queryId.slice(-8)} → ${result.status}`);

    if (result.ok && result.json) {
      const employees = parseVoyagerSearchResults(result.json, limit, excludeIds);
      if (employees.length > 0) return employees;
    }
  }

  return [];
}

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

/**
 * Parse Voyager search API JSON response.
 * Looks for EntityResultViewModel, SearchHitV2, and MiniProfile entities.
 * ALWAYS filters out the logged-in user.
 */
function parseVoyagerSearchResults(
  json: Record<string, unknown>,
  limit: number,
  excludeIds: Set<string>
): LinkedInEmployee[] {
  const employees: LinkedInEmployee[] = [];
  const included = (json.included || []) as Record<string, unknown>[];
  const seen = new Set<string>();

  // Strategy 1: EntityResultViewModel (modern search results)
  for (const entity of included) {
    if (employees.length >= limit) break;

    const type = String(entity.$type || "");
    if (!type.includes("EntityResultViewModel") && !type.includes("SearchHitV2")) continue;

    const name = extractText(entity.title);
    if (!name || name === "LinkedIn Member") continue;

    const headline = extractText(entity.primarySubtitle) || extractText(entity.headline);

    let profileUrl = "";
    if (typeof entity.navigationUrl === "string") {
      const m = entity.navigationUrl.match(/linkedin\.com\/in\/([^/?#]+)/);
      if (m) profileUrl = `https://www.linkedin.com/in/${m[1]}`;
    }
    if (!profileUrl) {
      const navCtx = entity.navigationContext;
      if (navCtx && typeof navCtx === "object") {
        const u = (navCtx as Record<string, unknown>).url;
        if (typeof u === "string") {
          const m = u.match(/linkedin\.com\/in\/([^/?#]+)/);
          if (m) profileUrl = `https://www.linkedin.com/in/${m[1]}`;
        }
      }
    }

    if (!profileUrl) continue;
    const publicId = profileUrl.replace("https://www.linkedin.com/in/", "");
    if (excludeIds.has(publicId)) continue;
    if (seen.has(profileUrl)) continue;
    seen.add(profileUrl);

    employees.push({ name, headline, linkedinUrl: profileUrl });
  }

  // Strategy 2: MiniProfile entities — ONLY if referenced by search result entities
  if (employees.length === 0) {
    // Collect URNs referenced by search entities
    const resultUrns = new Set<string>();
    for (const entity of included) {
      const type = String(entity.$type || "");
      if (type.includes("SearchHit") || type.includes("EntityResult") || type.includes("ResultCard")) {
        const jsonStr = JSON.stringify(entity);
        const urnMatches = jsonStr.match(/urn:li:(?:fs_miniProfile|fsd_profile):[^"]+/g);
        if (urnMatches) for (const urn of urnMatches) resultUrns.add(urn);
      }
    }

    // CRITICAL: Only use MiniProfiles if we found explicit result URN references.
    // If resultUrns is empty, the page has NO search results — don't grab random MiniProfiles.
    if (resultUrns.size > 0) {
      for (const entity of included) {
        if (employees.length >= limit) break;
        const type = String(entity.$type || "");
        if (!type.includes("MiniProfile")) continue;
        const entityUrn = String(entity.entityUrn || "");
        if (!resultUrns.has(entityUrn)) continue;

        const publicId = String(entity.publicIdentifier || "");
        if (!publicId || excludeIds.has(publicId)) continue;

        const firstName = String(entity.firstName || "");
        const lastName = String(entity.lastName || "");
        const name = `${firstName} ${lastName}`.trim();
        if (!name || name === "LinkedIn Member") continue;

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

// ---------------------------------------------------------------------------
// VOYAGER ORGANIZATION EMPLOYEES — different endpoint from search
// ---------------------------------------------------------------------------

/**
 * Try Voyager endpoints for company employees that are NOT the search API.
 * These are the endpoints behind the People tab on company pages.
 */
async function tryOrganizationEmployees(
  companyId: string,
  companySlug: string,
  headers: Record<string, string>,
  limit: number,
  excludeIds: Set<string>
): Promise<LinkedInEmployee[]> {
  const count = Math.min(49, limit);

  // Several known organization employee endpoint patterns
  const endpoints = [
    // GraphQL organization employees queries (queryIds change with deployments)
    `${LINKEDIN_API_BASE}/graphql?variables=(start:0,count:${count},companyUniversalName:${companySlug})&queryId=voyagerOrganizationDashEmployees.b0928897b71bd00a5a7291755dcd64f0`,
    `${LINKEDIN_API_BASE}/graphql?variables=(start:0,count:${count},companyUniversalName:${companySlug})&queryId=voyagerOrganizationDashEmployees.66adc6056cf4138949ca5dcb31bb1749`,
    `${LINKEDIN_API_BASE}/graphql?variables=(start:0,count:${count},companyUrn:urn%3Ali%3Afsd_company%3A${companyId})&queryId=voyagerOrganizationDashEmployees.b0928897b71bd00a5a7291755dcd64f0`,
    // REST-style organization endpoints
    `${LINKEDIN_API_BASE}/organization/dash/companies?decorationId=com.linkedin.voyager.dash.deco.organization.MemberCompany-28&q=search&companyId=${companyId}&start=0&count=${count}`,
    // Recommendations/similar people at company
    `${LINKEDIN_API_BASE}/graphql?variables=(companyId:${companyId},count:${count},start:0)&queryId=voyagerOrganizationDashRecommendedEmployees.b0928897b71bd00a5a7291755dcd64f0`,
  ];

  for (const url of endpoints) {
    const result = await apiFetch(url, headers, 8000);
    const shortUrl = url.replace(LINKEDIN_API_BASE, "").slice(0, 60);
    console.log(`[org] ${shortUrl}... → ${result.status}`);

    if (result.ok && result.json) {
      const employees = parseVoyagerSearchResults(result.json, limit, excludeIds);
      if (employees.length > 0) {
        console.log(`[org] Found ${employees.length} employees!`);
        return employees;
      }

      // Also try raw MiniProfile extraction for org responses
      // (org endpoints might return employee MiniProfiles directly)
      const included = (result.json.included || []) as Record<string, unknown>[];
      const orgEmployees: LinkedInEmployee[] = [];
      const seen = new Set<string>();
      for (const entity of included) {
        if (orgEmployees.length >= limit) break;
        const type = String(entity.$type || "");
        if (!type.includes("MiniProfile")) continue;
        const publicId = String(entity.publicIdentifier || "");
        if (!publicId || excludeIds.has(publicId)) continue;
        const firstName = String(entity.firstName || "");
        const lastName = String(entity.lastName || "");
        const name = `${firstName} ${lastName}`.trim();
        if (!name || name === "LinkedIn Member") continue;
        const profileUrl = `https://www.linkedin.com/in/${publicId}`;
        if (seen.has(profileUrl)) continue;
        seen.add(profileUrl);
        orgEmployees.push({
          name,
          headline: String(entity.occupation || entity.headline || ""),
          linkedinUrl: profileUrl,
        });
      }
      if (orgEmployees.length > 0) {
        console.log(`[org] Found ${orgEmployees.length} employees from MiniProfiles`);
        return orgEmployees;
      }
    }
  }

  return [];
}

// ---------------------------------------------------------------------------
// PUBLIC API
// ---------------------------------------------------------------------------

/**
 * Find employees at a LinkedIn company URL.
 *
 * Strategy:
 * 1. Identify logged-in user (to exclude from results)
 * 2. Try Voyager search API (lean: 4 attempts max)
 * 3. Try Voyager GraphQL search (2 attempts)
 * 4. Try organization employees API endpoints (5 attempts)
 * 5. Fall back to web search (DDG → Bing)
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
  console.log(`[linkedin] Company: ${companyName} (ID: ${companyId})`);

  const slug = extractCompanySlug(companyUrl);
  const headers = buildApiHeaders(liAtCookie);

  // Identify logged-in user to always exclude them from results
  const loggedInUserId = await getLoggedInUserId(headers);
  const excludeIds = new Set<string>();
  if (loggedInUserId) excludeIds.add(loggedInUserId);

  await delay(300);

  // 1. Try Voyager search API (lean)
  console.log(`[linkedin] Trying Voyager search...`);
  let employees = await tryVoyagerSearch(companyId, headers, limit, excludeIds);

  // 2. Try GraphQL search
  if (employees.length === 0) {
    console.log(`[linkedin] Trying GraphQL search...`);
    employees = await tryGraphQLSearch(companyId, headers, limit, excludeIds);
  }

  // 3. Try organization employees endpoints
  if (employees.length === 0 && slug) {
    console.log(`[linkedin] Trying organization employees API...`);
    await delay(300);
    employees = await tryOrganizationEmployees(companyId, slug, headers, limit, excludeIds);
  }

  // 4. Web search fallback (DDG → Bing)
  if (employees.length === 0) {
    console.log(`[linkedin] All Voyager methods failed, trying web search...`);
    const webResults = await searchEmployees(companyUrl, companyName, limit);
    // Filter web results against logged-in user
    employees = webResults.filter(emp => {
      const m = emp.linkedinUrl.match(/linkedin\.com\/in\/([^/?#]+)/);
      return !m || !excludeIds.has(m[1]);
    });
    console.log(`[linkedin] Web search: ${employees.length} employees`);
  } else {
    console.log(`[linkedin] Found: ${employees.length} employees`);
  }

  return { companyName, employees, websiteUrl };
}

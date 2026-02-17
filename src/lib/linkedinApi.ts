import { delay } from "./duckduckgo";

const LINKEDIN_API_BASE = "https://www.linkedin.com/voyager/api";

interface LinkedInEmployee {
  name: string;
  headline: string;
  linkedinUrl: string;
}

/**
 * Fetch a real JSESSIONID from LinkedIn by hitting the feed page.
 * LinkedIn validates that the CSRF token matches a server-issued JSESSIONID,
 * so we can't just fabricate one.
 */
async function fetchJSessionId(liAtCookie: string): Promise<string | null> {
  try {
    const res = await fetch("https://www.linkedin.com/feed/", {
      headers: {
        Cookie: `li_at=${liAtCookie}`,
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      redirect: "manual",
    });

    // Extract JSESSIONID from Set-Cookie headers
    const setCookieHeaders = res.headers.getSetCookie?.() || [];
    for (const cookie of setCookieHeaders) {
      const match = cookie.match(/JSESSIONID="?([^";]+)"?/);
      if (match) return match[1];
    }

    // Try raw header as fallback
    const rawSetCookie = res.headers.get("set-cookie") || "";
    const match = rawSetCookie.match(/JSESSIONID="?([^";]+)"?/);
    if (match) return match[1];
  } catch {
    // ignore
  }
  return null;
}

/**
 * Build the required headers for LinkedIn Voyager API requests.
 * Uses a real JSESSIONID if provided, otherwise generates one.
 */
function buildHeaders(
  liAtCookie: string,
  jsessionId?: string | null
): Record<string, string> {
  const csrfToken = jsessionId || `ajax:${Date.now()}`;
  return {
    Cookie: `li_at=${liAtCookie}; JSESSIONID="${csrfToken}"`,
    "Csrf-Token": csrfToken,
    "X-Restli-Protocol-Version": "2.0.0",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept: "application/vnd.linkedin.normalized+json+2.1",
  };
}

/**
 * Extract the company slug from a LinkedIn company URL.
 */
function extractCompanySlug(url: string): string {
  const match = url.match(/linkedin\.com\/company\/([^/?#]+)/);
  return match ? match[1] : "";
}

/**
 * Validate that the LinkedIn cookie is still valid.
 * Returns the JSESSIONID to use for subsequent requests.
 */
export async function validateAuth(
  liAtCookie: string
): Promise<{ jsessionId: string; valid: boolean }> {
  // Step 1: Get a real JSESSIONID from LinkedIn
  const jsessionId = await fetchJSessionId(liAtCookie);
  const token = jsessionId || `ajax:${Date.now()}`;
  const headers = buildHeaders(liAtCookie, token);

  // Step 2: Test auth with /me endpoint
  try {
    const res = await fetch(`${LINKEDIN_API_BASE}/me`, { headers });
    return { jsessionId: token, valid: res.ok };
  } catch {
    return { jsessionId: token, valid: false };
  }
}

/**
 * Get company info (name + numeric ID) from LinkedIn using the Voyager API.
 * The response uses { data, included } format where entities are in `included`.
 */
export async function getCompanyInfo(
  companyUrl: string,
  liAtCookie: string,
  jsessionId?: string
): Promise<{ companyName: string; companyId: string }> {
  const slug = extractCompanySlug(companyUrl);
  if (!slug) {
    throw new Error("Could not extract company slug from URL");
  }

  const headers = buildHeaders(liAtCookie, jsessionId);

  const url = `${LINKEDIN_API_BASE}/organization/companies?decorationId=com.linkedin.voyager.deco.organization.web.WebFullCompanyMain-12&q=universalName&universalName=${encodeURIComponent(slug)}`;

  const response = await fetch(url, { headers });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        "LinkedIn authentication failed. Your session cookie may have expired."
      );
    }
    throw new Error(`LinkedIn company lookup error: ${response.status}`);
  }

  const json = await response.json();

  // Voyager API returns { data: ..., included: [...entities...] }
  const included = (json.included || []) as Record<string, unknown>[];
  const dataObj = json.data as Record<string, unknown> | undefined;

  let companyName = slug
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
  let companyId = "";

  // Strategy 1: Look for the entity whose universalName matches the slug exactly
  for (const entity of included) {
    if (entity.universalName === slug) {
      if (entity.name) companyName = String(entity.name);
      const entityUrn = String(entity.entityUrn || "");
      const idMatch = entityUrn.match(
        /(?:company|fs_normalized_company|fsd_company):(\d+)/
      );
      if (idMatch) {
        companyId = idMatch[1];
        break;
      }
    }
  }

  // Strategy 2: Look for Company-typed entities
  if (!companyId) {
    for (const entity of included) {
      const type = String(entity.$type || "");
      if (
        type.includes("organization.Company") ||
        type.includes("organization.Organization")
      ) {
        if (entity.name) companyName = String(entity.name);
        const entityUrn = String(entity.entityUrn || "");
        const idMatch = entityUrn.match(
          /(?:company|fs_normalized_company):(\d+)/
        );
        if (idMatch) {
          companyId = idMatch[1];
          break;
        }
      }
    }
  }

  // Strategy 3: Look for the main data entity's company reference
  if (!companyId && dataObj) {
    // The data object often has a direct reference like "*elements" or entityUrn
    const dataStr = JSON.stringify(dataObj);
    const idMatch = dataStr.match(
      /urn:li:(?:company|fs_normalized_company|fsd_company):(\d+)/
    );
    if (idMatch) {
      companyId = idMatch[1];
    }
  }

  // Strategy 4: Extract company ID from FollowingInfo or any URN containing company:<id>
  // But SKIP entities that look like sub-companies (check name doesn't differ too much)
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

  // Strategy 5: Search all string values for any company ID reference
  if (!companyId) {
    for (const entity of included) {
      for (const value of Object.values(entity)) {
        const str = String(value || "");
        const idMatch = str.match(
          /(?:company|fs_normalized_company|fs_miniCompany):(\d+)/
        );
        if (idMatch) {
          companyId = idMatch[1];
          break;
        }
      }
      if (companyId) break;
    }
  }

  // Try to get company name from included entities if we still have the default
  const defaultName = slug
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
  if (companyId && companyName === defaultName) {
    for (const entity of included) {
      if (
        entity.name &&
        String(entity.entityUrn || "").includes(companyId)
      ) {
        companyName = String(entity.name);
        break;
      }
    }
  }

  if (!companyId) {
    throw new Error(
      `Could not find company ID for "${slug}". Got ${included.length} included entities but no company URN found.`
    );
  }

  return { companyName, companyId };
}

/**
 * Search for employees at a company using LinkedIn's Voyager search API.
 */
export async function searchCompanyEmployees(
  companyId: string,
  liAtCookie: string,
  limit: number = 10,
  jsessionId?: string
): Promise<LinkedInEmployee[]> {
  const headers = buildHeaders(liAtCookie, jsessionId);

  // Try the search/dash/clusters endpoint first (newer format)
  const employees = await trySearchDashClusters(companyId, headers, limit);
  if (employees.length > 0) return employees;

  // Fallback: try the search/blended endpoint
  return trySearchBlended(companyId, headers, limit);
}

async function trySearchDashClusters(
  companyId: string,
  headers: Record<string, string>,
  limit: number
): Promise<LinkedInEmployee[]> {
  // Try multiple decorationId versions as LinkedIn updates these
  const decorationIds = [
    "com.linkedin.voyager.dash.deco.search.SearchClusterCollection-186",
    "com.linkedin.voyager.dash.deco.search.SearchClusterCollection-185",
    "com.linkedin.voyager.dash.deco.search.SearchClusterCollection-165",
  ];

  for (const decorationId of decorationIds) {
    try {
      const queryParams = new URLSearchParams({
        decorationId,
        origin: "COMPANY_PAGE_CANNED_SEARCH",
        q: "all",
        query: `(flagshipSearchIntent:SEARCH_SRP,queryParameters:(currentCompany:List(${companyId}),resultType:List(PEOPLE)),includeFiltersInResponse:false)`,
        start: "0",
        count: String(Math.min(limit, 49)),
      });

      const url = `${LINKEDIN_API_BASE}/search/dash/clusters?${queryParams.toString()}`;
      const response = await fetch(url, { headers });

      if (!response.ok) continue;

      const json = await response.json();
      const employees = parseSearchResults(json, limit);
      if (employees.length > 0) return employees;
    } catch {
      continue;
    }
  }

  return [];
}

async function trySearchBlended(
  companyId: string,
  headers: Record<string, string>,
  limit: number
): Promise<LinkedInEmployee[]> {
  try {
    const queryParams = new URLSearchParams({
      count: String(Math.min(limit, 49)),
      filters: `List(currentCompany->${companyId},resultType->PEOPLE)`,
      origin: "COMPANY_PAGE_CANNED_SEARCH",
      q: "all",
      start: "0",
    });

    const url = `${LINKEDIN_API_BASE}/search/blended?${queryParams.toString()}`;
    const response = await fetch(url, { headers });

    if (!response.ok) return [];

    const json = await response.json();
    return parseSearchResults(json, limit);
  } catch {
    return [];
  }
}

/**
 * Parse LinkedIn search API response to extract employee info.
 * Handles both { data, included } and { elements, included } formats.
 */
function parseSearchResults(
  json: Record<string, unknown>,
  limit: number
): LinkedInEmployee[] {
  const employees: LinkedInEmployee[] = [];

  // Get all entities from the response
  const included = (json.included || []) as Record<string, unknown>[];

  // Look for profile/mini-profile entities
  for (const entity of included) {
    if (employees.length >= limit) break;

    const type = String(entity.$type || "");
    const entityUrn = String(entity.entityUrn || "");

    // Match profile entities
    const isProfile =
      type.includes("MiniProfile") ||
      type.includes("identity.profile.Profile") ||
      type.includes("identity.shared.MiniProfile") ||
      entityUrn.includes("fs_miniProfile") ||
      entityUrn.includes("fsd_profile");

    if (!isProfile) continue;

    const firstName = String(entity.firstName || "");
    const lastName = String(entity.lastName || "");
    const name = `${firstName} ${lastName}`.trim();

    if (!name || name === "LinkedIn Member") continue;

    const occupation = String(entity.occupation || "");
    const headline = String(entity.headline || occupation || "");

    const publicId = String(entity.publicIdentifier || "");
    if (!publicId) continue;

    const linkedinUrl = `https://www.linkedin.com/in/${publicId}`;

    if (employees.some((e) => e.linkedinUrl === linkedinUrl)) continue;

    employees.push({ name, headline, linkedinUrl });
  }

  // Fallback: look for EntityResultViewModel entities (newer search format)
  if (employees.length === 0) {
    for (const entity of included) {
      if (employees.length >= limit) break;

      const type = String(entity.$type || "");
      if (
        !type.includes("EntityResultViewModel") &&
        !type.includes("SearchHitV2") &&
        !type.includes("EntityResult")
      ) {
        continue;
      }

      // Extract name from title
      const title = entity.title as { text?: string } | undefined;
      const name = title?.text || "";
      if (!name || name === "LinkedIn Member") continue;

      const summary = entity.primarySubtitle as
        | { text?: string }
        | undefined;
      const headline = summary?.text || "";

      // Extract profile URL from navigationUrl or navigationContext
      let profileUrl = "";
      const navUrl = String(entity.navigationUrl || "");
      const navCtx = entity.navigationContext as
        | { url?: string }
        | undefined;
      const rawUrl = navUrl || navCtx?.url || "";

      const profileMatch = rawUrl.match(/linkedin\.com\/in\/([^/?#]+)/);
      if (profileMatch) {
        profileUrl = `https://www.linkedin.com/in/${profileMatch[1]}`;
      }

      if (!profileUrl) continue;
      if (employees.some((e) => e.linkedinUrl === profileUrl)) continue;

      employees.push({ name, headline, linkedinUrl: profileUrl });
    }
  }

  return employees;
}

/**
 * High-level function: find employees at a LinkedIn company URL.
 */
export async function findCompanyEmployees(
  companyUrl: string,
  liAtCookie: string,
  limit: number = 10
): Promise<{
  companyName: string;
  employees: LinkedInEmployee[];
}> {
  // First, validate auth and get a real JSESSIONID
  const { jsessionId, valid } = await validateAuth(liAtCookie);

  if (!valid) {
    throw new Error(
      "LinkedIn authentication failed. Your session cookie may have expired. Please get a fresh li_at cookie from your browser."
    );
  }

  const { companyName, companyId } = await getCompanyInfo(
    companyUrl,
    liAtCookie,
    jsessionId
  );

  await delay(500);

  const employees = await searchCompanyEmployees(
    companyId,
    liAtCookie,
    limit,
    jsessionId
  );

  return { companyName, employees };
}

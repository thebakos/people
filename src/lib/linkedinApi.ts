import { delay } from "./duckduckgo";

const LINKEDIN_API_BASE = "https://www.linkedin.com/voyager/api";

interface LinkedInEmployee {
  name: string;
  headline: string;
  linkedinUrl: string;
}

/**
 * Fetch a real JSESSIONID from LinkedIn.
 * Uses a lightweight HEAD request with a timeout to avoid hanging.
 * Falls back to null if it can't obtain one (will use ajax:timestamp instead).
 */
async function fetchJSessionId(liAtCookie: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    // Use a HEAD request to the homepage — much lighter than fetching /feed/
    const res = await fetch("https://www.linkedin.com/", {
      method: "HEAD",
      headers: {
        Cookie: `li_at=${liAtCookie}`,
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      redirect: "manual",
      signal: controller.signal,
    });

    // Extract JSESSIONID from Set-Cookie headers
    const setCookieHeaders = res.headers.getSetCookie?.() || [];
    for (const cookie of setCookieHeaders) {
      const match = cookie.match(/JSESSIONID="?([^";]+)"?/);
      if (match) return match[1];
    }

    // Try raw header as fallback (some runtimes merge set-cookie headers)
    const rawSetCookie = res.headers.get("set-cookie") || "";
    const match = rawSetCookie.match(/JSESSIONID="?([^";]+)"?/);
    if (match) return match[1];
  } catch {
    // Timeout or network error — fall back to generated token
  } finally {
    clearTimeout(timeout);
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

  // Step 2: Test auth with /me endpoint (with timeout)
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${LINKEDIN_API_BASE}/me`, {
      headers,
      signal: controller.signal,
    });
    return { jsessionId: token, valid: res.ok };
  } catch {
    return { jsessionId: token, valid: false };
  } finally {
    clearTimeout(timeout);
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
 * Paginates through multiple pages to collect up to `limit` results.
 */
export async function searchCompanyEmployees(
  companyId: string,
  liAtCookie: string,
  limit: number = 50,
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

  const pageSize = Math.min(49, limit);
  const allEmployees: LinkedInEmployee[] = [];
  const seen = new Set<string>();

  for (const decorationId of decorationIds) {
    let start = 0;

    while (allEmployees.length < limit) {
      try {
        const query = `(flagshipSearchIntent:SEARCH_SRP,queryParameters:(currentCompany:List(${companyId}),resultType:List(PEOPLE)),includeFiltersInResponse:false)`;
        const url =
          `${LINKEDIN_API_BASE}/search/dash/clusters` +
          `?decorationId=${encodeURIComponent(decorationId)}` +
          `&origin=COMPANY_PAGE_CANNED_SEARCH` +
          `&q=all` +
          `&query=${query}` +
          `&start=${start}` +
          `&count=${pageSize}`;

        const response = await fetch(url, { headers });
        console.log(`[clusters] decorationId=${decorationId.slice(-3)}, start=${start}, status=${response.status}`);
        if (!response.ok) {
          console.log(`[clusters] Non-OK response, trying next decorationId`);
          break;
        }

        const json = await response.json();
        const included = (json.included || []) as Record<string, unknown>[];
        const types = [...new Set(included.map((e: Record<string, unknown>) => String(e.$type || "")))];
        console.log(`[clusters] Included entities: ${included.length}, types: ${types.join(", ")}`);

        const pageEmployees = parseSearchResults(json, limit);
        console.log(`[clusters] Parsed employees from page: ${pageEmployees.length}`);

        if (pageEmployees.length === 0) break;

        let addedNew = false;
        for (const emp of pageEmployees) {
          if (allEmployees.length >= limit) break;
          if (seen.has(emp.linkedinUrl)) continue;
          seen.add(emp.linkedinUrl);
          allEmployees.push(emp);
          addedNew = true;
        }

        // If no new unique employees found, stop paginating
        if (!addedNew) break;

        start += pageSize;

        // Rate limit between pages
        if (allEmployees.length < limit) {
          await delay(400);
        }
      } catch (e) {
        console.error(`[clusters] Error:`, e);
        break;
      }
    }

    // If this decorationId worked (got results), don't try others
    if (allEmployees.length > 0) break;
  }

  return allEmployees;
}

async function trySearchBlended(
  companyId: string,
  headers: Record<string, string>,
  limit: number
): Promise<LinkedInEmployee[]> {
  const pageSize = Math.min(49, limit);
  const allEmployees: LinkedInEmployee[] = [];
  const seen = new Set<string>();
  let start = 0;

  while (allEmployees.length < limit) {
    try {
      const url =
        `${LINKEDIN_API_BASE}/search/blended` +
        `?count=${pageSize}` +
        `&filters=List(currentCompany->${companyId},resultType->PEOPLE)` +
        `&origin=COMPANY_PAGE_CANNED_SEARCH` +
        `&q=all` +
        `&start=${start}`;

      const response = await fetch(url, { headers });
      if (!response.ok) break;

      const json = await response.json();
      const pageEmployees = parseSearchResults(json, limit);

      if (pageEmployees.length === 0) break;

      let addedNew = false;
      for (const emp of pageEmployees) {
        if (allEmployees.length >= limit) break;
        if (seen.has(emp.linkedinUrl)) continue;
        seen.add(emp.linkedinUrl);
        allEmployees.push(emp);
        addedNew = true;
      }

      if (!addedNew) break;

      start += pageSize;

      if (allEmployees.length < limit) {
        await delay(400);
      }
    } catch {
      break;
    }
  }

  return allEmployees;
}

/**
 * Extract text from a LinkedIn title/subtitle field.
 * LinkedIn API returns these as either:
 *   - An object: { text: "Name", textDirection: "...", ... }
 *   - A JSON string: '{"text":"Name","textDirection":"..."}'
 *   - A plain string: "Name"
 */
function extractText(value: unknown): string {
  if (!value) return "";
  if (typeof value === "object" && value !== null) {
    const obj = value as Record<string, unknown>;
    if (typeof obj.text === "string") return obj.text;
  }
  if (typeof value === "string") {
    if (value.startsWith("{")) {
      try {
        const parsed = JSON.parse(value);
        if (typeof parsed.text === "string") return parsed.text;
      } catch {
        /* not JSON */
      }
    }
    return value;
  }
  return "";
}

/**
 * Extract a LinkedIn profile URL from various entity fields.
 * Checks navigationUrl, navigationContext.url, and entityUrn.
 */
function extractProfileUrl(entity: Record<string, unknown>): string {
  // Try navigationUrl first (direct string)
  const candidates: string[] = [];

  if (typeof entity.navigationUrl === "string") {
    candidates.push(entity.navigationUrl);
  }

  // Try navigationContext (object or JSON string with url property)
  const navCtx = entity.navigationContext;
  if (navCtx && typeof navCtx === "object") {
    const url = (navCtx as Record<string, unknown>).url;
    if (typeof url === "string") candidates.push(url);
  } else if (typeof navCtx === "string" && navCtx.startsWith("{")) {
    try {
      const parsed = JSON.parse(navCtx);
      if (typeof parsed.url === "string") candidates.push(parsed.url);
    } catch {
      /* not JSON */
    }
  }

  for (const raw of candidates) {
    const match = raw.match(/linkedin\.com\/in\/([^/?#]+)/);
    if (match) return `https://www.linkedin.com/in/${match[1]}`;
  }

  return "";
}

/**
 * Parse LinkedIn search API response to extract employee info.
 * Handles multiple response formats:
 *   - MiniProfile entities (older/blended search): firstName, lastName, publicIdentifier
 *   - EntityResultViewModel entities (dash/clusters search): title.text, navigationUrl
 */
function parseSearchResults(
  json: Record<string, unknown>,
  limit: number
): LinkedInEmployee[] {
  const employees: LinkedInEmployee[] = [];
  const included = (json.included || []) as Record<string, unknown>[];
  const seen = new Set<string>();

  const addEmployee = (
    name: string,
    headline: string,
    linkedinUrl: string
  ): boolean => {
    if (!name || name === "LinkedIn Member" || !linkedinUrl) return false;
    if (seen.has(linkedinUrl)) return false;
    seen.add(linkedinUrl);
    employees.push({ name, headline, linkedinUrl });
    return true;
  };

  // Strategy 1: MiniProfile entities (richest data — has firstName, lastName, publicIdentifier)
  for (const entity of included) {
    if (employees.length >= limit) break;

    const type = String(entity.$type || "");
    const isProfile =
      type.includes("MiniProfile") ||
      type.includes("identity.shared.MiniProfile");

    if (!isProfile) continue;

    const firstName = String(entity.firstName || "");
    const lastName = String(entity.lastName || "");
    const name = `${firstName} ${lastName}`.trim();
    const publicId = String(entity.publicIdentifier || "");
    if (!name || !publicId) continue;

    const headline = String(entity.occupation || entity.headline || "");
    addEmployee(name, headline, `https://www.linkedin.com/in/${publicId}`);
  }

  // Strategy 2: EntityResultViewModel entities (dash/clusters search result cards)
  if (employees.length === 0) {
    for (const entity of included) {
      if (employees.length >= limit) break;

      const type = String(entity.$type || "");
      if (
        !type.includes("EntityResultViewModel") &&
        !type.includes("SearchHitV2")
      ) {
        continue;
      }

      const name = extractText(entity.title);
      const headline = extractText(entity.primarySubtitle);
      const profileUrl = extractProfileUrl(entity);

      addEmployee(name, headline, profileUrl);
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
  limit: number = 50
): Promise<{
  companyName: string;
  employees: LinkedInEmployee[];
}> {
  // First, validate auth and get a real JSESSIONID
  console.log(`[linkedin] Validating auth...`);
  const { jsessionId, valid } = await validateAuth(liAtCookie);
  console.log(`[linkedin] Auth valid: ${valid}, JSESSIONID: ${jsessionId?.substring(0, 15)}...`);

  if (!valid) {
    throw new Error(
      "LinkedIn authentication failed. Your session cookie may have expired. Please get a fresh li_at cookie from your browser."
    );
  }

  console.log(`[linkedin] Looking up company: ${companyUrl}`);
  const { companyName, companyId } = await getCompanyInfo(
    companyUrl,
    liAtCookie,
    jsessionId
  );
  console.log(`[linkedin] Company found: ${companyName} (ID: ${companyId})`);

  await delay(500);

  console.log(`[linkedin] Searching for employees (limit: ${limit})...`);
  const employees = await searchCompanyEmployees(
    companyId,
    liAtCookie,
    limit,
    jsessionId
  );
  console.log(`[linkedin] Search complete: ${employees.length} employees found`);

  return { companyName, employees };
}

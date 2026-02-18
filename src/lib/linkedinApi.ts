import { delay } from "./duckduckgo";
import { searchEmployees } from "./linkedinSearch";

const LINKEDIN_API_BASE = "https://www.linkedin.com/voyager/api";

interface LinkedInEmployee {
  name: string;
  headline: string;
  linkedinUrl: string;
}

/**
 * Build the required headers for LinkedIn Voyager API requests.
 * Uses a generated ajax:timestamp CSRF token — never fetches a real
 * JSESSIONID from LinkedIn (that causes session invalidation).
 */
function buildHeaders(liAtCookie: string): Record<string, string> {
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
 * Extract the company slug from a LinkedIn company URL.
 */
function extractCompanySlug(url: string): string {
  const match = url.match(/linkedin\.com\/company\/([^/?#]+)/);
  return match ? match[1] : "";
}

/**
 * Get company info (name + numeric ID) from LinkedIn using the Voyager API.
 */
export async function getCompanyInfo(
  companyUrl: string,
  liAtCookie: string
): Promise<{ companyName: string; companyId: string }> {
  const slug = extractCompanySlug(companyUrl);
  if (!slug) {
    throw new Error("Could not extract company slug from URL");
  }

  const headers = buildHeaders(liAtCookie);

  const url = `${LINKEDIN_API_BASE}/organization/companies?decorationId=com.linkedin.voyager.deco.organization.web.WebFullCompanyMain-12&q=universalName&universalName=${encodeURIComponent(slug)}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(url, { headers, signal: controller.signal });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error(
          "LinkedIn authentication failed. Your session cookie may have expired."
        );
      }
      throw new Error(`LinkedIn company lookup error: ${response.status}`);
    }

    const json = await response.json();
    const included = (json.included || []) as Record<string, unknown>[];
    const dataObj = json.data as Record<string, unknown> | undefined;

    let companyName = slug
      .replace(/-/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
    let companyId = "";

    // Strategy 1: Look for the entity whose universalName matches the slug
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

    // Strategy 3: data object reference
    if (!companyId && dataObj) {
      const dataStr = JSON.stringify(dataObj);
      const idMatch = dataStr.match(
        /urn:li:(?:company|fs_normalized_company|fsd_company):(\d+)/
      );
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

    // Try to get company name from included entities if still default
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
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Search for employees at a company using LinkedIn's Voyager search API.
 * Tries multiple endpoints, falls back gracefully.
 */
export async function searchCompanyEmployees(
  companyId: string,
  liAtCookie: string,
  limit: number = 10
): Promise<LinkedInEmployee[]> {
  const headers = buildHeaders(liAtCookie);

  // Try the search/dash/clusters endpoint (newer format)
  const employees = await trySearchDashClusters(companyId, headers, limit);
  if (employees.length > 0) return employees;

  console.log(`[linkedin] Clusters failed, trying GraphQL search...`);
  const graphqlEmployees = await tryGraphQLSearch(companyId, headers, limit);
  if (graphqlEmployees.length > 0) return graphqlEmployees;

  console.log(`[linkedin] GraphQL failed, trying blended search...`);
  const blendedEmployees = await trySearchBlended(companyId, headers, limit);
  if (blendedEmployees.length > 0) return blendedEmployees;

  console.log(`[linkedin] Blended failed, trying people search...`);
  const peopleEmployees = await tryPeopleSearch(companyId, headers, limit);
  if (peopleEmployees.length > 0) return peopleEmployees;

  return [];
}

async function trySearchDashClusters(
  companyId: string,
  headers: Record<string, string>,
  limit: number
): Promise<LinkedInEmployee[]> {
  // Try a wide range of decoration IDs — LinkedIn increments these over time
  const decorationIds = [
    "com.linkedin.voyager.dash.deco.search.SearchClusterCollection-193",
    "com.linkedin.voyager.dash.deco.search.SearchClusterCollection-192",
    "com.linkedin.voyager.dash.deco.search.SearchClusterCollection-191",
    "com.linkedin.voyager.dash.deco.search.SearchClusterCollection-190",
    "com.linkedin.voyager.dash.deco.search.SearchClusterCollection-189",
    "com.linkedin.voyager.dash.deco.search.SearchClusterCollection-188",
    "com.linkedin.voyager.dash.deco.search.SearchClusterCollection-187",
    "com.linkedin.voyager.dash.deco.search.SearchClusterCollection-186",
    "com.linkedin.voyager.dash.deco.search.SearchClusterCollection-185",
    "com.linkedin.voyager.dash.deco.search.SearchClusterCollection-165",
  ];

  // Try multiple query formats in case the API changed
  const queryFormats = [
    // Format 1: List-style queryParameters (newer LinkedIn format)
    `(flagshipSearchIntent:SEARCH_SRP,queryParameters:List((key:currentCompany,value:List(${companyId})),(key:resultType,value:List(PEOPLE))),includeFiltersInResponse:false)`,
    // Format 2: List-style without includeFiltersInResponse
    `(flagshipSearchIntent:SEARCH_SRP,queryParameters:List((key:currentCompany,value:List(${companyId})),(key:resultType,value:List(PEOPLE))))`,
    // Format 3: Map-style (legacy)
    `(flagshipSearchIntent:SEARCH_SRP,queryParameters:(currentCompany:List(${companyId}),resultType:List(PEOPLE)),includeFiltersInResponse:false)`,
    // Format 4: Map-style without includeFiltersInResponse
    `(flagshipSearchIntent:SEARCH_SRP,queryParameters:(currentCompany:List(${companyId}),resultType:List(PEOPLE)))`,
    // Format 5: With keywords param (list-style)
    `(flagshipSearchIntent:SEARCH_SRP,keywords:,queryParameters:List((key:currentCompany,value:List(${companyId})),(key:resultType,value:List(PEOPLE))),includeFiltersInResponse:false)`,
  ];

  const pageSize = Math.min(49, limit);
  const allEmployees: LinkedInEmployee[] = [];
  const seen = new Set<string>();

  for (const queryTemplate of queryFormats) {
    if (allEmployees.length > 0) break;

    for (const decorationId of decorationIds) {
      if (allEmployees.length > 0) break;
      let start = 0;

      while (allEmployees.length < limit) {
        try {
          const url =
            `${LINKEDIN_API_BASE}/search/dash/clusters` +
            `?decorationId=${encodeURIComponent(decorationId)}` +
            `&origin=COMPANY_PAGE_CANNED_SEARCH` +
            `&q=all` +
            `&query=${encodeURIComponent(queryTemplate)}` +
            `&start=${start}` +
            `&count=${pageSize}`;

          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 10000);

          let response: Response;
          try {
            response = await fetch(url, { headers, signal: controller.signal });
          } finally {
            clearTimeout(timeout);
          }

          const decoShort = decorationId.slice(-3);
          console.log(`[clusters] deco=${decoShort}, start=${start}, status=${response.status}`);

          if (response.status === 400) break; // This decoration ID doesn't work
          if (!response.ok) break;

          const json = await response.json();
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

          if (!addedNew) break;
          start += pageSize;

          if (allEmployees.length < limit) await delay(400);
        } catch (e) {
          console.log(`[clusters] Failed: ${e instanceof Error ? e.message : e}`);
          break;
        }
      }
    }
  }

  return allEmployees;
}

/**
 * Try LinkedIn's GraphQL search endpoint with multiple queryId hashes.
 */
async function tryGraphQLSearch(
  companyId: string,
  headers: Record<string, string>,
  limit: number
): Promise<LinkedInEmployee[]> {
  // LinkedIn GraphQL queryIds change with deployments — try several known ones
  const queryIds = [
    "voyagerSearchDashClusters.b0928897b71bd00a5a7291755dcd64f0",
    "voyagerSearchDashClusters.8f5a6f5f1a0dc14a9ce3e58be2f6d2fd",
    "voyagerSearchDashClusters.66adc6056cf4138949ca5dcb31bb1749",
  ];

  // Try both list-style and map-style queryParameters
  const variableFormats = [
    `(start:0,origin:COMPANY_PAGE_CANNED_SEARCH,query:(flagshipSearchIntent:SEARCH_SRP,queryParameters:List((key:currentCompany,value:List(${companyId})),(key:resultType,value:List(PEOPLE))),includeFiltersInResponse:false),count:${Math.min(49, limit)})`,
    `(start:0,origin:COMPANY_PAGE_CANNED_SEARCH,query:(flagshipSearchIntent:SEARCH_SRP,queryParameters:(currentCompany:List(${companyId}),resultType:List(PEOPLE)),includeFiltersInResponse:false),count:${Math.min(49, limit)})`,
  ];

  for (const variables of variableFormats) {
    for (const queryId of queryIds) {
      try {
        const url =
          `${LINKEDIN_API_BASE}/graphql` +
          `?includeWebMetadata=true` +
          `&variables=${encodeURIComponent(variables)}` +
          `&queryId=${queryId}`;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        let response: Response;
        try {
          response = await fetch(url, { headers, signal: controller.signal });
        } finally {
          clearTimeout(timeout);
        }

        console.log(`[graphql] queryId=${queryId.slice(-8)}, status=${response.status}`);
        if (!response.ok) continue;

        const json = await response.json();
        const employees = parseSearchResults(json, limit);
        console.log(`[graphql] Parsed: ${employees.length} employees`);
        if (employees.length > 0) return employees;
      } catch (e) {
        console.log(`[graphql] Failed: ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  return [];
}

/**
 * Try LinkedIn's people search with a different query structure.
 * Uses the search/dash/clusters endpoint with different parameters.
 */
async function tryPeopleSearch(
  companyId: string,
  headers: Record<string, string>,
  limit: number
): Promise<LinkedInEmployee[]> {
  const pageSize = Math.min(49, limit);

  // Try with a filter-based query instead of queryParameters
  const filterQueries = [
    // Filter using currentCompany with people origin
    `(flagshipSearchIntent:SEARCH_SRP,queryParameters:(currentCompany:List(${companyId})),includeFiltersInResponse:false)`,
    // Simpler query without resultType filter
    `(queryParameters:(currentCompany:List(${companyId}),resultType:List(PEOPLE)))`,
  ];

  for (const query of filterQueries) {
    try {
      // Try without decorationId (let server pick default)
      const url =
        `${LINKEDIN_API_BASE}/search/dash/clusters` +
        `?origin=COMPANY_PAGE_CANNED_SEARCH` +
        `&q=all` +
        `&query=${encodeURIComponent(query)}` +
        `&start=0` +
        `&count=${pageSize}`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      let response: Response;
      try {
        response = await fetch(url, { headers, signal: controller.signal });
      } finally {
        clearTimeout(timeout);
      }

      console.log(`[people] status=${response.status}`);
      if (!response.ok) continue;

      const json = await response.json();
      const employees = parseSearchResults(json, limit);
      console.log(`[people] Parsed: ${employees.length} employees`);
      if (employees.length > 0) return employees;
    } catch (e) {
      console.log(`[people] Failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  return [];
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
        `&filters=${encodeURIComponent(`List(currentCompany->${companyId},resultType->PEOPLE)`)}` +
        `&origin=COMPANY_PAGE_CANNED_SEARCH` +
        `&q=all` +
        `&start=${start}`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      let response: Response;
      try {
        response = await fetch(url, { headers, signal: controller.signal });
      } finally {
        clearTimeout(timeout);
      }

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

      if (allEmployees.length < limit) await delay(400);
    } catch {
      break;
    }
  }

  return allEmployees;
}

/**
 * Extract text from a LinkedIn title/subtitle field.
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
 */
function extractProfileUrl(entity: Record<string, unknown>): string {
  const candidates: string[] = [];

  if (typeof entity.navigationUrl === "string") {
    candidates.push(entity.navigationUrl);
  }

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

  // Strategy 1: MiniProfile entities
  for (const entity of included) {
    if (employees.length >= limit) break;

    const type = String(entity.$type || "");
    if (!type.includes("MiniProfile") && !type.includes("identity.shared.MiniProfile")) continue;

    const firstName = String(entity.firstName || "");
    const lastName = String(entity.lastName || "");
    const name = `${firstName} ${lastName}`.trim();
    const publicId = String(entity.publicIdentifier || "");
    if (!name || !publicId) continue;

    const headline = String(entity.occupation || entity.headline || "");
    addEmployee(name, headline, `https://www.linkedin.com/in/${publicId}`);
  }

  // Strategy 2: EntityResultViewModel entities
  if (employees.length === 0) {
    for (const entity of included) {
      if (employees.length >= limit) break;

      const type = String(entity.$type || "");
      if (!type.includes("EntityResultViewModel") && !type.includes("SearchHitV2")) continue;

      const name = extractText(entity.title);
      const headline = extractText(entity.primarySubtitle);
      const profileUrl = extractProfileUrl(entity);

      addEmployee(name, headline, profileUrl);
    }
  }

  return employees;
}

/**
 * Scrape the LinkedIn company page HTML for embedded employee data.
 * LinkedIn pages embed JSON data in <code> tags that may contain employee info.
 */
async function scrapeCompanyPage(
  companySlug: string,
  liAtCookie: string,
  limit: number
): Promise<LinkedInEmployee[]> {
  const headers = buildHeaders(liAtCookie);
  // Override Accept for HTML page
  headers.Accept = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
  headers.Referer = "https://www.linkedin.com/";

  const employees: LinkedInEmployee[] = [];
  const seen = new Set<string>();

  // Try both the people page and the main company page
  const pages = [
    `https://www.linkedin.com/company/${companySlug}/people/`,
    `https://www.linkedin.com/company/${companySlug}/`,
  ];

  for (const pageUrl of pages) {
    if (employees.length >= limit) break;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      let response: Response;
      try {
        response = await fetch(pageUrl, { headers, signal: controller.signal, redirect: "follow" });
      } finally {
        clearTimeout(timeout);
      }

      console.log(`[scrape] ${pageUrl} → ${response.status}`);
      if (!response.ok) continue;

      const html = await response.text();
      console.log(`[scrape] Got ${html.length} chars of HTML`);

      // Strategy 1: Parse embedded JSON from <code> tags
      const codeRegex = /<code[^>]*>([\s\S]*?)<\/code>/g;
      let match;
      while ((match = codeRegex.exec(html)) !== null && employees.length < limit) {
        try {
          const decoded = match[1]
            .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
            .replace(/&amp;/g, "&").replace(/&quot;/g, '"');
          const data = JSON.parse(decoded);
          const included = data.included || (Array.isArray(data) ? data : []);

          for (const entity of included) {
            if (employees.length >= limit) break;
            if (!entity || typeof entity !== "object") continue;

            const type = String(entity.$type || "");

            // MiniProfile entities
            if (type.includes("MiniProfile") || type.includes("identity.shared.MiniProfile")) {
              const firstName = String(entity.firstName || "");
              const lastName = String(entity.lastName || "");
              const name = `${firstName} ${lastName}`.trim();
              const publicId = String(entity.publicIdentifier || "");
              if (!name || !publicId || name === "LinkedIn Member") continue;

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
        } catch {
          // Not valid JSON, skip
        }
      }

      // Strategy 2: Parse miniProfile data from JSON-LD or embedded script data
      const scriptRegex = /<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/g;
      while ((match = scriptRegex.exec(html)) !== null && employees.length < limit) {
        try {
          const data = JSON.parse(match[1]);
          extractProfilesFromObject(data, employees, seen, limit);
        } catch {
          // Not valid JSON
        }
      }
    } catch (e) {
      console.log(`[scrape] Failed for ${pageUrl}: ${e instanceof Error ? e.message : e}`);
    }
  }

  return employees;
}

/** Recursively extract MiniProfile-like data from nested objects */
function extractProfilesFromObject(
  obj: unknown,
  employees: LinkedInEmployee[],
  seen: Set<string>,
  limit: number
): void {
  if (employees.length >= limit || !obj || typeof obj !== "object") return;

  if (Array.isArray(obj)) {
    for (const item of obj) {
      extractProfilesFromObject(item, employees, seen, limit);
    }
    return;
  }

  const record = obj as Record<string, unknown>;

  // Check if this looks like a profile
  if (record.publicIdentifier && record.firstName) {
    const firstName = String(record.firstName || "");
    const lastName = String(record.lastName || "");
    const name = `${firstName} ${lastName}`.trim();
    const publicId = String(record.publicIdentifier || "");

    if (name && publicId && name !== "LinkedIn Member") {
      const profileUrl = `https://www.linkedin.com/in/${publicId}`;
      if (!seen.has(profileUrl)) {
        seen.add(profileUrl);
        employees.push({
          name,
          headline: String(record.occupation || record.headline || ""),
          linkedinUrl: profileUrl,
        });
      }
    }
  }

  // Recurse into values (but limit depth)
  for (const value of Object.values(record)) {
    if (typeof value === "object" && value !== null) {
      extractProfilesFromObject(value, employees, seen, limit);
    }
  }
}

/**
 * High-level function: find employees at a LinkedIn company URL.
 * Uses the Voyager API for company info, then tries Voyager search,
 * company page scraping, and web search as fallbacks.
 *
 * IMPORTANT: Does NOT make HEAD requests or validate auth separately —
 * that was causing LinkedIn to invalidate the user's session cookie.
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
  const { companyName, companyId } = await getCompanyInfo(
    companyUrl,
    liAtCookie
  );
  console.log(`[linkedin] Company found: ${companyName} (ID: ${companyId})`);

  const slug = extractCompanySlug(companyUrl);
  await delay(500);

  // Try Voyager search endpoints first
  console.log(`[linkedin] Trying Voyager search for employees (limit: ${limit})...`);
  let employees = await searchCompanyEmployees(companyId, liAtCookie, limit);

  // If Voyager search returned nothing, try scraping the company page HTML
  if (employees.length === 0 && slug) {
    console.log(`[linkedin] Voyager search returned 0 results, trying company page scrape...`);
    employees = await scrapeCompanyPage(slug, liAtCookie, limit);
    console.log(`[linkedin] Page scrape found: ${employees.length} employees`);
  }

  // If still nothing, fall back to web search (DDG/Bing)
  if (employees.length === 0) {
    console.log(`[linkedin] All LinkedIn methods failed, falling back to web search...`);
    employees = await searchEmployees(companyUrl, companyName, limit);
    console.log(`[linkedin] Web search fallback found: ${employees.length} employees`);
  } else {
    console.log(`[linkedin] Found: ${employees.length} employees`);
  }

  return { companyName, employees };
}

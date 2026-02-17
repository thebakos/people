import { delay } from "./duckduckgo";

const LINKEDIN_API_BASE = "https://www.linkedin.com/voyager/api";

interface LinkedInEmployee {
  name: string;
  headline: string;
  linkedinUrl: string;
}

/**
 * Build the required headers for LinkedIn Voyager API requests.
 * The li_at cookie is used for authentication. A matching JSESSIONID
 * cookie and Csrf-Token header are required.
 */
function buildHeaders(liAtCookie: string): Record<string, string> {
  const csrfToken = `ajax:${Date.now()}`;
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
 * e.g. "https://www.linkedin.com/company/sequoia-capital" → "sequoia-capital"
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

  const response = await fetch(url, { headers });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        "LinkedIn authentication failed. Your session cookie may have expired."
      );
    }
    throw new Error(`LinkedIn API error: ${response.status}`);
  }

  const data = await response.json();

  // Extract company name and ID from the response
  let companyName = slug
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
  let companyId = "";

  // The response includes elements in the "included" array
  const elements = data.elements || [];
  const included = data.included || [];

  // Try to find company data in elements first, then included
  const allEntities = [...elements, ...included];

  for (const entity of allEntities) {
    // Look for the company entity
    if (
      entity.$type === "com.linkedin.voyager.organization.Company" ||
      entity.universalName === slug
    ) {
      if (entity.name) {
        companyName = entity.name;
      }
      // The entityUrn contains the numeric ID: "urn:li:fs_normalized_company:12345"
      const urn = entity.entityUrn || entity["*companyV2"] || "";
      const idMatch = urn.match(/(\d+)$/);
      if (idMatch) {
        companyId = idMatch[1];
      }
      break;
    }
  }

  // Fallback: search for any entity with a numeric company ID
  if (!companyId) {
    for (const entity of allEntities) {
      const urn =
        entity.entityUrn || entity.objectUrn || entity["$id"] || "";
      const idMatch = urn.match(
        /(?:company|organization|fs_normalized_company):(\d+)/
      );
      if (idMatch) {
        companyId = idMatch[1];
        if (entity.name) companyName = entity.name;
        break;
      }
    }
  }

  if (!companyId) {
    throw new Error(
      `Could not find company ID for "${slug}". The company may not exist on LinkedIn.`
    );
  }

  return { companyName, companyId };
}

/**
 * Search for employees at a company using LinkedIn's Voyager search API.
 * Targets investment professionals (partners, directors, etc.).
 */
export async function searchCompanyEmployees(
  companyId: string,
  liAtCookie: string,
  limit: number = 10
): Promise<LinkedInEmployee[]> {
  const headers = buildHeaders(liAtCookie);

  // Use LinkedIn's people search filtered by current company
  const queryParams = new URLSearchParams({
    decorationId:
      "com.linkedin.voyager.dash.deco.search.SearchClusterCollection-186",
    origin: "COMPANY_PAGE_CANNED_SEARCH",
    q: "all",
    query: `(flagshipSearchIntent:SEARCH_SRP,queryParameters:(currentCompany:List(${companyId}),resultType:List(PEOPLE)),includeFiltersInResponse:false)`,
    start: "0",
    count: String(Math.min(limit, 49)),
  });

  const url = `${LINKEDIN_API_BASE}/search/dash/clusters?${queryParams.toString()}`;

  const response = await fetch(url, { headers });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error("LinkedIn authentication failed.");
    }
    throw new Error(`LinkedIn search API error: ${response.status}`);
  }

  const data = await response.json();
  return parseSearchResults(data, limit);
}

/**
 * Parse LinkedIn search API response to extract employee info.
 */
function parseSearchResults(
  data: Record<string, unknown>,
  limit: number
): LinkedInEmployee[] {
  const employees: LinkedInEmployee[] = [];
  const included = (data.included || []) as Record<string, unknown>[];

  // Build a map of entity URNs to their data for quick lookup
  const entityMap = new Map<string, Record<string, unknown>>();
  for (const entity of included) {
    const id =
      (entity.entityUrn as string) ||
      (entity["$id"] as string) ||
      (entity["*profile"] as string) ||
      "";
    if (id) {
      entityMap.set(id, entity);
    }
  }

  // Look for profile entities in the included array
  for (const entity of included) {
    if (employees.length >= limit) break;

    const type = entity.$type as string;
    const entityUrn = (entity.entityUrn as string) || "";

    // Match mini-profile entities
    if (
      type === "com.linkedin.voyager.identity.shared.MiniProfile" ||
      type === "com.linkedin.voyager.dash.identity.profile.Profile" ||
      entityUrn.includes("fs_miniProfile") ||
      entityUrn.includes("fsd_profile")
    ) {
      const firstName = (entity.firstName as string) || "";
      const lastName = (entity.lastName as string) || "";
      const name = `${firstName} ${lastName}`.trim();

      if (!name || name === "LinkedIn Member") continue;

      const occupation = (entity.occupation as string) || "";
      const headline = (entity.headline as string) || occupation;

      // Build profile URL from publicIdentifier
      const publicId = (entity.publicIdentifier as string) || "";
      const linkedinUrl = publicId
        ? `https://www.linkedin.com/in/${publicId}`
        : "";

      if (!linkedinUrl) continue;

      // Check for duplicates
      if (employees.some((e) => e.linkedinUrl === linkedinUrl)) continue;

      employees.push({ name, headline, linkedinUrl });
    }
  }

  // If we didn't find profiles in the standard way, try alternative parsing
  if (employees.length === 0) {
    for (const entity of included) {
      if (employees.length >= limit) break;

      // Look for search result entities that reference profiles
      const type = entity.$type as string;
      if (
        type ===
          "com.linkedin.voyager.dash.search.EntityResultViewModel" ||
        type === "com.linkedin.voyager.search.SearchHitV2"
      ) {
        const title = entity.title as
          | { text?: string }
          | undefined;
        const name = title?.text || "";
        if (!name || name === "LinkedIn Member") continue;

        const summary = entity.primarySubtitle as
          | { text?: string }
          | undefined;
        const headline = summary?.text || "";

        // Try to extract profile URL
        const navUrl = (entity.navigationUrl as string) || "";
        const profileMatch = navUrl.match(
          /linkedin\.com\/in\/([^/?#]+)/
        );
        const linkedinUrl = profileMatch
          ? `https://www.linkedin.com/in/${profileMatch[1]}`
          : "";

        if (!linkedinUrl) continue;
        if (employees.some((e) => e.linkedinUrl === linkedinUrl))
          continue;

        employees.push({ name, headline, linkedinUrl });
      }
    }
  }

  return employees;
}

/**
 * High-level function: find employees at a LinkedIn company URL.
 * Uses the Voyager API with authentication.
 */
export async function findCompanyEmployees(
  companyUrl: string,
  liAtCookie: string,
  limit: number = 10
): Promise<{
  companyName: string;
  employees: LinkedInEmployee[];
}> {
  // Step 1: Get company info
  const { companyName, companyId } = await getCompanyInfo(
    companyUrl,
    liAtCookie
  );

  // Brief delay between API calls
  await delay(500);

  // Step 2: Search for employees
  const employees = await searchCompanyEmployees(
    companyId,
    liAtCookie,
    limit
  );

  return { companyName, employees };
}

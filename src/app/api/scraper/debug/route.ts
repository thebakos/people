import { NextRequest, NextResponse } from "next/server";
import { getCompanyInfo } from "@/lib/linkedinApi";
import { searchDuckDuckGo, searchBing } from "@/lib/duckduckgo";

const LINKEDIN_API_BASE = "https://www.linkedin.com/voyager/api";

/** Serialize an error, including its .cause chain */
function errorDetail(e: unknown): unknown {
  if (e instanceof Error) {
    return {
      message: e.message,
      name: e.name,
      cause: e.cause ? errorDetail(e.cause) : undefined,
      code: (e as NodeJS.ErrnoException).code,
    };
  }
  return String(e);
}

/** Quick fetch with timeout, returns status + text */
async function tryFetch(
  url: string,
  headers: Record<string, string>
): Promise<{ status: number; preview: string; entityTypes?: string[] }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    const text = await res.text();

    let entityTypes: string[] | undefined;
    try {
      const json = JSON.parse(text);
      const included = json.included as Record<string, unknown>[] | undefined;
      if (included && included.length > 0) {
        entityTypes = [...new Set(included.map((e: Record<string, unknown>) => String(e.$type || "?")))];
      }
    } catch { /* not JSON */ }

    return { status: res.status, preview: text.slice(0, 300), entityTypes };
  } catch (e) {
    return { status: -1, preview: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Debug endpoint — tries multiple Voyager search URL formats to find one that works.
 * POST /api/scraper/debug
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { linkedinCookie, companyUrl } = body;

  if (!linkedinCookie) {
    return NextResponse.json({ error: "linkedinCookie is required" }, { status: 400 });
  }

  const slug =
    companyUrl?.match(/linkedin\.com\/company\/([^/?#]+)/)?.[1] || "sequoia-capital";
  const steps: Record<string, unknown> = {};

  // Step 1: Company lookup
  let companyId = "";
  let companyName = "";
  try {
    const info = await getCompanyInfo(
      companyUrl || `https://www.linkedin.com/company/${slug}`,
      linkedinCookie
    );
    companyId = info.companyId;
    companyName = info.companyName;
    steps["step1_company"] = { companyName, companyId, authValid: true };
  } catch (e) {
    steps["step1_error"] = errorDetail(e);
    return NextResponse.json({ slug, steps });
  }

  // Build headers (same as linkedinApi.ts buildHeaders)
  const csrfToken = `ajax:${Date.now()}`;
  const headers: Record<string, string> = {
    Cookie: `li_at=${linkedinCookie}; JSESSIONID="${csrfToken}"`,
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

  // Step 2: Try multiple search URL formats
  const query = `(flagshipSearchIntent:SEARCH_SRP,queryParameters:(currentCompany:List(${companyId}),resultType:List(PEOPLE)),includeFiltersInResponse:false)`;
  const querySimple = `(flagshipSearchIntent:SEARCH_SRP,queryParameters:(currentCompany:List(${companyId}),resultType:List(PEOPLE)))`;

  const searchTests: Record<string, string> = {};

  // Newer decoration IDs (193 down to 186)
  for (const ver of [193, 192, 191, 190, 189, 188, 187, 186]) {
    searchTests[`clusters_${ver}`] =
      `${LINKEDIN_API_BASE}/search/dash/clusters?decorationId=${encodeURIComponent(`com.linkedin.voyager.dash.deco.search.SearchClusterCollection-${ver}`)}&origin=COMPANY_PAGE_CANNED_SEARCH&q=all&query=${encodeURIComponent(query)}&start=0&count=10`;
  }

  // Without includeFiltersInResponse
  searchTests["clusters_193_simple"] =
    `${LINKEDIN_API_BASE}/search/dash/clusters?decorationId=${encodeURIComponent("com.linkedin.voyager.dash.deco.search.SearchClusterCollection-193")}&origin=COMPANY_PAGE_CANNED_SEARCH&q=all&query=${encodeURIComponent(querySimple)}&start=0&count=10`;

  // Without decorationId
  searchTests["clusters_no_deco"] =
    `${LINKEDIN_API_BASE}/search/dash/clusters?origin=COMPANY_PAGE_CANNED_SEARCH&q=all&query=${encodeURIComponent(query)}&start=0&count=10`;

  // GraphQL endpoints
  const graphqlVars = `(start:0,origin:COMPANY_PAGE_CANNED_SEARCH,query:(flagshipSearchIntent:SEARCH_SRP,queryParameters:(currentCompany:List(${companyId}),resultType:List(PEOPLE)),includeFiltersInResponse:false),count:10)`;

  searchTests["graphql_v1"] =
    `${LINKEDIN_API_BASE}/graphql?includeWebMetadata=true&variables=${encodeURIComponent(graphqlVars)}&queryId=voyagerSearchDashClusters.b0928897b71bd00a5a7291755dcd64f0`;

  searchTests["graphql_v2"] =
    `${LINKEDIN_API_BASE}/graphql?includeWebMetadata=true&variables=${encodeURIComponent(graphqlVars)}&queryId=voyagerSearchDashClusters.8f5a6f5f1a0dc14a9ce3e58be2f6d2fd`;

  // Blended (legacy)
  searchTests["blended"] =
    `${LINKEDIN_API_BASE}/search/blended?count=10&filters=${encodeURIComponent(`List(currentCompany->${companyId},resultType->PEOPLE)`)}&origin=COMPANY_PAGE_CANNED_SEARCH&q=all&start=0`;

  const searchResults: Record<string, unknown> = {};
  for (const [name, url] of Object.entries(searchTests)) {
    searchResults[name] = await tryFetch(url, headers);
  }
  steps["step2_search_formats"] = searchResults;

  // Step 3: Test DuckDuckGo
  try {
    const ddgQuery = `site:linkedin.com/in "${companyName}" partner OR director`;
    const ddgResults = await searchDuckDuckGo(ddgQuery);
    steps["step3_duckduckgo"] = {
      resultCount: ddgResults.length,
      results: ddgResults.slice(0, 3).map(r => ({ url: r.url, title: r.title })),
    };
  } catch (e) {
    steps["step3_duckduckgo_error"] = errorDetail(e);
  }

  // Step 4: Test Bing
  try {
    const bingQuery = `site:linkedin.com/in "${companyName}" partner OR director`;
    const bingResults = await searchBing(bingQuery);
    steps["step4_bing"] = {
      resultCount: bingResults.length,
      results: bingResults.slice(0, 3).map(r => ({ url: r.url, title: r.title })),
    };
  } catch (e) {
    steps["step4_bing_error"] = errorDetail(e);
  }

  return NextResponse.json({ slug, companyId, companyName, steps });
}

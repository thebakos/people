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

/** Fetch raw HTML from a URL with timeout — for debugging search engines */
async function fetchRawHTML(
  url: string,
  method: "GET" | "POST" = "GET",
  body?: string
): Promise<{ status: number; length: number; preview: string; hasResultClass: boolean }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const options: RequestInit = {
      method,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      },
      signal: controller.signal,
      ...(body ? { body } : {}),
    };
    const res = await fetch(url, options);
    const html = await res.text();
    return {
      status: res.status,
      length: html.length,
      preview: html.slice(0, 500),
      hasResultClass: html.includes("result__a") || html.includes("b_algo") || html.includes("result-link"),
    };
  } catch (e) {
    return { status: -1, length: 0, preview: e instanceof Error ? e.message : String(e), hasResultClass: false };
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

  // Build headers
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

  // Step 2: Try both list-style and map-style queryParameters
  const queryMap = `(flagshipSearchIntent:SEARCH_SRP,queryParameters:(currentCompany:List(${companyId}),resultType:List(PEOPLE)),includeFiltersInResponse:false)`;
  const queryList = `(flagshipSearchIntent:SEARCH_SRP,queryParameters:List((key:currentCompany,value:List(${companyId})),(key:resultType,value:List(PEOPLE))),includeFiltersInResponse:false)`;

  const searchTests: Record<string, string> = {};

  // Test list-style format with a few decoration IDs
  for (const ver of [193, 190, 187]) {
    searchTests[`list_${ver}`] =
      `${LINKEDIN_API_BASE}/search/dash/clusters?decorationId=${encodeURIComponent(`com.linkedin.voyager.dash.deco.search.SearchClusterCollection-${ver}`)}&origin=COMPANY_PAGE_CANNED_SEARCH&q=all&query=${encodeURIComponent(queryList)}&start=0&count=10`;
  }

  // Test map-style format (legacy)
  searchTests["map_193"] =
    `${LINKEDIN_API_BASE}/search/dash/clusters?decorationId=${encodeURIComponent("com.linkedin.voyager.dash.deco.search.SearchClusterCollection-193")}&origin=COMPANY_PAGE_CANNED_SEARCH&q=all&query=${encodeURIComponent(queryMap)}&start=0&count=10`;

  // Without decorationId
  searchTests["list_no_deco"] =
    `${LINKEDIN_API_BASE}/search/dash/clusters?origin=COMPANY_PAGE_CANNED_SEARCH&q=all&query=${encodeURIComponent(queryList)}&start=0&count=10`;

  // GraphQL with list-style params
  const graphqlVarsList = `(start:0,origin:COMPANY_PAGE_CANNED_SEARCH,query:(flagshipSearchIntent:SEARCH_SRP,queryParameters:List((key:currentCompany,value:List(${companyId})),(key:resultType,value:List(PEOPLE))),includeFiltersInResponse:false),count:10)`;

  searchTests["graphql_list_v1"] =
    `${LINKEDIN_API_BASE}/graphql?includeWebMetadata=true&variables=${encodeURIComponent(graphqlVarsList)}&queryId=voyagerSearchDashClusters.b0928897b71bd00a5a7291755dcd64f0`;

  const searchResults: Record<string, unknown> = {};
  for (const [name, url] of Object.entries(searchTests)) {
    searchResults[name] = await tryFetch(url, headers);
  }
  steps["step2_search_formats"] = searchResults;

  // Step 3: Test company page HTML scraping
  try {
    const pageHeaders = { ...headers, Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", Referer: "https://www.linkedin.com/" };
    const pageUrl = `https://www.linkedin.com/company/${slug}/people/`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let res: Response;
    try {
      res = await fetch(pageUrl, { headers: pageHeaders, signal: controller.signal, redirect: "follow" });
    } finally {
      clearTimeout(timeout);
    }
    const html = await res.text();

    // Count embedded <code> blocks and check for MiniProfile data
    const codeBlocks = (html.match(/<code[^>]*>/g) || []).length;
    const hasMiniProfile = html.includes("MiniProfile") || html.includes("publicIdentifier");
    const hasFirstName = html.includes("firstName");

    steps["step3_company_page"] = {
      status: res.status,
      htmlLength: html.length,
      codeBlocks,
      hasMiniProfile,
      hasFirstName,
      htmlPreview: html.slice(0, 300),
    };
  } catch (e) {
    steps["step3_company_page_error"] = errorDetail(e);
  }

  // Step 4: Test DuckDuckGo (parsed results + raw HTML)
  const ddgQuery = `site:linkedin.com/in "${companyName}" partner OR director`;
  try {
    const ddgResults = await searchDuckDuckGo(ddgQuery);
    steps["step4_duckduckgo"] = {
      resultCount: ddgResults.length,
      results: ddgResults.slice(0, 3).map(r => ({ url: r.url, title: r.title })),
    };
  } catch (e) {
    steps["step4_duckduckgo_error"] = errorDetail(e);
  }

  // Step 4b: Raw DDG HTML to debug parsing
  try {
    const rawDDG = await fetchRawHTML(
      "https://html.duckduckgo.com/html/",
      "POST",
      `q=${encodeURIComponent(ddgQuery)}`
    );
    steps["step4b_ddg_raw"] = rawDDG;
  } catch (e) {
    steps["step4b_ddg_raw_error"] = errorDetail(e);
  }

  // Step 5: Test Bing (parsed results + raw HTML)
  const bingQuery = `site:linkedin.com/in "${companyName}" partner OR director`;
  try {
    const bingResults = await searchBing(bingQuery);
    steps["step5_bing"] = {
      resultCount: bingResults.length,
      results: bingResults.slice(0, 3).map(r => ({ url: r.url, title: r.title })),
    };
  } catch (e) {
    steps["step5_bing_error"] = errorDetail(e);
  }

  // Step 5b: Raw Bing HTML
  try {
    const rawBing = await fetchRawHTML(
      `https://www.bing.com/search?q=${encodeURIComponent(bingQuery)}&count=20`
    );
    steps["step5b_bing_raw"] = rawBing;
  } catch (e) {
    steps["step5b_bing_raw_error"] = errorDetail(e);
  }

  return NextResponse.json({ slug, companyId, companyName, steps });
}

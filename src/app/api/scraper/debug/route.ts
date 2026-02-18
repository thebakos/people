import { NextRequest, NextResponse } from "next/server";
import { getCompanyInfo } from "@/lib/linkedinApi";

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

  // Build headers
  const csrfToken = `ajax:${Date.now()}`;
  const headers: Record<string, string> = {
    Cookie: `li_at=${linkedinCookie}; JSESSIONID="${csrfToken}"`,
    "Csrf-Token": csrfToken,
    "X-Restli-Protocol-Version": "2.0.0",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept: "application/vnd.linkedin.normalized+json+2.1",
    Referer: "https://www.linkedin.com/search/results/people/",
    Origin: "https://www.linkedin.com",
  };

  // Step 2: Try multiple search URL formats to find one that works
  const searchTests: Record<string, string> = {};

  // Format A: search/dash/clusters with decorationId -186
  const queryA = `(flagshipSearchIntent:SEARCH_SRP,queryParameters:(currentCompany:List(${companyId}),resultType:List(PEOPLE)),includeFiltersInResponse:false)`;
  searchTests["A_clusters_186"] =
    `${LINKEDIN_API_BASE}/search/dash/clusters?decorationId=${encodeURIComponent("com.linkedin.voyager.dash.deco.search.SearchClusterCollection-186")}&origin=COMPANY_PAGE_CANNED_SEARCH&q=all&query=${encodeURIComponent(queryA)}&start=0&count=10`;

  // Format B: search/dash/clusters with decorationId -165
  searchTests["B_clusters_165"] =
    `${LINKEDIN_API_BASE}/search/dash/clusters?decorationId=${encodeURIComponent("com.linkedin.voyager.dash.deco.search.SearchClusterCollection-165")}&origin=COMPANY_PAGE_CANNED_SEARCH&q=all&query=${encodeURIComponent(queryA)}&start=0&count=10`;

  // Format C: search/dash/clusters with keywords param
  const queryC = `(flagshipSearchIntent:SEARCH_SRP,queryParameters:(currentCompany:List(${companyId}),keywords:,resultType:List(PEOPLE)),includeFiltersInResponse:false)`;
  searchTests["C_clusters_keywords"] =
    `${LINKEDIN_API_BASE}/search/dash/clusters?decorationId=${encodeURIComponent("com.linkedin.voyager.dash.deco.search.SearchClusterCollection-186")}&origin=COMPANY_PAGE_CANNED_SEARCH&q=all&query=${encodeURIComponent(queryC)}&start=0&count=10`;

  // Format D: search/blended (older endpoint)
  searchTests["D_blended"] =
    `${LINKEDIN_API_BASE}/search/blended?count=10&filters=${encodeURIComponent(`List(currentCompany->${companyId},resultType->PEOPLE)`)}&origin=COMPANY_PAGE_CANNED_SEARCH&q=all&start=0`;

  // Format E: graphql search
  const graphqlVars = `(start:0,origin:COMPANY_PAGE_CANNED_SEARCH,query:(flagshipSearchIntent:SEARCH_SRP,queryParameters:(currentCompany:List(${companyId}),resultType:List(PEOPLE)),includeFiltersInResponse:false))`;
  searchTests["E_graphql"] =
    `${LINKEDIN_API_BASE}/graphql?variables=${encodeURIComponent(graphqlVars)}&queryId=voyagerSearchDashClusters.b0928897b71bd00a5a7291755dcd64f0`;

  // Format F: search/dash/clusters without decorationId
  searchTests["F_clusters_no_decoration"] =
    `${LINKEDIN_API_BASE}/search/dash/clusters?origin=COMPANY_PAGE_CANNED_SEARCH&q=all&query=${encodeURIComponent(queryA)}&start=0&count=10`;

  // Format G: typeahead endpoint
  searchTests["G_typeahead"] =
    `${LINKEDIN_API_BASE}/typeahead/hitsV2?keywords=&origin=COMPANY_PAGE_CANNED_SEARCH&q=federated&currentCompany=${companyId}`;

  const searchResults: Record<string, unknown> = {};
  for (const [name, url] of Object.entries(searchTests)) {
    searchResults[name] = await tryFetch(url, headers);
  }
  steps["step2_search_formats"] = searchResults;

  // Step 3: Test DuckDuckGo with raw HTML check
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const ddgQuery = `site:linkedin.com/in "${companyName}"`;
      const res = await fetch("https://html.duckduckgo.com/html/", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
        body: `q=${encodeURIComponent(ddgQuery)}`,
        signal: controller.signal,
      });
      const html = await res.text();
      const hasResults = html.includes('class="result__a"');
      const resultCount = (html.match(/class="result__a"/g) || []).length;
      steps["step3_duckduckgo"] = {
        status: res.status,
        htmlLength: html.length,
        hasResultClass: hasResults,
        resultCount,
        htmlPreview: html.slice(0, 500),
      };
    } finally {
      clearTimeout(timeout);
    }
  } catch (e) {
    steps["step3_duckduckgo_error"] = errorDetail(e);
  }

  return NextResponse.json({ slug, companyId, companyName, steps });
}

import { NextRequest, NextResponse } from "next/server";
import { getCompanyInfo } from "@/lib/linkedinApi";
import { searchDuckDuckGo, searchBing } from "@/lib/duckduckgo";

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

/** Fetch a LinkedIn HTML page, return metadata about the embedded data */
async function testPageScrape(
  url: string,
  headers: Record<string, string>
): Promise<{
  status: number;
  htmlLength: number;
  codeBlocks: number;
  miniProfileCount: number;
  profileNames: string[];
  htmlPreview: string;
  error?: string;
}> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    let response: Response;
    try {
      response = await fetch(url, { headers, signal: controller.signal, redirect: "follow" });
    } finally {
      clearTimeout(timeout);
    }

    const html = await response.text();
    const codeBlocks = (html.match(/<code[^>]*>/g) || []).length;

    // Count MiniProfiles found in <code> blocks
    const profiles: string[] = [];
    const codeRegex = /<code[^>]*>([\s\S]*?)<\/code>/g;
    let match;
    while ((match = codeRegex.exec(html)) !== null && profiles.length < 20) {
      try {
        const decoded = match[1]
          .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
          .replace(/&amp;/g, "&").replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'");
        const data = JSON.parse(decoded);
        const included = data.included;
        if (Array.isArray(included)) {
          for (const entity of included) {
            if (!entity || typeof entity !== "object") continue;
            const type = String(entity.$type || "");
            if (type.includes("MiniProfile") || (entity.publicIdentifier && entity.firstName)) {
              const firstName = String(entity.firstName || "");
              const lastName = String(entity.lastName || "");
              const name = `${firstName} ${lastName}`.trim();
              if (name && name !== "LinkedIn Member") {
                profiles.push(name);
              }
            }
          }
        }
      } catch {
        // Not valid JSON
      }
    }

    return {
      status: response.status,
      htmlLength: html.length,
      codeBlocks,
      miniProfileCount: profiles.length,
      profileNames: profiles.slice(0, 10),
      htmlPreview: html.slice(0, 400),
    };
  } catch (e) {
    return {
      status: -1,
      htmlLength: 0,
      codeBlocks: 0,
      miniProfileCount: 0,
      profileNames: [],
      htmlPreview: "",
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Debug endpoint — tests the HTML scraping approach + web search engines.
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

  // Step 1: Company lookup (Voyager API)
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

  const headers = buildPageHeaders(linkedinCookie);

  // Step 2: Test search results page HTML scraping (PRIMARY approach)
  const searchUrl = `https://www.linkedin.com/search/results/people/?currentCompany=%5B%22${companyId}%22%5D&origin=COMPANY_PAGE_CANNED_SEARCH`;
  steps["step2_search_page_scrape"] = await testPageScrape(searchUrl, headers);

  // Step 3: Test company people page HTML scraping (FALLBACK)
  const peopleUrl = `https://www.linkedin.com/company/${slug}/people/`;
  steps["step3_company_people_page"] = await testPageScrape(peopleUrl, headers);

  // Step 4: Test DuckDuckGo
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

  // Step 5: Test Bing
  try {
    const bingResults = await searchBing(ddgQuery);
    steps["step5_bing"] = {
      resultCount: bingResults.length,
      results: bingResults.slice(0, 3).map(r => ({ url: r.url, title: r.title })),
    };
  } catch (e) {
    steps["step5_bing_error"] = errorDetail(e);
  }

  return NextResponse.json({ slug, companyId, companyName, steps });
}

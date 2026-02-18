import { NextRequest, NextResponse } from "next/server";
import { getCompanyInfo } from "@/lib/linkedinApi";
import { searchDuckDuckGo } from "@/lib/duckduckgo";

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

/**
 * Debug endpoint to test LinkedIn API connectivity and see raw responses.
 * POST /api/scraper/debug
 * Body: { linkedinCookie: string, companyUrl: string }
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { linkedinCookie, companyUrl } = body;

  if (!linkedinCookie) {
    return NextResponse.json(
      { error: "linkedinCookie is required" },
      { status: 400 }
    );
  }

  const slug =
    companyUrl?.match(/linkedin\.com\/company\/([^/?#]+)/)?.[1] ||
    "sequoia-capital";
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
    steps["step1_company"] = {
      companyName: info.companyName,
      companyId: info.companyId,
      authValid: true,
    };
  } catch (e) {
    steps["step1_company_error"] = errorDetail(e);
  }

  // Step 2: Raw Voyager search — show the actual response so we can debug parsing
  if (companyId) {
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

    const query = `(flagshipSearchIntent:SEARCH_SRP,queryParameters:(currentCompany:List(${companyId}),resultType:List(PEOPLE)),includeFiltersInResponse:false)`;
    const searchUrl =
      `${LINKEDIN_API_BASE}/search/dash/clusters` +
      `?decorationId=${encodeURIComponent("com.linkedin.voyager.dash.deco.search.SearchClusterCollection-186")}` +
      `&origin=COMPANY_PAGE_CANNED_SEARCH` +
      `&q=all` +
      `&query=${encodeURIComponent(query)}` +
      `&start=0&count=10`;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      let res: Response;
      try {
        res = await fetch(searchUrl, { headers, signal: controller.signal });
      } finally {
        clearTimeout(timeout);
      }

      const rawText = await res.text();
      let rawJson: unknown = null;
      try {
        rawJson = JSON.parse(rawText);
      } catch {
        /* not JSON */
      }

      // Extract summary of included entity types
      const included = (rawJson as Record<string, unknown>)?.included as Record<string, unknown>[] | undefined;
      const typeSummary = included
        ? [...new Set(included.map((e) => String(e.$type || "unknown")))].map((t) => ({
            type: t,
            count: included.filter((e) => String(e.$type || "unknown") === t).length,
          }))
        : [];

      // Show a few sample entities for each type
      const samples: Record<string, unknown[]> = {};
      for (const { type } of typeSummary) {
        const entities = included!.filter((e) => String(e.$type || "unknown") === type);
        samples[type] = entities.slice(0, 2).map((e) => {
          // Only show a few key fields to keep response manageable
          const keys = Object.keys(e);
          const summary: Record<string, unknown> = { $type: e.$type, entityUrn: e.entityUrn };
          for (const k of ["title", "primarySubtitle", "navigationUrl", "navigationContext", "firstName", "lastName", "publicIdentifier", "occupation", "headline", "name", "text"]) {
            if (k in e) summary[k] = e[k];
          }
          summary._allKeys = keys;
          return summary;
        });
      }

      steps["step2_voyager_raw"] = {
        status: res.status,
        includedCount: included?.length ?? 0,
        typeSummary,
        samples,
        rawPreview: typeof rawText === "string" ? rawText.slice(0, 500) : null,
      };
    } catch (e) {
      steps["step2_voyager_error"] = errorDetail(e);
    }
  }

  // Step 3: Test DuckDuckGo connectivity
  try {
    const ddgResults = await searchDuckDuckGo(`site:linkedin.com/in "${companyName || slug}"`);
    steps["step3_duckduckgo"] = {
      resultCount: ddgResults.length,
      results: ddgResults.slice(0, 3).map((r) => ({
        title: r.title,
        url: r.url,
      })),
    };
  } catch (e) {
    steps["step3_duckduckgo_error"] = errorDetail(e);
  }

  return NextResponse.json({
    slug,
    companyId,
    companyName,
    steps,
  });
}

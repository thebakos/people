import { NextRequest, NextResponse } from "next/server";
import { validateAuth, getCompanyInfo, searchCompanyEmployees } from "@/lib/linkedinApi";

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

  // Step 1: Validate auth (fetches real JSESSIONID from LinkedIn)
  let jsessionId = "";
  let authValid = false;
  try {
    const authResult = await validateAuth(linkedinCookie);
    jsessionId = authResult.jsessionId;
    authValid = authResult.valid;
    steps["step1_auth"] = {
      valid: authResult.valid,
      jsessionIdObtained: !!authResult.jsessionId,
      jsessionIdPrefix: authResult.jsessionId?.substring(0, 15) + "...",
    };
  } catch (e) {
    steps["step1_auth_error"] = errorDetail(e);
  }

  // Step 2: Company lookup
  let companyId = "";
  let companyName = "";
  try {
    const info = await getCompanyInfo(
      companyUrl || `https://www.linkedin.com/company/${slug}`,
      linkedinCookie,
      jsessionId || undefined
    );
    companyId = info.companyId;
    companyName = info.companyName;
    steps["step2_company"] = {
      companyName: info.companyName,
      companyId: info.companyId,
    };
  } catch (e) {
    steps["step2_company_error"] = errorDetail(e);
  }

  // Step 3: Raw search endpoint tests
  if (companyId && authValid) {
    const csrfToken = jsessionId || `ajax:${Date.now()}`;
    const headers: Record<string, string> = {
      Cookie: `li_at=${linkedinCookie}; JSESSIONID="${csrfToken}"`,
      "Csrf-Token": csrfToken,
      "X-Restli-Protocol-Version": "2.0.0",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "application/vnd.linkedin.normalized+json+2.1",
      Referer: "https://www.linkedin.com/search/results/people/",
      Origin: "https://www.linkedin.com",
      "Sec-Fetch-Site": "same-origin",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Dest": "empty",
      "Sec-Ch-Ua": '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
      "Sec-Ch-Ua-Mobile": "?0",
      "Sec-Ch-Ua-Platform": '"Windows"',
      "Accept-Language": "en-US,en;q=0.9",
      "Accept-Encoding": "gzip, deflate, br",
    };

    // 3a: search/dash/clusters — URL-encode the query parameter properly
    try {
      const query = `(flagshipSearchIntent:SEARCH_SRP,queryParameters:(currentCompany:List(${companyId}),resultType:List(PEOPLE)),includeFiltersInResponse:false)`;
      const decorationId = "com.linkedin.voyager.dash.deco.search.SearchClusterCollection-186";
      const url =
        `https://www.linkedin.com/voyager/api/search/dash/clusters` +
        `?decorationId=${encodeURIComponent(decorationId)}` +
        `&origin=COMPANY_PAGE_CANNED_SEARCH` +
        `&q=all` +
        `&query=${encodeURIComponent(query)}` +
        `&start=0&count=5`;

      steps["step3a_url"] = url;
      const res = await fetch(url, { headers });
      const resBody = await res.text();

      let parsed: Record<string, unknown> | null = null;
      try { parsed = JSON.parse(resBody); } catch { /* not JSON */ }

      if (parsed) {
        const included = (parsed.included || []) as Record<string, unknown>[];
        const types = [...new Set(included.map((e) => String(e.$type || "unknown")))];

        const entityResult = included.find((e) =>
          String(e.$type || "").includes("EntityResultViewModel") ||
          String(e.$type || "").includes("EntityResult")
        ) as Record<string, unknown> | undefined;

        const entityResultSnapshot = entityResult
          ? Object.fromEntries(
              Object.entries(entityResult).map(([k, v]) => [
                k,
                typeof v === "object" && v !== null
                  ? JSON.stringify(v).substring(0, 200)
                  : v,
              ])
            )
          : null;

        steps["step3a_clusters"] = {
          status: res.status,
          ok: res.ok,
          includedCount: included.length,
          entityTypes: types,
          entityResultSample: entityResultSnapshot,
        };
      } else {
        steps["step3a_clusters"] = {
          status: res.status,
          rawBody: resBody.substring(0, 500),
        };
      }
    } catch (e) {
      steps["step3a_error"] = errorDetail(e);
    }

    // 3b: search/blended — URL-encode the filters parameter
    try {
      const filters = `List(currentCompany->${companyId},resultType->PEOPLE)`;
      const url =
        `https://www.linkedin.com/voyager/api/search/blended` +
        `?count=5` +
        `&filters=${encodeURIComponent(filters)}` +
        `&origin=COMPANY_PAGE_CANNED_SEARCH` +
        `&q=all&start=0`;

      steps["step3b_url"] = url;
      const res = await fetch(url, { headers });
      steps["step3b_blended"] = { status: res.status, ok: res.ok };

      if (res.ok) {
        const parsed = await res.json();
        const included = (parsed.included || []) as Record<string, unknown>[];
        steps["step3b_blended_data"] = {
          includedCount: included.length,
          entityTypes: [...new Set(included.map((e: Record<string, unknown>) => String(e.$type || "unknown")))],
        };
      }
    } catch (e) {
      steps["step3b_error"] = errorDetail(e);
    }

    // 3c: graphql endpoint — variables as JSON in query param (already encoded)
    try {
      const variables = encodeURIComponent(JSON.stringify({
        start: 0,
        count: 5,
        origin: "COMPANY_PAGE_CANNED_SEARCH",
        query: {
          flagshipSearchIntent: "SEARCH_SRP",
          queryParameters: {
            currentCompany: [companyId],
            resultType: ["PEOPLE"],
          },
          includeFiltersInResponse: false,
        },
      }));
      const queryId = "voyagerSearchDashClusters.b0928897b71bd00a5a7291755dcd64f0";
      const url = `https://www.linkedin.com/voyager/api/graphql?variables=${variables}&queryId=${encodeURIComponent(queryId)}`;

      steps["step3c_url"] = url;
      const res = await fetch(url, { headers });
      const resBody = await res.text();

      let parsed: Record<string, unknown> | null = null;
      try { parsed = JSON.parse(resBody); } catch { /* not JSON */ }

      if (parsed) {
        const included = (parsed.included || []) as Record<string, unknown>[];
        const types = [...new Set(included.map((e) => String(e.$type || "unknown")))];
        steps["step3c_graphql"] = {
          status: res.status,
          ok: res.ok,
          includedCount: included.length,
          entityTypes: types,
          sampleEntities: included.slice(0, 3).map((e) => ({
            $type: e.$type,
            entityUrn: e.entityUrn,
            firstName: e.firstName,
            lastName: e.lastName,
            publicIdentifier: e.publicIdentifier,
            keys: Object.keys(e),
          })),
        };
      } else {
        steps["step3c_graphql"] = {
          status: res.status,
          rawBody: resBody.substring(0, 500),
        };
      }
    } catch (e) {
      steps["step3c_error"] = errorDetail(e);
    }

    // 3d: Simple connectivity test — try fetching a known search-like path
    try {
      const simpleUrl = `https://www.linkedin.com/voyager/api/search/dash/clusters?q=all&count=1`;
      steps["step3d_url"] = simpleUrl;
      const res = await fetch(simpleUrl, { headers });
      steps["step3d_simple"] = { status: res.status, ok: res.ok };
    } catch (e) {
      steps["step3d_error"] = errorDetail(e);
    }

    // Step 4: End-to-end test using our actual search+parse function
    try {
      const employees = await searchCompanyEmployees(
        companyId,
        linkedinCookie,
        5,
        jsessionId || undefined
      );
      steps["step4_parsed"] = {
        employeeCount: employees.length,
        employees: employees.map((e) => ({
          name: e.name,
          headline: e.headline,
          url: e.linkedinUrl,
        })),
      };
    } catch (e) {
      steps["step4_error"] = errorDetail(e);
    }
  }

  return NextResponse.json({
    slug,
    companyId,
    companyName,
    authValid,
    steps,
  });
}

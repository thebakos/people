import { NextRequest, NextResponse } from "next/server";
import { validateAuth, getCompanyInfo } from "@/lib/linkedinApi";

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
    steps["step1_auth_error"] = String(e);
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
    steps["step2_company_error"] = String(e);
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
    };

    // 3a: search/dash/clusters — manually built URL (no URLSearchParams encoding)
    try {
      const query = `(flagshipSearchIntent:SEARCH_SRP,queryParameters:(currentCompany:List(${companyId}),resultType:List(PEOPLE)),includeFiltersInResponse:false)`;
      const decorationId = "com.linkedin.voyager.dash.deco.search.SearchClusterCollection-186";
      const url =
        `https://www.linkedin.com/voyager/api/search/dash/clusters` +
        `?decorationId=${encodeURIComponent(decorationId)}` +
        `&origin=COMPANY_PAGE_CANNED_SEARCH` +
        `&q=all` +
        `&query=${query}` +
        `&start=0&count=5`;

      const res = await fetch(url, { headers });
      const resBody = await res.text();

      let parsed: Record<string, unknown> | null = null;
      try { parsed = JSON.parse(resBody); } catch { /* not JSON */ }

      if (parsed) {
        const included = (parsed.included || []) as Record<string, unknown>[];
        const types = [...new Set(included.map((e) => String(e.$type || "unknown")))];
        steps["step3a_clusters"] = {
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
            occupation: e.occupation,
            keys: Object.keys(e),
          })),
        };
      } else {
        steps["step3a_clusters"] = {
          status: res.status,
          rawBody: resBody.substring(0, 500),
        };
      }
    } catch (e) {
      steps["step3a_error"] = String(e);
    }

    // 3b: search/blended — manually built URL
    try {
      const url =
        `https://www.linkedin.com/voyager/api/search/blended` +
        `?count=5` +
        `&filters=List(currentCompany->${companyId},resultType->PEOPLE)` +
        `&origin=COMPANY_PAGE_CANNED_SEARCH` +
        `&q=all&start=0`;

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
      steps["step3b_error"] = String(e);
    }

    // 3c: graphql endpoint — variables as JSON in query param
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
      steps["step3c_error"] = String(e);
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

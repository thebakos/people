import { NextRequest, NextResponse } from "next/server";
import { getCompanyInfo, searchCompanyEmployees } from "@/lib/linkedinApi";

/**
 * Debug endpoint to test LinkedIn API connectivity and see raw responses.
 * POST /api/scraper/debug
 * Body: { linkedinCookie: string, companyUrl: string }
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { linkedinCookie, companyUrl } = body;

  if (!linkedinCookie) {
    return NextResponse.json({ error: "linkedinCookie is required" }, { status: 400 });
  }

  const slug = companyUrl?.match(/linkedin\.com\/company\/([^/?#]+)/)?.[1] || "sequoia-capital";
  const csrfToken = `ajax:${Date.now()}`;
  const headers: Record<string, string> = {
    Cookie: `li_at=${linkedinCookie}; JSESSIONID="${csrfToken}"`,
    "Csrf-Token": csrfToken,
    "X-Restli-Protocol-Version": "2.0.0",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept: "application/vnd.linkedin.normalized+json+2.1",
  };

  const steps: Record<string, unknown> = {};

  // Step 1: Test basic auth
  try {
    const meRes = await fetch("https://www.linkedin.com/voyager/api/me", { headers });
    steps["step1_auth"] = { status: meRes.status, ok: meRes.ok };
  } catch (e) {
    steps["step1_error"] = String(e);
  }

  // Step 2: Company lookup using our actual function
  let companyId = "";
  try {
    const info = await getCompanyInfo(
      companyUrl || `https://www.linkedin.com/company/${slug}`,
      linkedinCookie
    );
    companyId = info.companyId;
    steps["step2_company"] = {
      companyName: info.companyName,
      companyId: info.companyId,
    };
  } catch (e) {
    steps["step2_error"] = String(e);
  }

  // Step 3: Test search endpoints directly
  if (companyId) {
    // 3a: search/dash/clusters with different decorationIds
    const decorationIds = [
      "com.linkedin.voyager.dash.deco.search.SearchClusterCollection-186",
      "com.linkedin.voyager.dash.deco.search.SearchClusterCollection-185",
      "com.linkedin.voyager.dash.deco.search.SearchClusterCollection-165",
    ];

    for (let i = 0; i < decorationIds.length; i++) {
      try {
        const params = new URLSearchParams({
          decorationId: decorationIds[i],
          origin: "COMPANY_PAGE_CANNED_SEARCH",
          q: "all",
          query: `(flagshipSearchIntent:SEARCH_SRP,queryParameters:(currentCompany:List(${companyId}),resultType:List(PEOPLE)),includeFiltersInResponse:false)`,
          start: "0",
          count: "5",
        });
        const url = `https://www.linkedin.com/voyager/api/search/dash/clusters?${params}`;
        const res = await fetch(url, { headers });
        const key = `step3a_clusters_v${i}`;
        steps[key] = { status: res.status, ok: res.ok, decorationId: decorationIds[i] };

        if (res.ok) {
          const json = await res.json();
          const included = (json.included || []) as Record<string, unknown>[];
          const types = [...new Set(included.map((e: Record<string, unknown>) => String(e.$type || "unknown")))];
          const profiles = included.filter((e: Record<string, unknown>) => {
            const t = String(e.$type || "");
            const u = String(e.entityUrn || "");
            return t.includes("MiniProfile") || t.includes("Profile") || u.includes("fsd_profile") || u.includes("fs_miniProfile");
          });
          steps[key + "_data"] = {
            topKeys: Object.keys(json),
            includedCount: included.length,
            entityTypes: types,
            profileCount: profiles.length,
            sampleProfile: profiles[0] ? {
              $type: profiles[0].$type,
              entityUrn: profiles[0].entityUrn,
              firstName: profiles[0].firstName,
              lastName: profiles[0].lastName,
              publicIdentifier: profiles[0].publicIdentifier,
              headline: profiles[0].headline,
              occupation: profiles[0].occupation,
              keys: Object.keys(profiles[0]),
            } : null,
          };
          if (profiles.length > 0) break; // Found profiles, skip remaining decorationIds
        } else {
          const text = await res.text();
          steps[key + "_error"] = text.substring(0, 300);
        }
      } catch (e) {
        steps[`step3a_clusters_v${i}_error`] = String(e);
      }
    }

    // 3b: search/blended
    try {
      const params = new URLSearchParams({
        count: "5",
        filters: `List(currentCompany->${companyId},resultType->PEOPLE)`,
        origin: "COMPANY_PAGE_CANNED_SEARCH",
        q: "all",
        start: "0",
      });
      const url = `https://www.linkedin.com/voyager/api/search/blended?${params}`;
      const res = await fetch(url, { headers });
      steps["step3b_blended"] = { status: res.status, ok: res.ok };

      if (res.ok) {
        const json = await res.json();
        const included = (json.included || []) as Record<string, unknown>[];
        const types = [...new Set(included.map((e: Record<string, unknown>) => String(e.$type || "unknown")))];
        const profiles = included.filter((e: Record<string, unknown>) => {
          const t = String(e.$type || "");
          return t.includes("MiniProfile") || t.includes("Profile");
        });
        steps["step3b_blended_data"] = {
          topKeys: Object.keys(json),
          includedCount: included.length,
          entityTypes: types,
          profileCount: profiles.length,
          sampleProfile: profiles[0] ? {
            $type: profiles[0].$type,
            firstName: profiles[0].firstName,
            lastName: profiles[0].lastName,
            publicIdentifier: profiles[0].publicIdentifier,
            keys: Object.keys(profiles[0]),
          } : null,
        };
      }
    } catch (e) {
      steps["step3b_error"] = String(e);
    }

    // Step 4: Full end-to-end test using our actual search function
    try {
      const employees = await searchCompanyEmployees(companyId, linkedinCookie, 5);
      steps["step4_final_result"] = {
        employeeCount: employees.length,
        employees: employees.map(e => ({ name: e.name, headline: e.headline, url: e.linkedinUrl })),
      };
    } catch (e) {
      steps["step4_error"] = String(e);
    }
  }

  return NextResponse.json({ slug, companyId, steps });
}

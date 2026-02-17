import { NextRequest, NextResponse } from "next/server";

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

  // Step 1: Test basic auth by fetching own profile
  try {
    const meUrl = "https://www.linkedin.com/voyager/api/me";
    const meRes = await fetch(meUrl, { headers });
    steps["step1_auth_test"] = {
      url: meUrl,
      status: meRes.status,
      statusText: meRes.statusText,
      ok: meRes.ok,
    };
    if (meRes.ok) {
      const meData = await meRes.json();
      steps["step1_profile"] = {
        firstName: meData?.miniProfile?.firstName || meData?.firstName,
        lastName: meData?.miniProfile?.lastName || meData?.lastName,
        keys: Object.keys(meData || {}),
      };
    } else {
      const text = await meRes.text();
      steps["step1_error"] = text.substring(0, 500);
    }
  } catch (e) {
    steps["step1_error"] = String(e);
  }

  // Step 2: Try company lookup
  try {
    const companyUrl1 = `https://www.linkedin.com/voyager/api/organization/companies?decorationId=com.linkedin.voyager.deco.organization.web.WebFullCompanyMain-12&q=universalName&universalName=${encodeURIComponent(slug)}`;
    const compRes1 = await fetch(companyUrl1, { headers });
    steps["step2a_company_v1"] = {
      url: companyUrl1,
      status: compRes1.status,
      ok: compRes1.ok,
    };
    if (compRes1.ok) {
      const data = await compRes1.json();
      steps["step2a_data"] = {
        topKeys: Object.keys(data || {}),
        elementsCount: data?.elements?.length || 0,
        includedCount: data?.included?.length || 0,
        firstElement: data?.elements?.[0] ? {
          type: data.elements[0].$type,
          entityUrn: data.elements[0].entityUrn,
          name: data.elements[0].name,
          universalName: data.elements[0].universalName,
          keys: Object.keys(data.elements[0]),
        } : null,
        firstIncluded: data?.included?.[0] ? {
          type: data.included[0].$type,
          entityUrn: data.included[0].entityUrn,
          name: data.included[0].name,
          keys: Object.keys(data.included[0]),
        } : null,
      };
    } else {
      const text = await compRes1.text();
      steps["step2a_error"] = text.substring(0, 500);
    }
  } catch (e) {
    steps["step2a_error"] = String(e);
  }

  // Step 2b: Try alternate company endpoint
  try {
    const companyUrl2 = `https://www.linkedin.com/voyager/api/entities/companies/${encodeURIComponent(slug)}`;
    const compRes2 = await fetch(companyUrl2, { headers });
    steps["step2b_company_v2"] = {
      url: companyUrl2,
      status: compRes2.status,
      ok: compRes2.ok,
    };
    if (compRes2.ok) {
      const data = await compRes2.json();
      steps["step2b_data"] = {
        topKeys: Object.keys(data || {}),
        entityUrn: data?.entityUrn,
        name: data?.name,
      };
    }
  } catch (e) {
    steps["step2b_error"] = String(e);
  }

  // Step 2c: Try organization API
  try {
    const companyUrl3 = `https://www.linkedin.com/voyager/api/organization/companies?q=universalName&universalName=${encodeURIComponent(slug)}`;
    const compRes3 = await fetch(companyUrl3, { headers });
    steps["step2c_company_v3"] = {
      url: companyUrl3,
      status: compRes3.status,
      ok: compRes3.ok,
    };
    if (compRes3.ok) {
      const data = await compRes3.json();
      steps["step2c_data"] = {
        topKeys: Object.keys(data || {}),
        elementsCount: data?.elements?.length || 0,
        includedCount: data?.included?.length || 0,
        sampleElement: data?.elements?.[0] ? summarizeEntity(data.elements[0]) : null,
        sampleIncluded: data?.included?.slice(0, 3).map(summarizeEntity),
      };
    }
  } catch (e) {
    steps["step2c_error"] = String(e);
  }

  return NextResponse.json({ slug, steps });
}

function summarizeEntity(entity: Record<string, unknown>): Record<string, unknown> {
  return {
    $type: entity.$type,
    entityUrn: entity.entityUrn,
    $id: entity["$id"],
    name: entity.name,
    universalName: entity.universalName,
    keys: Object.keys(entity),
  };
}

import { NextRequest, NextResponse } from "next/server";
import {
  validateAuth,
  getCompanyInfo,
  searchCompanyEmployees,
} from "@/lib/linkedinApi";

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

  // Step 3: Search test (only if auth is valid and we have a company ID)
  if (companyId) {
    if (authValid) {
      try {
        const employees = await searchCompanyEmployees(
          companyId,
          linkedinCookie,
          5,
          jsessionId || undefined
        );
        steps["step3_search"] = {
          employeeCount: employees.length,
          employees: employees.map((e) => ({
            name: e.name,
            headline: e.headline,
            url: e.linkedinUrl,
          })),
        };
      } catch (e) {
        steps["step3_search_error"] = String(e);
      }
    } else {
      steps["step3_search_skipped"] =
        "Auth invalid — search requires valid authentication. Get a fresh li_at cookie.";
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

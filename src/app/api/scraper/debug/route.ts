import { NextRequest, NextResponse } from "next/server";
import { getCompanyInfo, searchCompanyEmployees } from "@/lib/linkedinApi";

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

  // Step 1: Company lookup (also validates auth — if cookie is bad this will 401)
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

  // Step 2: Employee search via Voyager API
  if (companyId) {
    try {
      const employees = await searchCompanyEmployees(
        companyId,
        linkedinCookie,
        5
      );
      steps["step2_voyager_search"] = {
        employeeCount: employees.length,
        employees: employees.map((e) => ({
          name: e.name,
          headline: e.headline,
          url: e.linkedinUrl,
        })),
      };
    } catch (e) {
      steps["step2_voyager_error"] = errorDetail(e);
    }
  }

  return NextResponse.json({
    slug,
    companyId,
    companyName,
    steps,
  });
}

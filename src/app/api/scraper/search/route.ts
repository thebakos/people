import { NextRequest, NextResponse } from "next/server";
import { getCompanyName, searchEmployees } from "@/lib/linkedinSearch";
import { findEmail } from "@/lib/emailFinder";
import { delay } from "@/lib/duckduckgo";
import { ScraperResult } from "@/lib/types";

export const maxDuration = 120; // Allow up to 2 minutes for processing

export async function POST(request: NextRequest) {
  let body: { url: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }

  const { url } = body;

  if (!url || !url.includes("linkedin.com/company")) {
    return NextResponse.json(
      { error: "Please provide a valid LinkedIn company URL" },
      { status: 400 }
    );
  }

  try {
    // Step 1: Get company name from LinkedIn URL
    const companyName = await getCompanyName(url);

    // Small delay to be respectful to DuckDuckGo
    await delay(1000);

    // Step 2: Search for investment professionals
    const employees = await searchEmployees(url, companyName);

    if (employees.length === 0) {
      return NextResponse.json({
        companyName,
        results: [],
        message: "No investment professionals found at this company.",
      });
    }

    // Step 3: For each employee, find their email
    const results: ScraperResult[] = [];

    for (const emp of employees) {
      // Rate-limit between email searches
      await delay(1200);

      let email = "";
      try {
        const found = await findEmail(emp.name, companyName);
        if (found) {
          email = found;
        }
      } catch (e) {
        console.error(`Email search failed for ${emp.name}:`, e);
      }

      results.push({
        companyName,
        contactName: emp.name,
        linkedinUrl: emp.linkedinUrl,
        email,
      });
    }

    return NextResponse.json({ companyName, results });
  } catch (error) {
    console.error(`Error processing company ${url}:`, error);
    return NextResponse.json(
      { error: "Failed to process this company. Please try again." },
      { status: 500 }
    );
  }
}

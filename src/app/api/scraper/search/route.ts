import { NextRequest, NextResponse } from "next/server";
import {
  getCompanyProfile,
  searchEmployees,
  findEmailByLinkedIn,
} from "@/lib/proxycurl";
import { searchEmailViaGoogle } from "@/lib/emailFinder";
import { ScraperResult } from "@/lib/types";

export const maxDuration = 120; // Allow up to 2 minutes for processing

export async function POST(request: NextRequest) {
  if (!process.env.PROXYCURL_API_KEY) {
    return NextResponse.json(
      {
        error:
          "PROXYCURL_API_KEY is not configured. Add it to your .env.local file.",
      },
      { status: 500 }
    );
  }

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
    // Step 1: Get company name
    const companyProfile = await getCompanyProfile(url);
    const companyName = companyProfile?.name || extractCompanySlug(url);

    // Step 2: Search for investment professionals
    const employees = await searchEmployees(url);

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
      const profile = emp.profile;
      let contactName = "";

      if (profile) {
        contactName =
          profile.full_name ||
          `${profile.first_name || ""} ${profile.last_name || ""}`.trim();
      }

      // If no name available, skip this person
      if (!contactName) {
        continue;
      }

      let email = "";

      // Try Proxycurl Contact API first
      try {
        const found = await findEmailByLinkedIn(emp.profile_url);
        if (found) {
          email = found;
        }
      } catch (e) {
        console.error(`Proxycurl email lookup failed for ${contactName}:`, e);
      }

      // Fallback to Google Custom Search
      if (!email) {
        try {
          const found = await searchEmailViaGoogle(contactName, companyName);
          if (found) {
            email = found;
          }
        } catch (e) {
          console.error(`Google email search failed for ${contactName}:`, e);
        }
      }

      results.push({
        companyName,
        contactName,
        linkedinUrl: emp.profile_url,
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

/**
 * Extract a readable company name from the LinkedIn URL slug as fallback.
 */
function extractCompanySlug(url: string): string {
  const match = url.match(/linkedin\.com\/company\/([^/?#]+)/);
  if (match) {
    return match[1]
      .replace(/-/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return "Unknown Company";
}

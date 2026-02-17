import { NextRequest, NextResponse } from "next/server";
import { getCompanyName, searchEmployees } from "@/lib/linkedinSearch";
import { findCompanyEmployees } from "@/lib/linkedinApi";
import { findEmail } from "@/lib/emailFinder";
import { delay } from "@/lib/duckduckgo";
import { ScraperResult } from "@/lib/types";

export const maxDuration = 120; // Allow up to 2 minutes for processing

/** Process a batch of employees for email lookup in parallel */
async function findEmailsBatch(
  employees: { name: string; linkedinUrl: string; headline: string }[],
  companyName: string,
  batchSize: number = 5
): Promise<ScraperResult[]> {
  const results: ScraperResult[] = [];

  // Process in batches to avoid overwhelming DuckDuckGo
  for (let i = 0; i < employees.length; i += batchSize) {
    const batch = employees.slice(i, i + batchSize);

    const batchResults = await Promise.allSettled(
      batch.map(async (emp) => {
        let email = "";
        try {
          const found = await findEmail(emp.name, companyName);
          if (found) email = found;
        } catch (e) {
          console.error(`Email search failed for ${emp.name}:`, e);
        }
        return {
          companyName,
          contactName: emp.name,
          headline: emp.headline,
          linkedinUrl: emp.linkedinUrl,
          email,
        } satisfies ScraperResult;
      })
    );

    for (const result of batchResults) {
      if (result.status === "fulfilled") {
        results.push(result.value);
      }
    }

    // Small delay between batches to respect rate limits
    if (i + batchSize < employees.length) {
      await delay(500);
    }
  }

  return results;
}

export async function POST(request: NextRequest) {
  let body: { url: string; linkedinCookie?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }

  const { url, linkedinCookie: cookieFromBody } = body;

  if (!url || !url.includes("linkedin.com/company")) {
    return NextResponse.json(
      { error: "Please provide a valid LinkedIn company URL" },
      { status: 400 }
    );
  }

  // Use cookie from request body, or fall back to env variable
  const liAtCookie = cookieFromBody || process.env.LINKEDIN_COOKIE || "";

  try {
    let companyName: string;
    let employees: { name: string; linkedinUrl: string; headline: string }[];

    if (liAtCookie) {
      // Use LinkedIn Voyager API with authentication
      console.log("Using LinkedIn API with authentication...");
      const result = await findCompanyEmployees(url, liAtCookie);
      companyName = result.companyName;
      employees = result.employees;
    } else {
      // Fallback: use DuckDuckGo search (may return fewer results)
      console.log("No LinkedIn cookie — falling back to DuckDuckGo search...");
      companyName = await getCompanyName(url);
      await delay(1000);
      employees = await searchEmployees(url, companyName);
    }

    if (employees.length === 0) {
      return NextResponse.json({
        companyName,
        results: [],
        message: liAtCookie
          ? "No employees found at this company."
          : "No results found. Try adding your LinkedIn session cookie for better results.",
      });
    }

    // Find emails in parallel batches (5 at a time)
    const results = await findEmailsBatch(employees, companyName, 5);

    return NextResponse.json({ companyName, results });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    console.error(`Error processing company ${url}:`, message);

    // If LinkedIn auth failed, provide a helpful message
    if (message.includes("authentication") || message.includes("expired")) {
      return NextResponse.json(
        {
          error:
            "LinkedIn session expired. Please get a fresh li_at cookie from your browser.",
        },
        { status: 401 }
      );
    }

    return NextResponse.json(
      { error: `LinkedIn API error: ${message}` },
      { status: 500 }
    );
  }
}

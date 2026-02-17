import { NextRequest, NextResponse } from "next/server";
import { getCompanyName, searchEmployees } from "@/lib/linkedinSearch";
import { findCompanyEmployees } from "@/lib/linkedinApi";
import { findEmail } from "@/lib/emailFinder";
import { delay } from "@/lib/duckduckgo";
import { ScraperResult } from "@/lib/types";

export const maxDuration = 120; // Allow up to 2 minutes for processing

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
      // Fallback: use DuckDuckGo (may return 0 results)
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

    // For each employee, try to find their email
    const results: ScraperResult[] = [];

    for (const emp of employees) {
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

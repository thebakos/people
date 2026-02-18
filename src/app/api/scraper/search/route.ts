import { NextRequest, NextResponse } from "next/server";
import { getCompanyName, searchEmployees } from "@/lib/linkedinSearch";
import { findCompanyEmployees } from "@/lib/linkedinApi";
import { findCompanyDomain, findEmailWithDomain, detectEmailPattern } from "@/lib/emailFinder";
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
      // Use LinkedIn Voyager API with authentication — limit to 10 most relevant
      console.log(`[search] Using LinkedIn API for: ${url}`);
      const result = await findCompanyEmployees(url, liAtCookie, 10);
      companyName = result.companyName;
      employees = result.employees;
      console.log(`[search] Company: ${companyName}, Employees found: ${employees.length}`);
    } else {
      // Fallback: use DuckDuckGo search (may return fewer results)
      console.log("[search] No LinkedIn cookie — falling back to DuckDuckGo search...");
      companyName = await getCompanyName(url);
      await delay(1000);
      employees = await searchEmployees(url, companyName);
      // Limit to 10 from DuckDuckGo too
      employees = employees.slice(0, 10);
      console.log(`[search] DuckDuckGo fallback: ${companyName}, ${employees.length} employees`);
    }

    if (employees.length === 0) {
      console.log(`[search] No employees found for ${companyName}`);
      return NextResponse.json({
        companyName,
        results: [],
        message: liAtCookie
          ? "No employees found at this company. The company may be too small or LinkedIn may be restricting results."
          : "No results found. Try adding your LinkedIn session cookie for better results.",
      });
    }

    // Step 1: Find the company's email domain ONCE
    console.log(`[search] Finding email domain for ${companyName}...`);
    const domain = await findCompanyDomain(companyName);
    console.log(`[search] Company domain: ${domain || "not found"}`);

    // Step 2: If we have a domain, try to detect the email pattern from the
    // first 2 employees (only 2 DDG searches instead of per-person)
    let pattern: string | null = null;
    if (domain) {
      console.log(`[search] Detecting email pattern at @${domain}...`);
      pattern = await detectEmailPattern(employees.slice(0, 3), domain);
      console.log(`[search] Detected pattern: ${pattern || "none — will use first.last"}`);
    }

    // Step 3: Generate emails for all employees using the pattern
    const results: ScraperResult[] = [];

    for (let i = 0; i < employees.length; i++) {
      const emp = employees[i];
      let email = "";

      try {
        email = await findEmailWithDomain(emp.name, companyName, domain, pattern);
      } catch (e) {
        console.error(`[search] Email lookup failed for ${emp.name}:`, e);
      }

      results.push({
        companyName,
        contactName: emp.name,
        headline: emp.headline,
        linkedinUrl: emp.linkedinUrl,
        email,
      });

      // Small delay between lookups to respect rate limits
      if (i < employees.length - 1) {
        await delay(300);
      }
    }

    console.log(`[search] Done: ${results.length} contacts, ${results.filter(r => r.email).length} with emails`);
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

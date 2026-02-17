import { Person, SearchParams } from "./types";
import { v4 as uuidv4 } from "uuid";

const PROXYCURL_API_KEY = process.env.PROXYCURL_API_KEY;

export async function searchLinkedIn(
  params: SearchParams
): Promise<Person[]> {
  if (!PROXYCURL_API_KEY) {
    throw new Error("PROXYCURL_API_KEY is not configured");
  }

  const searchParams = new URLSearchParams();
  if (params.keywords || params.query) {
    searchParams.set("keyword_first_name", "");
    searchParams.set("keyword_last_name", "");
    searchParams.set("current_role_title", params.title || params.query);
  }
  if (params.company) {
    searchParams.set("current_company_name", params.company);
  }
  if (params.location) {
    searchParams.set("country", params.location);
  }
  searchParams.set("page_size", "10");
  searchParams.set("enrich_profiles", "enrich");

  const response = await fetch(
    `https://nubela.co/proxycurl/api/search/person/?${searchParams.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${PROXYCURL_API_KEY}`,
      },
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Proxycurl API error (${response.status}): ${errorText}`
    );
  }

  const data = await response.json();
  const results: Person[] = (data.results || []).map(
    (result: {
      profile?: {
        full_name?: string;
        headline?: string;
        occupation?: string;
        summary?: string;
        city?: string;
        state?: string;
        country_full_name?: string;
        experiences?: Array<{ company?: string }>;
        personal_emails?: string[];
        work_email?: string;
      };
      linkedin_profile_url?: string;
    }) => {
      const profile = result.profile || {};
      return {
        id: uuidv4(),
        name: profile.full_name || "Unknown",
        title: profile.headline || profile.occupation || "",
        company: profile.experiences?.[0]?.company || "",
        location: [profile.city, profile.state, profile.country_full_name]
          .filter(Boolean)
          .join(", "),
        linkedinUrl: result.linkedin_profile_url || "",
        email:
          profile.personal_emails?.[0] || profile.work_email || "",
        summary: profile.summary || "",
        source: "linkedin" as const,
      };
    }
  );

  return results;
}

export async function searchWeb(params: SearchParams): Promise<Person[]> {
  const query = [
    "site:linkedin.com/in/",
    params.query,
    params.title ? `"${params.title}"` : "",
    params.company ? `"${params.company}"` : "",
    params.location || "",
  ]
    .filter(Boolean)
    .join(" ");

  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=10`;

  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });

  if (!response.ok) {
    throw new Error(`Google search error (${response.status})`);
  }

  const html = await response.text();
  const results: Person[] = [];

  // Extract LinkedIn profile URLs from search results
  const linkedinUrlPattern = /https?:\/\/[a-z]+\.linkedin\.com\/in\/[\w-]+/g;
  const urls = [...new Set(html.match(linkedinUrlPattern) || [])];

  // Extract titles/snippets near each URL
  for (const linkedinUrl of urls.slice(0, 10)) {
    const username = linkedinUrl.split("/in/")[1]?.replace(/\/$/, "") || "";
    // Try to find associated text in the HTML near this URL
    const escapedUrl = linkedinUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const contextPattern = new RegExp(
      escapedUrl + "[^<]*<\\/a>\\s*[^<]*(?:<[^>]+>)*\\s*(?:<[^>]+>)*([^<]{0,300})",
      "i"
    );
    const contextMatch = html.match(contextPattern);
    const snippet = contextMatch?.[1]?.replace(/&#?\w+;/g, " ").trim() || "";

    // Parse name from LinkedIn URL slug
    const nameParts = username.split("-").filter((p: string) => !/^\d+$/.test(p));
    const name = nameParts
      .map((p: string) => p.charAt(0).toUpperCase() + p.slice(1))
      .join(" ");

    // Try to extract title/company from snippet
    const titleMatch = snippet.match(/[-–]\s*(.+?)(?:\s*[-–]|$)/);

    results.push({
      id: uuidv4(),
      name: name || "Unknown",
      title: titleMatch?.[1]?.trim() || "",
      company: "",
      location: params.location || "",
      linkedinUrl,
      email: "",
      summary: snippet,
      source: "web" as const,
    });
  }

  return results;
}

export async function searchPeople(
  params: SearchParams
): Promise<Person[]> {
  const results: Person[] = [];

  if (params.source === "linkedin" || params.source === "both") {
    try {
      const linkedinResults = await searchLinkedIn(params);
      results.push(...linkedinResults);
    } catch (error) {
      console.error("LinkedIn search error:", error);
      if (params.source === "linkedin") throw error;
    }
  }

  if (params.source === "web" || params.source === "both") {
    try {
      const webResults = await searchWeb(params);
      results.push(...webResults);
    } catch (error) {
      console.error("Web search error:", error);
      if (params.source === "web") throw error;
    }
  }

  return results;
}

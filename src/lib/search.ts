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
    "site:linkedin.com/in",
    params.query,
    params.title || "",
    params.company || "",
    params.location || "",
  ]
    .filter(Boolean)
    .join(" ");

  // Use DuckDuckGo HTML search — doesn't block server-side requests like Google does
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });

  if (!response.ok) {
    throw new Error(`Search error (${response.status})`);
  }

  const html = await response.text();
  const results: Person[] = [];

  // DuckDuckGo result links contain uddg= parameter with the actual URL
  const resultPattern = /href="[^"]*uddg=(https?%3A%2F%2F[a-z]+\.linkedin\.com%2Fin%2F[^&"]+)[^"]*"[^>]*>([^<]*)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  let match;
  while ((match = resultPattern.exec(html)) !== null && results.length < 10) {
    const linkedinUrl = decodeURIComponent(match[1]);
    const title = match[2].replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').trim();
    const snippet = match[3].replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').trim();

    // Extract name from title (usually "Name - Title - LinkedIn")
    const titleParts = title.split(/\s*[-–—|]\s*/);
    const name = titleParts[0]?.trim() || "";
    const jobTitle = titleParts[1]?.trim() || "";

    if (name) {
      results.push({
        id: uuidv4(),
        name,
        title: jobTitle,
        company: "",
        location: params.location || "",
        linkedinUrl,
        email: "",
        summary: snippet,
        source: "web" as const,
      });
    }
  }

  // Fallback: extract LinkedIn URLs if the structured pattern didn't match
  if (results.length === 0) {
    const urlPattern = /uddg=(https?%3A%2F%2F[a-z]+\.linkedin\.com%2Fin%2F[^&"]+)/g;
    let urlMatch;
    while ((urlMatch = urlPattern.exec(html)) !== null && results.length < 10) {
      const linkedinUrl = decodeURIComponent(urlMatch[1]);
      const username = linkedinUrl.split("/in/")[1]?.replace(/\/$/, "") || "";
      const nameParts = username.split("-").filter((p: string) => !/^\d+$/.test(p));
      const name = nameParts
        .map((p: string) => p.charAt(0).toUpperCase() + p.slice(1))
        .join(" ");

      if (name) {
        results.push({
          id: uuidv4(),
          name,
          title: "",
          company: "",
          location: params.location || "",
          linkedinUrl,
          email: "",
          summary: "",
          source: "web" as const,
        });
      }
    }
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

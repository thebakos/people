import { Person, SearchParams } from "./types";
import { v4 as uuidv4 } from "uuid";

const PROXYCURL_API_KEY = process.env.PROXYCURL_API_KEY;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const GOOGLE_SEARCH_ENGINE_ID = process.env.GOOGLE_SEARCH_ENGINE_ID;

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
  if (!GOOGLE_API_KEY || !GOOGLE_SEARCH_ENGINE_ID) {
    throw new Error(
      "GOOGLE_API_KEY and GOOGLE_SEARCH_ENGINE_ID are not configured"
    );
  }

  const query = [
    params.query,
    params.title ? `"${params.title}"` : "",
    params.company ? `"${params.company}"` : "",
    params.location || "",
    "email contact",
  ]
    .filter(Boolean)
    .join(" ");

  const searchParams = new URLSearchParams({
    key: GOOGLE_API_KEY,
    cx: GOOGLE_SEARCH_ENGINE_ID,
    q: query,
    num: "10",
  });

  const response = await fetch(
    `https://www.googleapis.com/customsearch/v1?${searchParams.toString()}`
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Google Search API error (${response.status}): ${errorText}`
    );
  }

  const data = await response.json();
  const results: Person[] = (data.items || []).map(
    (item: {
      title?: string;
      snippet?: string;
      link?: string;
      pagemap?: {
        person?: Array<{ name?: string; jobtitle?: string; org?: string }>;
        metatags?: Array<{
          "og:title"?: string;
          "og:description"?: string;
        }>;
      };
    }) => {
      const person = item.pagemap?.person?.[0];
      const emailMatch = item.snippet?.match(
        /[\w.+-]+@[\w-]+\.[\w.-]+/
      );

      return {
        id: uuidv4(),
        name: person?.name || item.title?.split(/[|\-–]/)[0]?.trim() || "Unknown",
        title: person?.jobtitle || "",
        company: person?.org || "",
        location: "",
        linkedinUrl: item.link?.includes("linkedin.com")
          ? item.link
          : "",
        email: emailMatch ? emailMatch[0] : "",
        summary: item.snippet || "",
        source: "web" as const,
      };
    }
  );

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

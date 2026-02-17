/**
 * Search for a person's email using Google Custom Search API.
 * Searches public web pages for email addresses associated with the person.
 */
export async function searchEmailViaGoogle(
  name: string,
  company: string
): Promise<string | null> {
  const apiKey = process.env.GOOGLE_API_KEY;
  const searchEngineId = process.env.GOOGLE_SEARCH_ENGINE_ID;

  if (!apiKey || !searchEngineId) {
    return null;
  }

  const query = `"${name}" "${company}" email`;
  const params = new URLSearchParams({
    key: apiKey,
    cx: searchEngineId,
    q: query,
    num: "5",
  });

  try {
    const response = await fetch(
      `https://www.googleapis.com/customsearch/v1?${params}`
    );

    if (!response.ok) {
      console.error(`Google Search API error: ${response.status}`);
      return null;
    }

    const data = await response.json();
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const foundEmails: string[] = [];

    for (const item of data.items || []) {
      const text = `${item.title || ""} ${item.snippet || ""}`;
      const matches = text.match(emailRegex) || [];
      for (const email of matches) {
        const lower = email.toLowerCase();
        // Filter out common generic/spam addresses
        if (
          !lower.includes("example.com") &&
          !lower.includes("noreply") &&
          !lower.includes("no-reply") &&
          !lower.includes("support@") &&
          !lower.includes("info@") &&
          !lower.includes("contact@")
        ) {
          foundEmails.push(lower);
        }
      }
    }

    return foundEmails.length > 0 ? foundEmails[0] : null;
  } catch (error) {
    console.error("Google Search email lookup failed:", error);
    return null;
  }
}

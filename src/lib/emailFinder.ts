import { searchDuckDuckGo } from "./duckduckgo";

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

const BLOCKED_PATTERNS = [
  "example.com",
  "noreply",
  "no-reply",
  "support@",
  "info@",
  "contact@",
  "help@",
  "sales@",
  "admin@",
  "webmaster@",
  "privacy@",
  "legal@",
  "abuse@",
  "sentry.io",
  "email.com",
  "test.com",
  "domain.com",
  "company.com",
  "yourcompany",
  "placeholder",
];

/**
 * Search for a person's email address using DuckDuckGo (free, no API key).
 * Looks through search result snippets for email patterns.
 */
export async function findEmail(
  name: string,
  company: string
): Promise<string | null> {
  // Try a direct email search first
  const query = `"${name}" "${company}" email`;
  const results = await searchDuckDuckGo(query);

  const foundEmails: string[] = [];

  for (const result of results) {
    const text = `${result.title} ${result.snippet}`;
    const matches = text.match(EMAIL_REGEX) || [];

    for (const email of matches) {
      const lower = email.toLowerCase();
      if (isValidEmail(lower, name)) {
        foundEmails.push(lower);
      }
    }
  }

  if (foundEmails.length > 0) {
    // Prefer emails that contain part of the person's name
    const nameParts = name.toLowerCase().split(/\s+/);
    const nameMatch = foundEmails.find((e) =>
      nameParts.some((part) => part.length > 2 && e.includes(part))
    );
    return nameMatch || foundEmails[0];
  }

  return null;
}

/**
 * Check if an email looks valid and isn't a generic/spam address.
 */
function isValidEmail(email: string, name: string): boolean {
  // Check against blocked patterns
  for (const pattern of BLOCKED_PATTERNS) {
    if (email.includes(pattern)) {
      return false;
    }
  }

  // Filter out clearly fake/generic patterns
  if (email.startsWith("...") || email.includes("...")) {
    return false;
  }

  // Must have a reasonable TLD
  const tld = email.split(".").pop() || "";
  if (tld.length < 2 || tld.length > 10) {
    return false;
  }

  return true;
}

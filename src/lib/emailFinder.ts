import { searchDuckDuckGo, searchBing, delay, SearchResult } from "./duckduckgo";

/** Search DDG first, then Bing as fallback */
async function webSearch(query: string): Promise<SearchResult[]> {
  const results = await webSearch(query);
  if (results.length > 0) return results;
  return searchBing(query);
}

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
  "wixpress.com",
  "schema.org",
  "w3.org",
  "googleapis.com",
  "cloudflare",
  "gravatar",
  "wordpress",
  "squarespace",
];

/** Common free/personal email providers — deprioritized but not blocked */
const FREE_EMAIL_PROVIDERS = new Set([
  "gmail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "aol.com",
  "icloud.com",
  "protonmail.com",
  "proton.me",
  "mail.com",
  "yandex.com",
  "zoho.com",
  "fastmail.com",
  "tutanota.com",
  "gmx.com",
  "live.com",
]);

/** Sites to skip when extracting company domain */
const SKIP_DOMAINS = new Set([
  "linkedin.com", "facebook.com", "twitter.com", "x.com",
  "instagram.com", "youtube.com", "wikipedia.org", "crunchbase.com",
  "bloomberg.com", "reuters.com", "forbes.com", "techcrunch.com",
  "github.com", "medium.com", "pitchbook.com", "glassdoor.com",
  "indeed.com", "yelp.com", "bbb.org", "google.com", "apple.com",
  "amazon.com", "duckduckgo.com", "reddit.com",
]);

// ────────────────────────────────────────────────────────────────────────────
// PUBLIC API — called from the search route
// ────────────────────────────────────────────────────────────────────────────

/**
 * Find a company's email domain. Called ONCE per company.
 * Uses 2-3 DuckDuckGo searches max.
 */
export async function findCompanyDomain(
  company: string
): Promise<string | null> {
  try {
    // Strategy 1: Search for the company website directly
    const results = await webSearch(`"${company}" official website`);
    for (const result of results) {
      const domain = extractCompanyDomain(result.url, company);
      if (domain) return domain;
    }

    await delay(500);

    // Strategy 2: Look for emails mentioning the company
    const results2 = await webSearch(`"${company}" "@" email contact`);
    for (const result of results2) {
      const text = `${result.title} ${result.snippet}`;
      const emails = text.match(EMAIL_REGEX) || [];
      for (const email of emails) {
        const domain = email.split("@")[1]?.toLowerCase();
        if (domain && !FREE_EMAIL_PROVIDERS.has(domain) && !isBlockedEmail(email)) {
          return domain;
        }
      }
    }

    await delay(500);

    // Strategy 3: Try company name as domain directly (common for VCs)
    const slug = company.toLowerCase().replace(/[^a-z0-9]/g, "");
    const commonTlds = [".com", ".vc", ".co", ".io", ".xyz", ".capital"];
    const results3 = await webSearch(
      `site:${slug}.com OR site:${slug}.vc OR site:${slug}.co OR site:${slug}.io "${company}"`
    );
    for (const result of results3) {
      for (const tld of commonTlds) {
        if (result.url.includes(slug + tld)) {
          return slug + tld;
        }
      }
      // Also try extracting from the URL
      const domain = extractCompanyDomain(result.url, company);
      if (domain) return domain;
    }
  } catch (e) {
    console.error(`[email] Domain lookup failed for ${company}:`, e);
  }

  return null;
}

/**
 * Detect the email pattern used by a company.
 * Tests a few employees' names against the domain using DuckDuckGo.
 * Returns a pattern string like "first.last", "flast", "firstl", etc.
 */
export async function detectEmailPattern(
  employees: { name: string }[],
  domain: string
): Promise<string | null> {
  const PATTERNS = [
    { id: "first.last", gen: (f: string, l: string) => `${f}.${l}` },
    { id: "firstlast", gen: (f: string, l: string) => `${f}${l}` },
    { id: "flast", gen: (f: string, l: string) => `${f[0]}${l}` },
    { id: "first", gen: (f: string, l: string) => `${f}` },
    { id: "f.last", gen: (f: string, l: string) => `${f[0]}.${l}` },
    { id: "last.first", gen: (f: string, l: string) => `${l}.${f}` },
    { id: "first_last", gen: (f: string, l: string) => `${f}_${l}` },
  ];

  // Try to find a confirmed email for 1-2 employees to detect the pattern
  for (const emp of employees.slice(0, 2)) {
    const { first, last } = parseName(emp.name);
    if (!first || !last) continue;

    const f = first.toLowerCase();
    const l = last.toLowerCase();

    try {
      // Search for any email at this domain for this person
      const query = `"${emp.name}" "@${domain}"`;
      const results = await webSearch(query);

      for (const result of results) {
        const text = `${result.title} ${result.snippet}`;
        const emails = (text.match(EMAIL_REGEX) || [])
          .map((e) => e.toLowerCase())
          .filter((e) => e.endsWith(`@${domain}`));

        for (const email of emails) {
          const local = email.split("@")[0];
          // Match against known patterns
          for (const pat of PATTERNS) {
            if (local === pat.gen(f, l)) {
              console.log(`[email] Pattern detected: ${pat.id} (from ${email})`);
              return pat.id;
            }
          }
        }
      }

      await delay(500);
    } catch {
      // Search failed, continue
    }
  }

  return null;
}

/**
 * Find an email for a single person.
 * If domain and pattern are known, generates the email directly (no DDG search).
 * If domain is known but pattern isn't, uses "first.last" as default.
 * If no domain, falls back to a single DDG search.
 */
export async function findEmailWithDomain(
  name: string,
  company: string,
  domain: string | null,
  pattern: string | null
): Promise<string> {
  const { first, last } = parseName(name);

  // If we have a domain, generate the email from the pattern
  if (domain && first && last) {
    const f = first.toLowerCase();
    const l = last.toLowerCase();

    const email = applyPattern(f, l, domain, pattern || "first.last");

    // Quick verification: one DDG search to see if this email appears online
    try {
      const results = await webSearch(`"${email}"`);
      if (results.length > 0) {
        for (const result of results) {
          const text = `${result.title} ${result.snippet}`;
          if (text.toLowerCase().includes(email)) {
            return email; // Confirmed!
          }
        }
      }
    } catch {
      // Search failed — still return the pattern-based guess
    }

    // Return the pattern-based email even if we couldn't confirm it
    return email;
  }

  // No domain — try a direct search (1 DDG query)
  if (first && last) {
    try {
      const results = await webSearch(
        `"${name}" "${company}" email`
      );
      for (const result of results) {
        const text = `${result.title} ${result.snippet}`;
        const emails = extractValidEmails(text);
        if (emails.length > 0) {
          // Prefer company-domain emails over free providers
          const companyEmail = emails.find(
            (e) => !FREE_EMAIL_PROVIDERS.has(e.split("@")[1])
          );
          return companyEmail || emails[0];
        }
      }
    } catch {
      // Search failed
    }
  }

  return "";
}

/**
 * Legacy API — still used by existing code if needed.
 */
export async function findEmail(
  name: string,
  company: string
): Promise<string | null> {
  const result = await findEmailWithDomain(name, company, null, null);
  return result || null;
}

// ────────────────────────────────────────────────────────────────────────────
// INTERNAL HELPERS
// ────────────────────────────────────────────────────────────────────────────

function applyPattern(
  first: string,
  last: string,
  domain: string,
  pattern: string
): string {
  switch (pattern) {
    case "first.last":
      return `${first}.${last}@${domain}`;
    case "firstlast":
      return `${first}${last}@${domain}`;
    case "flast":
      return `${first[0]}${last}@${domain}`;
    case "first":
      return `${first}@${domain}`;
    case "f.last":
      return `${first[0]}.${last}@${domain}`;
    case "last.first":
      return `${last}.${first}@${domain}`;
    case "first_last":
      return `${first}_${last}@${domain}`;
    case "firstl":
      return `${first}${last[0]}@${domain}`;
    default:
      return `${first}.${last}@${domain}`;
  }
}

function parseName(fullName: string): { first: string; last: string } {
  const cleaned = fullName
    .replace(/\s+(jr\.?|sr\.?|ii|iii|iv|phd|md|esq\.?)$/i, "")
    .replace(/\(.*?\)/g, "") // Remove parenthetical nicknames
    .trim();

  const parts = cleaned.split(/\s+/);
  if (parts.length === 0) return { first: "", last: "" };
  if (parts.length === 1) return { first: parts[0], last: "" };

  return {
    first: parts[0],
    last: parts[parts.length - 1],
  };
}

function extractValidEmails(text: string): string[] {
  const matches = text.match(EMAIL_REGEX) || [];
  return matches
    .map((e) => e.toLowerCase())
    .filter((e) => !isBlockedEmail(e));
}

function isBlockedEmail(email: string): boolean {
  for (const pattern of BLOCKED_PATTERNS) {
    if (email.includes(pattern)) return true;
  }
  if (email.includes("...")) return false;
  const tld = email.split(".").pop() || "";
  const badTlds = ["png", "jpg", "gif", "css", "js", "svg", "ico", "pdf"];
  if (badTlds.includes(tld)) return true;
  return false;
}

function extractCompanyDomain(
  url: string,
  company: string
): string | null {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();

    for (const skip of SKIP_DOMAINS) {
      if (hostname.includes(skip)) return null;
    }

    const domain = hostname.replace(/^www\./, "");
    if (domain.split(".").length < 2) return null;
    if (domain.length > 50) return null;

    // Check if domain relates to company name
    const companyWords = company
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 2);

    const domainBase = domain.split(".")[0];
    const matches = companyWords.some(
      (word) => domainBase.includes(word) || word.includes(domainBase)
    );

    if (matches) return domain;
    return null;
  } catch {
    return null;
  }
}

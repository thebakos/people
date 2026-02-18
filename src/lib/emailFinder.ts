import { searchDuckDuckGo, searchBing, delay, SearchResult } from "./duckduckgo";

/** Search DDG first, then Bing as fallback */
async function webSearch(query: string): Promise<SearchResult[]> {
  const results = await searchDuckDuckGo(query);
  if (results.length > 0) return results;
  return searchBing(query);
}

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

const BLOCKED_PATTERNS = [
  "example.com", "noreply", "no-reply", "support@", "info@",
  "contact@", "help@", "sales@", "admin@", "webmaster@",
  "privacy@", "legal@", "abuse@", "sentry.io", "email.com",
  "test.com", "domain.com", "company.com", "yourcompany",
  "placeholder", "wixpress.com", "schema.org", "w3.org",
  "googleapis.com", "cloudflare", "gravatar", "wordpress", "squarespace",
];

const FREE_EMAIL_PROVIDERS = new Set([
  "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "aol.com",
  "icloud.com", "protonmail.com", "proton.me", "mail.com", "yandex.com",
  "zoho.com", "fastmail.com", "tutanota.com", "gmx.com", "live.com",
]);

const SKIP_DOMAINS = new Set([
  "linkedin.com", "facebook.com", "twitter.com", "x.com",
  "instagram.com", "youtube.com", "wikipedia.org", "crunchbase.com",
  "bloomberg.com", "reuters.com", "forbes.com", "techcrunch.com",
  "github.com", "medium.com", "pitchbook.com", "glassdoor.com",
  "indeed.com", "yelp.com", "bbb.org", "google.com", "apple.com",
  "amazon.com", "duckduckgo.com", "reddit.com",
]);

// ────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ────────────────────────────────────────────────────────────────────────────

/**
 * Find a company's email domain.
 * Priority: LinkedIn website URL → domain generation + HTTP check → DDG/Bing
 */
export async function findCompanyDomain(
  company: string,
  websiteUrl?: string
): Promise<string | null> {
  // Strategy 1: Use the LinkedIn-provided website URL
  if (websiteUrl) {
    try {
      const parsed = new URL(websiteUrl);
      const domain = parsed.hostname.replace(/^www\./, "").toLowerCase();
      if (domain && !SKIP_DOMAINS.has(domain) && !FREE_EMAIL_PROVIDERS.has(domain)) {
        console.log(`[email] Domain from LinkedIn website: ${domain}`);
        return domain;
      }
    } catch {
      // Invalid URL
    }
  }

  // Strategy 2: Generate domain from company name and verify with HTTP HEAD
  const guessedDomain = await guessCompanyDomain(company);
  if (guessedDomain) {
    console.log(`[email] Domain guessed + verified: ${guessedDomain}`);
    return guessedDomain;
  }

  // Strategy 3: Fall back to web search (if DDG/Bing work)
  try {
    const results = await webSearch(`"${company}" official website`);
    for (const result of results) {
      const domain = extractCompanyDomain(result.url, company);
      if (domain) return domain;
    }

    await delay(500);

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
  } catch (e) {
    console.error(`[email] Web search domain lookup failed:`, e);
  }

  // Strategy 4: Just return the best guess without verification
  const slug = company.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (slug.length >= 3) {
    console.log(`[email] Using unverified domain guess: ${slug}.com`);
    return `${slug}.com`;
  }

  return null;
}

/**
 * Try common domain patterns and verify they exist with a HEAD request.
 */
async function guessCompanyDomain(company: string): Promise<string | null> {
  const slug = company.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (slug.length < 3) return null;

  // Also try without common suffixes
  const slugNoSuffix = slug
    .replace(/(ventures|capital|partners|group|fund|management|advisors|labs|holdings)$/, "")
    .replace(/(vc|co|inc|llc|ltd)$/, "");

  const candidates = new Set<string>();
  // Full name
  candidates.add(`${slug}.com`);
  candidates.add(`${slug}.vc`);
  candidates.add(`${slug}.co`);
  candidates.add(`${slug}.io`);
  // Without suffix
  if (slugNoSuffix && slugNoSuffix !== slug && slugNoSuffix.length >= 2) {
    candidates.add(`${slugNoSuffix}.com`);
    candidates.add(`${slugNoSuffix}.vc`);
    candidates.add(`${slugNoSuffix}.co`);
    candidates.add(`${slugNoSuffix}.io`);
  }

  // Try each candidate with a quick HEAD request
  for (const domain of candidates) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      try {
        const res = await fetch(`https://${domain}`, {
          method: "HEAD",
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
          signal: controller.signal,
          redirect: "follow",
        });
        if (res.ok || res.status === 301 || res.status === 302 || res.status === 403) {
          return domain;
        }
      } finally {
        clearTimeout(timeout);
      }
    } catch {
      // Domain doesn't resolve — skip
    }
  }

  return null;
}

/**
 * Detect the email pattern used by a company.
 * Tests a few employees' names against the domain using DDG.
 * Returns quickly if web search isn't working.
 */
export async function detectEmailPattern(
  employees: { name: string }[],
  domain: string
): Promise<string | null> {
  const PATTERNS = [
    { id: "first.last", gen: (f: string, l: string) => `${f}.${l}` },
    { id: "firstlast", gen: (f: string, l: string) => `${f}${l}` },
    { id: "flast", gen: (f: string, l: string) => `${f[0]}${l}` },
    { id: "first", gen: (f: string) => `${f}` },
    { id: "f.last", gen: (f: string, l: string) => `${f[0]}.${l}` },
    { id: "last.first", gen: (f: string, l: string) => `${l}.${f}` },
    { id: "first_last", gen: (f: string, l: string) => `${f}_${l}` },
  ];

  // Try to detect pattern with just 1 employee to save time
  const emp = employees[0];
  if (!emp) return null;

  const { first, last } = parseName(emp.name);
  if (!first || !last) return null;

  const f = first.toLowerCase();
  const l = last.toLowerCase();

  try {
    const query = `"${emp.name}" "@${domain}"`;
    const results = await webSearch(query);

    for (const result of results) {
      const text = `${result.title} ${result.snippet}`;
      const emails = (text.match(EMAIL_REGEX) || [])
        .map((e) => e.toLowerCase())
        .filter((e) => e.endsWith(`@${domain}`));

      for (const email of emails) {
        const local = email.split("@")[0];
        for (const pat of PATTERNS) {
          if (local === pat.gen(f, l)) {
            console.log(`[email] Pattern detected: ${pat.id} (from ${email})`);
            return pat.id;
          }
        }
      }
    }
  } catch {
    // Web search failed — use default pattern
  }

  return null;
}

/**
 * Find an email for a single person.
 * If domain is known, generates pattern-based email directly.
 * Skips DDG verification since web search may not work.
 */
export async function findEmailWithDomain(
  name: string,
  company: string,
  domain: string | null,
  pattern: string | null
): Promise<string> {
  const { first, last } = parseName(name);

  // If we have a domain, generate the email from the pattern — done.
  if (domain && first && last) {
    return applyPattern(first.toLowerCase(), last.toLowerCase(), domain, pattern || "first.last");
  }

  // No domain — try a direct search (1 DDG query)
  if (first && last) {
    try {
      const results = await webSearch(`"${name}" "${company}" email`);
      for (const result of results) {
        const text = `${result.title} ${result.snippet}`;
        const emails = extractValidEmails(text);
        if (emails.length > 0) {
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
 * Legacy API — still used by existing code.
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

function applyPattern(first: string, last: string, domain: string, pattern: string): string {
  switch (pattern) {
    case "first.last": return `${first}.${last}@${domain}`;
    case "firstlast": return `${first}${last}@${domain}`;
    case "flast": return `${first[0]}${last}@${domain}`;
    case "first": return `${first}@${domain}`;
    case "f.last": return `${first[0]}.${last}@${domain}`;
    case "last.first": return `${last}.${first}@${domain}`;
    case "first_last": return `${first}_${last}@${domain}`;
    case "firstl": return `${first}${last[0]}@${domain}`;
    default: return `${first}.${last}@${domain}`;
  }
}

function parseName(fullName: string): { first: string; last: string } {
  const cleaned = fullName
    .replace(/\s+(jr\.?|sr\.?|ii|iii|iv|phd|md|esq\.?)$/i, "")
    .replace(/\(.*?\)/g, "")
    .trim();

  const parts = cleaned.split(/\s+/);
  if (parts.length === 0) return { first: "", last: "" };
  if (parts.length === 1) return { first: parts[0], last: "" };

  return { first: parts[0], last: parts[parts.length - 1] };
}

function extractValidEmails(text: string): string[] {
  const matches = text.match(EMAIL_REGEX) || [];
  return matches.map((e) => e.toLowerCase()).filter((e) => !isBlockedEmail(e));
}

function isBlockedEmail(email: string): boolean {
  for (const pattern of BLOCKED_PATTERNS) {
    if (email.includes(pattern)) return true;
  }
  const tld = email.split(".").pop() || "";
  if (["png", "jpg", "gif", "css", "js", "svg", "ico", "pdf"].includes(tld)) return true;
  return false;
}

function extractCompanyDomain(url: string, company: string): string | null {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();

    for (const skip of SKIP_DOMAINS) {
      if (hostname.includes(skip)) return null;
    }

    const domain = hostname.replace(/^www\./, "");
    if (domain.split(".").length < 2 || domain.length > 50) return null;

    const companyWords = company.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter((w) => w.length > 2);
    const domainBase = domain.split(".")[0];
    if (companyWords.some((word) => domainBase.includes(word) || word.includes(domainBase))) {
      return domain;
    }
    return null;
  } catch {
    return null;
  }
}

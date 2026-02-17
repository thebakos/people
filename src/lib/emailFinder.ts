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
  "wixpress.com",
  "sentry-next.wixpress.com",
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

interface EmailCandidate {
  email: string;
  source: string;
  confidence: number; // 0-100
}

/**
 * Smart email finder — uses multiple strategies to find a person's email.
 * Searches the web, detects company domains, generates pattern-based guesses,
 * and ranks results by confidence.
 */
export async function findEmail(
  name: string,
  company: string
): Promise<string | null> {
  const candidates: EmailCandidate[] = [];
  const nameParts = parseName(name);

  // Run strategies in parallel for speed
  const [directResults, companyDomain] = await Promise.all([
    searchDirectEmail(name, company),
    findCompanyDomain(company),
  ]);

  candidates.push(...directResults);

  // If we found a company domain, generate pattern-based candidates
  if (companyDomain) {
    const patternCandidates = generateEmailPatterns(nameParts, companyDomain);
    candidates.push(...patternCandidates);

    // Also search for the domain + name to find if pattern is confirmed
    const domainResults = await searchDomainEmail(
      name,
      companyDomain,
      nameParts
    );
    candidates.push(...domainResults);
  }

  // Search for the person's email on their own profiles/sites
  const profileResults = await searchProfileEmail(name, company);
  candidates.push(...profileResults);

  if (candidates.length === 0) return null;

  // Deduplicate and merge confidence scores
  const merged = mergeCandidates(candidates, nameParts, companyDomain);

  // Return the highest-confidence result
  return merged.length > 0 ? merged[0].email : null;
}

/**
 * Strategy 1: Direct search — "FirstName LastName" "Company" email
 */
async function searchDirectEmail(
  name: string,
  company: string
): Promise<EmailCandidate[]> {
  const candidates: EmailCandidate[] = [];

  try {
    const results = await searchDuckDuckGo(
      `"${name}" "${company}" email address`
    );

    for (const result of results) {
      const text = `${result.title} ${result.snippet}`;
      const emails = extractEmails(text, name);
      for (const email of emails) {
        candidates.push({ email, source: "direct_search", confidence: 60 });
      }
    }
  } catch {
    // Search failed — continue with other strategies
  }

  return candidates;
}

/**
 * Strategy 2: Find the company's email domain.
 * Searches for the company website and extracts common email domains.
 */
async function findCompanyDomain(
  company: string
): Promise<string | null> {
  try {
    // Search for the company's official website
    const results = await searchDuckDuckGo(`"${company}" official website`);

    // Look for company domain from search results
    for (const result of results) {
      const domain = extractCompanyDomain(result.url, company);
      if (domain) return domain;
    }

    // Try another query pattern
    const results2 = await searchDuckDuckGo(`${company} company site`);
    for (const result of results2) {
      const domain = extractCompanyDomain(result.url, company);
      if (domain) return domain;
    }

    // Try to find email addresses on the company site to detect domain
    const results3 = await searchDuckDuckGo(`"${company}" "@" email contact`);
    for (const result of results3) {
      const text = `${result.title} ${result.snippet}`;
      const emails = text.match(EMAIL_REGEX) || [];
      for (const email of emails) {
        const domain = email.split("@")[1]?.toLowerCase();
        if (domain && !FREE_EMAIL_PROVIDERS.has(domain) && isValidDomain(domain)) {
          return domain;
        }
      }
    }
  } catch {
    // Domain detection failed
  }

  return null;
}

/**
 * Strategy 3: Generate pattern-based email candidates from name + domain.
 */
function generateEmailPatterns(
  nameParts: { first: string; last: string },
  domain: string
): EmailCandidate[] {
  const { first, last } = nameParts;
  if (!first || !last) return [];

  const f = first.toLowerCase();
  const l = last.toLowerCase();
  const fi = f[0]; // first initial

  // Most common patterns ordered by frequency
  const patterns = [
    { email: `${f}.${l}@${domain}`, confidence: 35 },       // john.doe
    { email: `${f}${l}@${domain}`, confidence: 30 },        // johndoe
    { email: `${fi}${l}@${domain}`, confidence: 30 },       // jdoe
    { email: `${f}@${domain}`, confidence: 20 },             // john
    { email: `${fi}.${l}@${domain}`, confidence: 25 },      // j.doe
    { email: `${l}.${f}@${domain}`, confidence: 15 },       // doe.john
    { email: `${f}_${l}@${domain}`, confidence: 15 },       // john_doe
    { email: `${f}-${l}@${domain}`, confidence: 10 },       // john-doe
    { email: `${l}${fi}@${domain}`, confidence: 10 },       // doej
  ];

  return patterns.map((p) => ({
    email: p.email,
    source: "pattern_generation",
    confidence: p.confidence,
  }));
}

/**
 * Strategy 4: Search for emails at the known company domain.
 */
async function searchDomainEmail(
  name: string,
  domain: string,
  nameParts: { first: string; last: string }
): Promise<EmailCandidate[]> {
  const candidates: EmailCandidate[] = [];

  try {
    // Search for the person's email at this domain
    const results = await searchDuckDuckGo(
      `"${name}" "@${domain}"`
    );

    for (const result of results) {
      const text = `${result.title} ${result.snippet}`;
      const emails = (text.match(EMAIL_REGEX) || [])
        .map((e) => e.toLowerCase())
        .filter((e) => e.endsWith(`@${domain}`));

      for (const email of emails) {
        if (isValidEmail(email, name)) {
          candidates.push({
            email,
            source: "domain_search",
            confidence: 85,
          });
        }
      }
    }

    // Also try searching for common patterns at this domain
    const { first, last } = nameParts;
    if (first && last) {
      const patternQuery = `"${first.toLowerCase()}.${last.toLowerCase()}@${domain}" OR "${first.toLowerCase()[0]}${last.toLowerCase()}@${domain}" OR "${first.toLowerCase()}${last.toLowerCase()}@${domain}"`;
      const results2 = await searchDuckDuckGo(patternQuery);

      for (const result of results2) {
        const text = `${result.title} ${result.snippet}`;
        const emails = (text.match(EMAIL_REGEX) || [])
          .map((e) => e.toLowerCase())
          .filter((e) => e.endsWith(`@${domain}`));

        for (const email of emails) {
          if (isValidEmail(email, name)) {
            candidates.push({
              email,
              source: "pattern_search",
              confidence: 80,
            });
          }
        }
      }
    }
  } catch {
    // Search failed
  }

  return candidates;
}

/**
 * Strategy 5: Search for the person's email on profile sites (GitHub, Twitter, personal sites).
 */
async function searchProfileEmail(
  name: string,
  company: string
): Promise<EmailCandidate[]> {
  const candidates: EmailCandidate[] = [];

  try {
    const results = await searchDuckDuckGo(
      `"${name}" email (site:github.com OR site:twitter.com OR site:crunchbase.com OR "contact")`
    );

    for (const result of results) {
      const text = `${result.title} ${result.snippet}`;
      const emails = extractEmails(text, name);
      for (const email of emails) {
        candidates.push({ email, source: "profile_search", confidence: 55 });
      }
    }
  } catch {
    // Search failed
  }

  return candidates;
}

/**
 * Parse a full name into first and last parts.
 */
function parseName(fullName: string): { first: string; last: string } {
  // Remove suffixes like "Jr.", "III", "PhD", etc.
  const cleaned = fullName
    .replace(/\s+(jr\.?|sr\.?|ii|iii|iv|phd|md|esq\.?)$/i, "")
    .trim();

  const parts = cleaned.split(/\s+/);
  if (parts.length === 0) return { first: "", last: "" };
  if (parts.length === 1) return { first: parts[0], last: "" };

  return {
    first: parts[0],
    last: parts[parts.length - 1], // Use last word as surname
  };
}

/**
 * Extract valid emails from text, filtering against blocked patterns.
 */
function extractEmails(text: string, name: string): string[] {
  const matches = text.match(EMAIL_REGEX) || [];
  return matches
    .map((e) => e.toLowerCase())
    .filter((e) => isValidEmail(e, name));
}

/**
 * Merge and deduplicate email candidates, boosting scores for matches.
 */
function mergeCandidates(
  candidates: EmailCandidate[],
  nameParts: { first: string; last: string },
  companyDomain: string | null
): EmailCandidate[] {
  const map = new Map<string, EmailCandidate>();

  for (const c of candidates) {
    const existing = map.get(c.email);
    if (existing) {
      // Merge: take the higher confidence and note multiple sources
      existing.confidence = Math.min(
        100,
        existing.confidence + c.confidence * 0.5
      );
      existing.source += `, ${c.source}`;
    } else {
      map.set(c.email, { ...c });
    }
  }

  // Apply confidence boosts/penalties
  const { first, last } = nameParts;
  const fLower = first.toLowerCase();
  const lLower = last.toLowerCase();

  for (const [, candidate] of map) {
    const emailLocal = candidate.email.split("@")[0];
    const emailDomain = candidate.email.split("@")[1];

    // Boost if email contains parts of the person's name
    if (fLower && emailLocal.includes(fLower)) {
      candidate.confidence = Math.min(100, candidate.confidence + 15);
    }
    if (lLower && emailLocal.includes(lLower)) {
      candidate.confidence = Math.min(100, candidate.confidence + 15);
    }

    // Boost if it's at the company domain
    if (companyDomain && emailDomain === companyDomain) {
      candidate.confidence = Math.min(100, candidate.confidence + 20);
    }

    // Penalize free email providers (they're less useful for outreach)
    if (FREE_EMAIL_PROVIDERS.has(emailDomain)) {
      candidate.confidence = Math.max(0, candidate.confidence - 15);
    }
  }

  // Sort by confidence descending
  return Array.from(map.values()).sort((a, b) => b.confidence - a.confidence);
}

/**
 * Extract a company domain from a URL, filtering out social media and generic sites.
 */
function extractCompanyDomain(
  url: string,
  company: string
): string | null {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();

    // Skip social media, news, and generic sites
    const skipDomains = [
      "linkedin.com",
      "facebook.com",
      "twitter.com",
      "x.com",
      "instagram.com",
      "youtube.com",
      "wikipedia.org",
      "crunchbase.com",
      "bloomberg.com",
      "reuters.com",
      "forbes.com",
      "techcrunch.com",
      "github.com",
      "medium.com",
      "pitchbook.com",
      "glassdoor.com",
      "indeed.com",
      "yelp.com",
      "bbb.org",
      "google.com",
      "apple.com",
      "amazon.com",
      "duckduckgo.com",
      "reddit.com",
    ];

    for (const skip of skipDomains) {
      if (hostname.includes(skip)) return null;
    }

    // Remove www. prefix
    const domain = hostname.replace(/^www\./, "");

    // Sanity check: domain should be reasonable
    if (domain.split(".").length < 2) return null;
    if (domain.length > 50) return null;

    // Basic heuristic: domain should relate to company name
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

    // If the URL is the first organic result for "company website", trust it
    // even if the name doesn't match exactly (e.g., "a16z" → "a16z.com")
    return null;
  } catch {
    return null;
  }
}

/**
 * Check if a domain looks valid (not a file extension, etc).
 */
function isValidDomain(domain: string): boolean {
  if (!domain || domain.length < 4) return false;
  const parts = domain.split(".");
  if (parts.length < 2) return false;
  const tld = parts[parts.length - 1];
  if (tld.length < 2 || tld.length > 10) return false;
  // Filter out obviously non-email domains
  const blocked = ["png", "jpg", "gif", "css", "js", "svg", "ico", "pdf"];
  if (blocked.includes(tld)) return false;
  return true;
}

/**
 * Check if an email looks valid and isn't a generic/spam address.
 */
function isValidEmail(email: string, name: string): boolean {
  for (const pattern of BLOCKED_PATTERNS) {
    if (email.includes(pattern)) return false;
  }

  if (email.startsWith("...") || email.includes("...")) return false;

  const tld = email.split(".").pop() || "";
  if (tld.length < 2 || tld.length > 10) return false;

  // Filter out emails that are clearly file names
  const badTlds = ["png", "jpg", "gif", "css", "js", "svg", "ico", "pdf"];
  if (badTlds.includes(tld)) return false;

  return true;
}

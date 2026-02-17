const PROXYCURL_BASE = "https://nubela.co/proxycurl/api";

function getHeaders(): HeadersInit {
  return {
    Authorization: `Bearer ${process.env.PROXYCURL_API_KEY}`,
  };
}

export interface ProxycurlEmployee {
  profile_url: string;
  profile: {
    public_identifier: string;
    first_name: string;
    last_name: string;
    full_name: string;
    headline: string;
    occupation: string;
  } | null;
}

export interface ProxycurlCompanyProfile {
  name: string;
  description: string;
  linkedin_internal_id: string;
  website: string;
}

export interface ProxycurlEmailResult {
  emails: string[];
  invalid_credits_spent: number;
}

/**
 * Get company profile from LinkedIn URL.
 */
export async function getCompanyProfile(
  companyUrl: string
): Promise<ProxycurlCompanyProfile | null> {
  const params = new URLSearchParams({
    url: companyUrl,
    use_cache: "if-present",
  });

  const response = await fetch(
    `${PROXYCURL_BASE}/linkedin/company?${params}`,
    { headers: getHeaders() }
  );

  if (!response.ok) {
    console.error(
      `Proxycurl company profile error: ${response.status} ${response.statusText}`
    );
    return null;
  }

  return response.json();
}

/**
 * Search for employees at a company filtered by investment-related roles.
 * Returns up to `limit` employees.
 */
export async function searchEmployees(
  companyUrl: string,
  roleKeywords: string = "partner managing director principal vice president investment venture associate",
  limit: number = 5
): Promise<ProxycurlEmployee[]> {
  const params = new URLSearchParams({
    url: companyUrl,
    role_search: roleKeywords,
    page_size: String(limit),
    enrich_profiles: "enrich",
  });

  const response = await fetch(
    `${PROXYCURL_BASE}/linkedin/company/employees/?${params}`,
    { headers: getHeaders() }
  );

  if (!response.ok) {
    console.error(
      `Proxycurl employee search error: ${response.status} ${response.statusText}`
    );
    return [];
  }

  const data = await response.json();
  return (data.employees || []).slice(0, limit);
}

/**
 * Look up a person's email using the Proxycurl Contact API.
 */
export async function findEmailByLinkedIn(
  linkedinUrl: string
): Promise<string | null> {
  const params = new URLSearchParams({
    linkedin_profile_url: linkedinUrl,
  });

  const response = await fetch(
    `${PROXYCURL_BASE}/contact-api/personal-email?${params}`,
    { headers: getHeaders() }
  );

  if (!response.ok) {
    return null;
  }

  const data = await response.json();
  // Return the first available email (personal or work)
  if (data.emails && data.emails.length > 0) {
    return data.emails[0];
  }
  return null;
}

/**
 * Get a person's profile to extract their name if not available from employee search.
 */
export async function getPersonProfile(
  linkedinUrl: string
): Promise<{ firstName: string; lastName: string; fullName: string } | null> {
  const params = new URLSearchParams({
    url: linkedinUrl,
    use_cache: "if-present",
  });

  const response = await fetch(`${PROXYCURL_BASE}/v2/linkedin?${params}`, {
    headers: getHeaders(),
  });

  if (!response.ok) {
    return null;
  }

  const data = await response.json();
  return {
    firstName: data.first_name || "",
    lastName: data.last_name || "",
    fullName: data.full_name || `${data.first_name || ""} ${data.last_name || ""}`.trim(),
  };
}

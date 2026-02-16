export interface Person {
  id: string;
  name: string;
  title?: string;
  company?: string;
  location?: string;
  linkedinUrl?: string;
  email?: string;
  summary?: string;
  source: "linkedin" | "web";
}

export interface SearchParams {
  query: string;
  source: "linkedin" | "web" | "both";
  keywords?: string;
  location?: string;
  company?: string;
  title?: string;
}

export interface EmailTemplate {
  subject: string;
  body: string;
}

export interface DraftEmail {
  personId: string;
  to: string;
  subject: string;
  body: string;
}

export interface GmailTokens {
  access_token: string;
  refresh_token: string;
  expiry_date: number;
}

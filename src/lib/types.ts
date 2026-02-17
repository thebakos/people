export interface Contact {
  id: string;
  name: string;
  company: string;
  email: string;
}

export interface EmailTemplate {
  subject: string;
  body: string;
}

export interface DraftEmail {
  contactId: string;
  to: string;
  subject: string;
  body: string;
}

export interface GmailTokens {
  access_token: string;
  refresh_token: string;
  expiry_date: number;
}

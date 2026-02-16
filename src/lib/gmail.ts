import { google } from "googleapis";
import { GmailTokens } from "./types";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
];

export function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.NEXTAUTH_URL || "http://localhost:3000"}/api/gmail/callback`
  );
}

export function getAuthUrl(): string {
  const oauth2Client = getOAuth2Client();
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  });
}

export async function getTokensFromCode(
  code: string
): Promise<GmailTokens> {
  const oauth2Client = getOAuth2Client();
  const { tokens } = await oauth2Client.getToken(code);
  return {
    access_token: tokens.access_token || "",
    refresh_token: tokens.refresh_token || "",
    expiry_date: tokens.expiry_date || 0,
  };
}

export async function createDraft(
  tokens: GmailTokens,
  to: string,
  subject: string,
  body: string
): Promise<{ id: string; message: { id: string } }> {
  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials(tokens);

  const gmail = google.gmail({ version: "v1", auth: oauth2Client });

  const rawMessage = createRawMessage(to, subject, body);

  const response = await gmail.users.drafts.create({
    userId: "me",
    requestBody: {
      message: {
        raw: rawMessage,
      },
    },
  });

  return response.data as { id: string; message: { id: string } };
}

function createRawMessage(
  to: string,
  subject: string,
  body: string
): string {
  const messageParts = [
    `To: ${to}`,
    `Subject: ${subject}`,
    "Content-Type: text/html; charset=utf-8",
    "MIME-Version: 1.0",
    "",
    body,
  ];
  const message = messageParts.join("\r\n");
  return Buffer.from(message)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function getUserEmail(tokens: GmailTokens): Promise<string> {
  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials(tokens);

  const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
  const { data } = await oauth2.userinfo.get();
  return data.email || "";
}

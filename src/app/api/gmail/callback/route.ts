import { NextRequest, NextResponse } from "next/server";
import { getTokensFromCode, getUserEmail } from "@/lib/gmail";

export async function GET(request: NextRequest) {
  try {
    const code = request.nextUrl.searchParams.get("code");

    if (!code) {
      return NextResponse.redirect(
        new URL("/?error=no_code", request.url)
      );
    }

    const tokens = await getTokensFromCode(code);
    const email = await getUserEmail(tokens);

    // Pass tokens back to the frontend via URL params (stored in sessionStorage)
    const params = new URLSearchParams({
      gmail_connected: "true",
      gmail_email: email,
      gmail_tokens: Buffer.from(JSON.stringify(tokens)).toString("base64"),
    });

    return NextResponse.redirect(
      new URL(`/?${params.toString()}`, request.url)
    );
  } catch (error) {
    console.error("Gmail callback error:", error);
    return NextResponse.redirect(
      new URL("/?error=auth_failed", request.url)
    );
  }
}

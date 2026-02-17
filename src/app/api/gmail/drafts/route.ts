import { NextRequest, NextResponse } from "next/server";
import { createDraft } from "@/lib/gmail";
import { GmailTokens, DraftEmail } from "@/lib/types";

export async function POST(request: NextRequest) {
  try {
    const { tokens, drafts }: { tokens: GmailTokens; drafts: DraftEmail[] } =
      await request.json();

    if (!tokens || !drafts || drafts.length === 0) {
      return NextResponse.json(
        { error: "tokens and drafts are required" },
        { status: 400 }
      );
    }

    const results = [];
    const errors = [];

    for (const draft of drafts) {
      try {
        const result = await createDraft(
          tokens,
          draft.to,
          draft.subject,
          draft.body
        );
        results.push({
          contactId: draft.contactId,
          draftId: result.id,
          to: draft.to,
          success: true,
        });
      } catch (error) {
        errors.push({
          contactId: draft.contactId,
          to: draft.to,
          error: error instanceof Error ? error.message : "Failed to create draft",
        });
      }
    }

    return NextResponse.json({ results, errors });
  } catch (error) {
    console.error("Gmail drafts error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create drafts" },
      { status: 500 }
    );
  }
}

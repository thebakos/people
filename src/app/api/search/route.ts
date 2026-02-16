import { NextRequest, NextResponse } from "next/server";
import { searchPeople } from "@/lib/search";
import { SearchParams } from "@/lib/types";

export async function POST(request: NextRequest) {
  try {
    const body: SearchParams = await request.json();

    if (!body.query) {
      return NextResponse.json(
        { error: "Search query is required" },
        { status: 400 }
      );
    }

    const results = await searchPeople(body);
    return NextResponse.json({ results });
  } catch (error) {
    console.error("Search error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Search failed" },
      { status: 500 }
    );
  }
}

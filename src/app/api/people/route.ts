import { NextRequest, NextResponse } from "next/server";
import {
  savePeopleList,
  loadPeopleList,
  listPeopleLists,
  deletePeopleList,
  updatePersonInList,
} from "@/lib/people-store";

export async function GET(request: NextRequest) {
  try {
    const listName = request.nextUrl.searchParams.get("list");

    if (listName) {
      const data = await loadPeopleList(listName);
      if (!data) {
        return NextResponse.json(
          { error: "List not found" },
          { status: 404 }
        );
      }
      return NextResponse.json(data);
    }

    const lists = await listPeopleLists();
    return NextResponse.json({ lists });
  } catch (error) {
    console.error("People GET error:", error);
    return NextResponse.json(
      { error: "Failed to load people data" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { listName, people } = await request.json();

    if (!listName || !people) {
      return NextResponse.json(
        { error: "listName and people are required" },
        { status: 400 }
      );
    }

    await savePeopleList(listName, people);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("People POST error:", error);
    return NextResponse.json(
      { error: "Failed to save people data" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { listName, personId, updates } = await request.json();

    if (!listName || !personId || !updates) {
      return NextResponse.json(
        { error: "listName, personId, and updates are required" },
        { status: 400 }
      );
    }

    await updatePersonInList(listName, personId, updates);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("People PATCH error:", error);
    return NextResponse.json(
      { error: "Failed to update person" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const listName = request.nextUrl.searchParams.get("list");
    if (!listName) {
      return NextResponse.json(
        { error: "list parameter is required" },
        { status: 400 }
      );
    }

    await deletePeopleList(listName);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("People DELETE error:", error);
    return NextResponse.json(
      { error: "Failed to delete list" },
      { status: 500 }
    );
  }
}

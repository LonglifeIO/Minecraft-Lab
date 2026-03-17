import { NextResponse, NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { searchAddons } from "@/lib/curseforge";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session.isLoggedIn) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q") || undefined;
    const classId = searchParams.get("classId");
    const categoryId = searchParams.get("categoryId");
    const gameVersion = searchParams.get("gameVersion") || undefined;
    const sortField = searchParams.get("sortField");
    const sortOrder = searchParams.get("sortOrder");
    const pageSize = searchParams.get("pageSize");
    const index = searchParams.get("index");

    const result = await searchAddons({
      query: q,
      classId: classId ? parseInt(classId, 10) : undefined,
      categoryId: categoryId ? parseInt(categoryId, 10) : undefined,
      gameVersion,
      sortField: sortField ? parseInt(sortField, 10) : undefined,
      sortOrder: sortOrder === "asc" || sortOrder === "desc" ? sortOrder : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
      index: index ? parseInt(index, 10) : undefined,
    });

    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "search failed" }, { status: 500 });
  }
}

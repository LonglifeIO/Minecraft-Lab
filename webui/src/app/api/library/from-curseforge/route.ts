import { NextResponse, NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { saveCurseforgeToLibrary } from "@/lib/library";
import { getDownloadUrl, isAllowedDownloadUrl } from "@/lib/curseforge";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session.isLoggedIn) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const isMod = session.role === "moderator" || session.role === "admin";
  if (!isMod) return NextResponse.json({ error: "moderator access required" }, { status: 403 });

  try {
    const body = await req.json();
    const { modId, fileId, fileUrl, name, description, author, thumbUrl } = body;
    if (!modId || !fileId || !name) {
      return NextResponse.json({ error: "missing modId, fileId, or name" }, { status: 400 });
    }

    const url = isAllowedDownloadUrl(fileUrl) ? fileUrl : await getDownloadUrl(modId, fileId);
    if (!url) return NextResponse.json({ error: "no download URL available" }, { status: 422 });

    const { status, body: result } = await saveCurseforgeToLibrary({
      modId, fileId, fileUrl: url, name, description, author, thumbUrl,
    });
    return NextResponse.json(result, { status });
  } catch {
    return NextResponse.json({ error: "save failed" }, { status: 500 });
  }
}

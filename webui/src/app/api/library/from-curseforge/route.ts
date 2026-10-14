import { NextResponse, NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { saveCurseforgeToLibrary } from "@/lib/library";
import { findCompanionFiles, getDownloadUrl, isAllowedDownloadUrl } from "@/lib/curseforge";

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

    // The other half of a two-file add-on: whatever the caller named, plus what the file list implies.
    const extraIds = new Set<number>((Array.isArray(body.extraFileIds) ? body.extraFileIds : []).map(Number).filter((n: number) => Number.isFinite(n) && n > 0));
    try {
      for (const f of await findCompanionFiles(Number(modId), Number(fileId))) extraIds.add(f.id);
    } catch { /* companion detection is best effort */ }
    const extraFileIds = [...extraIds].filter((id) => id !== Number(fileId));
    const extraFileUrls: string[] = [];
    for (const id of extraFileIds) {
      try {
        const u = await getDownloadUrl(Number(modId), id);
        if (isAllowedDownloadUrl(u)) extraFileUrls.push(u);
      } catch { /* skip a half we can't fetch; the host still gets the main file */ }
    }

    const { status, body: result } = await saveCurseforgeToLibrary({
      modId, fileId, fileUrl: url, extraFileIds, extraFileUrls, name, description, author, thumbUrl,
    });
    return NextResponse.json(result, { status });
  } catch {
    return NextResponse.json({ error: "save failed" }, { status: 500 });
  }
}

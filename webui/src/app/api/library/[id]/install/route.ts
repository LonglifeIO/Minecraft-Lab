import { NextResponse, NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { installLibraryEntry } from "@/lib/library";
import { setRestartPending } from "@/lib/restart-state";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session.isLoggedIn) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const isMod = session.role === "moderator" || session.role === "admin";
  if (!isMod) return NextResponse.json({ error: "moderator access required" }, { status: 403 });

  try {
    const { id } = await params;
    const { worldId } = await req.json();
    if (!worldId) return NextResponse.json({ error: "missing worldId" }, { status: 400 });

    const { status, body } = await installLibraryEntry(id, worldId);
    if (body?.success) setRestartPending(worldId);
    return NextResponse.json(body, { status });
  } catch {
    return NextResponse.json({ error: "install failed" }, { status: 500 });
  }
}

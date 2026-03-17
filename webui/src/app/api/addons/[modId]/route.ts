import { NextResponse, NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { getAddon, getAddonFiles } from "@/lib/curseforge";

export async function GET(req: NextRequest, { params }: { params: Promise<{ modId: string }> }) {
  const session = await getSession();
  if (!session.isLoggedIn) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const { modId } = await params;
    const id = parseInt(modId, 10);
    const [addon, filesData] = await Promise.all([
      getAddon(id),
      getAddonFiles(id),
    ]);

    return NextResponse.json({ addon, files: filesData.files });
  } catch {
    return NextResponse.json({ error: "addon lookup failed" }, { status: 500 });
  }
}

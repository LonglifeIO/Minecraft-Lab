import { NextResponse, NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { listWorlds } from "@/lib/host";
import * as bds from "@/lib/bds";
import { getDownloadUrl } from "@/lib/curseforge";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session.isLoggedIn) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const isAdmin = session.role === "admin";
  const isMod = session.role === "moderator" || isAdmin;
  if (!isMod) return NextResponse.json({ error: "moderator access required" }, { status: 403 });

  try {
    const body = await req.json();
    const { modId, fileId, fileUrl, worldId, addonName } = body;

    const worlds = await listWorlds();
    const world = worlds.find((w: any) => w.id === worldId);
    if (!world) return NextResponse.json({ error: "server not found" }, { status: 404 });
    const server = { id: world.id, name: world.name, host: world.ip, apiPort: world.apiPort };

    const properties = await bds.getProperties(server);
    const worldName = properties["level-name"] || "world";
    // Use URL from client (already has forgecdn.net fallback); only hit CF if not provided
    const url = fileUrl || await getDownloadUrl(modId, fileId);
    if (!url) return NextResponse.json({ error: "no download URL available for this file" }, { status: 422 });
    const result = await bds.installAddon(server, { url, worldName, modId, fileId, addonName });

    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "install failed" }, { status: 500 });
  }
}

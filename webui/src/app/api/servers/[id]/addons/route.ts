import { NextResponse, NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { listWorlds } from "@/lib/host";
import * as bds from "@/lib/bds";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session.isLoggedIn) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const { id } = await params;
    const worldId = id;
    const worlds = await listWorlds();
    const world = worlds.find((w: any) => w.id === worldId);
    if (!world) return NextResponse.json({ error: "server not found" }, { status: 404 });
    const server = { id: world.id, name: world.name, host: world.ip, apiPort: world.apiPort };

    const properties = await bds.getProperties(server);
    const worldName = properties["level-name"] || "world";
    const result = await bds.getWorldAddons(server, worldName);

    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "addons lookup failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session.isLoggedIn) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const isAdmin = session.role === "admin";
  const isMod = session.role === "moderator" || isAdmin;
  if (!isMod) return NextResponse.json({ error: "moderator access required" }, { status: 403 });

  try {
    const { id } = await params;
    const worldId = id;
    const body = await req.json();
    const { action, uuid, enabled } = body;

    if (action !== "toggle") {
      return NextResponse.json({ error: `unknown action: ${action}` }, { status: 400 });
    }

    const worlds = await listWorlds();
    const world = worlds.find((w: any) => w.id === worldId);
    if (!world) return NextResponse.json({ error: "server not found" }, { status: 404 });
    const server = { id: world.id, name: world.name, host: world.ip, apiPort: world.apiPort };

    const properties = await bds.getProperties(server);
    const worldName = properties["level-name"] || "world";
    const result = await bds.toggleAddon(server, { uuid, worldName, enabled });

    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "addon action failed" }, { status: 500 });
  }
}

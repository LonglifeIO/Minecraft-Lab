import { NextResponse, NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { listWorlds } from "@/lib/host";
import * as bds from "@/lib/bds";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session.isLoggedIn) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const isAdmin = session.role === "admin";
  if (!isAdmin) return NextResponse.json({ error: "admin access required" }, { status: 403 });

  try {
    const body = await req.json();
    const { uuid, worldId } = body;

    const worlds = await listWorlds();
    const world = worlds.find((w: any) => w.id === worldId);
    if (!world) return NextResponse.json({ error: "server not found" }, { status: 404 });
    const server = { id: world.id, name: world.name, host: world.ip, apiPort: world.apiPort };

    const properties = await (bds as any).getProperties(server);
    const worldName = properties["level-name"];
    const result = await (bds as any).removeAddon(server, { uuid, worldName });

    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "remove failed" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { listWorlds } from "@/lib/host";

export async function GET() {
  const session = await getSession();
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const worlds = await listWorlds();
  const results = worlds.map((w: any) => ({
    id: w.id,
    name: w.name,
    online: w.running && w.bdsStatus?.online,
    players: w.bdsStatus?.players || 0,
    maxPlayers: w.bdsStatus?.maxPlayers || 20,
    version: w.bdsStatus?.version || "unknown",
    difficulty: w.bdsStatus?.difficulty || "normal",
    gamemode: w.bdsStatus?.gamemode || "survival",
    running: w.running,
  }));

  return NextResponse.json(results);
}

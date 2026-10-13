import { NextResponse, NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { listWorlds, getWorldBackups, restoreBackup } from "@/lib/host";
import * as bds from "@/lib/bds";

// Daily archives live on the Proxmox host (scripts/daily-backup.sh); manual ones made with the
// "Back up now" button live inside the world container. Show both.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session.isLoggedIn) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const worlds = await listWorlds();
  const world = worlds.find((w: any) => w.id === id);
  if (!world) return NextResponse.json({ error: "server not found" }, { status: 404 });
  const server = { id: world.id, name: world.name, host: world.ip, apiPort: world.apiPort };

  const [hostRes, manualRes] = await Promise.allSettled([
    getWorldBackups(id),
    world.running ? bds.getBackups(server) : Promise.resolve([]),
  ]);
  const host = hostRes.status === "fulfilled" && hostRes.value && !hostRes.value.error
    ? hostRes.value
    : { daily: [], safety: [], lastRun: null, lastStatus: null, keep: null, schedule: null };
  const manual = manualRes.status === "fulfilled" && Array.isArray(manualRes.value) ? manualRes.value : [];
  return NextResponse.json({ ...host, manual });
}

// Restore one of those backups (host-api stops the game, saves a safety copy of the current world,
// swaps the world in, keeps the achievements setting, starts it, and rolls back if it won't start).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session.isLoggedIn) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "admin access required" }, { status: 403 });
  const { id } = await params;
  const { source, filename } = await req.json().catch(() => ({}));
  if (!["daily", "safety", "manual"].includes(source) || typeof filename !== "string" || !filename) {
    return NextResponse.json({ error: "missing backup" }, { status: 400 });
  }
  try {
    const result = await restoreBackup(id, source, filename);
    return NextResponse.json(result, { status: result?.success ? 200 : 400 });
  } catch {
    return NextResponse.json({ error: "couldn't reach the host" }, { status: 502 });
  }
}

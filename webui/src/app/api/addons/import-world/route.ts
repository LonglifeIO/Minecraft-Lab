import { NextResponse, NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { createWorld, listWorlds, setWorldImporting } from "@/lib/host";
import * as bds from "@/lib/bds";
import { getDownloadUrl } from "@/lib/curseforge";
import { setRestartPending } from "@/lib/restart-state";

export const maxDuration = 120; // seconds — map imports stop/start BDS and can be slow

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 60000;

async function waitForServer(server: { id: string; name: string; host: string; apiPort: number }): Promise<boolean> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const status = await bds.getStatus(server);
      if (status && !status.error) return true;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return false;
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session.isLoggedIn) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const isAdmin = session.role === "admin";
  const isMod = session.role === "moderator" || isAdmin;
  if (!isMod) return NextResponse.json({ error: "moderator access required" }, { status: 403 });

  try {
    const body = await req.json();
    const { modId, fileId, fileUrl, worldName } = body;

    if (!worldName?.trim()) return NextResponse.json({ error: "missing worldName" }, { status: 400 });

    const url = fileUrl || await getDownloadUrl(modId, fileId);
    if (!url) return NextResponse.json({ error: "no download URL available" }, { status: 422 });

    // Create the new world/container via host API
    const created = await createWorld(worldName.trim());
    if (!created?.world?.id) return NextResponse.json({ error: created?.error || "failed to create world" }, { status: 500 });

    // Fetch the new server's connection info
    const worlds = await listWorlds();
    const world = worlds.find((w: any) => w.id === created.world.id);
    if (!world) return NextResponse.json({ error: "new world not found after creation" }, { status: 500 });

    const server = { id: world.id, name: world.name, host: world.ip, apiPort: world.apiPort };

    // Wait for the BDS API to become available
    const ready = await waitForServer(server);
    if (!ready) return NextResponse.json({ error: "new server did not become ready in time" }, { status: 504 });

    // Mark world as importing so UI shows a banner and blocks joining
    await setWorldImporting(world.id, true);

    // Import the world data (stops BDS, extracts map, restarts BDS)
    const result = await bds.importWorld(server, { url, worldName: worldName.trim() });

    // Always clear the importing flag
    await setWorldImporting(world.id, false);

    if (!result?.success) return NextResponse.json({ error: result?.error || "import failed" }, { status: 500 });

    setRestartPending(world.id);
    return NextResponse.json({ success: true, worldId: world.id, worldName: worldName.trim() });
  } catch {
    return NextResponse.json({ error: "import failed" }, { status: 500 });
  }
}

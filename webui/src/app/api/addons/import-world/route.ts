import { NextResponse, NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { createWorld, deleteWorld, listWorlds, setWorldImporting } from "@/lib/host";
import * as bds from "@/lib/bds";
import { getDownloadUrl, isAllowedDownloadUrl } from "@/lib/curseforge";
import { setRestartPending } from "@/lib/restart-state";

export const maxDuration = 300; // seconds — a new container boots, then BDS stops, downloads, unpacks and starts

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
  // Creating a world is an admin action everywhere else (/api/worlds); keep this door the same
  if (session.role !== "admin") return NextResponse.json({ error: "admin access required" }, { status: 403 });

  try {
    const body = await req.json();
    const { modId, fileId, fileUrl, worldName } = body;

    if (!worldName?.trim()) return NextResponse.json({ error: "missing worldName" }, { status: 400 });

    const url = isAllowedDownloadUrl(fileUrl) ? fileUrl : await getDownloadUrl(modId, fileId);
    if (!url) return NextResponse.json({ error: "no download URL available" }, { status: 422 });

    // Create the new world/container via host API
    const created = await createWorld(worldName.trim());
    if (!created?.world?.id) return NextResponse.json({ error: created?.error || "failed to create world" }, { status: 500 });
    const newId: string = created.world.id;

    // From here on a failure would leave an empty, orphaned world behind (and every retry would add another)
    const fail = async (error: string, status: number) => {
      await deleteWorld(newId).catch(() => {});
      return NextResponse.json({ error }, { status });
    };

    // Fetch the new server's connection info
    const worlds = await listWorlds();
    const world = worlds.find((w: any) => w.id === newId);
    if (!world) return fail("new world not found after creation", 500);

    const server = { id: world.id, name: world.name, host: world.ip, apiPort: world.apiPort };

    // Wait for the BDS API to become available
    const ready = await waitForServer(server);
    if (!ready) return fail("the new world took too long to start", 504);

    // Mark world as importing so UI shows a banner and blocks joining
    await setWorldImporting(world.id, true);

    // Import the world data (stops BDS, extracts map, restarts BDS)
    let result: { success?: boolean; error?: string } | undefined;
    try {
      result = await bds.importWorld(server, { url, worldName: worldName.trim() });
    } catch {
      result = { error: "the import timed out or the world stopped answering" };
    } finally {
      // Always clear the importing flag, even when the import threw
      await setWorldImporting(world.id, false).catch(() => {});
    }

    if (!result?.success) return fail(result?.error || "import failed", 500);

    setRestartPending(world.id);
    return NextResponse.json({ success: true, worldId: world.id, worldName: worldName.trim() });
  } catch {
    return NextResponse.json({ error: "import failed" }, { status: 500 });
  }
}

import { NextResponse, NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { listWorlds, startWorldContainer, stopWorldContainer } from "@/lib/host";
import * as bds from "@/lib/bds";

function getServerFromWorlds(worlds: any[], id: string) {
  const w = worlds.find((w: any) => w.id === id);
  if (!w) return null;
  return { id: w.id, name: w.name, host: w.ip, apiPort: w.apiPort };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session.isLoggedIn) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const worlds = await listWorlds();
  const server = getServerFromWorlds(worlds, id);
  if (!server) return NextResponse.json({ error: "server not found" }, { status: 404 });

  const world = worlds.find((w: any) => w.id === id);
  const [status, allowlist] = await Promise.all([
    bds.getStatus(server),
    bds.getAllowlist(server),
  ]);
  // Always use registry name, not BDS response (avoids flicker during startup)
  status.worldName = world?.name || status.worldName;
  return NextResponse.json({ status, allowlist });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session.isLoggedIn) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const worlds = await listWorlds();
  const server = getServerFromWorlds(worlds, id);
  if (!server) return NextResponse.json({ error: "server not found" }, { status: 404 });

  const isAdmin = session.role === "admin";
  const isMod = session.role === "moderator" || isAdmin;
  const body = await req.json();
  const action = body.action;

  if (["backup", "delete"].includes(action) && !isAdmin) return NextResponse.json({ error: "admin access required" }, { status: 403 });
  if (!isMod && action !== "gamerules") return NextResponse.json({ error: "moderator access required" }, { status: 403 });

  try {
    switch (action) {
      case "start":
        return NextResponse.json(await startWorldContainer(id));

      case "stop":
        return NextResponse.json(await stopWorldContainer(id));

      case "restart":
        await stopWorldContainer(id);
        await new Promise((r) => setTimeout(r, 3000));
        return NextResponse.json(await startWorldContainer(id));

      case "command":
        return NextResponse.json(await bds.sendCommand(server, body.command));

      case "kick":
        return NextResponse.json(await bds.sendCommand(server, `kick ${body.name}`));

      case "difficulty":
        return NextResponse.json(await bds.sendCommand(server, `difficulty ${body.level}`));

      case "allowlist_add":
        return NextResponse.json(await bds.addToAllowlist(server, body.name));

      case "allowlist_remove":
        return NextResponse.json(await bds.removeFromAllowlist(server, body.name));

      case "backup":
        return NextResponse.json(await bds.triggerBackup(server));

      case "gamerules": {
        const rules: Record<string, boolean> = {};
        const ruleNames = [
          "keepInventory", "pvp", "showCoordinates", "naturalRegeneration",
          "doDaylightCycle", "doWeatherCycle", "doFireTick", "tntExplodes",
          "doMobSpawning", "mobGriefing", "doInsomnia",
          "doTileDrops", "doEntityDrops", "doImmediateRespawn",
          "commandBlocksEnabled", "showDeathMessages",
        ];
        for (const rule of ruleNames) {
          const result = await bds.sendCommand(server, `gamerule ${rule}`);
          const output = result.output || "";
          if (output.includes("true")) rules[rule] = true;
          else if (output.includes("false")) rules[rule] = false;
          else rules[rule] = true;
        }
        return NextResponse.json({ rules });
      }

      default:
        return NextResponse.json({ error: `unknown action: ${action}` }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Action failed" }, { status: 500 });
  }
}

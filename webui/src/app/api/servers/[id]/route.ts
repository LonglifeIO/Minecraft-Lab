import { NextResponse, NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { getServer } from "@/lib/config";
import * as bds from "@/lib/bds";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const server = getServer(id);
  if (!server) {
    return NextResponse.json({ error: "server not found" }, { status: 404 });
  }

  const [status, allowlist] = await Promise.all([
    bds.getStatus(server),
    bds.getAllowlist(server),
  ]);

  return NextResponse.json({ status, allowlist });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const server = getServer(id);
  if (!server) {
    return NextResponse.json({ error: "server not found" }, { status: 404 });
  }

  const body = await req.json();
  const action = body.action;

  // Role checks: moderators can do most things, admins can do everything
  const isAdmin = session.role === "admin";
  const isMod = session.role === "moderator" || isAdmin;
  const adminOnly = ["backup"];
  if (adminOnly.includes(action) && !isAdmin) {
    return NextResponse.json({ error: "admin access required" }, { status: 403 });
  }
  if (!isMod) {
    return NextResponse.json({ error: "moderator access required" }, { status: 403 });
  }

  try {
    switch (action) {
      case "start":
      case "stop":
      case "restart":
        return NextResponse.json(await bds.power(server, action));

      case "preset":
        return NextResponse.json(await bds.applyPreset(server, body.preset));

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
        ];
        for (const rule of ruleNames) {
          const result = await bds.sendCommand(server, `gamerule ${rule}`);
          const output = result.output || "";
          if (output.includes("true")) rules[rule] = true;
          else if (output.includes("false")) rules[rule] = false;
          else rules[rule] = true; // default
        }
        return NextResponse.json({ rules });
      }

      default:
        return NextResponse.json({ error: `unknown action: ${action}` }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ error: "Action failed" }, { status: 500 });
  }
}

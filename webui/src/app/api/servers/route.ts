import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getServers } from "@/lib/config";
import { getStatus } from "@/lib/bds";

export async function GET() {
  const session = await getSession();
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const servers = getServers();
  const results = await Promise.all(
    servers.map(async (server) => {
      const status = await getStatus(server);
      return { id: server.id, name: server.name, ...status };
    }),
  );

  return NextResponse.json(results);
}

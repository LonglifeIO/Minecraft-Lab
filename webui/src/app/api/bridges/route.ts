import { NextResponse, NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { getBridges, restartBridge } from "@/lib/host";

// Xbox bridges (MCXboxBroadcast in CT 105): health for everyone logged in, restart for admins/moderators.
export async function GET() {
  const session = await getSession();
  if (!session.isLoggedIn) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const bridges = await getBridges();
  if (!Array.isArray(bridges)) return NextResponse.json({ error: "couldn't reach the host" }, { status: 502 });
  return NextResponse.json(bridges);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session.isLoggedIn) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (session.role !== "admin" && session.role !== "moderator") return NextResponse.json({ error: "moderator access required" }, { status: 403 });
  const { account } = await req.json().catch(() => ({}));
  if (!["primary", "secondary", "all"].includes(account)) return NextResponse.json({ error: "unknown bridge" }, { status: 400 });
  try {
    return NextResponse.json(await restartBridge(account));
  } catch {
    return NextResponse.json({ error: "couldn't reach the host" }, { status: 502 });
  }
}

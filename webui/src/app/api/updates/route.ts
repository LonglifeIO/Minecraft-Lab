import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { checkUpdates, applyUpdates, getUpdateStatus } from "@/lib/host";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session.isLoggedIn) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  if (searchParams.get("status") === "1") {
    return NextResponse.json(await getUpdateStatus());
  }
  return NextResponse.json(await checkUpdates());
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session.isLoggedIn) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "admin access required" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  return NextResponse.json(await applyUpdates(body.force === true));
}

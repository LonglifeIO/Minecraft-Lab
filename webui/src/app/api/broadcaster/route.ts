import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getMcxStatus } from "@/lib/host";

export async function GET() {
  const session = await getSession();
  if (!session.isLoggedIn) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json((await getMcxStatus()) ?? {});
}

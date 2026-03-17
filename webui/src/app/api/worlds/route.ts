import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { createWorld, deleteWorld } from "@/lib/host";

export async function POST(req: Request) {
  const session = await getSession();
  if (!session.isLoggedIn || session.role !== "admin") {
    return NextResponse.json({ error: "admin access required" }, { status: 403 });
  }

  const body = await req.json();
  const action = body.action;

  if (action === "create") {
    const name = body.name?.trim();
    if (!name) return NextResponse.json({ error: "missing name" }, { status: 400 });
    const result = await createWorld(name);
    return NextResponse.json(result, { status: result.success ? 200 : 500 });
  }

  if (action === "delete") {
    const id = body.id?.trim();
    if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });
    const result = await deleteWorld(id);
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}

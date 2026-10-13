import { NextResponse, NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { listLibrary, uploadToLibrary } from "@/lib/library";

export async function GET() {
  const session = await getSession();
  if (!session.isLoggedIn) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await listLibrary());
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session.isLoggedIn) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const isMod = session.role === "moderator" || session.role === "admin";
  if (!isMod) return NextResponse.json({ error: "moderator access required" }, { status: 403 });

  try {
    const body = await req.json();
    const { name, contentBase64, description, author } = body;
    if (!name || !contentBase64) {
      return NextResponse.json({ error: "missing name or contentBase64" }, { status: 400 });
    }
    const { status, body: result } = await uploadToLibrary({ name, contentBase64, description, author });
    return NextResponse.json(result, { status });
  } catch {
    return NextResponse.json({ error: "upload failed" }, { status: 500 });
  }
}

import { NextResponse, NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { getLibraryEntry, deleteLibraryEntry } from "@/lib/library";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session.isLoggedIn) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  try {
    const { status, body } = await getLibraryEntry(id);
    // an upstream 401 means the host token is wrong, not that the user is logged out
    return NextResponse.json(body, { status: status === 401 ? 502 : status });
  } catch {
    return NextResponse.json({ error: "couldn't reach the host" }, { status: 502 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session.isLoggedIn) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // deleting from the shared library is destructive: admins only, like /api/addons/remove
  if (session.role !== "admin") return NextResponse.json({ error: "admin access required" }, { status: 403 });

  const { id } = await params;
  try {
    const { status, body } = await deleteLibraryEntry(id);
    return NextResponse.json(body, { status: status === 401 ? 502 : status });
  } catch {
    return NextResponse.json({ error: "couldn't reach the host" }, { status: 502 });
  }
}

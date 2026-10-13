import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { getSession } from "@/lib/session";

// Serves the nightly web maps rendered into data/maps/<worldId>/ (scripts/render-maps.sh on the host,
// /usr/local/bin/mcmap-render in this container). Login required, no paths outside the map folder.
const MAPS_DIR = path.join(process.cwd(), "data", "maps");
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8",
};

export async function GET(req: NextRequest, { params }: { params: Promise<{ world: string; path: string[] }> }) {
  const session = await getSession();
  if (!session.isLoggedIn) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { world, path: parts } = await params;
  if (!/^[a-z0-9_-]{1,40}$/i.test(world) || !Array.isArray(parts) || parts.length === 0) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const base = path.join(MAPS_DIR, world);
  const target = path.resolve(base, ...parts);
  if (!target.startsWith(base + path.sep)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const ext = path.extname(target).toLowerCase();
  const type = TYPES[ext];
  if (!type) return NextResponse.json({ error: "not found" }, { status: 404 });

  try {
    const body = await fs.readFile(target);
    // tiles change at most once a night; the html and the map's own metadata files always revalidate
    const fresh = ext === ".html" || ext === ".json" || path.basename(target).startsWith("unmined.map.");
    return new NextResponse(new Uint8Array(body), {
      headers: { "Content-Type": type, "Cache-Control": fresh ? "no-store" : "private, max-age=3600" },
    });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}

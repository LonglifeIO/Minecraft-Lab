"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import useSWR from "swr";
import { useDemoMode } from "@/lib/demoMode";

interface MapInfo { renderedAt: number; backup: string }

// Backups are named <world>_<YYYYMMDD>-<HHMM>.tar.gz (host local time); that moment is what the map shows.
function backupTime(name: string | undefined): Date | null {
  const m = /_(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})\.tar\.gz$/.exec(name || "");
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : null;
}
const fmt = (d: Date) => d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

const infoFetcher = async (url: string): Promise<MapInfo | null> => {
  const r = await fetch(url);
  if (!r.ok) return null;
  return r.json();
};
const worldFetcher = (url: string) => fetch(url).then((r) => (r.ok ? r.json() : null));

export default function WorldMapPage() {
  const params = useParams();
  const id = params.id as string;
  const { transform } = useDemoMode();
  const { data: info, isLoading } = useSWR<MapInfo | null>(`/api/maps/${id}/map-info.json`, infoFetcher);
  const { data: world } = useSWR(`/api/servers/${id}`, worldFetcher);
  const name = world?.status?.worldName ? transform(world.status.worldName, "worldName") : transform(id, "worldId");
  const src = `/api/maps/${id}/index.html`;

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto" style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <header className="mc-dark-panel px-4 py-3 mb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-4 min-w-0">
            <Link href={`/world/${id}`} className="mc-btn mc-btn-sm">&larr; World</Link>
            <div className="flex flex-col min-w-0">
              <h1 className="mc-title text-xl tracking-tight leading-tight break-words">Map · {name}</h1>
              <span className="mc-note mt-1">
                {info
                  ? <>Shows the world as of {fmt(backupTime(info.backup) ?? new Date(info.renderedAt * 1000))} (latest backup). Redrawn every morning at 4:15 from the 3:30 backup.</>
                  : "Drawn every morning from the latest backup."}
              </span>
            </div>
          </div>
          {info && <a href={src} target="_blank" rel="noopener" className="mc-btn mc-btn-sm">Open full screen</a>}
        </div>
      </header>
      {isLoading ? (
        <p className="mc-note text-center py-12">Loading…</p>
      ) : info ? (
        <iframe title={`Map of ${name}`} src={src} className="mc-dark-panel" style={{ flex: 1, width: "100%", minHeight: 400, border: "2px solid #2e2e2e", background: "#111" }} />
      ) : (
        <div className="mc-dark-panel p-8 text-center">
          <p className="mc-white mb-1">No map yet for this world.</p>
          <p className="mc-note">Maps are drawn every night after the 03:30 backup, so it will appear tomorrow morning.</p>
        </div>
      )}
    </div>
  );
}

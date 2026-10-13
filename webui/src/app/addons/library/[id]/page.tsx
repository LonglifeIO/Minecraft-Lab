"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import useSWR from "swr";
import { useToast } from "@/components/toast";
import { useDemoMode } from "@/lib/demoMode";
import type { LibraryEntry } from "@/lib/library";

const fetcher = (url: string) => fetch(url).then((r) => {
  if (r.status === 401) throw new Error("unauthorized");
  if (!r.ok) throw new Error("fetch failed");
  return r.json();
});

interface WorldInfo {
  id: string;
  name: string;
  online: boolean;
  running: boolean;
}

function formatBytes(n: number): string {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function typeBadgeClass(type: LibraryEntry["type"]): string {
  if (type === "downloaded") return "bg-amber-900/30 border-amber-500/30 text-amber-300";
  if (type === "custom") return "bg-cyan-900/30 border-cyan-500/30 text-cyan-300";
  return "bg-black/40 text-gray-300";
}

export default function LibraryEntryPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const { transform } = useDemoMode();
  const id = params.id as string;
  const [installing, setInstalling] = useState(false);
  const [showWorldPicker, setShowWorldPicker] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const { data: entry, error, isLoading, mutate } = useSWR<LibraryEntry>(
    `/api/library/${encodeURIComponent(id)}`,
    fetcher,
    { onError: (err) => { if (err.message === "unauthorized") router.push("/login"); } },
  );

  const { data: worlds } = useSWR<WorldInfo[]>("/api/servers", fetcher);

  async function handleInstall(worldId: string, worldName: string) {
    if (!entry) return;
    setInstalling(true);
    setShowWorldPicker(false);
    toast(`Installing ${entry.name} to ${transform(worldName, "worldName")}...`, "info");

    try {
      const res = await fetch(`/api/library/${encodeURIComponent(entry.id)}/install`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ worldId }),
      });
      const result = await res.json();
      if (result.success) {
        toast(
          entry.needsBetaApis
            ? `${entry.name} installed! It needs Beta APIs: turn that on in the world's page (it restarts the world).`
            : `${entry.name} installed! Restart the world to turn it on.`,
          "success",
        );
      } else {
        toast(result.error || "Install failed", "error");
      }
    } catch {
      toast("Couldn't connect. Check your internet and try again.", "error");
    } finally {
      setInstalling(false);
    }
  }

  async function handleDelete() {
    if (!entry) return;
    if (!confirm(`Delete "${entry.name}" from the library?\n\nWorlds that already have it installed keep their copy.`)) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/library/${encodeURIComponent(entry.id)}`, { method: "DELETE" });
      const result = await res.json();
      if (result.success) {
        toast("Removed from library", "success");
        router.push("/addons/library");
      } else {
        toast(result.error || "Delete failed", "error");
        setDeleting(false);
      }
    } catch {
      toast("Couldn't connect. Check your internet and try again.", "error");
      setDeleting(false);
    }
  }

  return (
    <div className="min-h-screen p-4 sm:p-6 max-w-5xl mx-auto pb-20">
      <div className="mc-dark-panel flex flex-wrap items-center justify-between gap-2 px-4 py-2 mb-4">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            className="mc-btn mc-btn-sm mc-btn-icon"
            aria-label="Back"
            onClick={() => {
              if (typeof window !== "undefined" && window.history.length > 1) {
                router.back();
              } else {
                router.push("/addons/library");
              }
            }}
          >
            &lt;
          </button>
          <span className="mc-title text-sm truncate">{entry?.name || "Add-on"}</span>
        </div>
      </div>

      {isLoading && (
        <div className="mc-dark-panel p-4 mb-4">
          <div className="flex gap-4">
            <div className="mc-item-slot w-16 h-16 border-4 mc-skeleton" />
            <div className="flex-1 space-y-2 py-1">
              <div className="h-4 w-1/2 mc-skeleton" />
              <div className="h-3 w-1/3 mc-skeleton" />
            </div>
          </div>
        </div>
      )}
      {error && !isLoading && <p className="mc-red text-sm py-8 text-center">Couldn&apos;t load this add-on. Try again.</p>}

      {entry && (
        <>
          <div className="mc-window p-6 mb-6">
            <div className="flex flex-col sm:flex-row gap-6">
              <div className="mc-item-slot w-24 h-24 sm:w-32 sm:h-32 border-4 shadow-lg bg-black/40 self-center sm:self-start">
                {entry.thumbUrl ? (
                  <img src={entry.thumbUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="mc-gold text-4xl">{entry.name.charAt(0)}</span>
                )}
              </div>
              <div className="flex-1 min-w-0 flex flex-col justify-center">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-2">
                  <h2 className="mc-white text-2xl font-bold tracking-tight break-words">{entry.name}</h2>
                </div>
                <p className="mc-dark-gray text-xs mb-4">
                  {entry.author && <>by <span className="mc-white font-bold">{entry.author}</span></>}
                  {entry.version && <> · v{entry.version}</>}
                </p>
                <div className="flex flex-wrap gap-2">
                  <span
                    className={`mc-category py-1 px-3 font-bold uppercase tracking-wider border ${typeBadgeClass(entry.type)}`}
                    style={{ fontSize: 11 }}
                  >
                    {entry.type}
                  </span>
                  <span className="mc-category py-1 px-3 bg-black/40 uppercase tracking-wider" style={{ fontSize: 11 }}>
                    {formatBytes(entry.sizeBytes)}
                  </span>
                  {entry.packs?.length > 0 && (
                    <span className="mc-category py-1 px-3 bg-black/40 uppercase tracking-wider" style={{ fontSize: 11 }}>
                      {entry.packs.length} pack{entry.packs.length === 1 ? "" : "s"}
                    </span>
                  )}
                  {entry.needsBetaApis && (
                    <span className="mc-category py-1 px-3 bg-black/40 uppercase tracking-wider text-amber-300" style={{ fontSize: 11 }} title="Turn on Beta APIs in the world's page for this add-on to work">
                      Needs Beta APIs
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center justify-center sm:justify-end">
                <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                  <button
                    type="button"
                    className="mc-btn mc-btn-red text-xs px-4 py-3 w-full sm:w-auto"
                    disabled={deleting || installing}
                    onClick={handleDelete}
                  >
                    {deleting ? "Removing…" : "Remove from library"}
                  </button>
                  <button
                    className={`mc-btn mc-btn-green text-sm px-10 py-3 w-full sm:w-auto font-bold tracking-widest ${!installing ? "mc-glint" : ""}`}
                    disabled={installing}
                    onClick={() => setShowWorldPicker(true)}
                  >
                    {installing ? "Installing…" : "Install to world"}
                  </button>
                </div>
              </div>
            </div>

            {entry.description && (
              <div className="mt-6 p-4 bg-black/40 border-l-4 border-amber-500/50 backdrop-blur-sm">
                <p className="mc-gray italic leading-relaxed font-sans" style={{ fontSize: 13 }}>
                  {entry.description}
                </p>
              </div>
            )}
          </div>

          {showWorldPicker && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.7)" }}>
              <div role="dialog" aria-modal="true" className="mc-window p-4 w-full max-w-xs" style={{ boxShadow: "6px 6px 0 rgba(0,0,0,0.5)" }}>
                <div className="mc-section text-center mb-3">Select World</div>
                <div className="mc-window-inner bg-[#444] mb-3 max-h-[200px] overflow-y-auto">
                  {worlds && worlds.length > 0 ? (
                    <div className="space-y-1">
                      {worlds.map((w) => (
                        <button
                          key={w.id}
                          className="mc-row w-full text-left p-2 flex items-center justify-between"
                          onClick={() => handleInstall(w.id, w.name)}
                          disabled={installing || !w.running}
                          title={!w.running ? "Start the world before installing" : undefined}
                        >
                          <span className="mc-white text-xs">{transform(w.name, "worldName")}</span>
                          <span className={`mc-status ${w.online ? "mc-status-online" : "mc-status-offline"}`} style={{ fontSize: 11 }}>
                            {w.online ? "Online" : w.running ? "Starting" : "Stopped"}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="mc-gray text-xs text-center py-4">No worlds found</p>
                  )}
                </div>
                <button className="mc-btn w-full text-xs" onClick={() => setShowWorldPicker(false)}>Cancel</button>
              </div>
            </div>
          )}

          <div className="mc-dark-panel p-4 mb-4">
            <div className="mc-section mb-3 border-b border-black/20 pb-1">Packs</div>
            {entry.packs?.length > 0 ? (
              <div className="divide-y divide-black/10">
                {entry.packs.map((pack) => (
                  <div key={pack.uuid} className="py-2 flex items-center justify-between">
                    <div className="min-w-0 flex-1 mr-3">
                      <div className="mc-white text-xs truncate font-bold">{pack.name || "Unnamed pack"}</div>
                      <div className="mc-dark-gray text-[11px] font-mono truncate">{pack.uuid}</div>
                    </div>
                    <span className="mc-category py-1 px-2 bg-black/40 uppercase tracking-wider" style={{ fontSize: 11 }}>
                      {pack.type === "data" || pack.type === "script" ? "Behavior pack" : pack.type === "resources" ? "Resource pack" : pack.type || "?"}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mc-gray text-xs">No details available</p>
            )}
          </div>

          {entry.source?.kind === "curseforge" && entry.source.modId && (
            <div className="mc-dark-panel p-3 mb-4">
              <div className="mc-section mb-2">Source</div>
              <Link href={`/addons/${entry.source.modId}`} className="mc-aqua hover:underline text-xs">
                Open in Browse Add-ons (#{entry.source.modId})
              </Link>
            </div>
          )}
        </>
      )}
    </div>
  );
}

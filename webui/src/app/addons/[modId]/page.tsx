"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import useSWR from "swr";
import { useToast } from "@/components/toast";

const fetcher = (url: string) => fetch(url).then((r) => { if (r.status === 401) throw new Error("unauthorized"); return r.json(); });

interface AddonDetail {
  id: number;
  name: string;
  summary: string;
  description: string;
  downloadCount: number;
  thumbUrl: string;
  screenshots: { id: number; title: string; url: string }[];
  authors: { name: string; url: string }[];
  categories: { id: number; name: string }[];
  dateModified: string;
  links: { websiteUrl: string };
}

interface AddonFile {
  id: number;
  displayName: string;
  fileName: string;
  fileDate: string;
  fileLength: number;
  downloadUrl: string | null;
  gameVersions: string[];
  dependencies: { modId: number; relationType: number }[];
}

interface WorldInfo {
  id: string;
  name: string;
  online: boolean;
  running: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export default function AddonDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const modId = params.modId as string;
  const [installing, setInstalling] = useState(false);
  const [showWorldPicker, setShowWorldPicker] = useState(false);
  const [selectedFileId, setSelectedFileId] = useState<number | null>(null);
  const [screenshotIdx, setScreenshotIdx] = useState(0);

  const { data, error, isLoading } = useSWR<{ addon: AddonDetail; files: AddonFile[] }>(
    `/api/addons/${modId}`,
    fetcher,
    { onError: (err) => { if (err.message === "unauthorized") router.push("/login"); } }
  );

  const { data: worlds } = useSWR<WorldInfo[]>("/api/servers", fetcher);

  const addon = data?.addon;
  const files = data?.files || [];

  async function handleInstall(worldId: string, worldName: string) {
    const fileId = selectedFileId || files[0]?.id;
    if (!fileId || !addon) return;

    setInstalling(true);
    setShowWorldPicker(false);
    toast(`Installing ${addon.name} to ${worldName}...`, "info");

    try {
      const res = await fetch("/api/addons/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modId: addon.id, fileId, worldId, addonName: addon.name }),
      });
      const result = await res.json();
      if (result.success) {
        toast(`${addon.name} installed! Restart the server to activate.`, "success");
      } else {
        toast(result.error || "Install failed", "error");
      }
    } catch {
      toast("Network error", "error");
    } finally {
      setInstalling(false);
    }
  }

  return (
    <div className="min-h-screen p-4 sm:p-6 max-w-5xl mx-auto pb-20">
      {/* Title bar */}
      <div className="mc-dark-panel flex items-center justify-between px-4 py-2 mb-4">
        <div className="flex items-center gap-3">
          <Link href="/addons"><button className="mc-btn text-xs px-2 py-0">&lt;</button></Link>
          <span className="mc-title text-sm">{addon?.name || "Add-on"}</span>
        </div>
      </div>

      {isLoading && (
        <div className="mc-dark-panel p-4 mb-4">
          <div className="flex gap-4">
            <div className="mc-item-slot w-16 h-16 border-4 mc-skeleton" />
            <div className="flex-1 space-y-2 py-1">
              <div className="h-4 w-1/2 mc-skeleton" />
              <div className="h-3 w-1/3 mc-skeleton" />
              <div className="h-3 w-2/3 mc-skeleton" />
            </div>
          </div>
        </div>
      )}
      {error && !isLoading && <p className="mc-red text-xs py-8 text-center">Failed to load add-on</p>}

      {addon && (
        <>
          {/* Header */}
          <div className="mc-window p-6 mb-6">
            <div className="flex flex-col sm:flex-row gap-6">
              <div className="mc-item-slot w-24 h-24 sm:w-32 sm:h-32 border-4 shadow-lg bg-black/40 self-center sm:self-start">
                {addon.thumbUrl ? (
                  <img src={addon.thumbUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="mc-gold text-4xl">{addon.name.charAt(0)}</span>
                )}
              </div>
              <div className="flex-1 min-w-0 flex flex-col justify-center">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-2">
                  <h2 className="mc-white text-2xl font-bold tracking-tight">{addon.name}</h2>
                </div>
                <p className="mc-dark-gray text-xs mb-4">
                  by <span className="mc-white font-bold">{addon.authors.map((a) => a.name).join(", ")}</span>
                </p>
                <div className="flex flex-wrap gap-2">
                  <span className="mc-category py-1 px-3 bg-blue-900/30 border-blue-500/30 text-blue-300 font-bold uppercase tracking-wider" style={{ fontSize: 9 }}>
                    {formatCount(addon.downloadCount)} DOWNLOADS
                  </span>
                  {addon.categories.map((c) => (
                    <span key={c.id} className="mc-category py-1 px-3 bg-black/40 uppercase tracking-wider" style={{ fontSize: 9 }}>{c.name}</span>
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-center sm:justify-end">
                <button
                  className={`mc-btn mc-btn-green text-sm px-10 py-3 w-full sm:w-auto font-bold tracking-widest ${!installing ? "mc-glint" : ""}`}
                  disabled={installing || files.length === 0}
                  onClick={() => setShowWorldPicker(true)}
                >
                  {installing ? "INSTALLING..." : "INSTALL TO WORLD"}
                </button>
              </div>
            </div>

            <div className="mt-6 p-4 bg-black/40 border-l-4 border-amber-500/50 backdrop-blur-sm">
              <p className="mc-gray italic leading-relaxed font-sans" style={{ fontSize: 13 }}>
                {addon.summary}
              </p>
            </div>
          </div>

          {/* World picker modal */}
          {showWorldPicker && (
            <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.7)" }}>
              <div className="mc-window p-4 w-80" style={{ boxShadow: "6px 6px 0 rgba(0,0,0,0.5)" }}>
                <div className="mc-section text-center mb-3">Select World</div>
                <div className="mc-window-inner bg-[#444] mb-3 max-h-[200px] overflow-y-auto">
                  {worlds && worlds.length > 0 ? (
                    <div className="space-y-1">
                      {worlds.map((w) => (
                        <button
                          key={w.id}
                          className="mc-row w-full text-left p-2 flex items-center justify-between"
                          onClick={() => handleInstall(w.id, w.name)}
                          disabled={installing}
                        >
                          <span className="mc-white text-xs">{w.name}</span>
                          <span className={`mc-status ${w.online ? "mc-status-online" : "mc-status-offline"}`} style={{ fontSize: 8 }}>
                            {w.online ? "Online" : "Offline"}
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

          {/* Screenshots */}
          {addon.screenshots.length > 0 && (
            <div className="mc-dark-panel p-3 mb-4">
              <div className="mc-section mb-2">Screenshots</div>
              <div className="mc-window-inner p-1 relative">
                <img
                  src={addon.screenshots[screenshotIdx].url}
                  alt={addon.screenshots[screenshotIdx].title}
                  className="w-full"
                  style={{ border: "2px solid #5a5b5c", maxHeight: 400, objectFit: "contain", background: "#111" }}
                />
                {addon.screenshots.length > 1 && (
                  <div className="flex justify-center gap-1.5 mt-2 overflow-x-auto pb-1">
                    {addon.screenshots.map((s, i) => (
                      <button
                        key={i}
                        className={`w-10 h-10 flex-shrink-0 border-2 ${i === screenshotIdx ? "border-[var(--mc-aqua)]" : "border-black/50"}`}
                        onClick={() => setScreenshotIdx(i)}
                      >
                        <img src={s.url} alt="" className="w-full h-full object-cover opacity-60 hover:opacity-100" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Description */}
          <div className="mc-dark-panel p-4 mb-4">
            <div className="mc-section mb-3 border-b border-black/20 pb-1">Description</div>
            <div
              className="mc-description"
              dangerouslySetInnerHTML={{ __html: addon.description }}
            />
          </div>

          {/* Files */}
          <div className="mc-dark-panel mb-4 overflow-hidden">
            <div className="p-3 pb-1 border-b border-black/20"><div className="mc-section">Recent Versions</div></div>
            <div className="divide-y divide-black/10">
              {files.length === 0 && <p className="mc-gray text-xs p-3">No files available</p>}
              {files.slice(0, 10).map((file) => (
                <div key={file.id} className="mc-row flex items-center justify-between px-3 py-2.5">
                  <div className="flex-1 min-w-0 mr-3">
                    <div className="mc-white text-xs truncate font-bold">{file.displayName}</div>
                    <div className="mc-dark-gray flex gap-3 mt-0.5" style={{ fontSize: 9 }}>
                      <span>{formatBytes(file.fileLength)}</span>
                      <span>{file.gameVersions.slice(0, 3).join(", ")}</span>
                      <span style={{ fontSize: 8, opacity: 0.5 }}>{new Date(file.fileDate).toLocaleDateString()}</span>
                    </div>
                  </div>
                  <button
                    className={`mc-btn text-xs px-2 py-0 h-6 ${selectedFileId === file.id ? "mc-btn-active" : ""}`}
                    onClick={() => { setSelectedFileId(file.id); setShowWorldPicker(true); }}
                    disabled={installing}
                  >
                    Install
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Dependencies */}
          {files[0]?.dependencies && files[0].dependencies.length > 0 && (
            <div className="mc-dark-panel p-3 mb-4">
              <div className="mc-section mb-2">Dependencies</div>
              {files[0].dependencies.map((dep, i) => (
                <div key={i} className="flex items-center gap-2 text-xs mb-1">
                  <span className={dep.relationType === 3 ? "mc-red" : dep.relationType === 2 ? "mc-gold" : "mc-gray"}>
                    {dep.relationType === 3 ? "Required" : dep.relationType === 2 ? "Optional" : dep.relationType === 5 ? "Incompatible" : "Other"}
                  </span>
                  <Link href={`/addons/${dep.modId}`} className="mc-aqua hover:underline">
                    Mod #{dep.modId}
                  </Link>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

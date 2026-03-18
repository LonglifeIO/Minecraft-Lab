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

      {isLoading && <p className="mc-gray text-xs py-8 text-center">Loading...</p>}
      {error && !isLoading && <p className="mc-red text-xs py-8 text-center">Failed to load add-on</p>}

      {addon && (
        <>
          {/* Header info */}
          <div className="mc-dark-panel p-4 mb-4">
            <div className="flex gap-4">
              {addon.thumbUrl ? (
                <img
                  src={addon.thumbUrl}
                  alt=""
                  className="w-16 h-16 flex-shrink-0"
                  style={{ imageRendering: "pixelated", border: "2px solid #5a5b5c" }}
                />
              ) : (
                <div
                  className="w-16 h-16 flex-shrink-0 flex items-center justify-center"
                  style={{ background: "#3a3a3a", border: "2px solid #5a5b5c" }}
                >
                  <span className="mc-gold text-2xl">{addon.name.charAt(0)}</span>
                </div>
              )}
              <div className="flex-1">
                <h2 className="mc-white text-sm mb-1">{addon.name}</h2>
                <p className="mc-gray" style={{ fontSize: 10 }}>
                  by {addon.authors.map((a) => a.name).join(", ")}
                </p>
                <div className="flex gap-4 mt-2 text-xs">
                  <span className="mc-aqua">{formatCount(addon.downloadCount)} downloads</span>
                  {addon.categories.map((c) => (
                    <span key={c.id} className="mc-gold">{c.name}</span>
                  ))}
                </div>
              </div>
            </div>

            <p className="mc-gray mt-3" style={{ fontSize: 11, lineHeight: 1.5 }}>{addon.summary}</p>

            {/* Install button */}
            <div className="mt-3">
              <button
                className="mc-btn mc-btn-green text-xs px-6"
                disabled={installing || files.length === 0}
                onClick={() => setShowWorldPicker(true)}
              >
                {installing ? "Installing..." : "Install to World"}
              </button>
            </div>
          </div>

          {/* World picker modal */}
          {showWorldPicker && (
            <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.6)" }}>
              <div className="mc-dark-panel p-4 w-80" style={{ boxShadow: "6px 6px 0 rgba(0,0,0,0.5)" }}>
                <div className="mc-section text-center mb-3">Select World</div>
                {worlds && worlds.length > 0 ? (
                  <div className="space-y-2 mb-3">
                    {worlds.map((w) => (
                      <button
                        key={w.id}
                        className="mc-btn w-full text-xs"
                        onClick={() => handleInstall(w.id, w.name)}
                        disabled={installing}
                      >
                        <span className={w.online ? "mc-green" : "mc-red"}>&#x25CF;</span>
                        {" "}{w.name}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="mc-gray text-xs text-center mb-3">No worlds found</p>
                )}
                <button className="mc-btn w-full text-xs" onClick={() => setShowWorldPicker(false)}>Cancel</button>
              </div>
            </div>
          )}

          {/* Screenshots */}
          {addon.screenshots.length > 0 && (
            <div className="mc-dark-panel p-3 mb-4">
              <div className="mc-section mb-2">Screenshots</div>
              <div className="relative">
                <img
                  src={addon.screenshots[screenshotIdx].url}
                  alt={addon.screenshots[screenshotIdx].title}
                  className="w-full"
                  style={{ border: "2px solid #5a5b5c", maxHeight: 300, objectFit: "contain", background: "#000" }}
                />
                {addon.screenshots.length > 1 && (
                  <div className="flex justify-center gap-2 mt-2">
                    {addon.screenshots.map((_, i) => (
                      <button
                        key={i}
                        className={`w-3 h-3 ${i === screenshotIdx ? "mc-btn-active" : ""}`}
                        style={{
                          background: i === screenshotIdx ? "var(--mc-aqua)" : "#555",
                          border: "1px solid #333",
                          cursor: "pointer",
                        }}
                        onClick={() => setScreenshotIdx(i)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Description */}
          <div className="mc-dark-panel p-3 mb-4">
            <div className="mc-section mb-2">Description</div>
            <div
              className="mc-gray prose-invert"
              style={{ fontSize: 11, lineHeight: 1.6, wordBreak: "break-word" }}
              dangerouslySetInnerHTML={{ __html: addon.description }}
            />
          </div>

          {/* Files */}
          <div className="mc-dark-panel mb-4">
            <div className="p-3 pb-1"><div className="mc-section">Files</div></div>
            {files.length === 0 && <p className="mc-gray text-xs px-3 pb-3">No files available</p>}
            {files.slice(0, 10).map((file) => (
              <div key={file.id} className="mc-row flex items-center justify-between px-3 py-2">
                <div className="flex-1 min-w-0 mr-3">
                  <div className="mc-white text-xs truncate">{file.displayName}</div>
                  <div className="mc-dark-gray flex gap-3" style={{ fontSize: 10 }}>
                    <span>{formatBytes(file.fileLength)}</span>
                    <span>{file.gameVersions.slice(0, 3).join(", ")}</span>
                  </div>
                </div>
                <button
                  className={`mc-btn text-xs px-2 py-0 ${selectedFileId === file.id ? "mc-btn-active" : ""}`}
                  onClick={() => { setSelectedFileId(file.id); setShowWorldPicker(true); }}
                  disabled={installing}
                >
                  Install
                </button>
              </div>
            ))}
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

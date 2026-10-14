"use client";

import { useState, useMemo, useRef } from "react";
import Link from "next/link";
import useSWR from "swr";
import { useRouter } from "next/navigation";
import { sourceLabel, type LibraryEntry } from "@/lib/library";
import suggested from "@/data/suggested-addons.json";

const fetcher = (url: string) => fetch(url).then((r) => {
  if (r.status === 401) throw new Error("unauthorized");
  if (!r.ok) throw new Error("fetch failed");
  return r.json();
});

const TYPE_FILTERS: { label: string; value: "" | LibraryEntry["type"] }[] = [
  { label: "All", value: "" },
  { label: "CurseForge", value: "downloaded" },
  { label: "Made here", value: "custom" },
  { label: "Uploaded", value: "imported" },
];

function formatBytes(n: number): string {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function timeAgo(dateStr: string): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days < 1) return "today";
  if (days === 1) return "1d ago";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

function typeBadgeClass(type: LibraryEntry["type"]): string {
  if (type === "downloaded") return "bg-amber-900/30 border-amber-500/30 text-amber-300";
  if (type === "custom") return "bg-cyan-900/30 border-cyan-500/30 text-cyan-300";
  return "bg-black/40 text-gray-300";
}

const MAX_UPLOAD = 150 * 1024 * 1024;

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// Add a .mcaddon/.mcpack downloaded from MCPEDL, Planet Minecraft, etc. The host checks it holds real
// Bedrock packs before it lands in the library; installing into a world is the usual library flow.
function UploadAddon({ onDone }: { onDone: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function uploadOne(file: File): Promise<string | null> {
    if (!/\.(mcaddon|mcpack|zip)$/i.test(file.name)) return `${file.name}: pick a .mcaddon, .mcpack or .zip file.`;
    if (file.size > MAX_UPLOAD) return `${file.name}: over 150 MB.`;
    const name = file.name.replace(/\.(mcaddon|mcpack|zip)$/i, "").replace(/[_]+/g, " ").trim() || "Uploaded add-on";
    try {
      const res = await fetch("/api/library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, contentBase64: await readAsBase64(file) }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) return null;
      const err = String(body.error ?? "upload failed");
      return `${file.name}: ${/no packs|invalid/i.test(err) ? "not a Bedrock add-on (no packs found inside)." : err}`;
    } catch {
      return `${file.name}: upload failed. Try again.`;
    }
  }

  // Several files can be picked at once (e.g. a folder of MCPEDL downloads); they go up one after another.
  async function upload(files: File[]) {
    setMsg(null);
    setBusy(true);
    const errors: string[] = [];
    let added = 0;
    for (const file of files) {
      const err = await uploadOne(file);
      if (err) errors.push(err); else added += 1;
    }
    setBusy(false);
    if (input.current) input.current.value = "";
    if (added) onDone();
    const summary = added ? `Added ${added} add-on${added === 1 ? "" : "s"} to your library.` : "";
    setMsg(errors.length ? { ok: false, text: [summary, ...errors].filter(Boolean).join(" ") } : { ok: true, text: summary });
  }

  return (
    <div className="mc-dark-panel p-3 mb-4">
      <div className="flex flex-wrap items-center gap-3">
        <button className="mc-btn mc-btn-amber mc-btn-sm" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? "Uploading..." : "Upload add-ons"}
        </button>
        <span className="mc-note">.mcaddon or .mcpack files from MCPEDL, Planet Minecraft or anywhere else; pick several at once</span>
        <input
          ref={input}
          type="file"
          accept=".mcaddon,.mcpack,.zip"
          multiple
          className="hidden"
          onChange={(e) => { const files = Array.from(e.target.files ?? []); if (files.length) upload(files); }}
        />
      </div>
      {msg && <p className={`text-xs mt-2 ${msg.ok ? "mc-green" : "mc-red"}`} role="status">{msg.text}</p>}
    </div>
  );
}

type Suggestion = (typeof suggested.items)[number];

// Hand-picked from the most-downloaded CurseForge add-ons; each one loaded with no errors on our server
// version. "May clash" means both replace the same vanilla mob/player/biome file, so only one wins.
function SuggestedAddons({ have, onAdded }: { have: Set<number>; onAdded: () => void }) {
  const [open, setOpen] = useState(true);
  const [adding, setAdding] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const groups = useMemo(() => {
    const m = new Map<string, Suggestion[]>();
    for (const it of suggested.items) m.set(it.group, [...(m.get(it.group) ?? []), it]);
    return [...m.entries()];
  }, []);

  async function add(it: Suggestion) {
    setAdding(it.modId); setErr(null);
    try {
      const res = await fetch("/api/library/from-curseforge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modId: it.modId, fileId: it.fileId, fileUrl: it.fileUrl, name: it.name, description: it.summary, author: it.author, thumbUrl: it.thumbUrl }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) onAdded(); else setErr(`${it.name}: ${body.error ?? "couldn't add it"}`);
    } catch {
      setErr("Couldn't reach the dashboard. Try again.");
    } finally {
      setAdding(null);
    }
  }

  return (
    <div className="mc-dark-panel p-3 mt-6">
      <button className="mc-textbtn w-full text-left flex items-center justify-between" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="mc-section" style={{ marginBottom: 0 }}>Suggested add-ons</span>
        <span className="mc-note">{open ? "Hide" : `Show ${suggested.items.length}`}</span>
      </button>
      {open && (
        <>
          <p className="mc-note mt-1 mb-3">
            Popular CurseForge add-ons that each loaded with no errors on our server ({suggested.testedOn}, tested {suggested.testedAt}).
            Add one to the library, then install it to a world from there. Try new ones on Playground first.
          </p>
          {err && <p className="mc-red text-xs mb-2" role="status">{err}</p>}
          {groups.map(([group, items]) => (
            <div key={group} className="mb-4">
              <div className="mc-gold text-xs font-bold mb-2">{group}</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {items.map((it) => {
                  const inLib = have.has(it.modId);
                  return (
                    <div key={it.modId} className="flex gap-3 items-start p-2 bg-black/30 border border-white/5">
                      <img src={it.thumbUrl} alt="" className="w-12 h-12 object-cover flex-shrink-0" loading="lazy" />
                      <div className="flex-1 min-w-0">
                        <Link href={`/addons/${it.modId}`} className="mc-white text-sm font-bold hover:underline block truncate">{it.name}</Link>
                        <p className="mc-gray text-[11px] leading-snug">{it.why}</p>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {it.needsBetaApis && <span className="mc-category px-2 py-0.5 border bg-black/60 border-amber-500/40 text-amber-300" style={{ fontSize: 11 }}>Needs Beta APIs</span>}
                          {it.changesPlayer && <span className="mc-category px-2 py-0.5 border bg-black/60 border-white/20 text-gray-300" style={{ fontSize: 11 }} title="Replaces the player's behaviour or look, so only one add-on like this works at a time">Changes the player</span>}
                        </div>
                        {it.conflictsWith.length > 0 && (
                          <p className="mc-note text-[11px] mt-1">May clash with: {it.conflictsWith.join(", ")}</p>
                        )}
                      </div>
                      <button
                        className="mc-btn mc-btn-sm flex-shrink-0"
                        disabled={inLib || adding !== null}
                        onClick={() => add(it)}
                      >
                        {inLib ? "In library" : adding === it.modId ? "Adding..." : "Add"}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

export default function LibraryPage() {
  const router = useRouter();
  const [filter, setFilter] = useState<"" | LibraryEntry["type"]>("");
  const [search, setSearch] = useState("");

  const { data, error, isLoading, mutate } = useSWR<LibraryEntry[]>("/api/library", fetcher, {
    onError: (err) => { if (err.message === "unauthorized") router.push("/login"); },
  });

  const filtered = useMemo(() => {
    const entries = data || [];
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (filter && e.type !== filter) return false;
      if (q && !e.name.toLowerCase().includes(q) && !(e.author || "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [data, filter, search]);

  return (
    <div className="min-h-screen p-4 sm:p-6 max-w-5xl mx-auto pb-20">
      <div className="mc-dark-panel flex flex-wrap items-center justify-between gap-2 px-4 py-2 mb-4">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/" className="mc-btn mc-btn-sm mc-btn-icon" aria-label="Back to worlds">&lt;</Link>
          <span className="mc-title text-sm">My Add-on Library</span>
        </div>
        <span className="mc-gray text-xs">{data?.length ?? 0} add-ons</span>
      </div>

      <UploadAddon onDone={() => mutate()} />

      <div className="mc-dark-panel p-3 mb-4">
        <input
          className="mc-input w-full mb-3"
          aria-label="Search library"
          placeholder="Search library..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="flex gap-2 items-center flex-wrap">
          <span className="mc-gray text-xs">Type:</span>
          {TYPE_FILTERS.map((opt) => (
            <button
              key={opt.label}
              className={`mc-btn mc-btn-sm ${filter === opt.value ? "mc-btn-active" : ""}`}
              aria-pressed={filter === opt.value}
              onClick={() => setFilter(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="mc-inventory-grid mb-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="mc-addon-card opacity-50">
              <div className="mc-addon-banner mc-skeleton" />
              <div className="mc-addon-card-body space-y-3">
                <div className="h-4 w-3/4 mc-skeleton" />
                <div className="h-3 w-1/4 mc-skeleton" />
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="mc-dark-panel p-8 text-center">
          <p className="mc-red text-sm">Couldn&apos;t load your library. Try again.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="mc-dark-panel p-8 text-center">
          {(data?.length ?? 0) === 0 ? (
            <>
              <p className="mc-gray text-xs mb-3">Your library is empty.</p>
              <Link href="/addons" className="mc-btn mc-btn-amber mc-btn-sm">Find add-ons</Link>
            </>
          ) : (
            <p className="mc-gray text-xs">Nothing matches.</p>
          )}
        </div>
      ) : (
        <div className="mc-inventory-grid mb-4">
          {filtered.map((entry) => (
            <Link key={entry.id} href={`/addons/library/${entry.id}`} className="h-full">
              <div className="mc-addon-card">
                <div className="mc-addon-banner relative">
                  <span
                    className={`mc-category absolute left-2 top-2 z-10 px-2 py-0.5 uppercase tracking-wider font-bold border ${typeBadgeClass(entry.type)}`}
                    style={{ fontSize: 11 }}
                  >
                    {sourceLabel(entry)}
                  </span>
                  {entry.needsBetaApis && (
                    <span
                      className="mc-category absolute right-2 top-2 z-10 px-2 py-0.5 uppercase tracking-wider font-bold border bg-black/60 border-amber-500/40 text-amber-300"
                      style={{ fontSize: 11 }}
                      title="Only works in a world with Beta APIs turned on (world page)"
                    >
                      Needs Beta APIs
                    </span>
                  )}
                  {entry.thumbUrl ? (
                    <img src={entry.thumbUrl} alt="" className="transition-transform duration-500 hover:scale-105" />
                  ) : (
                    <div className="mc-addon-banner-placeholder">{entry.name.charAt(0)}</div>
                  )}
                </div>
                <div className="mc-addon-card-body">
                  <div className="mc-white text-sm font-bold truncate mb-1">{entry.name}</div>
                  <div className="mc-dark-gray text-[11px] mb-3">
                    {entry.author ? <>by <span className="mc-white">{entry.author}</span></> : <span className="mc-dark-gray">Unknown author</span>}
                    {entry.version && <> · v{entry.version}</>}
                  </div>
                  <div className="mc-gray flex-1 text-[11px] line-clamp-2 leading-relaxed font-sans mb-4">
                    {entry.description || <span className="mc-dark-gray italic">No description</span>}
                  </div>
                  <div className="flex justify-between items-center pt-3 border-t border-white/5 mt-auto">
                    <span className="mc-aqua text-[11px] font-bold">{formatBytes(entry.sizeBytes)}</span>
                    <span className="mc-dark-gray text-[11px]">{timeAgo(entry.addedAt)}</span>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      <SuggestedAddons have={new Set((data ?? []).map((e) => Number(e.source?.modId)).filter(Boolean))} onAdded={() => mutate()} />

      <div className="text-center mt-6">
        <Link href="/addons" className="mc-gray text-xs hover:text-white">
          Want more? → Find add-ons
        </Link>
      </div>
    </div>
  );
}

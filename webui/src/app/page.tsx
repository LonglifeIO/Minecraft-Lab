"use client";

import { useState, useRef, useEffect } from "react";
import useSWR from "swr";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/toast";
import { WorldIcon } from "@/components/world-icon";
import { useDemoMode, DemoModeDevToggle } from "@/lib/demoMode";
import { copyText } from "@/lib/copy";
import { BridgeMenu } from "@/components/bridge-menu";

const fetcher = (url: string) => fetch(url).then((r) => { if (r.status === 401) throw new Error("unauthorized"); return r.json(); });

interface ServerStatus {
  id: string; name: string; online: boolean; running: boolean;
  players: number; maxPlayers: number; version: string;
  difficulty: string; gamemode: string; seed?: string | null;
}

interface UpdateInfo {
  latest: string | null;
  worlds: Array<{ name: string; needsUpdate: boolean }>;
  broadcaster?: {
    compatibleReleaseAvailable?: boolean;
    warning?: string | null;
  };
}

// Escape closes whatever is open (dialogs, menus)
function useEscape(active: boolean, onEscape: () => void) {
  useEffect(() => {
    if (!active) return;
    function handler(e: KeyboardEvent) { if (e.key === "Escape") onEscape(); }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [active, onEscape]);
}

// ============ MC-styled confirm dialog ============
function McConfirm({ message, requireText, onConfirm, onCancel }: { message: string; requireText?: string; onConfirm: () => void; onCancel: () => void }) {
  const [typed, setTyped] = useState("");
  const ready = !requireText || typed.trim().toLowerCase() === requireText.trim().toLowerCase();
  useEscape(true, onCancel);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.6)" }} onClick={onCancel}>
      <div role="dialog" aria-modal="true" aria-label="Confirm" className="mc-dark-panel p-5 w-full max-w-sm" style={{ boxShadow: "6px 6px 0 rgba(0,0,0,0.5)" }} onClick={(e) => e.stopPropagation()}>
        <p className="mc-white text-sm text-center mb-4" style={{ lineHeight: 1.6, whiteSpace: "pre-line" }}>{message}</p>
        {requireText && (
          <div className="mb-4">
            <label htmlFor="confirm-text" className="mc-note block mb-1.5">Type <b className="mc-white">{requireText}</b> to confirm:</label>
            <input id="confirm-text" className="mc-input" value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && ready) onConfirm(); }} autoFocus />
          </div>
        )}
        <div className="flex gap-2">
          <button className="mc-btn flex-1" onClick={onCancel} autoFocus={!requireText}>Cancel</button>
          <button className="mc-btn mc-btn-red flex-1" onClick={onConfirm} disabled={!ready}>Confirm</button>
        </div>
      </div>
    </div>
  );
}

// ============ 3-dot menu ============
function WorldMenu({ server, onAction }: { server: ServerStatus; onAction: (action: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { transform } = useDemoMode();

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);
  useEscape(open, () => setOpen(false));

  const item = (action: string, label: string, extra = "") => (
    <button role="menuitem" className={`mc-menu-item ${extra}`} onClick={(e) => { e.preventDefault(); setOpen(false); onAction(action); }}>{label}</button>
  );

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        className="mc-btn mc-btn-sm mc-btn-icon"
        aria-label={`Actions for ${transform(server.name, "worldName")}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(!open); }}
      >
        &#x22EE;
      </button>
      {open && (
        <div role="menu" className="mc-menu">
          {server.online ? (
            <>
              {item("stop", "Stop")}
              {item("restart", "Restart")}
              {item("backup", "Back up now")}
            </>
          ) : (
            item("start", "Start", "mc-green")
          )}
          <div className="mc-sep" />
          {item("delete", "Delete world…", "mc-red")}
        </div>
      )}
    </div>
  );
}

// ============ Dashboard ============
export default function Dashboard() {
  const router = useRouter();
  const { toast } = useToast();
  const { transform } = useDemoMode();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newSeed, setNewSeed] = useState("");
  const [newBackup, setNewBackup] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{ message: string; requireText?: string; onConfirm: () => void; onCancel: () => void } | null>(null);
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
  const [updateBusy, setUpdateBusy] = useState(false);

  const { data: rawServers, error, isLoading, mutate } = useSWR<ServerStatus[]>("/api/servers", fetcher, {
    refreshInterval: 5000, onError: (err) => { if (err.message === "unauthorized") router.push("/login"); },
  });

  const { data: updateInfo } = useSWR<UpdateInfo>("/api/updates", fetcher, {
    refreshInterval: 300000, onError: (err) => { if (err.message === "unauthorized") router.push("/login"); },
  });

  // Filter out deleted worlds client-side so they never reappear
  const servers = rawServers?.filter((s) => !deletedIds.has(s.id));
  const broadcasterWarning = updateInfo?.broadcaster?.warning || "";

  function showConfirm(message: string, requireText?: string): Promise<boolean> {
    return new Promise((resolve) => {
      setConfirmDialog({
        message,
        requireText,
        onConfirm: () => { setConfirmDialog(null); resolve(true); },
        onCancel:  () => { setConfirmDialog(null); resolve(false); },
      });
    });
  }

  function cancelConfirm() {
    confirmDialog?.onCancel();
  }

  function cancelCreate() {
    setCreating(false); setNewName(""); setNewSeed(""); setNewBackup(true);
  }
  useEscape(creating && !busy, cancelCreate);

  async function handleWorldAction(server: ServerStatus, action: string) {
    const displayName = transform(server.name, "worldName");
    if (action === "delete") {
      const ok = await showConfirm(`Delete "${displayName}" permanently?\n\nThis stops the world and destroys it, including its builds. This cannot be undone.`, displayName);
      if (!ok) return;

      // Hide from UI immediately and permanently until page reload
      setDeletedIds((prev) => new Set(prev).add(server.id));
      toast("Deleting world...", "info");

      try {
        const res = await fetch("/api/worlds", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete", id: server.id }) });
        const r = await res.json();
        if (r.success) {
          toast(`"${displayName}" deleted`, "success");
        } else {
          toast(r.error || "Delete failed", "error");
          // Unhide if delete actually failed
          setDeletedIds((prev) => { const n = new Set(prev); n.delete(server.id); return n; });
        }
      } catch {
        toast("Couldn't reach the dashboard server", "error");
        setDeletedIds((prev) => { const n = new Set(prev); n.delete(server.id); return n; });
      }
      return;
    }

    if (action === "stop" || action === "restart") {
      const verb = action === "stop" ? "Stop" : "Restart";
      const warn = server.players > 0 ? `\n\n${server.players} player${server.players === 1 ? " is" : "s are"} online and will be disconnected.` : "";
      const ok = await showConfirm(`${verb} "${displayName}"?${warn}`);
      if (!ok) return;
    }
    if (action === "backup") {
      const ok = await showConfirm(`Create a backup of "${displayName}"?`);
      if (!ok) return;
    }

    if (["start", "stop", "restart", "backup"].includes(action)) {
      toast(action === "start" ? "Starting..." : action === "stop" ? "Stopping..." : action === "restart" ? "Restarting..." : "Backing up...", "info");
      try {
        const res = await fetch(`/api/servers/${server.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
        const r = await res.json();
        if (r.success || r.output !== undefined) toast(`${action === "backup" ? "Backup" : action.charAt(0).toUpperCase() + action.slice(1)} complete`, "success");
        else toast(r.error || "Failed", "error");
        setTimeout(() => mutate(), 2000);
      } catch { toast("Couldn't reach the dashboard server", "error"); }
    }
  }

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    const seed = newSeed.trim();
    const backup = newBackup;

    setCreating(false);
    setNewName("");
    setNewSeed("");
    setNewBackup(true);
    setBusy(true);

    try {
      const res = await fetch("/api/worlds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", name, ...(seed ? { seed } : {}), backup }),
      });
      const result = await res.json();
      if (result.success) {
        // Add real world to UI immediately — container boots in background
        const newWorld: ServerStatus = {
          id: result.world.id, name, online: false, running: true,
          players: 0, maxPlayers: 20, version: "", difficulty: "", gamemode: "", seed: seed || null,
        };
        mutate((prev) => [...(prev || []), newWorld], false);
        toast(`"${transform(name, "worldName")}" created! Starting up...`, "success");
      } else {
        toast(result.error || "Failed to create world", "error");
      }
    } catch { toast("Couldn't reach the dashboard server", "error"); }
    finally { setBusy(false); }
  }

  async function handleUpdateClick() {
    setUpdateBusy(true);
    let polling = false;
    try {
      const res = await fetch("/api/updates");
      const info = await res.json();
      if (!res.ok) { toast(info.error || "Update check failed", "error"); return; }

      const outdated = (info.worlds || []).filter((w: { needsUpdate: boolean }) => w.needsUpdate);
      if (outdated.length === 0) { toast(`All worlds up to date (${info.latest})`, "success"); return; }

      const names = outdated.map((w: { name: string }) => w.name).join(", ");
      const bridgeWarning = info.broadcaster?.warning ? `\n\nXbox bridge warning:\n${info.broadcaster.warning}` : "";
      const ok = await showConfirm(`Update available: ${info.latest}\n\nWorlds to update: ${names}\n\nWorlds with players online will be skipped. Updated worlds will restart.${bridgeWarning}`);
      if (!ok) return;

      toast(info.broadcaster?.warning ? `Updating ${outdated.length} world(s)... Xbox bridge broadcaster may stay on its current release.` : `Updating ${outdated.length} world(s)...`, "info");
      const applyRes = await fetch("/api/updates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      const applyJson = await applyRes.json();
      if (!applyJson.success) { toast(applyJson.error || "Update failed", "error"); return; }

      polling = true;
      const poll = setInterval(async () => {
        try {
          const s = await (await fetch("/api/updates?status=1")).json();
          if (!s.running && s.finishedAt) {
            clearInterval(poll);
            toast("Update complete", "success");
            setUpdateBusy(false);
            mutate();
          }
        } catch { /* keep polling */ }
      }, 3000);
      setTimeout(() => { clearInterval(poll); setUpdateBusy(false); }, 10 * 60 * 1000);
    } catch {
      toast("Couldn't reach the dashboard server", "error");
    } finally {
      if (!polling) setUpdateBusy(false);
    }
  }

  return (
    <div className="min-h-screen p-4 sm:p-6 max-w-5xl mx-auto">
      {/* Confirm dialog */}
      {confirmDialog && (
        <McConfirm
          message={confirmDialog.message}
          requireText={confirmDialog.requireText}
          onConfirm={confirmDialog.onConfirm}
          onCancel={cancelConfirm}
        />
      )}

      {/* Title bar */}
      <header className="mc-dark-panel px-5 py-4 mb-6 border-b-4 border-black/30">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="mc-title text-3xl tracking-tighter" style={{ textShadow: "4px 4px 0 rgba(0,0,0,0.5), 0 0 20px rgba(255,155,46,0.3)" }}>MinecraftLab</h1>
            <p className="mc-note mt-1">Family server dashboard</p>
          </div>
          <nav className="mc-toolbar" aria-label="Main">
            <Link href="/addons" className="mc-btn mc-btn-amber mc-btn-sm">Browse add-ons</Link>
            <Link href="/addons/library" className="mc-btn mc-btn-sm">Library</Link>
            <BridgeMenu />
            <button className="mc-btn mc-btn-sm" disabled={updateBusy} onClick={handleUpdateClick}>
              {updateBusy ? "Checking…" : "Check for updates"}
            </button>
            <button className="mc-btn mc-btn-sm" onClick={async () => { await fetch("/api/logout", { method: "POST" }); router.push("/login"); }}>
              Log out
            </button>
          </nav>
        </div>
      </header>

      {broadcasterWarning && (
        <div className="mc-dark-panel p-4 mb-6" role="status" style={{ borderLeft: "3px solid var(--mc-gold)", background: "rgba(255,170,0,0.07)" }}>
          <p className="mc-gold text-sm font-bold">Xbox bridge release unavailable</p>
          <p className="mc-note mt-1">{broadcasterWarning}</p>
        </div>
      )}

      {isLoading && !rawServers && <p className="mc-gray text-sm py-8 text-center animate-pulse">Loading your worlds…</p>}
      {error && !isLoading && <p className="mc-red text-sm py-8 text-center">Can&apos;t reach the server host. Retrying…</p>}

      {/* Your Worlds */}
      <h2 className="mc-section mb-1 text-center text-lg uppercase tracking-widest">Your worlds</h2>
      {servers && servers.length > 0 && (
        <p className="mc-note text-center mb-5">
          {servers.reduce((n, s) => n + (s.online ? s.players : 0), 0)} playing right now · {servers.filter((s) => s.online).length} of {servers.length} world{servers.length === 1 ? "" : "s"} online
        </p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-12 max-w-4xl mx-auto" style={{ overflow: "visible" }}>
        {servers?.map((server) => {
          const displayName = transform(server.name, "worldName");
          const displayId = transform(server.id, "worldId");
          const fill = Math.max(((server.players || 0) / (server.maxPlayers || 20)) * 100, 2);
          return (
          <article
            key={server.id}
            className={`mc-dark-panel p-5 transition-all duration-300 relative group ${server.online ? "shadow-[0_0_15px_rgba(85,255,85,0.1)]" : ""}`}
            style={{ overflow: "visible", borderWidth: 2, borderColor: server.online ? "#3f8f3f" : "#2e2e2e" }}
          >
            <div className="flex items-start justify-between gap-3 mb-4 relative z-20">
              <Link href={`/world/${server.id}`} className="mc-link flex items-center gap-3 flex-1 min-w-0">
                <div className={`mc-avatar mc-avatar-lg transition-transform duration-300 group-hover:scale-110 ${server.online ? "border-green-500/50" : ""}`} aria-hidden="true" style={{ padding: 0, overflow: "hidden" }}>
                  <WorldIcon id={server.id} seed={server.seed} />
                </div>
                <span className="mc-white text-base font-bold break-words leading-tight tracking-tight min-w-0">{displayName}</span>
              </Link>
              <div className="flex flex-col items-end gap-2 flex-shrink-0">
                <WorldMenu server={server} onAction={(a) => handleWorldAction(server, a)} />
                <span className={`mc-chip ${server.online ? "mc-chip-on" : server.running ? "mc-chip-wait" : "mc-chip-off"}`}>
                  {server.online ? "Online" : server.running ? "Starting" : "Stopped"}
                </span>
              </div>
            </div>

            <div className="mc-note mb-3 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span>{displayId}</span>
              {server.seed && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>seed <span className="mc-mono" style={{ fontSize: 13 }}>{server.seed}</span></span>
                  <button type="button" className="mc-textbtn" aria-label={`Copy seed of ${displayName}`}
                    onClick={async () => { const ok = await copyText(server.seed!); toast(ok ? "Seed copied" : "Couldn't copy — select it and copy by hand", ok ? "success" : "error"); }}>
                    Copy
                  </button>
                </>
              )}
            </div>

            <div className="relative z-10">
              {server.online ? (
                <>
                  <div className="space-y-2 mb-3 bg-black/40 p-3 border border-white/5">
                    <div className="flex justify-between text-[13px] uppercase tracking-wider">
                      <span className="mc-gray">Players online</span>
                      <span className="mc-green">{server.players}<span className="mc-dark-gray">/{server.maxPlayers}</span></span>
                    </div>
                    <div className="mc-xp-bar h-2.5" role="progressbar" aria-label="Players online" aria-valuemin={0} aria-valuemax={server.maxPlayers} aria-valuenow={server.players}>
                      <div className="mc-xp-fill shadow-[0_0_10px_rgba(128,255,32,0.5)]" style={{ width: `${fill}%` }} />
                    </div>
                  </div>
                  <dl className="flex flex-wrap gap-x-6 gap-y-1 text-[13px] px-1">
                    <div className="flex gap-2"><dt className="mc-gray uppercase">Mode</dt><dd className="mc-aqua font-bold capitalize">{server.gamemode}</dd></div>
                    <div className="flex gap-2"><dt className="mc-gray uppercase">Difficulty</dt><dd className="mc-gold font-bold capitalize">{server.difficulty}</dd></div>
                    {server.version && server.version !== "unknown" && (
                      <div className="flex gap-2"><dt className="mc-gray uppercase">Version</dt><dd className="mc-white">{server.version}</dd></div>
                    )}
                  </dl>
                </>
              ) : (
                <div className="py-6 text-center bg-black/20 border border-dashed border-white/10">
                  <p className="mc-note uppercase tracking-widest">{server.running ? "Starting up…" : "Stopped"}</p>
                </div>
              )}

              <Link href={`/world/${server.id}`} className={`mc-btn w-full mt-5 tracking-widest ${server.online ? "mc-btn-active" : ""}`}>
                Open world
              </Link>
            </div>
          </article>
          );
        })}

        {/* Create World Card */}
        {!creating && (
          <button
            type="button"
            className="mc-dark-panel mc-lift p-5 cursor-pointer flex flex-col items-center justify-center h-full min-h-[180px] group border-dashed border-2 border-white/10 hover:border-white/30 transition-all duration-300 bg-black/20 w-full"
            onClick={() => setCreating(true)}
            disabled={busy}
          >
            <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center mb-4 group-hover:scale-110 group-hover:bg-white/10 transition-all" aria-hidden="true">
              <span className="mc-white text-4xl leading-none font-light">+</span>
            </div>
            <span className="mc-gray text-[13px] uppercase font-bold tracking-[0.2em] group-hover:text-white transition-colors">{busy ? "Creating…" : "Create a new world"}</span>
          </button>
        )}
      </div>

      {/* Create World Form Modal-ish */}
      {creating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={() => { if (!busy) cancelCreate(); }}>
          <div role="dialog" aria-modal="true" aria-labelledby="create-title" className="mc-dark-panel p-6 w-full max-w-md border-t-4 border-green-500 shadow-[0_20px_50px_rgba(0,0,0,0.5)]" onClick={(e) => e.stopPropagation()}>
            <h2 id="create-title" className="mc-section text-center mb-6 text-xl tracking-widest uppercase">Create a new world</h2>
            <div className="space-y-4">
              <div>
                <label htmlFor="new-world-name" className="mc-note mb-1.5 block uppercase font-bold">World name</label>
                <input
                  id="new-world-name"
                  className="mc-input"
                  placeholder="e.g. Survival SMP"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                  disabled={busy}
                  autoFocus
                />
              </div>
              <div>
                <label htmlFor="new-world-seed" className="mc-note mb-1.5 block uppercase font-bold">Seed <span className="font-normal normal-case">(optional)</span></label>
                <input
                  id="new-world-seed"
                  className="mc-input"
                  placeholder="Leave blank for a random world"
                  value={newSeed}
                  onChange={(e) => setNewSeed(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                  disabled={busy}
                />
                <p className="mc-note mt-1.5">A seed is a number or word that picks the terrain. Two worlds with the same seed generate the same land.</p>
              </div>
              <label htmlFor="new-world-backup" className="flex items-start gap-3 cursor-pointer">
                <input id="new-world-backup" type="checkbox" checked={newBackup} onChange={(e) => setNewBackup(e.target.checked)} disabled={busy}
                  style={{ width: 18, height: 18, marginTop: 2, accentColor: "var(--mc-green, #5b8731)" }} />
                <span className="mc-note">Back up this world every night <span className="font-normal normal-case">(untick for a throwaway test world; you can change it later on the world&apos;s page)</span></span>
              </label>
              <div className="flex gap-3 pt-4">
                <button className="mc-btn flex-1" onClick={cancelCreate} disabled={busy}>Cancel</button>
                <button className="mc-btn mc-btn-green flex-1" onClick={handleCreate} disabled={busy || !newName.trim()}>
                  {busy ? "Creating…" : "Create"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="mc-sep" />
      <p className="mc-note mt-3 text-center">
        MinecraftLab &middot; family Bedrock server<DemoModeDevToggle />
      </p>
    </div>
  );
}

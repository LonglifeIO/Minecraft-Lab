"use client";

import { useState, useRef, useEffect } from "react";
import useSWR from "swr";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/toast";

const fetcher = (url: string) => fetch(url).then((r) => { if (r.status === 401) throw new Error("unauthorized"); return r.json(); });

interface ServerStatus {
  id: string; name: string; online: boolean; running: boolean;
  players: number; maxPlayers: number; version: string;
  difficulty: string; gamemode: string;
}

// ============ MC-styled confirm dialog ============
function McConfirm({ message, onConfirm, onCancel }: { message: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.6)" }}>
      <div className="mc-dark-panel p-5 w-80" style={{ boxShadow: "6px 6px 0 rgba(0,0,0,0.5)" }}>
        <p className="mc-white text-xs text-center mb-4" style={{ lineHeight: 1.6 }}>{message}</p>
        <div className="flex gap-2">
          <button className="mc-btn flex-1" onClick={onCancel}>Cancel</button>
          <button className="mc-btn mc-btn-red flex-1" onClick={onConfirm}>Confirm</button>
        </div>
      </div>
    </div>
  );
}

// ============ 3-dot menu ============
function WorldMenu({ server, onAction }: { server: ServerStatus; onAction: (action: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        className="mc-btn px-2 py-0 text-xs"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(!open); }}
      >
        &#x22EE;
      </button>
      {open && (
        <div className="absolute right-0 top-8 mc-dark-panel p-1 z-50 min-w-[140px]" style={{ boxShadow: "4px 4px 0 rgba(0,0,0,0.4)" }}>
          {server.online ? (
            <>
              <button className="mc-btn w-full text-xs mb-1" onClick={(e) => { e.preventDefault(); setOpen(false); onAction("stop"); }}>Stop</button>
              <button className="mc-btn w-full text-xs mb-1" onClick={(e) => { e.preventDefault(); setOpen(false); onAction("restart"); }}>Restart</button>
              <button className="mc-btn w-full text-xs mb-1" onClick={(e) => { e.preventDefault(); setOpen(false); onAction("backup"); }}>Backup</button>
            </>
          ) : (
            <button className="mc-btn mc-btn-green w-full text-xs mb-1" onClick={(e) => { e.preventDefault(); setOpen(false); onAction("start"); }}>Start</button>
          )}
          <div className="mc-sep" />
          <button className="mc-btn mc-btn-red w-full text-xs" onClick={(e) => { e.preventDefault(); setOpen(false); onAction("delete"); }}>Delete World</button>
        </div>
      )}
    </div>
  );
}

// ============ Dashboard ============
export default function Dashboard() {
  const router = useRouter();
  const { toast } = useToast();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{ message: string; onConfirm: () => void } | null>(null);
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());

  const { data: rawServers, error, isLoading, mutate } = useSWR<ServerStatus[]>("/api/servers", fetcher, {
    refreshInterval: 5000, onError: (err) => { if (err.message === "unauthorized") router.push("/login"); },
  });

  // Filter out deleted worlds client-side so they never reappear
  const servers = rawServers?.filter((s) => !deletedIds.has(s.id));

  function showConfirm(message: string): Promise<boolean> {
    return new Promise((resolve) => {
      setConfirmDialog({
        message,
        onConfirm: () => { setConfirmDialog(null); resolve(true); },
      });
    });
  }

  function cancelConfirm() {
    setConfirmDialog(null);
  }

  async function handleWorldAction(server: ServerStatus, action: string) {
    if (action === "delete") {
      const ok = await showConfirm(`Delete "${server.name}" permanently?\n\nThis will stop and destroy the world. This cannot be undone.`);
      if (!ok) return;

      // Hide from UI immediately and permanently until page reload
      setDeletedIds((prev) => new Set(prev).add(server.id));
      toast("Deleting world...", "info");

      try {
        const res = await fetch("/api/worlds", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete", id: server.id }) });
        const r = await res.json();
        if (r.success) {
          toast(`"${server.name}" deleted`, "success");
        } else {
          toast(r.error || "Delete failed", "error");
          // Unhide if delete actually failed
          setDeletedIds((prev) => { const n = new Set(prev); n.delete(server.id); return n; });
        }
      } catch {
        toast("Network error", "error");
        setDeletedIds((prev) => { const n = new Set(prev); n.delete(server.id); return n; });
      }
      return;
    }

    if (action === "stop" || action === "restart") {
      const ok = await showConfirm(`${action.charAt(0).toUpperCase() + action.slice(1)} "${server.name}"?`);
      if (!ok) return;
    }
    if (action === "backup") {
      const ok = await showConfirm(`Create a backup of "${server.name}"?`);
      if (!ok) return;
    }

    if (["start", "stop", "restart", "backup"].includes(action)) {
      toast(action === "start" ? "Starting..." : action === "stop" ? "Stopping..." : action === "restart" ? "Restarting..." : "Backing up...", "info");
      try {
        const res = await fetch(`/api/servers/${server.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
        const r = await res.json();
        if (r.success || r.output !== undefined) toast(`${action} complete`, "success");
        else toast(r.error || "Failed", "error");
        setTimeout(() => mutate(), 2000);
      } catch { toast("Network error", "error"); }
    }
  }

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);

    setCreating(false);
    setNewName("");
    setBusy(true);

    try {
      const res = await fetch("/api/worlds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", name }),
      });
      const result = await res.json();
      if (result.success) {
        // Add real world to UI immediately — container boots in background
        const newWorld: ServerStatus = {
          id: result.world.id, name, online: false, running: true,
          players: 0, maxPlayers: 20, version: "", difficulty: "", gamemode: "",
        };
        mutate((prev) => [...(prev || []), newWorld], false);
        toast(`"${name}" created! Starting up...`, "success");
      } else {
        toast(result.error || "Failed to create world", "error");
      }
    } catch { toast("Network error", "error"); }
    finally { setBusy(false); }
  }

  return (
    <div className="min-h-screen p-4 sm:p-6 max-w-5xl mx-auto">
      {/* Confirm dialog */}
      {confirmDialog && (
        <McConfirm
          message={confirmDialog.message}
          onConfirm={confirmDialog.onConfirm}
          onCancel={cancelConfirm}
        />
      )}

      {/* Title bar */}
      <div className="mc-dark-panel flex items-center justify-between px-6 py-4 mb-8 border-b-4 border-black/30">
        <div className="flex flex-col">
          <h1 className="mc-title text-3xl tracking-tighter" style={{ textShadow: "4px 4px 0 rgba(0,0,0,0.5), 0 0 20px rgba(255,155,46,0.3)" }}>MinecraftLab</h1>
          <p className="mc-dark-gray text-[10px] uppercase tracking-widest mt-1">Experimental Server Hub</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/addons"><button className="mc-btn mc-btn-amber text-xs px-4 py-1.5 font-bold">BROWSE ADD-ONS</button></Link>
          <button className="mc-btn text-xs px-4 py-1.5" onClick={async () => { await fetch("/api/logout", { method: "POST" }); router.push("/login"); }}>
            LOGOUT
          </button>
        </div>
      </div>

      {isLoading && <p className="mc-gray text-xs py-8 text-center animate-pulse">Scanning for active worlds...</p>}
      {error && !isLoading && <p className="mc-red text-xs py-8 text-center">Connection to host lost. Reconnecting...</p>}

      {/* Your Worlds */}
      <div className="mc-section mb-6 text-center text-lg uppercase tracking-widest">Active Instances</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-12 max-w-4xl mx-auto">
        {servers?.map((server) => (
          <div 
            key={server.id} 
            className={`mc-dark-panel p-5 transition-all duration-300 relative group ${server.online ? "border-green-500/30 shadow-[0_0_15px_rgba(85,255,85,0.1)]" : "opacity-80"}`}
            style={{ 
              overflow: "visible",
              borderWidth: "2px",
              borderColor: server.online ? "#55ff5544" : "#2e2e2e"
            }}
          >
            {server.online && (
              <div className="absolute -inset-[1px] bg-gradient-to-r from-green-500/20 to-emerald-500/20 rounded-sm blur-sm opacity-50 group-hover:opacity-100 transition-opacity pointer-events-none" />
            )}
            
            <div className="flex items-start justify-between mb-4 relative z-10">
              <Link href={server.id === "creating" ? "#" : `/world/${server.id}`} className="flex items-center gap-3 flex-1 min-w-0">
                <div className={`mc-avatar w-12 h-12 text-xl border-2 transition-transform duration-300 group-hover:scale-110 ${server.online ? "border-green-500/50" : "border-gray-700"}`}>
                  {server.name.charAt(0)}
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="mc-white text-base font-bold truncate tracking-tight">{server.name}</span>
                  <span className="mc-dark-gray text-[10px] uppercase">{server.id.slice(0, 8)}</span>
                </div>
              </Link>
              <div className="flex flex-col items-end gap-2 flex-shrink-0">
                <WorldMenu server={server} onAction={(a) => handleWorldAction(server, a)} />
                <span className={`mc-status text-[9px] px-2 py-0.5 font-bold uppercase ${server.online ? "mc-status-online" : "mc-status-offline"}`}>
                  {server.online ? "Online" : server.running ? "Starting" : "Offline"}
                </span>
              </div>
            </div>

            <div className="relative z-10">
              {server.id === "creating" ? (
                <div className="py-4 text-center">
                  <p className="mc-gold text-xs animate-bounce">Provisioning Resources...</p>
                </div>
              ) : server.online ? (
                <>
                  <div className="space-y-2 mb-4 bg-black/40 p-3 border border-white/5">
                    <div className="flex justify-between text-[10px] uppercase font-bold tracking-wider">
                      <span className="mc-gray">Network Load</span>
                      <span className="mc-green">{server.players}<span className="mc-dark-gray">/{server.maxPlayers}</span></span>
                    </div>
                    <div className="mc-xp-bar h-2.5">
                      <div className="mc-xp-fill shadow-[0_0_10px_rgba(128,255,32,0.5)]" style={{ width: `${Math.max((server.players / server.maxPlayers) * 100, 2)}%` }} />
                    </div>
                  </div>
                  <div className="flex gap-4 text-[11px] px-1">
                    <span className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 bg-aqua-400" /><span className="mc-gray uppercase">Mode</span> <span className="mc-aqua font-bold">{server.gamemode}</span></span>
                    <span className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 bg-gold-400" /><span className="mc-gray uppercase">Diff</span> <span className="mc-gold font-bold">{server.difficulty}</span></span>
                  </div>
                </>
              ) : (
                <div className="py-6 text-center bg-black/20 border border-dashed border-white/5">
                  <p className="mc-dark-gray text-xs uppercase tracking-widest">{server.running ? "Awaiting Core Services..." : "Instance Dormant"}</p>
                </div>
              )}

              {server.id !== "creating" && (
                <Link href={`/world/${server.id}`} className="block mt-5">
                  <button className={`mc-btn w-full text-xs font-bold py-2 tracking-widest transition-colors ${server.online ? "mc-btn-active" : ""}`}>
                    OPEN DASHBOARD
                  </button>
                </Link>
              )}
            </div>
          </div>
        ))}

        {/* Create World Card */}
        {!creating && (
          <div
            className="mc-dark-panel mc-lift p-5 cursor-pointer flex flex-col items-center justify-center h-full min-h-[180px] group border-dashed border-2 border-white/10 hover:border-white/30 transition-all duration-300 bg-black/20"
            onClick={() => setCreating(true)}
          >
            <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center mb-4 group-hover:scale-110 group-hover:bg-white/10 transition-all">
              <span className="mc-white text-4xl leading-none font-light">+</span>
            </div>
            <span className="mc-gray text-[10px] uppercase font-bold tracking-[0.2em] group-hover:mc-white transition-colors">Initialize New Instance</span>
          </div>
        )}
      </div>

      {/* Create World Form Modal-ish */}
      {creating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="mc-dark-panel p-6 w-full max-w-md border-t-4 border-green-500 shadow-[0_20px_50px_rgba(0,0,0,0.5)]">
            <div className="mc-section text-center mb-6 text-xl tracking-widest uppercase">New World Initialization</div>
            <div className="space-y-4">
              <div>
                <label className="mc-dark-gray text-[10px] uppercase font-bold mb-1.5 block">Instance Label</label>
                <input
                  className="mc-input py-3 text-base"
                  placeholder="e.g. Survival SMP"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                  disabled={busy}
                  autoFocus
                />
              </div>
              <div className="flex gap-3 pt-4">
                <button className="mc-btn flex-1 py-3 text-xs uppercase font-bold" onClick={() => { setCreating(false); setNewName(""); }} disabled={busy}>Abort</button>
                <button className="mc-btn mc-btn-green flex-1 py-3 text-xs uppercase font-bold" onClick={handleCreate} disabled={busy || !newName.trim()}>
                  {busy ? "Deploying..." : "Initialize"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="mc-sep" />
      <p className="mc-dark-gray text-xs mt-3 text-center">
        MinecraftLab &middot; Worlds auto-stop after 10 minutes with no players
      </p>
    </div>
  );
}

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
      <div className="mc-dark-panel flex items-center justify-between px-4 py-2 mb-6">
        <h1 className="mc-title text-lg">MinecraftLab</h1>
        <button className="mc-btn text-xs px-3 py-1" onClick={async () => { await fetch("/api/logout", { method: "POST" }); router.push("/login"); }}>
          Disconnect
        </button>
      </div>

      {isLoading && <p className="mc-gray text-xs py-8 text-center">Loading worlds...</p>}
      {error && !isLoading && <p className="mc-red text-xs py-8 text-center">Error loading worlds</p>}

      {/* Your Worlds */}
      <div className="mc-section mb-3 text-center">Your Worlds</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8 max-w-2xl mx-auto">
        {servers?.map((server) => (
          <div key={server.id} className="mc-dark-panel p-4 h-full" style={{ overflow: "visible" }}>
            <div className="flex items-center justify-between mb-3">
              <Link href={server.id === "creating" ? "#" : `/world/${server.id}`} className="flex items-center gap-2 flex-1 min-w-0">
                <div className="mc-avatar flex-shrink-0">{server.name.charAt(0)}</div>
                <span className="mc-white text-sm truncate">{server.name}</span>
              </Link>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className={`mc-status ${server.online ? "mc-status-online" : "mc-status-offline"}`}>
                  <span className={server.online ? "mc-pulse" : ""}>&#x25CF;</span>
                  {server.online ? " Online" : server.running ? " Starting" : " Offline"}
                </span>
                {server.id !== "creating" && (
                  <WorldMenu server={server} onAction={(a) => handleWorldAction(server, a)} />
                )}
              </div>
            </div>

            {server.id === "creating" ? (
              <p className="mc-gold text-xs">Setting up world...</p>
            ) : server.online ? (
              <>
                <div className="space-y-1 mb-3">
                  <div className="flex justify-between text-xs">
                    <span className="mc-gray">Players</span>
                    <span className="mc-green">{server.players}<span className="mc-dark-gray">/{server.maxPlayers}</span></span>
                  </div>
                  <div className="mc-xp-bar">
                    <div className="mc-xp-fill" style={{ width: `${Math.max((server.players / server.maxPlayers) * 100, 2)}%` }} />
                  </div>
                </div>
                <div className="flex gap-4 text-xs">
                  <span><span className="mc-gray">Mode: </span><span className="mc-aqua capitalize">{server.gamemode}</span></span>
                  <span><span className="mc-gray">Diff: </span><span className="mc-gold capitalize">{server.difficulty}</span></span>
                </div>
              </>
            ) : (
              <p className="mc-dark-gray text-xs">{server.running ? "Server is starting..." : "Server is offline"}</p>
            )}

            {server.id !== "creating" && (
              <Link href={`/world/${server.id}`} className="block mt-3">
                <button className="mc-btn w-full text-xs">Manage</button>
              </Link>
            )}
          </div>
        ))}
      </div>

      {/* Create World */}
      <div className="mc-sep" />
      <div className="flex justify-center my-6">
        {creating ? (
          <div className="mc-dark-panel p-4 w-80">
            <div className="mc-section text-center mb-3">New World</div>
            <input
              className="mc-input mb-3"
              placeholder="World name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              disabled={busy}
              autoFocus
            />
            <div className="flex gap-2">
              <button className="mc-btn flex-1" onClick={() => { setCreating(false); setNewName(""); }} disabled={busy}>Cancel</button>
              <button className="mc-btn mc-btn-green flex-1" onClick={handleCreate} disabled={busy || !newName.trim()}>
                {busy ? "Creating..." : "Create"}
              </button>
            </div>
          </div>
        ) : (
          <div
            className="mc-dark-panel mc-lift p-4 cursor-pointer flex flex-col items-center justify-center w-64 opacity-60 hover:opacity-100 transition-opacity"
            onClick={() => setCreating(true)}
          >
            <span className="mc-white text-2xl mb-1">+</span>
            <span className="mc-gray text-xs">Create New World</span>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="mc-sep" />
      <p className="mc-dark-gray text-xs mt-3 text-center">
        MinecraftLab &middot; Worlds auto-stop after 10 minutes with no players
      </p>
    </div>
  );
}

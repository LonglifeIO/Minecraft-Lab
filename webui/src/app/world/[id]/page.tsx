"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import useSWR from "swr";
import Link from "next/link";
import { useToast } from "@/components/toast";

interface InstalledAddon {
  uuid: string;
  name: string;
  description: string;
  version: number[];
  type: string;
  packType: string;
  enabled: boolean;
  curseforge: { modId: number; fileId: number } | null;
}

const fetcher = (url: string) => fetch(url).then((r) => { if (r.status === 401) throw new Error("unauthorized"); return r.json(); });

interface WorldData {
  status: { online: boolean; players: number; maxPlayers: number; playerList: string[]; version: string; worldName: string; difficulty: string; gamemode: string };
  allowlist: Array<{ name: string; ignoresPlayerLimit?: boolean }>;
}
interface GameRule { id: string; label: string; description: string }

const BASIC_RULES: GameRule[] = [
  { id: "keepInventory", label: "Keep Inventory", description: "Players keep items on death" },
  { id: "pvp", label: "Player vs Player", description: "Players can damage each other" },
  { id: "mobGriefing", label: "Mob Griefing", description: "Mobs can destroy blocks" },
  { id: "doMobSpawning", label: "Mob Spawning", description: "Mobs spawn naturally" },
  { id: "showCoordinates", label: "Show Coordinates", description: "Display coordinates on screen" },
];
const ADVANCED_RULES: GameRule[] = [
  { id: "naturalRegeneration", label: "Natural Regeneration", description: "Health regenerates over time" },
  { id: "doDaylightCycle", label: "Daylight Cycle", description: "Time progresses normally" },
  { id: "doWeatherCycle", label: "Weather Cycle", description: "Weather changes naturally" },
  { id: "doFireTick", label: "Fire Spreads", description: "Fire can spread to nearby blocks" },
  { id: "tntExplodes", label: "TNT Explodes", description: "TNT blocks can detonate" },
  { id: "doInsomnia", label: "Phantoms Spawn", description: "Phantoms appear when not sleeping" },
  { id: "doTileDrops", label: "Tile Drops", description: "Blocks drop items when broken" },
  { id: "doEntityDrops", label: "Entity Drops", description: "Entities drop items on death" },
  { id: "doImmediateRespawn", label: "Instant Respawn", description: "Skip the death screen" },
  { id: "commandBlocksEnabled", label: "Command Blocks", description: "Command blocks can execute" },
  { id: "showDeathMessages", label: "Death Messages", description: "Show death messages in chat" },
];

function McToggle({ on, onChange, disabled }: { on: boolean; onChange: () => void; disabled?: boolean }) {
  return (
    <button onClick={onChange} disabled={disabled} className={`mc-toggle ${on ? "mc-toggle-on" : ""}`}>
      <div className="mc-toggle-knob" />
    </button>
  );
}

export default function WorldPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const id = params.id as string;
  const [busy, setBusy] = useState<string | null>(null);
  const [newPlayer, setNewPlayer] = useState("");
  const [ruleStates, setRuleStates] = useState<Record<string, boolean>>({});
  const [rulesLoaded, setRulesLoaded] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const { data, error, isLoading, mutate } = useSWR<WorldData>(`/api/servers/${id}`, fetcher, {
    refreshInterval: 5000, onError: (err) => { if (err.message === "unauthorized") router.push("/login"); },
  });
  const status = data?.status;
  const allowlist = data?.allowlist || [];
  // Default to true while loading so the full UI renders immediately
  const online = status?.online ?? (isLoading ? true : false);

  async function action(name: string, body?: Record<string, string>) {
    setBusy(name);
    try {
      const res = await fetch(`/api/servers/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: name, ...body }) });
      const result = await res.json();
      if (!res.ok) toast(result.error || "Failed", "error");
      setTimeout(() => mutate(), 1500);
      return result;
    } catch { toast("Network error", "error"); } finally { setBusy(null); }
  }

  async function handlePower(type: string) {
    if ((type === "stop" || type === "restart") && !confirm(`${type.charAt(0).toUpperCase() + type.slice(1)} the server?`)) return;
    toast(type === "start" ? "Starting server..." : type === "stop" ? "Stopping..." : "Restarting...", "info");
    await action(type);
  }
  async function handleGamemode(mode: string) { await action("command", { command: `gamemode ${mode} @a` }); toast(`Mode → ${mode}`, "success"); }
  async function handleDifficulty(level: string) { await action("difficulty", { level }); toast(`Difficulty → ${level}`, "success"); }
  async function handleGamerule(rule: string, val: boolean) { setRuleStates(p => ({ ...p, [rule]: val })); await action("command", { command: `gamerule ${rule} ${val}` }); }
  async function handleKick(name: string) { if (!confirm(`Kick ${name}?`)) return; await action("kick", { name }); toast(`${name} kicked`, "success"); }
  async function handleAllowlistAdd() { const n = newPlayer.trim(); if (!n) return; await action("allowlist_add", { name: n }); setNewPlayer(""); toast(`${n} added`, "success"); }
  async function handleAllowlistRemove(name: string) { if (!confirm(`Remove ${name}?`)) return; await action("allowlist_remove", { name }); toast(`${name} removed`, "success"); }
  async function handleBackup() {
    if (!confirm("Create backup?")) return;
    setBusy("backup"); toast("Backing up...", "info");
    try {
      const res = await fetch(`/api/servers/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "backup" }) });
      const r = await res.json();
      toast(r.success ? `Saved: ${r.filename}` : `Failed: ${r.error}`, r.success ? "success" : "error");
    } catch { toast("Backup failed", "error"); } finally { setBusy(null); }
  }

  async function loadGamerules() {
    if (rulesLoaded || !online) return;
    try {
      const res = await fetch(`/api/servers/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "gamerules" }) });
      const result = await res.json();
      if (result.rules) { setRuleStates(result.rules); setRulesLoaded(true); }
    } catch {}
  }
  if (online && !rulesLoaded) loadGamerules();

  // Show UI immediately — default to "online" so controls are visible while loading
  const loading = isLoading && !data;
  const failed = error && !data;

  function RuleRow({ rule }: { rule: GameRule }) {
    const isOn = ruleStates[rule.id] ?? true;
    return (
      <div className="mc-row flex items-center justify-between px-3 py-2.5">
        <div className="flex-1 mr-3">
          <div className="mc-white text-xs">{rule.label}</div>
          <div className="mc-dark-gray" style={{ fontSize: 10 }}>{rule.description}</div>
        </div>
        <McToggle on={isOn} onChange={() => handleGamerule(rule.id, !isOn)} disabled={busy !== null || loading} />
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 sm:p-6 max-w-5xl mx-auto pb-20">
      {/* Title bar */}
      <div className="mc-dark-panel flex items-center justify-between px-5 py-3 mb-6 border-b-2 border-black/20">
        <div className="flex items-center gap-4">
          <Link href="/"><button className="mc-btn text-xs px-3 py-1 font-bold">BACK</button></Link>
          <div className="flex flex-col">
            <span className="mc-title text-xl tracking-tight leading-none">{status?.worldName || id}</span>
            <span className="mc-dark-gray text-[9px] uppercase tracking-widest mt-1">Instance Control Center</span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className={`mc-status text-[10px] font-bold uppercase tracking-wider px-3 py-0.5 ${online ? "mc-status-online border-green-500/50" : "mc-status-offline border-red-500/50"}`}>
            {online ? "Online" : "Offline"}
          </span>
          <span className="mc-dark-gray text-[8px] uppercase tracking-tighter opacity-50">{id}</span>
        </div>
      </div>

      {/* Status bar */}
      {online && (
        <div className="mc-dark-panel p-4 mb-6 bg-gradient-to-r from-black/40 to-transparent">
          <div className="flex flex-wrap gap-8 text-[11px] mb-4 uppercase tracking-wider font-bold">
            <div className="flex flex-col">
              <span className="mc-gray text-[9px] mb-0.5">Network Load</span>
              <span className="mc-green text-sm">{status?.players}<span className="mc-dark-gray font-normal">/{status?.maxPlayers}</span></span>
            </div>
            <div className="flex flex-col">
              <span className="mc-gray text-[9px] mb-0.5">Operation Mode</span>
              <span className="mc-aqua text-sm capitalize">{status?.gamemode}</span>
            </div>
            <div className="flex flex-col">
              <span className="mc-gray text-[9px] mb-0.5">Threat Level</span>
              <span className="mc-gold text-sm capitalize">{status?.difficulty}</span>
            </div>
            <div className="flex flex-col">
              <span className="mc-gray text-[9px] mb-0.5">Kernel Version</span>
              <span className="mc-white text-sm">{status?.version}</span>
            </div>
          </div>
          <div className="mc-xp-bar h-2 shadow-inner">
            <div className="mc-xp-fill shadow-[0_0_8px_rgba(128,255,32,0.4)]" style={{ width: `${Math.max(((status?.players || 0) / (status?.maxPlayers || 20)) * 100, 2)}%` }} />
          </div>
        </div>
      )}

      {/* Power */}
      <div className="mc-dark-panel p-3 mb-4">
        <div className="mc-section">Power</div>
        {online ? (
          <div className="flex gap-2">
            <button className="mc-btn mc-btn-red flex-1" onClick={() => handlePower("stop")} disabled={busy !== null}>{busy === "stop" ? "Stopping..." : "Stop"}</button>
            <button className="mc-btn mc-btn-amber flex-1" onClick={() => handlePower("restart")} disabled={busy !== null}>{busy === "restart" ? "Restarting..." : "Restart"}</button>
            <button className="mc-btn flex-1" onClick={handleBackup} disabled={busy !== null}>{busy === "backup" ? "Saving..." : "Backup"}</button>
          </div>
        ) : (
          <button className="mc-btn mc-btn-green w-full py-2" onClick={() => handlePower("start")} disabled={busy !== null}>{busy === "start" ? "Starting..." : "Start Server"}</button>
        )}
      </div>

      {!online && status && (
        <div className="mc-dark-panel p-4 mb-4 text-center">
          <p className="mc-gold text-xs">Server is offline. Start it to manage settings.</p>
        </div>
      )}

      {status && !status.online && status.worldName === "" && (
        <div className="mc-dark-panel p-4 mb-4 text-center">
          <p className="mc-gold text-xs">Please wait — world is still being set up...</p>
        </div>
      )}

      {online && (
        <>
          {/* Game Mode + Difficulty */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div className="mc-dark-panel p-3">
              <div className="mc-section">Game Mode</div>
              <p className="mc-dark-gray mb-2" style={{ fontSize: 10 }}>Changes all online players</p>
              <div className="flex gap-2">
                {["survival", "creative", "adventure"].map((m) => (
                  <button key={m} className={`mc-btn flex-1 capitalize text-xs ${status?.gamemode === m ? "mc-btn-active" : ""}`} onClick={() => handleGamemode(m)} disabled={busy !== null}>{m}</button>
                ))}
              </div>
            </div>
            <div className="mc-dark-panel p-3">
              <div className="mc-section">Difficulty</div>
              <p className="mc-dark-gray mb-2" style={{ fontSize: 10 }}>Takes effect immediately</p>
              <div className="flex gap-2">
                {["peaceful", "easy", "normal", "hard"].map((d) => (
                  <button key={d} className={`mc-btn flex-1 capitalize text-xs ${status?.difficulty === d ? "mc-btn-active" : ""}`} onClick={() => handleDifficulty(d)} disabled={busy !== null}>{d}</button>
                ))}
              </div>
            </div>
          </div>

          {/* Game Rules + Players/Allowlist */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
            <div className="mc-dark-panel">
              <div className="p-3 pb-1"><div className="mc-section">Game Rules</div></div>
              {BASIC_RULES.map((r) => <RuleRow key={r.id} rule={r} />)}
              <button onClick={() => setShowAdvanced(!showAdvanced)} className="mc-btn w-full text-xs" style={{ border: "none", borderTop: "1px solid #333", boxShadow: "none" }}>
                {showAdvanced ? "Hide Advanced \u25B2" : "Show Advanced \u25BC"}
              </button>
              {showAdvanced && ADVANCED_RULES.map((r) => <RuleRow key={r.id} rule={r} />)}
            </div>

            <div className="flex flex-col gap-4">
              <div className="mc-dark-panel">
                <div className="p-3 pb-1"><div className="mc-section">Players Online <span className="mc-green">{status?.players || 0}</span></div></div>
                {status?.playerList && status.playerList.length > 0 ? (
                  status.playerList.map((name) => (
                    <div key={name} className="mc-row flex items-center justify-between px-3 py-2">
                      <div className="flex items-center gap-2">
                        <div className="mc-avatar">{name.charAt(0).toUpperCase()}</div>
                        <span className="mc-white text-xs">{name}</span>
                      </div>
                      <button className="mc-btn mc-btn-red text-xs px-2 py-0" onClick={() => handleKick(name)} disabled={busy !== null}>Kick</button>
                    </div>
                  ))
                ) : (
                  <p className="mc-dark-gray text-xs px-3 pb-3">No players online</p>
                )}
              </div>

              <div className="mc-dark-panel">
                <div className="p-3 pb-1"><div className="mc-section">Allowlist</div></div>
                <div className="px-3 pb-2">
                  <div className="flex gap-2">
                    <input className="mc-input" placeholder="Enter gamertag" value={newPlayer} onChange={(e) => setNewPlayer(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleAllowlistAdd()} />
                    <button className="mc-btn mc-btn-green text-xs px-3" onClick={handleAllowlistAdd} disabled={busy !== null || !newPlayer.trim()}>Add</button>
                  </div>
                </div>
                {allowlist.map((entry) => (
                  <div key={entry.name} className="mc-row flex items-center justify-between px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="mc-avatar">{entry.name.charAt(0).toUpperCase()}</div>
                      <span className="mc-white text-xs">{entry.name}</span>
                    </div>
                    <button className="mc-btn text-xs px-2 py-0" onClick={() => handleAllowlistRemove(entry.name)} disabled={busy !== null}>Remove</button>
                  </div>
                ))}
                {allowlist.length === 0 && <p className="mc-dark-gray text-xs px-3 pb-3">Empty</p>}
              </div>
            </div>
          </div>

          {/* Installed Add-ons */}
          <WorldAddons id={id} busy={busy} setBusy={setBusy} />
        </>
      )}
    </div>
  );
}

function WorldAddons({ id, busy, setBusy }: { id: string; busy: string | null; setBusy: (v: string | null) => void }) {
  const { toast } = useToast();
  const { data: addons, mutate } = useSWR<InstalledAddon[]>(`/api/servers/${id}/addons`, fetcher, { refreshInterval: 10000 });

  async function handleToggle(addon: InstalledAddon) {
    setBusy(`toggle-${addon.uuid}`);
    try {
      const res = await fetch(`/api/servers/${id}/addons`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "toggle", uuid: addon.uuid, enabled: !addon.enabled }),
      });
      const result = await res.json();
      if (result.success) {
        toast(`${addon.name} ${!addon.enabled ? "enabled" : "disabled"}. Restart to apply.`, "success");
        mutate();
      } else {
        toast(result.error || "Toggle failed", "error");
      }
    } catch { toast("Network error", "error"); }
    finally { setBusy(null); }
  }

  async function handleRemove(addon: InstalledAddon) {
    if (!confirm(`Remove "${addon.name}"? This will delete the pack files.`)) return;
    setBusy(`remove-${addon.uuid}`);
    toast("Removing...", "info");
    try {
      const res = await fetch("/api/addons/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uuid: addon.uuid, worldId: id }),
      });
      const result = await res.json();
      if (result.success) {
        toast(`${addon.name} removed. Restart to apply.`, "success");
        mutate();
      } else {
        toast(result.error || "Remove failed", "error");
      }
    } catch { toast("Network error", "error"); }
    finally { setBusy(null); }
  }

  return (
    <div className="mc-dark-panel mb-4 overflow-hidden">
      <div className="p-3 pb-2 flex items-center justify-between border-b border-black/20">
        <div className="mc-section" style={{ marginBottom: 0 }}>Installed Add-ons</div>
        <Link href="/addons">
          <button className="mc-btn mc-btn-green text-xs px-3 py-1">Browse Add-ons</button>
        </Link>
      </div>

      <div className="divide-y divide-black/10">
        {(!addons || addons.length === 0) && (
          <p className="mc-dark-gray text-xs p-4 text-center">No add-ons installed. Browse the library to get started.</p>
        )}

        {addons?.map((addon) => (
          <div key={addon.uuid} className="mc-row flex items-center justify-between px-3 py-3">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div
                className={`mc-item-slot-sm ${addon.enabled ? "mc-glint" : ""}`}
                style={{
                  background: addon.packType === "behavior" ? "#2a4a2a" : "#2a2a4a",
                  borderColor: addon.enabled
                    ? (addon.packType === "behavior" ? "#5a9e44 #2e5a22 #2e5a22 #5a9e44" : "#5a8a9e #2e4a5a #2e4a5a #5a8a9e")
                    : "#373737 #ffffff #ffffff #373737",
                }}
              >
                <span className="font-bold" style={{ fontSize: 10, color: addon.packType === "behavior" ? "var(--mc-green)" : "var(--mc-aqua)" }}>
                  {addon.packType === "behavior" ? "BP" : "RP"}
                </span>
              </div>
              <div className="min-w-0">
                <div className={`text-xs truncate font-bold ${addon.enabled ? "mc-white" : "mc-dark-gray"}`}>
                  {addon.name || addon.uuid.slice(0, 8)}
                </div>
                <div className="mc-dark-gray flex items-center gap-2" style={{ fontSize: 9 }}>
                  <span className={addon.packType === "behavior" ? "mc-green" : "mc-aqua"} style={{ fontSize: 8 }}>
                    {addon.packType === "behavior" ? "BEHAVIOR" : "RESOURCE"}
                  </span>
                  <span>&middot;</span>
                  <span>v{(addon.version || []).join(".")}</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-4 flex-shrink-0 ml-2">
              <div className="flex flex-col items-end gap-1">
                <span className="mc-dark-gray" style={{ fontSize: 8 }}>{addon.enabled ? "ENABLED" : "DISABLED"}</span>
                <button
                  onClick={() => handleToggle(addon)}
                  disabled={busy !== null}
                  className={`mc-toggle ${addon.enabled ? "mc-toggle-on" : ""}`}
                >
                  <div className="mc-toggle-knob" />
                </button>
              </div>
              <button
                className="mc-btn mc-btn-red text-xs px-2 py-0 h-8 min-w-[32px]"
                onClick={() => handleRemove(addon)}
                disabled={busy !== null}
              >
                {busy === `remove-${addon.uuid}` ? "..." : "X"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

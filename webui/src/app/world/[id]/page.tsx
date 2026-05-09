"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import useSWR from "swr";
import Link from "next/link";
import { useToast } from "@/components/toast";
import { useDemoMode } from "@/lib/demoMode";

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
  permissions: Array<{ xuid: string; permission: string }>;
  restartPending?: boolean;
  importing?: boolean;
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
  const { transform } = useDemoMode();
  const id = params.id as string;
  const [busy, setBusy] = useState<string | null>(null);
  const [newPlayer, setNewPlayer] = useState("");
  const [ruleStates, setRuleStates] = useState<Record<string, boolean>>({});
  const [rulesLoaded, setRulesLoaded] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [pendingChange, setPendingChange] = useState<{ type: string; value: string } | null>(null);

  const { data, error, isLoading, mutate } = useSWR<WorldData>(`/api/servers/${id}`, fetcher, {
    refreshInterval: 5000, onError: (err) => { if (err.message === "unauthorized") router.push("/login"); },
  });
  const status = data?.status;
  const allowlist = data?.allowlist || [];
  const permissions: Array<{ xuid: string; permission: string; name?: string }> = data?.permissions || [];
  const [permMenuOpen, setPermMenuOpen] = useState<string | null>(null);
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
    if (type === "restart" || type === "start") {
      setTimeout(() => mutate(), 5000);
      setTimeout(() => mutate(), 8000);
    }
  }
  async function handleGamemode(mode: string) {
    toast(`Setting gamemode to ${mode}...`, "info");
    const result = await action("gamemode", { mode });
    if (result?.success) setPendingChange({ type: "Game Mode", value: mode });
  }
  async function handleDifficulty(level: string) {
    toast(`Setting difficulty to ${level}...`, "info");
    const result = await action("difficulty", { level });
    if (result?.success) setPendingChange({ type: "Difficulty", value: level });
  }
  async function handleGamerule(rule: string, val: boolean) { setRuleStates(p => ({ ...p, [rule]: val })); await action("command", { command: `gamerule ${rule} ${val}` }); }
  async function handleKick(name: string) { const d = transform(name, "gamertag"); if (!confirm(`Kick ${d}?`)) return; await action("kick", { name }); toast(`${d} kicked`, "success"); }
  async function handleAllowlistAdd() { const n = newPlayer.trim(); if (!n) return; await action("allowlist_add", { name: n }); setNewPlayer(""); toast(`${transform(n, "gamertag")} added`, "success"); }
  async function handleSetPermission(name: string, permission: string) {
    setPermMenuOpen(null);
    const res = await fetch(`/api/servers/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "set_permission", name, permission }) });
    const result = await res.json();
    if (result.success) { toast(`${transform(name, "gamertag")} → ${permission}`, "success"); mutate(); }
    else toast(result.error || "Failed", "error");
  }
  async function handleAllowlistRemove(name: string) { const d = transform(name, "gamertag"); if (!confirm(`Remove ${d}?`)) return; await action("allowlist_remove", { name }); toast(`${d} removed`, "success"); }
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
  const importing = data?.importing === true;

  function RuleRow({ rule }: { rule: GameRule }) {
    const isOn = ruleStates[rule.id] ?? false;
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
            <span className="mc-title text-xl tracking-tight leading-none">{status?.worldName ? transform(status.worldName, "worldName") : transform(id, "worldId")}</span>
            <span className="mc-dark-gray text-[9px] uppercase tracking-widest mt-1">Instance Control Center</span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className={`mc-status text-[10px] font-bold uppercase tracking-wider px-3 py-0.5 ${online ? "mc-status-online border-green-500/50" : "mc-status-offline border-red-500/50"}`}>
            {online ? "Online" : "Offline"}
          </span>
          <span className="mc-dark-gray text-[8px] uppercase tracking-tighter opacity-50">{transform(id, "worldId")}</span>
        </div>
      </div>

      {/* Map import in-progress banner */}
      {data?.importing && (
        <div className="mc-dark-panel p-4 mb-4 text-center" style={{ borderLeft: "3px solid var(--mc-aqua)", background: "rgba(85,255,255,0.05)" }}>
          <p className="mc-aqua text-xs font-bold uppercase tracking-wide animate-pulse">Importing Map...</p>
          <p className="mc-dark-gray mt-1" style={{ fontSize: 10 }}>The map is being downloaded and set up. This takes about 30–60 seconds. The page will update automatically.</p>
        </div>
      )}

      {/* Restart-required banner */}
      {data?.restartPending && (
        <div className="mc-dark-panel p-3 mb-4 flex items-center justify-between gap-4" style={{ borderLeft: "3px solid var(--mc-gold)", background: "rgba(255,170,0,0.07)" }}>
          <div>
            <span className="mc-gold text-xs font-bold uppercase tracking-wide">⚠ Restart Required</span>
            <p className="mc-dark-gray mt-0.5" style={{ fontSize: 10 }}>Changes will take effect after restarting the server.</p>
          </div>
          <button className="mc-btn mc-btn-amber text-xs px-3 py-1 flex-shrink-0" onClick={() => handlePower("restart")} disabled={busy !== null}>
            {busy === "restart" ? "Restarting..." : "Restart Now"}
          </button>
        </div>
      )}

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
        {importing ? (
          <button className="mc-btn w-full py-2 opacity-50" disabled>Importing map...</button>
        ) : online ? (
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

      {online && !importing && (
        <>
          {/* Game Mode + Difficulty */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div className="mc-dark-panel p-3">
              <div className="mc-section">Game Mode</div>
              <p className="mc-dark-gray mb-2" style={{ fontSize: 10 }}>Requires restart to apply</p>
              <div className="flex gap-2">
                {["survival", "creative", "adventure"].map((m) => (
                  <button key={m} className={`mc-btn flex-1 capitalize text-xs ${status?.gamemode === m ? "mc-btn-active" : ""}`} onClick={() => handleGamemode(m)} disabled={busy !== null}>{m}</button>
                ))}
              </div>
            </div>
            <div className="mc-dark-panel p-3">
              <div className="mc-section">Difficulty</div>
              <p className="mc-dark-gray mb-2" style={{ fontSize: 10 }}>Requires restart to apply</p>
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
              <div className="p-3 pb-1"><div className="mc-section">Game Rules {!rulesLoaded && <span className="mc-dark-gray text-[9px] font-normal normal-case tracking-normal animate-pulse ml-1">Loading...</span>}</div></div>
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
                  status.playerList.map((name) => {
                    const d = transform(name, "gamertag");
                    return (
                    <div key={name} className="mc-row flex items-center justify-between px-3 py-2">
                      <div className="flex items-center gap-2">
                        <div className="mc-avatar">{d.charAt(0).toUpperCase()}</div>
                        <span className="mc-white text-xs">{d}</span>
                      </div>
                      <button className="mc-btn mc-btn-red text-xs px-2 py-0" onClick={() => handleKick(name)} disabled={busy !== null}>Kick</button>
                    </div>
                    );
                  })
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
                {allowlist.map((entry) => {
                  const perm = permissions.find((p) => p.name === entry.name)?.permission ?? "member";
                  const permColor = perm === "operator" ? "mc-gold" : perm === "visitor" ? "mc-dark-gray" : "mc-gray";
                  const d = transform(entry.name, "gamertag");
                  return (
                    <div key={entry.name} className="mc-row flex items-center justify-between px-3 py-2">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <div className="mc-avatar">{d.charAt(0).toUpperCase()}</div>
                        <div className="min-w-0">
                          <span className="mc-white text-xs">{d}</span>
                          <span className={`ml-2 uppercase ${permColor}`} style={{ fontSize: 8 }}>{perm}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <div className="relative">
                          <button className="mc-btn text-xs px-2 py-0" onClick={() => setPermMenuOpen(permMenuOpen === entry.name ? null : entry.name)} disabled={busy !== null}>⋯</button>
                          {permMenuOpen === entry.name && (
                            <div className="absolute right-0 top-full mt-1 z-10 mc-dark-panel border border-black/40 min-w-[110px]" style={{ boxShadow: "2px 2px 0 #000" }}>
                              {["visitor", "member", "operator"].map((lvl) => (
                                <button key={lvl} onClick={() => handleSetPermission(entry.name, lvl)}
                                  className={`w-full text-left px-3 py-1.5 text-xs capitalize hover:bg-white/10 ${perm === lvl ? "mc-gold" : "mc-white"}`}>
                                  {lvl}
                                </button>
                              ))}
                              <div className="border-t border-black/30 mt-1 pt-1">
                                <button onClick={() => { setPermMenuOpen(null); handleAllowlistRemove(entry.name); }}
                                  className="w-full text-left px-3 py-1.5 text-xs mc-red hover:bg-white/10">
                                  Remove
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {allowlist.length === 0 && <p className="mc-dark-gray text-xs px-3 pb-3">Empty</p>}
              </div>
            </div>
          </div>

          {/* Installed Add-ons */}
          <WorldAddons id={id} busy={busy} setBusy={setBusy} />
        </>
      )}

      {/* Restart confirmation modal */}
      {pendingChange && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.7)" }} onClick={() => setPendingChange(null)}>
          <div className="mc-dark-panel p-5 max-w-sm w-full mx-4" style={{ borderColor: "var(--mc-gold)", borderWidth: 2 }} onClick={(e) => e.stopPropagation()}>
            <div className="mc-gold text-xs font-bold uppercase tracking-wide mb-3">{pendingChange.type} Changed</div>
            <p className="mc-white text-sm mb-1">
              Set to <span className="mc-gold font-bold capitalize">{pendingChange.value}</span>
            </p>
            <p className="mc-dark-gray mb-4" style={{ fontSize: 11 }}>
              Restart the server for changes to take effect.
              {(status?.players ?? 0) > 0 && (
                <span className="mc-gold"> {status!.players} player{status!.players !== 1 ? "s" : ""} currently online.</span>
              )}
            </p>
            <div className="flex gap-2">
              <button
                className="mc-btn mc-btn-amber flex-1 text-xs py-2"
                onClick={() => { setPendingChange(null); handlePower("restart"); }}
                disabled={busy !== null}
              >
                Restart Now
              </button>
              <button
                className="mc-btn flex-1 text-xs py-2"
                onClick={() => { setPendingChange(null); toast("Restart when you're ready — changes are saved.", "info"); }}
              >
                Later
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

type AddonGroup = { primary: InstalledAddon; linked: InstalledAddon[] };

function groupAddons(addons: InstalledAddon[]): AddonGroup[] {
  const groups: Map<string, AddonGroup> = new Map();
  const ungrouped: InstalledAddon[] = [];

  // First pass: index by curseforge modId+fileId
  for (const addon of addons) {
    const key = addon.curseforge ? `${addon.curseforge.modId}_${addon.curseforge.fileId}` : null;
    if (!key) { ungrouped.push(addon); continue; }
    if (!groups.has(key)) {
      groups.set(key, { primary: addon, linked: [] });
    } else {
      const g = groups.get(key)!;
      // BP is always primary
      if (addon.packType === "behavior") {
        g.linked.push(g.primary);
        g.primary = addon;
      } else {
        g.linked.push(addon);
      }
    }
  }

  const result: AddonGroup[] = [...groups.values()];
  ungrouped.forEach((a) => result.push({ primary: a, linked: [] }));
  return result;
}

function WorldAddons({ id, busy, setBusy }: { id: string; busy: string | null; setBusy: (v: string | null) => void }) {
  const { toast } = useToast();
  const { data: addonsRaw, mutate } = useSWR(`/api/servers/${id}/addons`, fetcher, { refreshInterval: 10000 });
  const addons: InstalledAddon[] = Array.isArray(addonsRaw) ? addonsRaw : [];
  const groups = groupAddons(addons);

  async function handleToggle(group: AddonGroup) {
    const { primary, linked } = group;
    setBusy(`toggle-${primary.uuid}`);
    try {
      const all = [primary, ...linked];
      let ok = true;
      for (const addon of all) {
        const res = await fetch(`/api/servers/${id}/addons`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "toggle", uuid: addon.uuid, enabled: !primary.enabled }),
        });
        const result = await res.json();
        if (!result.success) { toast(result.error || "Toggle failed", "error"); ok = false; break; }
      }
      if (ok) { toast(`${primary.name} ${!primary.enabled ? "enabled" : "disabled"}. Restart to apply.`, "success"); mutate(); }
    } catch { toast("Network error", "error"); }
    finally { setBusy(null); }
  }

  async function handleRemove(group: AddonGroup) {
    const { primary, linked } = group;
    if (!confirm(`Remove "${primary.name}"? This will delete the pack files.`)) return;
    setBusy(`remove-${primary.uuid}`);
    toast("Removing...", "info");
    try {
      const all = [primary, ...linked];
      let ok = true;
      for (const addon of all) {
        const res = await fetch("/api/addons/remove", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ uuid: addon.uuid, worldId: id }),
        });
        const result = await res.json();
        if (!result.success) { toast(result.error || "Remove failed", "error"); ok = false; break; }
      }
      if (ok) { toast(`${primary.name} removed. Restart to apply.`, "success"); mutate(); }
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
        {groups.length === 0 && (
          <p className="mc-dark-gray text-xs p-4 text-center">No add-ons installed. Browse the library to get started.</p>
        )}

        {groups.map(({ primary, linked }) => (
          <div key={primary.uuid} className="mc-row flex items-center justify-between px-3 py-3">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div
                className={`mc-item-slot-sm ${primary.enabled ? "mc-glint" : ""}`}
                style={{
                  background: linked.length > 0 ? "#2a3a2a" : primary.packType === "behavior" ? "#2a4a2a" : "#2a2a4a",
                  borderColor: primary.enabled ? "#5a9e44 #2e5a22 #2e5a22 #5a9e44" : "#373737 #ffffff #ffffff #373737",
                }}
              >
                <span className="font-bold" style={{ fontSize: linked.length > 0 ? 7 : 10, color: "var(--mc-green)", lineHeight: 1.1, textAlign: "center" }}>
                  {linked.length > 0 ? "BP+RP" : primary.packType === "behavior" ? "BP" : "RP"}
                </span>
              </div>
              <div className="min-w-0">
                <div className={`text-xs truncate font-bold ${primary.enabled ? "mc-white" : "mc-dark-gray"}`}>
                  {primary.name || primary.uuid.slice(0, 8)}
                </div>
                <div className="mc-dark-gray flex items-center gap-2" style={{ fontSize: 9 }}>
                  <span className="mc-green" style={{ fontSize: 8 }}>
                    {linked.length > 0 ? "BEHAVIOR + RESOURCE" : primary.packType === "behavior" ? "BEHAVIOR" : "RESOURCE"}
                  </span>
                  <span>&middot;</span>
                  <span>v{(primary.version || []).join(".")}</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-4 flex-shrink-0 ml-2">
              <div className="flex flex-col items-end gap-1">
                <span className="mc-dark-gray" style={{ fontSize: 8 }}>{primary.enabled ? "ENABLED" : "DISABLED"}</span>
                <button
                  onClick={() => handleToggle({ primary, linked })}
                  disabled={busy !== null}
                  className={`mc-toggle ${primary.enabled ? "mc-toggle-on" : ""}`}
                >
                  <div className="mc-toggle-knob" />
                </button>
              </div>
              <button
                className="mc-btn mc-btn-red text-xs px-2 py-0 h-8 min-w-[32px]"
                onClick={() => handleRemove({ primary, linked })}
                disabled={busy !== null}
              >
                {busy === `remove-${primary.uuid}` ? "..." : "X"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

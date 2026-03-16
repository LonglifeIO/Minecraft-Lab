"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import useSWR from "swr";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";

const fetcher = (url: string) => fetch(url).then((r) => {
  if (r.status === 401) throw new Error("unauthorized");
  return r.json();
});

interface WorldData {
  status: {
    online: boolean;
    players: number;
    maxPlayers: number;
    playerList: string[];
    version: string;
    worldName: string;
    difficulty: string;
    gamemode: string;
  };
  allowlist: Array<{ name: string; ignoresPlayerLimit?: boolean }>;
}

interface GameRule {
  id: string;
  label: string;
  description: string;
}

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
  { id: "respawnBlocksExplode", label: "Respawn Block Explosions", description: "Beds/anchors explode in wrong dimension" },
  { id: "showDeathMessages", label: "Death Messages", description: "Show death messages in chat" },
  { id: "doTileDrops", label: "Block Drops", description: "Blocks drop items when broken" },
];

export default function WorldPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const [busy, setBusy] = useState<string | null>(null);
  const [newPlayer, setNewPlayer] = useState("");
  const [ruleStates, setRuleStates] = useState<Record<string, boolean>>({});
  const [rulesLoaded, setRulesLoaded] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const { data, error, isLoading, mutate } = useSWR<WorldData>(
    `/api/servers/${id}`,
    fetcher,
    {
      refreshInterval: 5000,
      onError: (err) => { if (err.message === "unauthorized") router.push("/login"); },
    },
  );

  const status = data?.status;
  const allowlist = data?.allowlist || [];

  async function action(actionName: string, body?: Record<string, string>) {
    setBusy(actionName);
    try {
      const res = await fetch(`/api/servers/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: actionName, ...body }),
      });
      const result = await res.json();
      if (!res.ok) {
        alert(result.error || "Action failed");
      }
      setTimeout(() => mutate(), 1500);
    } catch {
      alert("Network error");
    } finally {
      setBusy(null);
    }
  }

  async function handlePower(type: string) {
    if (type === "stop" || type === "restart") {
      if (!confirm(`Are you sure you want to ${type} the server?`)) return;
    }
    await action(type);
  }

  async function handleGamemode(mode: string) {
    await action("command", { command: `gamemode ${mode} @a` });
  }

  async function handleDifficulty(level: string) {
    await action("difficulty", { level });
  }

  async function handleGamerule(rule: string, value: boolean) {
    setRuleStates((prev) => ({ ...prev, [rule]: value }));
    await action("command", { command: `gamerule ${rule} ${value}` });
  }

  async function handleKick(name: string) {
    if (!confirm(`Kick ${name} from the server?`)) return;
    await action("kick", { name });
  }

  async function handleAllowlistAdd() {
    const name = newPlayer.trim();
    if (!name) return;
    await action("allowlist_add", { name });
    setNewPlayer("");
  }

  async function handleAllowlistRemove(name: string) {
    if (!confirm(`Remove ${name} from the allowlist?`)) return;
    await action("allowlist_remove", { name });
  }

  async function handleBackup() {
    if (!confirm("Create a backup? The server may lag briefly.")) return;
    setBusy("backup");
    try {
      const res = await fetch(`/api/servers/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "backup" }),
      });
      const result = await res.json();
      if (result.success) {
        alert(`Backup created: ${result.filename}`);
      } else {
        alert(`Backup failed: ${result.error}`);
      }
    } catch {
      alert("Backup failed: network error");
    } finally {
      setBusy(null);
    }
  }

  // Load initial game rule states from the server
  async function loadGamerules() {
    if (rulesLoaded || !status?.online) return;
    try {
      const res = await fetch(`/api/servers/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "gamerules" }),
      });
      const result = await res.json();
      if (result.rules) {
        setRuleStates(result.rules);
        setRulesLoaded(true);
      }
    } catch {
      // Fall back to defaults
    }
  }

  // Load gamerules when server is online
  if (status?.online && !rulesLoaded) {
    loadGamerules();
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen text-zinc-500">
        Loading...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <p className="text-red-400">Failed to load server data</p>
        <Link href="/"><Button variant="outline">Back to Dashboard</Button></Link>
      </div>
    );
  }

  const online = status?.online ?? false;

  return (
    <div className="min-h-screen p-4 sm:p-6 max-w-2xl mx-auto pb-20">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link href="/" className="text-zinc-400 hover:text-zinc-200 text-lg">
          &larr;
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-bold">{status?.worldName || id}</h1>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant={online ? "success" : "destructive"}>
              {online ? "Online" : "Offline"}
            </Badge>
            {online && (
              <span className="text-sm text-zinc-400">
                {status?.players}/{status?.maxPlayers} players &middot; v{status?.version}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Power Controls */}
      <section className="mb-6">
        <div className="flex gap-2">
          {online ? (
            <>
              <Button variant="destructive" className="flex-1" onClick={() => handlePower("stop")} disabled={busy !== null}>
                {busy === "stop" ? "Stopping..." : "Stop"}
              </Button>
              <Button variant="warning" className="flex-1" onClick={() => handlePower("restart")} disabled={busy !== null}>
                {busy === "restart" ? "Restarting..." : "Restart"}
              </Button>
              <Button variant="primary" className="flex-1" onClick={handleBackup} disabled={busy !== null}>
                {busy === "backup" ? "Backing up..." : "Backup"}
              </Button>
            </>
          ) : (
            <Button variant="success" size="lg" className="w-full" onClick={() => handlePower("start")} disabled={busy !== null}>
              {busy === "start" ? "Starting..." : "Start Server"}
            </Button>
          )}
        </div>
      </section>

      {online && (
        <>
          {/* Game Mode */}
          <section className="mb-6">
            <h2 className="text-sm font-medium text-zinc-400 mb-2">Game Mode</h2>
            <p className="text-xs text-zinc-600 mb-2">Changes all players currently online. New players joining later will use the default from server settings.</p>
            <div className="flex gap-2">
              {[
                { id: "survival", label: "Survival" },
                { id: "creative", label: "Creative" },
                { id: "adventure", label: "Adventure" },
              ].map((mode) => (
                <Button
                  key={mode.id}
                  variant={status?.gamemode === mode.id ? "primary" : "outline"}
                  size="sm"
                  className="flex-1"
                  onClick={() => handleGamemode(mode.id)}
                  disabled={busy !== null}
                >
                  {mode.label}
                </Button>
              ))}
            </div>
          </section>

          {/* Difficulty */}
          <section className="mb-6">
            <h2 className="text-sm font-medium text-zinc-400 mb-2">Difficulty</h2>
            <div className="flex gap-2">
              {["peaceful", "easy", "normal", "hard"].map((d) => (
                <Button
                  key={d}
                  variant={status?.difficulty === d ? "primary" : "outline"}
                  size="sm"
                  className="flex-1 capitalize"
                  onClick={() => handleDifficulty(d)}
                  disabled={busy !== null}
                >
                  {d}
                </Button>
              ))}
            </div>
          </section>

          {/* Game Rules — Realms-style toggles */}
          <section className="mb-6">
            <h2 className="text-sm font-medium text-zinc-400 mb-3">Game Rules</h2>
            <Card>
              <CardContent className="p-0">
                <div className="divide-y divide-zinc-800/50">
                  {BASIC_RULES.map((rule) => {
                    const isOn = ruleStates[rule.id] ?? true;
                    return (
                      <div key={rule.id} className="flex items-center justify-between px-4 py-3">
                        <div className="flex-1 mr-3">
                          <div className="text-sm font-medium text-zinc-200">{rule.label}</div>
                          <div className="text-xs text-zinc-500">{rule.description}</div>
                        </div>
                        <button
                          onClick={() => handleGamerule(rule.id, !isOn)}
                          disabled={busy !== null}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${
                            isOn ? "bg-emerald-600" : "bg-zinc-700"
                          }`}
                        >
                          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${isOn ? "translate-x-6" : "translate-x-1"}`} />
                        </button>
                      </div>
                    );
                  })}
                </div>

                {/* Advanced toggle */}
                <button
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="flex items-center justify-between w-full px-4 py-3 border-t border-zinc-800 text-sm text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/30 transition-colors"
                >
                  <span>Advanced</span>
                  <span className={`transition-transform ${showAdvanced ? "rotate-180" : ""}`}>&#9660;</span>
                </button>

                {showAdvanced && (
                  <div className="divide-y divide-zinc-800/50 border-t border-zinc-800">
                    {ADVANCED_RULES.map((rule) => {
                      const isOn = ruleStates[rule.id] ?? true;
                      return (
                        <div key={rule.id} className="flex items-center justify-between px-4 py-3">
                          <div className="flex-1 mr-3">
                            <div className="text-sm font-medium text-zinc-200">{rule.label}</div>
                            <div className="text-xs text-zinc-500">{rule.description}</div>
                          </div>
                          <button
                            onClick={() => handleGamerule(rule.id, !isOn)}
                            disabled={busy !== null}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${
                              isOn ? "bg-emerald-600" : "bg-zinc-700"
                            }`}
                          >
                            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${isOn ? "translate-x-6" : "translate-x-1"}`} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </section>

          {/* Online Players */}
          <section className="mb-6">
            <h2 className="text-sm font-medium text-zinc-400 mb-2">
              Players Online ({status?.players || 0})
            </h2>
            {status?.playerList && status.playerList.length > 0 ? (
              <Card>
                <CardContent className="p-3">
                  <div className="divide-y divide-zinc-800">
                    {status.playerList.map((name) => (
                      <div key={name} className="flex items-center justify-between py-2">
                        <span className="text-sm font-medium">{name}</span>
                        <Button variant="destructive" size="sm" onClick={() => handleKick(name)} disabled={busy !== null}>
                          Kick
                        </Button>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ) : (
              <p className="text-sm text-zinc-600">No players online</p>
            )}
          </section>
        </>
      )}

      {/* Allowlist */}
      <section className="mb-6">
        <h2 className="text-sm font-medium text-zinc-400 mb-2">Allowlist</h2>
        <div className="flex gap-2 mb-3">
          <Input
            placeholder="Gamertag"
            value={newPlayer}
            onChange={(e) => setNewPlayer(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAllowlistAdd()}
          />
          <Button variant="primary" onClick={handleAllowlistAdd} disabled={busy !== null || !newPlayer.trim()}>
            Add
          </Button>
        </div>
        {allowlist.length > 0 ? (
          <Card>
            <CardContent className="p-3">
              <div className="divide-y divide-zinc-800">
                {allowlist.map((entry) => (
                  <div key={entry.name} className="flex items-center justify-between py-2">
                    <span className="text-sm">{entry.name}</span>
                    <Button variant="ghost" size="sm" className="text-red-400 hover:text-red-300" onClick={() => handleAllowlistRemove(entry.name)} disabled={busy !== null}>
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ) : (
          <p className="text-sm text-zinc-600">Allowlist is empty</p>
        )}
      </section>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import useSWR from "swr";
import Link from "next/link";
import { useToast } from "@/components/toast";
import { WorldIcon } from "@/components/world-icon";
import { useDemoMode } from "@/lib/demoMode";
import { copyText } from "@/lib/copy";

interface InstalledAddon {
  uuid: string;
  name: string;
  description: string;
  version: number[] | string;
  type: string;
  packType: string;
  enabled: boolean;
  curseforge: { modId: number; fileId: number } | null;
}

const fetcher = (url: string) => fetch(url).then((r) => { if (r.status === 401) throw new Error("unauthorized"); return r.json(); });

interface WorldInfo {
  seed: string | null;
  ip: string | null;
  gamePort: number;
  externalPort: number | null;
  publicIp: string | null;
  xbox?: { account: string; service: string; active: boolean; gamertag: string | null } | null;
}

interface BackupsData {
  enabled?: boolean; // nightly job includes this world (host-side flag)
  daily: Array<{ filename: string; sizeBytes: number; modified: number }>;
  safety?: Array<{ filename: string; sizeBytes: number; modified: number }>;
  manual: Array<{ filename: string; size: number; date: string }>;
  lastRun: string | null;
  lastStatus: string | null;
  keep: number | null;
  schedule: string | null;
}

function formatBytes(n: number): string {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

interface WorldData {
  status: { online: boolean; players: number; maxPlayers: number; playerList: string[]; version: string; worldName: string; difficulty: string; gamemode: string; hardcore?: boolean; achievements?: boolean | null; betaApis?: boolean | null };
  allowlist: Array<{ name: string; xuid?: string; ignoresPlayerLimit?: boolean }>;
  permissions: Array<{ xuid: string; permission: string; name?: string }>;
  gamerules?: Record<string, boolean>;
  restartPending?: boolean;
  importing?: boolean;
  info?: WorldInfo;
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

// Hidden "Powers" panel: potion effects the game grants with /effect, one player at a time.
// 999999 s is the longest duration the command accepts; "true" hides the particle swirl.
const POWERS: Array<{ id: string; label: string; effect: string; amp: number; blurb: string }> = [
  { id: "speed", label: "Super speed", effect: "speed", amp: 2, blurb: "Speed III" },
  { id: "jump", label: "Super jump", effect: "jump_boost", amp: 2, blurb: "Jump Boost III" },
  { id: "strength", label: "Super strength", effect: "strength", amp: 2, blurb: "Strength III" },
  { id: "regen", label: "Fast healing", effect: "regeneration", amp: 2, blurb: "Regeneration III" },
  { id: "resist", label: "Tough skin", effect: "resistance", amp: 2, blurb: "Resistance III" },
  { id: "haste", label: "Fast digging", effect: "haste", amp: 1, blurb: "Haste II" },
  { id: "night", label: "Night vision", effect: "night_vision", amp: 0, blurb: "See in the dark" },
  { id: "fire", label: "Fireproof", effect: "fire_resistance", amp: 0, blurb: "Lava and fire can't hurt" },
  { id: "water", label: "Gills", effect: "water_breathing", amp: 0, blurb: "Breathe under water" },
  { id: "feather", label: "Feather fall", effect: "slow_falling", amp: 0, blurb: "Float down, no fall damage" },
  { id: "hearts", label: "Extra hearts", effect: "health_boost", amp: 4, blurb: "+10 hearts" },
  { id: "invis", label: "Invisible", effect: "invisibility", amp: 0, blurb: "Mobs and players can't see you" },
  { id: "conduit", label: "Water master", effect: "conduit_power", amp: 0, blurb: "Breathe, see and mine fast underwater" },
];

// Combos and items. "$P" is replaced by the quoted gamertag; commands run in order.
// No "~" coordinates anywhere: the per-world API's command filter does not allow them.
const TRICKS: Array<{ id: string; label: string; blurb: string; cmds: string[]; undo?: string[] }> = [
  { id: "moon", label: "Moon jump", blurb: "Jump ~8 blocks, no fall damage (damage-proof while on)", cmds: ["effect $P jump_boost 999999 4 true", "effect $P resistance 999999 4 true"], undo: ["effect $P jump_boost 0", "effect $P resistance 0"] },
  { id: "bullet", label: "Bullet time", blurb: "Mobs near you crawl for 30 s, you get Speed III", cmds: ["execute as $P at @s run effect @e[type=!player,r=25] slowness 30 5 true", "effect $P speed 30 2 true"] },
  { id: "float", label: "Float up", blurb: "8 s of levitation", cmds: ["effect $P levitation 8 1 true"] },
  { id: "heal", label: "Full heal", blurb: "Health and hunger refilled", cmds: ["effect $P instant_health 1 5 true", "effect $P saturation 1 5 true"] },
  { id: "wings", label: "Wings", blurb: "Elytra + 64 rockets (equip, jump twice, boost)", cmds: ["give $P elytra 1", "give $P firework_rocket 64"], undo: ["clear $P elytra", "clear $P firework_rocket"] },
  { id: "pearls", label: "Ender pearls", blurb: "16 pearls: throw one to teleport", cmds: ["give $P ender_pearl 16"], undo: ["clear $P ender_pearl"] },
];

// More per-player fun, same shape as TRICKS. "Bring everyone here" is the one that touches other players.
const FUN: Array<{ id: string; label: string; blurb: string; cmds: string[]; undo?: string[] }> = [
  { id: "ghost", label: "Ghost mode", blurb: "Fly through walls, unseen (spectator)", cmds: ["gamemode spectator $P"], undo: ["gamemode survival $P"] },
  { id: "suit", label: "Suit up", blurb: "Diamond armour, sword and pickaxe", cmds: ["give $P diamond_helmet 1", "give $P diamond_chestplate 1", "give $P diamond_leggings 1", "give $P diamond_boots 1", "give $P diamond_sword 1", "give $P diamond_pickaxe 1"], undo: ["clear $P diamond_helmet", "clear $P diamond_chestplate", "clear $P diamond_leggings", "clear $P diamond_boots", "clear $P diamond_sword", "clear $P diamond_pickaxe"] },
  { id: "totem", label: "Second life", blurb: "Totem of Undying: hold it to survive one death", cmds: ["give $P totem_of_undying 1"], undo: ["clear $P totem_of_undying"] },
  { id: "snacks", label: "Snacks", blurb: "8 golden apples + 1 enchanted one", cmds: ["give $P golden_apple 8", "give $P enchanted_golden_apple 1"] },
  { id: "levels", label: "+30 levels", blurb: "Experience for enchanting", cmds: ["xp 30L $P"] },
  { id: "golem", label: "Bodyguard", blurb: "An iron golem appears beside you and fights hostile mobs", cmds: ["execute as $P at @s run summon iron_golem"] },
  { id: "wolf", label: "Pet wolf", blurb: "A wolf appears; feed it the bones to tame it", cmds: ["execute as $P at @s run summon wolf", "give $P bone 8"] },
  { id: "horse", label: "Horse + saddle", blurb: "Ride it a few times to tame it, then saddle it", cmds: ["execute as $P at @s run summon horse", "give $P saddle 1"] },
  { id: "fireworks", label: "Fireworks", blurb: "Three rockets go up where you stand", cmds: ["execute as $P at @s run summon fireworks_rocket", "execute as $P at @s run summon fireworks_rocket", "execute as $P at @s run summon fireworks_rocket"] },
  { id: "fog", label: "Spooky fog", blurb: "Nether-red haze, only on your screen", cmds: ["fog $P push minecraft:fog_hell spooky"], undo: ["fog $P pop spooky"] },
  { id: "respawn", label: "Respawn here", blurb: "Your next respawn is where you stand now", cmds: ["spawnpoint $P"] },
  { id: "shake", label: "Earthquake", blurb: "3 seconds of screen shake, just for you", cmds: ["camerashake add $P 0.6 3 positional"] },
  { id: "roar", label: "Dragon roar", blurb: "Only you hear it", cmds: ["playsound mob.enderdragon.growl $P"] },
  { id: "everyone", label: "Bring everyone here", blurb: "Teleports all players to you", cmds: ["tp @a $P"] },
];

// Best gear: the game can't give enchanted items directly, so put the item into the selected hotbar
// slot (keep = never overwrite what's there) and stack the enchantments onto it.
const GEAR: Array<{ id: string; label: string; blurb: string; cmds: string[] }> = [
  { id: "bow", label: "Best bow", blurb: "Infinity, Power V, Punch II, Flame, Unbreaking III (+1 arrow)", cmds: ["replaceitem entity $P slot.weapon.mainhand 0 keep bow 1", "enchant $P infinity 1", "enchant $P power 5", "enchant $P punch 2", "enchant $P flame 1", "enchant $P unbreaking 3", "give $P arrow 1"] },
  { id: "sword", label: "Best sword", blurb: "Diamond: Sharpness V, Looting III, Fire Aspect II, Unbreaking III", cmds: ["replaceitem entity $P slot.weapon.mainhand 0 keep diamond_sword 1", "enchant $P sharpness 5", "enchant $P looting 3", "enchant $P fire_aspect 2", "enchant $P unbreaking 3"] },
  { id: "pick", label: "Best pickaxe", blurb: "Diamond: Efficiency V, Fortune III, Unbreaking III", cmds: ["replaceitem entity $P slot.weapon.mainhand 0 keep diamond_pickaxe 1", "enchant $P efficiency 5", "enchant $P fortune 3", "enchant $P unbreaking 3"] },
  { id: "trident", label: "Riptide trident", blurb: "Riptide III launches you through water or rain; Impaling V", cmds: ["replaceitem entity $P slot.weapon.mainhand 0 keep trident 1", "enchant $P riptide 3", "enchant $P impaling 5", "enchant $P unbreaking 3"] },
  { id: "helmet", label: "Netherite helmet", blurb: "Protection IV, Unbreaking III, Respiration III, Aqua Affinity, Mending", cmds: ["replaceitem entity $P slot.weapon.mainhand 0 keep netherite_helmet 1", "enchant $P protection 4", "enchant $P unbreaking 3", "enchant $P respiration 3", "enchant $P aqua_affinity 1", "enchant $P mending 1"] },
  { id: "chest", label: "Netherite chestplate", blurb: "Protection IV, Unbreaking III, Thorns III, Mending", cmds: ["replaceitem entity $P slot.weapon.mainhand 0 keep netherite_chestplate 1", "enchant $P protection 4", "enchant $P unbreaking 3", "enchant $P thorns 3", "enchant $P mending 1"] },
  { id: "legs", label: "Netherite leggings", blurb: "Protection IV, Unbreaking III, Swift Sneak III, Mending", cmds: ["replaceitem entity $P slot.weapon.mainhand 0 keep netherite_leggings 1", "enchant $P protection 4", "enchant $P unbreaking 3", "enchant $P swift_sneak 3", "enchant $P mending 1"] },
  { id: "boots", label: "Netherite boots", blurb: "Protection IV, Unbreaking III, Feather Falling IV, Depth Strider III, Mending", cmds: ["replaceitem entity $P slot.weapon.mainhand 0 keep netherite_boots 1", "enchant $P protection 4", "enchant $P unbreaking 3", "enchant $P feather_falling 4", "enchant $P depth_strider 3", "enchant $P mending 1"] },
];

// Pranks: short, harmless, aimed at the selected player, over in seconds
const PRANKS: Array<{ id: string; label: string; blurb: string; cmds: string[] }> = [
  { id: "wobbly", label: "Wobbly", blurb: "12 s of nausea", cmds: ["effect $P nausea 12 1 true"] },
  { id: "lightsout", label: "Lights out", blurb: "6 s of blindness", cmds: ["effect $P blindness 6 0 true"] },
  { id: "yoink", label: "Yoink", blurb: "Sudden lift, soft landing", cmds: ["effect $P slow_falling 8 0 true", "effect $P levitation 2 3 true"] },
  { id: "blackout", label: "Blackout", blurb: "3 s black screen", cmds: ["camera $P fade time 0.3 2.5 0.3"] },
  { id: "redflash", label: "Red flash", blurb: "A quick red flash", cmds: ["camera $P fade time 0.1 0.4 0.5 color 200 0 0"] },
  { id: "scream", label: "Ghast scream", blurb: "Only they hear it", cmds: ["playsound mob.ghast.scream $P"] },
  { id: "fakedeath", label: "Fake death", blurb: "\"You died!\" on their screen", cmds: ["camera $P fade time 0.1 0.6 0.6 color 120 0 0", "title $P title You died!"] },
  { id: "chickens", label: "Chicken rain", blurb: "Five chickens appear on them", cmds: ["execute as $P at @s run summon chicken", "execute as $P at @s run summon chicken", "execute as $P at @s run summon chicken", "execute as $P at @s run summon chicken", "execute as $P at @s run summon chicken"] },
];

// Silent buffs for everyone EXCEPT the selected player ($N = their bare name inside the selector).
// Hidden particles, no message: nobody notices unless they look at their effect icons.
const SILENT: Array<{ id: string; label: string; blurb: string; cmds: string[]; undo?: string[] }> = [
  { id: "s_tough", label: "Quiet toughness", blurb: "Resistance II: they take 40% less damage and never know", cmds: ['effect @a[name=!"$N"] resistance 999999 1 true'], undo: ['effect @a[name=!"$N"] resistance 0'] },
];

type Reply = { ok: boolean; reply: string };

// What the panel switched on for a player, remembered per world and player in this browser. The game
// has no command that lists a player's effects, so this is the panel's own bookkeeping, corrected by
// every reply (and wiped by Reset, e.g. after a death removed everything).
function activeKey(worldId: string, player: string) { return `mc-powers-active:${worldId}:${player}`; }
function loadActive(worldId: string, player: string): Set<string> {
  try { const raw = window.localStorage.getItem(activeKey(worldId, player)); const arr = raw ? JSON.parse(raw) : []; return new Set(Array.isArray(arr) ? arr : []); } catch { return new Set(); }
}
function saveActive(worldId: string, player: string, set: Set<string>) {
  try { window.localStorage.setItem(activeKey(worldId, player), JSON.stringify([...set])); } catch { /* ignore */ }
}

// Abilities from the "Superpowers" script pack (mods/superpowers). The pack reads these tags every
// tick, so toggling needs no restart once the pack is installed in the world.
const SCRIPT_POWERS: Array<{ tag: string; label: string; blurb: string }> = [
  { tag: "sp_doublejump", label: "Double jump", blurb: "Tap jump again in mid-air" },
  { tag: "sp_chargejump", label: "Charge jump", blurb: "Hold sneak on the ground, let go to launch" },
  { tag: "sp_momentum", label: "Momentum jump", blurb: "The faster you run, the higher you jump" },
  { tag: "sp_dash", label: "Dash", blurb: "Tap sneak twice quickly" },
  { tag: "sp_slam", label: "Ground slam", blurb: "Sneak while falling; shockwave on landing (swaps out Power slide)" },
  { tag: "sp_slide", label: "Power slide", blurb: "Sneak while sprinting, or hold sneak as you land, to skid along the ground (swaps out Ground slam)" },
  { tag: "sp_freeze", label: "Time freeze", blurb: "Mobs and arrows near you stop (Matrix mode)" },
  { tag: "sp_climb", label: "Spider climb", blurb: "Sneak while facing a wall" },
  { tag: "sp_punch", label: "Super punch", blurb: "Your hits send mobs flying" },
  { tag: "sp_pull", label: "Force pull", blurb: "Sneak while looking at a mob" },
];
// Powers that read the same input (hold sneak into a landing) and can't both be on: turning one on
// takes the other off.
const EXCLUSIVE_POWERS: Record<string, string> = { sp_slide: "sp_slam", sp_slam: "sp_slide" };

// Escape closes whatever is open (dialogs, menus)
function useEscape(active: boolean, onEscape: () => void) {
  useEffect(() => {
    if (!active) return;
    function handler(e: KeyboardEvent) { if (e.key === "Escape") onEscape(); }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [active, onEscape]);
}

function McToggle({ on, onChange, disabled, label }: { on: boolean; onChange: () => void; disabled?: boolean; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={onChange} disabled={disabled} className={`mc-toggle ${on ? "mc-toggle-on" : ""}`}>
      <div className="mc-toggle-knob" />
    </button>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const { toast } = useToast();
  return (
    <button
      type="button"
      className="mc-textbtn"
      aria-label={`Copy ${label}`}
      onClick={async () => { const ok = await copyText(value); toast(ok ? `${label} copied` : "Couldn't copy — select it and copy by hand", ok ? "success" : "error"); }}
    >
      Copy
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
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [pendingChange, setPendingChange] = useState<{ type: string; value: string } | null>(null);
  const [powersOpen, setPowersOpen] = useState(false);
  const [powersPlayer, setPowersPlayer] = useState<string | null>(null);
  const [consoleOpen, setConsoleOpen] = useState(false);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
      if (e.key === "/" && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); setConsoleOpen(true); }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  useEscape(consoleOpen, () => setConsoleOpen(false));

  const { data, error, isLoading, mutate } = useSWR<WorldData>(`/api/servers/${id}`, fetcher, {
    refreshInterval: 5000, onError: (err) => { if (err.message === "unauthorized") router.push("/login"); },
  });
  const status = data?.status;
  const info = data?.info;
  const allowlist = data?.allowlist || [];
  const permissions = data?.permissions || [];
  const [permMenuOpen, setPermMenuOpen] = useState<string | null>(null);
  const permMenuRef = useRef<HTMLDivElement>(null);
  // Default to true while loading so the full UI renders immediately
  const online = status?.online ?? (isLoading ? true : false);

  useEffect(() => {
    try { if (window.localStorage.getItem("mc-powers") === "1") setPowersOpen(true); } catch { /* ignore */ }
  }, []);
  function togglePowers() {
    const next = !powersOpen;
    setPowersOpen(next);
    try { window.localStorage.setItem("mc-powers", next ? "1" : "0"); } catch { /* ignore */ }
    toast(next ? "Superpowers unlocked" : "Superpowers hidden", "info");
  }

  useEscape(permMenuOpen !== null, () => setPermMenuOpen(null));
  useEscape(pendingChange !== null, () => setPendingChange(null));
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (permMenuRef.current && !permMenuRef.current.contains(e.target as Node)) setPermMenuOpen(null);
    }
    if (permMenuOpen !== null) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [permMenuOpen]);

  async function action(name: string, body?: Record<string, string>) {
    setBusy(name);
    try {
      const res = await fetch(`/api/servers/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: name, ...body }) });
      const result = await res.json();
      if (!res.ok) toast(result.error || "Failed", "error");
      setTimeout(() => mutate(), 1500);
      return result;
    } catch { toast("Couldn't reach the dashboard server", "error"); } finally { setBusy(null); }
  }

  async function handlePower(type: string) {
    if (type === "stop" || type === "restart") {
      const players = status?.players ?? 0;
      const warn = players > 0 ? ` ${players} player${players === 1 ? " is" : "s are"} online and will be disconnected.` : "";
      if (!confirm(`${type.charAt(0).toUpperCase() + type.slice(1)} this world?${warn}`)) return;
    }
    toast(type === "start" ? "Starting world..." : type === "stop" ? "Stopping..." : "Restarting...", "info");
    await action(type);
    if (type === "restart" || type === "start") {
      setTimeout(() => mutate(), 5000);
      setTimeout(() => mutate(), 8000);
    }
  }
  async function handleGamemode(mode: string) {
    if (mode === "creative" && status?.achievements === true && !confirm("Making Creative this world's game mode turns achievements OFF for the whole world once anyone plays in it. Getting them back needs the Achievements toggle and a restart. Continue?")) return;
    toast(`Setting game mode to ${mode}...`, "info");
    const result = await action("gamemode", { mode });
    if (result?.success) setPendingChange({ type: "Game mode", value: mode });
  }
  async function handleDifficulty(level: string) {
    toast(`Setting difficulty to ${level}...`, "info");
    const result = await action("difficulty", { level });
    if (result?.success) setPendingChange({ type: "Difficulty", value: level });
  }
  async function handleHardcore(enabled: boolean) {
    if (enabled && !confirm("Enable Hardcore Mode? Players who die will be locked to spectator for this world. The world will briefly restart now.")) return;
    setBusy("hardcore");
    toast(enabled ? "Enabling hardcore — world is restarting..." : "Disabling hardcore — world is restarting...", "info");
    try {
      const res = await fetch(`/api/servers/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "hardcore", enabled }) });
      const result = await res.json();
      if (result?.success) {
        toast(`Hardcore ${enabled ? "enabled" : "disabled"}`, "success");
      } else {
        toast(result?.error || "Failed to toggle hardcore", "error");
      }
    } catch {
      toast("Couldn't reach the dashboard server", "error");
    } finally {
      setBusy(null);
      // Give BDS a moment to come back, then refresh status.
      setTimeout(() => mutate(), 2000);
      setTimeout(() => mutate(), 6000);
    }
  }
  async function handleBetaApis(enabled: boolean) {
    const players = status?.players ?? 0;
    const who = players > 0 ? ` ${players} player${players === 1 ? " is" : "s are"} online and will be disconnected for about 30 seconds.` : "";
    const msg = enabled
      ? `Turn on Beta APIs? Some add-ons need this Mojang experiment to work. It restarts the world now, and the game switches achievements off for a world once an experiment has been used.${who}`
      : `Turn off Beta APIs? Add-ons that need it will stop working. The world restarts now.${who}`;
    if (!confirm(msg)) return;
    setBusy("betaApis");
    toast(enabled ? "Turning on Beta APIs — world is restarting..." : "Turning off Beta APIs — world is restarting...", "info");
    try {
      const res = await fetch(`/api/servers/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "betaApis", enabled }) });
      const result = await res.json();
      if (result?.success) toast(`Beta APIs ${enabled ? "on" : "off"}`, "success");
      else toast(result?.error || "Failed to change Beta APIs", "error");
    } catch {
      toast("Couldn't reach the dashboard server", "error");
    } finally {
      setBusy(null);
      setTimeout(() => mutate(), 2000);
      setTimeout(() => mutate(), 6000);
    }
  }
  async function handleAchievements(enabled: boolean) {
    const players = status?.players ?? 0;
    const who = players > 0 ? ` ${players} player${players === 1 ? " is" : "s are"} online and will be disconnected for about 30 seconds.` : "";
    const msg = enabled
      ? `Turn achievements on? This switches cheats off for this world, clears its creative flag and restarts the world now.${who} Using Fly (creative mode) from Superpowers switches achievements off again.`
      : `Turn achievements off? This switches cheats on for this world and restarts it now.${who}`;
    if (!confirm(msg)) return;
    setBusy("achievements");
    toast(enabled ? "Enabling achievements — world is restarting..." : "Disabling achievements — world is restarting...", "info");
    try {
      const res = await fetch(`/api/servers/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "achievements", enabled }) });
      const result = await res.json();
      if (result?.success) toast(`Achievements ${enabled ? "enabled" : "disabled"}`, "success");
      else toast(result?.error || "Failed to change achievements", "error");
    } catch {
      toast("Couldn't reach the dashboard server", "error");
    } finally {
      setBusy(null);
      setTimeout(() => mutate(), 2000);
      setTimeout(() => mutate(), 6000);
    }
  }
  async function handleSky(command: string, label: string) {
    const r = await action("command", { command });
    const reply = String(r?.output ?? "").replace(/^\[.*?\]\s*(INFO|ERROR)\]?\s*/i, "").trim();
    if (r && !r.error && !/error|unknown|syntax/i.test(String(r?.output ?? ""))) toast(label, "success");
    else if (reply) toast(reply, "error");
  }
  async function handleGamerule(rule: string, val: boolean) {
    // Optimistically flip the toggle in SWR's cache, fire the BDS command, then
    // revalidate. bds-api's gamerules cache is busted server-side when /command
    // writes a gamerule, so the next fetch returns the real state.
    mutate(prev => prev ? { ...prev, gamerules: { ...(prev.gamerules || {}), [rule]: val } } : prev, { revalidate: false });
    await action("command", { command: `gamerule ${rule} ${val}` });
    setTimeout(() => mutate(), 500);
  }
  async function handleKick(name: string) { const d = transform(name, "gamertag"); if (!confirm(`Kick ${d}?`)) return; await action("kick", { name }); toast(`${d} kicked`, "success"); }
  async function handleAllowlistAdd() { const n = newPlayer.trim(); if (!n) return; await action("allowlist_add", { name: n }); setNewPlayer(""); toast(`${transform(n, "gamertag")} added`, "success"); }
  async function handleSetPermission(name: string, permission: string) {
    setPermMenuOpen(null);
    const res = await fetch(`/api/servers/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "set_permission", name, permission }) });
    const result = await res.json();
    if (result.success) { toast(`${transform(name, "gamertag")} → ${permission}`, "success"); mutate(); }
    else toast(result.error || "Failed", "error");
  }
  async function handleAllowlistRemove(name: string) { const d = transform(name, "gamertag"); if (!confirm(`Remove ${d} from the allowlist?`)) return; await action("allowlist_remove", { name }); toast(`${d} removed`, "success"); }

  const ruleStates = data?.gamerules || {};
  const rulesLoaded = data?.gamerules !== undefined;

  // Show UI immediately — default to "online" so controls are visible while loading
  const loading = isLoading && !data;
  const importing = data?.importing === true;
  const title = status?.worldName ? transform(status.worldName, "worldName") : transform(id, "worldId");

  function RuleRow({ rule }: { rule: GameRule }) {
    const isOn = ruleStates[rule.id] ?? false;
    return (
      <div className="mc-row flex items-center justify-between px-3 py-2.5">
        <div className="flex-1 mr-3">
          <div className="mc-white text-sm">{rule.label}</div>
          <div className="mc-note">{rule.description}</div>
        </div>
        <McToggle on={isOn} label={rule.label} onChange={() => handleGamerule(rule.id, !isOn)} disabled={busy !== null || loading} />
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 sm:p-6 max-w-5xl mx-auto pb-20">
      {/* Title bar */}
      <header className="mc-dark-panel px-4 py-3 mb-6 border-b-2 border-black/20">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-4 min-w-0">
            <Link href="/" className="mc-btn mc-btn-sm">&larr; Worlds</Link>
            <div className="mc-avatar mc-avatar-lg" aria-hidden="true" style={{ padding: 0, overflow: "hidden", flexShrink: 0 }}>
              <WorldIcon id={id} seed={info?.seed} />
            </div>
            <div className="flex flex-col min-w-0">
              <h1 className="mc-title text-xl tracking-tight leading-tight break-words">{title}</h1>
              <span className="mc-note mt-1">World dashboard · {transform(id, "worldId")}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link href={`/world/${id}/map`} className="mc-btn mc-btn-sm">Map</Link>
            <span className={`mc-chip ${online ? "mc-chip-on" : "mc-chip-off"}`}>{loading ? "Loading" : online ? "Online" : "Stopped"}</span>
          </div>
        </div>
      </header>

      {error && !data && (
        <div className="mc-dark-panel p-4 mb-4 text-center" role="alert">
          <p className="mc-red text-sm">Can&apos;t reach the dashboard server. Retrying…</p>
        </div>
      )}

      {/* Map import in-progress banner */}
      {data?.importing && (
        <div className="mc-dark-panel p-4 mb-4 text-center" role="status" style={{ borderLeft: "3px solid var(--mc-aqua)", background: "rgba(85,255,255,0.05)" }}>
          <p className="mc-aqua text-sm font-bold animate-pulse">Importing map…</p>
          <p className="mc-note mt-1">The map is being downloaded and set up. This takes about 30–60 seconds. The page updates by itself.</p>
        </div>
      )}

      {/* Restart-required banner */}
      {data?.restartPending && (
        <div className="mc-dark-panel p-3 mb-4 flex flex-wrap items-center justify-between gap-3" role="status" style={{ borderLeft: "3px solid var(--mc-gold)", background: "rgba(255,170,0,0.07)" }}>
          <div>
            <span className="mc-gold text-sm font-bold">Restart needed</span>
            <p className="mc-note mt-0.5">Saved changes take effect after the world restarts.</p>
          </div>
          <button className="mc-btn mc-btn-amber mc-btn-sm flex-shrink-0" onClick={() => handlePower("restart")} disabled={busy !== null}>
            {busy === "restart" ? "Restarting..." : "Restart now"}
          </button>
        </div>
      )}

      {/* Seed + how to join: one compact strip of facts, shown even while stopped */}
      <section className="mc-dark-panel p-4 mb-4" aria-label="Seed and how to join">
        <dl className="flex flex-wrap gap-x-10 gap-y-3">
          <div className="mc-stat">
            <dt className="mc-stat-label">World seed</dt>
            <dd className="flex flex-wrap items-center gap-x-2">
              {info?.seed ? (
                <>
                  <span className="mc-mono mc-white" style={{ fontSize: 16 }}>{info.seed}</span>
                  <CopyButton value={info.seed} label="Seed" />
                </>
              ) : (
                <span className="mc-note">{loading ? "Loading…" : online ? "Reading…" : "Start the world to read it"}</span>
              )}
            </dd>
          </div>
          {info?.ip && (
            <div className="mc-stat">
              <dt className="mc-stat-label">Same Wi‑Fi</dt>
              <dd className="flex flex-wrap items-center gap-x-2">
                <span className="mc-mono mc-white">{info.ip}</span>
                <span className="mc-note">port {info.gamePort}</span>
                <CopyButton value={info.ip} label="LAN address" />
              </dd>
            </div>
          )}
          <div className="mc-stat">
            <dt className="mc-stat-label">From anywhere</dt>
            <dd className="flex flex-wrap items-center gap-x-2">
              {info?.publicIp && info?.externalPort ? (
                <>
                  <span className="mc-mono mc-white">{info.publicIp}</span>
                  <span className="mc-note">port {info.externalPort}</span>
                  <CopyButton value={info.publicIp} label="Public address" />
                </>
              ) : (
                <span className="mc-note">Not available right now</span>
              )}
            </dd>
          </div>
          <div className="mc-stat">
            <dt className="mc-stat-label">Friends tab</dt>
            <dd className="flex flex-wrap items-center gap-x-2">
              {info?.xbox?.gamertag ? (
                <>
                  <span className="mc-mono mc-white">{info.xbox.gamertag}</span>
                  <span className={`mc-chip ${info.xbox.active ? "mc-chip-on" : "mc-chip-off"}`} style={{ fontSize: 10, padding: "1px 7px" }}>{info.xbox.active ? "Bridge online" : "Bridge off"}</span>
                </>
              ) : (
                <span className="mc-note">{info?.xbox ? (info.xbox.active ? "Bridge signing in…" : "Bridge off") : "No bridge account"}</span>
              )}
            </dd>
          </div>
        </dl>
        <p className="mc-note mt-3">
          Seed: Minecraft → Create New World → Seed gives the same terrain. Addresses: Servers → Add Server. Friends tab: add the gamertag as a friend, then join from its tile.
        </p>
      </section>

      {/* Status bar */}
      {online && (
        <div className="mc-dark-panel p-4 mb-6 bg-gradient-to-r from-black/40 to-transparent">
          <dl className="flex flex-wrap gap-x-8 gap-y-3 mb-4">
            <div className="mc-stat"><dt className="mc-stat-label">Players online</dt><dd className="mc-stat-value mc-green">{status?.players ?? 0}<span className="mc-dark-gray">/{status?.maxPlayers ?? 20}</span></dd></div>
            <div className="mc-stat"><dt className="mc-stat-label">Game mode</dt><dd className="mc-stat-value mc-aqua capitalize">{status?.gamemode || "—"}</dd></div>
            <div className="mc-stat"><dt className="mc-stat-label">Difficulty</dt><dd className="mc-stat-value mc-gold capitalize">{status?.difficulty || "—"}</dd></div>
            <div className="mc-stat"><dt className="mc-stat-label">Version</dt><dd className="mc-stat-value mc-white" style={{ userSelect: "none" }} onDoubleClick={togglePowers}>{status?.version || "—"}</dd></div>
          </dl>
          <div className="mc-xp-bar h-2 shadow-inner" role="progressbar" aria-label="Players online" aria-valuemin={0} aria-valuemax={status?.maxPlayers ?? 20} aria-valuenow={status?.players ?? 0}>
            <div className="mc-xp-fill shadow-[0_0_8px_rgba(128,255,32,0.4)]" style={{ width: `${Math.max(((status?.players || 0) / (status?.maxPlayers || 20)) * 100, 2)}%` }} />
          </div>
        </div>
      )}

      {/* Console (hidden until "/" is pressed, like chat in the game) */}
      {consoleOpen && online && <WorldConsole send={(command) => action("command", { command })} onClose={() => setConsoleOpen(false)} />}

      {/* Superpowers (hidden until the version number is double-clicked) */}
      {online && powersOpen && (
        <PowersPanel
          worldId={id}
          achievementsOn={status?.achievements === true}
          players={status?.playerList ?? []}
          selected={powersPlayer}
          onSelect={setPowersPlayer}
          busy={busy}
          onHide={togglePowers}
          run={(command, label) => action("command", { command }).then((r) => {
            const reply = String(r?.output ?? "").replace(/^\[.*?\]\s*(INFO|ERROR)\]?\s*/i, "").trim();
            const ok = !r?.error && !/couldn't|could not|cannot|syntax error|no targets|unknown|not found|invalid/i.test(reply);
            if (!ok) toast(reply || r?.error || "The game refused that command", "error");
            else if (label) toast(label, "success");
            return { ok, reply };
          })}
          query={(command) => action("command", { command })}
        />
      )}

      {/* Power */}
      <div className="mc-dark-panel p-3 mb-4">
        <div className="mc-section">Power</div>
        {importing ? (
          <button className="mc-btn w-full py-2 opacity-50" disabled>Importing map...</button>
        ) : online ? (
          <div className="flex flex-wrap gap-2">
            <button className="mc-btn mc-btn-red flex-1" onClick={() => handlePower("stop")} disabled={busy !== null}>{busy === "stop" ? "Stopping..." : "Stop"}</button>
            <button className="mc-btn mc-btn-amber flex-1" onClick={() => handlePower("restart")} disabled={busy !== null}>{busy === "restart" ? "Restarting..." : "Restart"}</button>
          </div>
        ) : (
          <button className="mc-btn mc-btn-green w-full py-2" onClick={() => handlePower("start")} disabled={busy !== null}>{busy === "start" ? "Starting..." : "Start world"}</button>
        )}
        {online && <p className="mc-note mt-2">Stopping or restarting disconnects everyone who is playing. Players on the same Wi‑Fi may need to join once from the Friends tab after a restart.</p>}
      </div>

      {!online && status && (
        <div className="mc-dark-panel p-4 mb-4 text-center">
          <p className="mc-gold text-sm">This world is stopped. Start it to change its settings.</p>
        </div>
      )}

      {status && !status.online && status.worldName === "" && (
        <div className="mc-dark-panel p-4 mb-4 text-center">
          <p className="mc-gold text-sm">Please wait — the world is still being set up…</p>
        </div>
      )}

      {online && !importing && (
        <>
          {/* Game Mode + Difficulty */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div className="mc-dark-panel p-3">
              <div className="mc-section">Game Mode</div>
              <p className="mc-note mb-2">Takes effect after a restart</p>
              <div className="grid grid-cols-3 gap-2" role="group" aria-label="Game mode">
                {["survival", "creative", "adventure"].map((m) => (
                  <button key={m} className={`mc-btn mc-btn-sm capitalize ${status?.gamemode === m ? "mc-btn-active" : ""}`} aria-pressed={status?.gamemode === m} onClick={() => handleGamemode(m)} disabled={busy !== null}>{m}</button>
                ))}
              </div>
            </div>
            <div className="mc-dark-panel p-3">
              <div className="mc-section">Difficulty</div>
              <p className="mc-note mb-2">Takes effect after a restart</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" role="group" aria-label="Difficulty">
                {["peaceful", "easy", "normal", "hard"].map((d) => (
                  <button key={d} className={`mc-btn mc-btn-sm capitalize ${status?.difficulty === d ? "mc-btn-active" : ""}`} aria-pressed={status?.difficulty === d} onClick={() => handleDifficulty(d)} disabled={busy !== null}>{d}</button>
                ))}
              </div>
            </div>
          </div>

          {/* Time & weather (console commands: achievement-safe) */}
          <div className="mc-dark-panel p-3 mb-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="mc-section" style={{ marginBottom: 0 }}>Time &amp; weather</div>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Time and weather">
                <button className="mc-btn mc-btn-sm" onClick={() => handleSky("time set day", "It's morning")} disabled={busy !== null}>☀ Day</button>
                <button className="mc-btn mc-btn-sm" onClick={() => handleSky("time set noon", "It's noon")} disabled={busy !== null}>Noon</button>
                <button className="mc-btn mc-btn-sm" onClick={() => handleSky("time set night", "It's night")} disabled={busy !== null}>☾ Night</button>
                <span className="mc-gray hidden sm:inline" aria-hidden="true">|</span>
                <button className="mc-btn mc-btn-sm" onClick={() => handleSky("weather clear", "Skies cleared")} disabled={busy !== null}>Clear</button>
                <button className="mc-btn mc-btn-sm" onClick={() => handleSky("weather rain", "Rain started")} disabled={busy !== null}>Rain</button>
                <button className="mc-btn mc-btn-sm" onClick={() => handleSky("weather thunder", "Thunderstorm started")} disabled={busy !== null}>Storm</button>
              </div>
            </div>
            <p className="mc-note mt-1">Changes the time and weather for everyone in this world right away. Doesn&apos;t affect achievements.</p>
          </div>

          {/* Hardcore Mode */}
          <div className="mc-dark-panel p-3 mb-4" style={status?.hardcore ? { borderLeft: "3px solid var(--mc-red)" } : undefined}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="mc-section" style={{ marginBottom: 2 }}>Hardcore Mode {status?.hardcore && <span className="mc-red text-[11px] font-bold ml-1">ON</span>}</div>
                <p className="mc-note">
                  Locks the world to hard difficulty and turns players who die into spectators. Toggling it restarts the world.
                </p>
              </div>
              <McToggle on={!!status?.hardcore} label="Hardcore mode" onChange={() => handleHardcore(!status?.hardcore)} disabled={busy !== null} />
            </div>
          </div>

          {/* Achievements */}
          <div className="mc-dark-panel p-3 mb-4" style={status?.achievements ? { borderLeft: "3px solid var(--mc-green)" } : undefined}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="mc-section" style={{ marginBottom: 2 }}>Achievements {status?.achievements === true && <span className="mc-green text-[11px] font-bold ml-1">ON</span>}{status?.achievements === false && <span className="mc-note text-[11px] ml-1">OFF</span>}</div>
                <p className="mc-note">
                  {status?.achievements === undefined
                    ? "Status unknown: this world's API needs the achievements update."
                    : status?.achievements
                      ? "Players can earn achievements. Cheats are off for this world; Fly (creative mode) from Superpowers will switch achievements off again."
                      : "Achievements are off because cheats are on or someone has been in creative mode. Turning them on switches cheats off and restarts the world."}
                </p>
              </div>
              <McToggle on={status?.achievements === true} label="Achievements" onChange={() => handleAchievements(!status?.achievements)} disabled={busy !== null || status?.achievements === undefined || status?.achievements === null} />
            </div>
          </div>

          {/* Beta APIs (Mojang experiment some add-ons need) */}
          {status?.betaApis !== undefined && (
            <div className="mc-dark-panel p-3 mb-4" style={status?.betaApis ? { borderLeft: "3px solid var(--mc-gold, #ffaa00)" } : undefined}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="mc-section" style={{ marginBottom: 2 }}>Beta APIs {status?.betaApis === true && <span className="mc-gold text-[11px] font-bold ml-1">ON</span>}{status?.betaApis === false && <span className="mc-note text-[11px] ml-1">OFF</span>}</div>
                  <p className="mc-note">
                    {status?.betaApis
                      ? "Add-ons that need Mojang's Beta APIs experiment can run here. Experiments switch achievements off for this world."
                      : "Some add-ons (marked \"Needs Beta APIs\" in the library) only work with this Mojang experiment on. Turning it on restarts the world and switches achievements off for it."}
                  </p>
                </div>
                <McToggle on={status?.betaApis === true} label="Beta APIs" onChange={() => handleBetaApis(!status?.betaApis)} disabled={busy !== null || status?.betaApis === null} />
              </div>
            </div>
          )}

          {/* Game Rules + Players/Allowlist */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
            <div className="mc-dark-panel">
              <div className="p-3 pb-1"><div className="mc-section">Game Rules {!rulesLoaded && <span className="mc-note animate-pulse ml-1">Loading...</span>}</div></div>
              {BASIC_RULES.map((r) => <RuleRow key={r.id} rule={r} />)}
              <button onClick={() => setShowAdvanced(!showAdvanced)} aria-expanded={showAdvanced} className="mc-btn mc-btn-sm w-full" style={{ border: "none", borderTop: "1px solid #333", boxShadow: "none" }}>
                {showAdvanced ? "Hide advanced rules ▲" : "Show advanced rules ▼"}
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
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="mc-avatar" aria-hidden="true">{d.charAt(0).toUpperCase()}</div>
                        <span className="mc-white text-sm truncate">{d}</span>
                      </div>
                      <button className="mc-btn mc-btn-red mc-btn-sm" onClick={() => handleKick(name)} disabled={busy !== null}>Kick</button>
                    </div>
                    );
                  })
                ) : (
                  <p className="mc-note px-3 pb-3">No players online</p>
                )}
              </div>

              <div className="mc-dark-panel">
                <div className="p-3 pb-1"><div className="mc-section">Allowlist</div></div>
                <div className="px-3 pb-2">
                  <div className="flex gap-2">
                    <input className="mc-input" aria-label="Gamertag to add" placeholder="Enter gamertag" value={newPlayer} onChange={(e) => setNewPlayer(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleAllowlistAdd()} />
                    <button className="mc-btn mc-btn-green" onClick={handleAllowlistAdd} disabled={busy !== null || !newPlayer.trim()}>Add</button>
                  </div>
                  <p className="mc-note mt-1.5">Only people on this list can join. Use ⋯ to make someone an operator (commands allowed) or to remove them.</p>
                </div>
                {allowlist.map((entry) => {
                  const perm = permissions.find((p) => p.name === entry.name || (entry.xuid && p.xuid === entry.xuid))?.permission ?? "member";
                  const permColor = perm === "operator" ? "mc-gold" : perm === "visitor" ? "mc-dark-gray" : "mc-gray";
                  const d = transform(entry.name, "gamertag");
                  const menuOpen = permMenuOpen === entry.name;
                  return (
                    <div key={entry.name} className="mc-row flex items-center justify-between px-3 py-2">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <div className="mc-avatar" aria-hidden="true">{d.charAt(0).toUpperCase()}</div>
                        <div className="min-w-0 flex flex-wrap items-baseline gap-x-2">
                          <span className="mc-white text-sm truncate">{d}</span>
                          <span className={`uppercase text-[11px] ${permColor}`}>{perm}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <div className="relative" ref={menuOpen ? permMenuRef : undefined}>
                          <button
                            className="mc-btn mc-btn-sm mc-btn-icon"
                            aria-label={`Options for ${d}`}
                            aria-haspopup="menu"
                            aria-expanded={menuOpen}
                            onClick={() => setPermMenuOpen(menuOpen ? null : entry.name)}
                            disabled={busy !== null}
                          >
                            ⋯
                          </button>
                          {menuOpen && (
                            <div role="menu" className="mc-menu">
                              {["visitor", "member", "operator"].map((lvl) => (
                                <button key={lvl} role="menuitemradio" aria-checked={perm === lvl} onClick={() => handleSetPermission(entry.name, lvl)}
                                  className={`mc-menu-item capitalize ${perm === lvl ? "mc-gold" : "mc-white"}`}>
                                  {perm === lvl ? "✓ " : ""}{lvl}
                                </button>
                              ))}
                              <div className="mc-sep" />
                              <button role="menuitem" onClick={() => { setPermMenuOpen(null); handleAllowlistRemove(entry.name); }}
                                className="mc-menu-item mc-red">
                                Remove from allowlist
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {allowlist.length === 0 && <p className="mc-note px-3 pb-3">Nobody is on the allowlist yet.</p>}
              </div>
            </div>
          </div>

          {/* Installed Add-ons */}
          <WorldAddons id={id} busy={busy} setBusy={setBusy} />
        </>
      )}

      {/* Backups: daily archives on the host + manual ones in the container */}
      <WorldBackups id={id} busy={busy} setBusy={setBusy} online={online && !importing} worldName={title} players={status?.players ?? 0} />

      {/* Restart confirmation modal */}
      {pendingChange && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.7)" }} onClick={() => setPendingChange(null)}>
          <div role="dialog" aria-modal="true" aria-labelledby="pending-title" className="mc-dark-panel p-5 max-w-sm w-full" style={{ borderColor: "var(--mc-gold)", borderWidth: 2 }} onClick={(e) => e.stopPropagation()}>
            <div id="pending-title" className="mc-gold text-sm font-bold uppercase tracking-wide mb-3">{pendingChange.type} saved</div>
            <p className="mc-white text-sm mb-1">
              Set to <span className="mc-gold font-bold capitalize">{pendingChange.value}</span>
            </p>
            <p className="mc-note mb-4">
              Restart the world for the change to take effect.
              {(status?.players ?? 0) > 0 && (
                <span className="mc-gold"> {status!.players} player{status!.players !== 1 ? "s" : ""} currently online.</span>
              )}
            </p>
            <div className="flex gap-2">
              <button
                className="mc-btn mc-btn-amber flex-1"
                onClick={() => { setPendingChange(null); handlePower("restart"); }}
                disabled={busy !== null}
              >
                Restart now
              </button>
              <button
                className="mc-btn flex-1"
                onClick={() => { setPendingChange(null); toast("Restart when you're ready — the change is saved.", "info"); }}
                autoFocus
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

// Raw server console: any command the per-world API lets through, replies underneath, ↑/↓ history.
function WorldConsole({ send, onClose }: { send: (command: string) => Promise<{ output?: string; error?: string } | undefined>; onClose: () => void }) {
  const [line, setLine] = useState("");
  const [log, setLog] = useState<Array<{ cmd: string; reply: string; ok: boolean }>>([]);
  const [history, setHistory] = useState<string[]>([]);
  const [hIdx, setHIdx] = useState(-1);
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  async function submit() {
    const cmd = line.trim().replace(/^\//, "");
    if (!cmd || sending) return;
    setSending(true);
    try {
      const r = await send(cmd);
      const reply = String(r?.output ?? r?.error ?? "").replace(/^\[.*?\]\s*(INFO|ERROR)\]?\s*/i, "").trim() || "(no reply)";
      const ok = !r?.error && !/couldn't|could not|cannot|syntax error|no targets|unknown|not found|invalid|disallowed/i.test(reply);
      setLog((prev) => [...prev.slice(-11), { cmd, reply, ok }]);
      setHistory((prev) => [cmd, ...prev.filter((h) => h !== cmd)].slice(0, 30));
      setHIdx(-1);
      setLine("");
    } finally { setSending(false); }
  }
  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") { e.preventDefault(); submit(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); const i = Math.min(hIdx + 1, history.length - 1); if (i >= 0) { setHIdx(i); setLine(history[i]); } }
    else if (e.key === "ArrowDown") { e.preventDefault(); const i = hIdx - 1; setHIdx(i); setLine(i >= 0 ? history[i] : ""); }
  }
  return (
    <section className="mc-dark-panel p-3 mb-4" aria-label="Server console" style={{ borderLeft: "3px solid var(--mc-aqua)" }}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <h2 className="mc-section" style={{ marginBottom: 0, color: "var(--mc-aqua)", textShadow: "1px 1px 0 #003333" }}>Console</h2>
        <button type="button" className="mc-textbtn" onClick={onClose}>Close (Esc)</button>
      </div>
      {log.length > 0 && (
        <div className="mc-window-inner mb-2" style={{ maxHeight: 220, overflowY: "auto", fontFamily: "ui-monospace, Menlo, Consolas, monospace", fontSize: 13 }}>
          {log.map((l, i) => (
            <div key={i} className="px-1 py-0.5">
              <div className="mc-gray">&gt; {l.cmd}</div>
              <div className={l.ok ? "mc-white" : "mc-red"} style={{ whiteSpace: "pre-wrap" }}>{l.reply}</div>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input ref={inputRef} className="mc-input" style={{ fontFamily: "ui-monospace, Menlo, Consolas, monospace" }} placeholder='e.g. give "Steve" diamond 64 · list · time set day' value={line} onChange={(e) => setLine(e.target.value)} onKeyDown={onKey} disabled={sending} aria-label="Server command" />
        <button type="button" className="mc-btn mc-btn-sm" onClick={submit} disabled={sending || !line.trim()}>{sending ? "…" : "Send"}</button>
      </div>
      <p className="mc-note mt-1.5">Runs as the server operator. Names with spaces go in quotes; no leading slash needed.</p>
    </section>
  );
}

function PowersPanel({ worldId, achievementsOn, players, selected, onSelect, busy, onHide, run, query }: {
  worldId: string; achievementsOn: boolean; players: string[]; selected: string | null; onSelect: (p: string | null) => void; busy: string | null; onHide: () => void;
  run: (command: string, successLabel: string) => Promise<Reply>;
  query: (command: string) => Promise<{ output?: string; error?: string } | undefined>;
}) {
  const { transform } = useDemoMode();
  const { toast } = useToast();
  const player = selected && players.includes(selected) ? selected : players[0] ?? null;
  useEffect(() => { if (player && player !== selected) onSelect(player); }, [player, selected, onSelect]);
  const d = player ? transform(player, "gamertag") : "";
  const q = (name: string) => `"${name.replace(/"/g, "")}"`;
  const sub = (c: string) => c.replace(/\$P/g, q(player || "")).replace(/\$N/g, (player || "").replace(/"/g, ""));

  // bookkeeping of what this panel switched on for the selected player
  const [active, setActive] = useState<Set<string>>(new Set());
  useEffect(() => { setActive(player ? loadActive(worldId, player) : new Set()); }, [worldId, player]);
  function mark(ids: string[], on: boolean) {
    setActive((prev) => { const n = new Set(prev); for (const id of ids) { if (on) n.add(id); else n.delete(id); } if (player) saveActive(worldId, player, n); return n; });
  }
  const isOn = (id: string) => active.has(id);
  const effectIds = [...POWERS.map((p) => p.id), ...TRICKS.filter((t) => t.id === "moon").map((t) => t.id)];
  const names: Record<string, string> = { creative: "Creative mode" };
  for (const p of POWERS) names[p.id] = p.label;
  for (const t of TRICKS) names[t.id] = t.label;
  for (const f of FUN) names[f.id] = f.label;
  for (const b of SILENT) names[b.id] = b.label;
  const onNow = [...active].map((id) => names[id] || id);

  // which script powers the selected player has: read the player's tags once per selection
  const [tags, setTags] = useState<Set<string>>(new Set());
  useEffect(() => {
    let cancelled = false;
    setTags(new Set());
    if (!player) return;
    query(`tag ${q(player)} list`).then((r) => {
      if (cancelled) return;
      const found = (String(r?.output ?? "").match(/sp_[a-z]+/g) || []);
      setTags(new Set(found));
    }).catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player]);

  async function togglePower(pw: typeof POWERS[number]) {
    if (!player) return;
    if (isOn(pw.id)) {
      await run(`effect ${q(player)} ${pw.effect} 0`, `${pw.label} removed from ${d}`);
      mark([pw.id], false);                      // whatever the reply, it is not on them now
    } else {
      const r = await run(`effect ${q(player)} ${pw.effect} 999999 ${pw.amp} true`, `${pw.label} → ${d}`);
      if (r.ok) mark([pw.id], true);
    }
  }
  // creative, even for a moment, switches achievements off for the whole world (spectator does not:
  // a world created in spectator mode kept hasBeenLoadedInCreative at 0, tested 2026-10-12)
  const okToLoseAchievements = (what: string) =>
    !achievementsOn || confirm(`${what} turns achievements OFF for this whole world, for everyone. Getting them back needs the Achievements toggle and a world restart. Continue?`);
  async function toggleTrick(tr: typeof TRICKS[number]) {
    if (!player) return;
    if (tr.undo && isOn(tr.id)) {
      for (const c of tr.undo) await run(sub(c), "");
      mark([tr.id], false);
      toast(`${tr.label} removed from ${d}`, "success");
      return;
    }
    let ok = true;
    for (const c of tr.cmds) { const r = await run(sub(c), ""); ok = ok && r.ok; }
    if (ok) {
      if (tr.undo) mark([tr.id], true);
      if (tr.id === "ghost") mark(["creative"], false);   // one game mode at a time
      toast(`${tr.label} → ${d}`, "success");
    }
  }
  const [bigText, setBigText] = useState("");
  async function showBigText() {
    if (!player) return;
    // only characters the per-world API's command filter accepts
    const text = bigText.replace(/[^a-zA-Z0-9 _\-\.,:/@'!?#()=+]/g, "").trim().slice(0, 40);
    if (!text) return;
    const r = await run(`title ${q(player)} title ${text}`, `Shown to ${d}: ${text}`);
    if (r.ok) setBigText("");
  }
  async function toggleScriptPower(tag: string, label: string) {
    if (!player) return;
    const on = tags.has(tag);
    const other = on ? undefined : EXCLUSIVE_POWERS[tag];
    if (other && tags.has(other)) await run(`tag ${q(player)} remove ${other}`, "");
    await run(`tag ${q(player)} ${on ? "remove" : "add"} ${tag}`, `${label} ${on ? "off" : "on"} for ${d}`);
    setTags((prev) => { const n = new Set(prev); if (on) n.delete(tag); else { n.add(tag); if (other) n.delete(other); } return n; });
  }
  const stack = (on: boolean, label: string, blurb: string) => (
    <>
      <span>{on ? "✓ " : ""}{label}</span>
      <span style={{ fontFamily: "var(--font-text)", fontSize: 11, opacity: 0.8, textTransform: "none", letterSpacing: 0 }}>{on ? "tap to remove" : blurb}</span>
    </>
  );

  // collapsible groups, remembered across visits
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  useEffect(() => {
    try { const raw = window.localStorage.getItem("mc-powers-open"); const arr = raw ? JSON.parse(raw) : ["effects"]; setOpenGroups(new Set(Array.isArray(arr) ? arr : ["effects"])); } catch { setOpenGroups(new Set(["effects"])); }
  }, []);
  function toggleGroup(id: string) {
    setOpenGroups((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); try { window.localStorage.setItem("mc-powers-open", JSON.stringify([...n])); } catch { /* ignore */ } return n; });
  }
  const countOn = (ids: string[]) => ids.filter((i) => active.has(i)).length;
  const group = (id: string, title: string, note: string | null, onCount: number, body: React.ReactNode) => {
    const open = openGroups.has(id);
    return (
      <div key={id} className="mb-2" style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
        <button type="button" className="w-full flex items-center justify-between gap-2 py-2 px-1 text-left" aria-expanded={open} onClick={() => toggleGroup(id)} style={{ background: "transparent", border: "none", color: "inherit", cursor: "pointer" }}>
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span className="mc-stat-label" style={{ color: "var(--mc-gold)" }}>{title}</span>
            {onCount > 0 && <span className="mc-chip mc-chip-on" style={{ fontSize: 10, padding: "1px 7px" }}>{onCount} on</span>}
            {note && <span className="mc-note">{note}</span>}
          </span>
          <span className="mc-gray" aria-hidden="true">{open ? "\u25BE" : "\u25B8"}</span>
        </button>
        {open && <div className="pb-2">{body}</div>}
      </div>
    );
  };
  const grid = "grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2";

  return (
    <section className="mc-dark-panel p-3 mb-4" aria-labelledby="powers-heading" style={{ borderLeft: "3px solid var(--mc-light-purple)" }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="powers-heading" className="mc-section" style={{ marginBottom: 0, color: "var(--mc-light-purple)", textShadow: "1px 1px 0 #2a0a2a" }}>Superpowers</h2>
        <button type="button" className="mc-textbtn" onClick={onHide}>Hide</button>
      </div>
      <p className="mc-note mt-1 mb-3">Give someone who is online a superpower; tap it again to take it away. Powers last until they die. Double-click the version number to hide this panel again.</p>
      {players.length === 0 ? (
        <p className="mc-note">Nobody is online right now.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-2" role="group" aria-label="Player">
            <span className="mc-stat-label">Player</span>
            {players.map((p) => (
              <button key={p} type="button" className={`mc-btn mc-btn-sm ${p === player ? "mc-btn-active" : ""}`} aria-pressed={p === player} onClick={() => onSelect(p)}>
                {transform(p, "gamertag")}
              </button>
            ))}
          </div>
          <p className="mc-note mb-3" aria-live="polite">
            On {d} now: {onNow.length ? <span className="mc-white">{onNow.join(" · ")}</span> : "nothing from this panel"}
            {onNow.length > 0 && <> · <button type="button" className="mc-textbtn" title="Forget this list (e.g. after a death removed everything) without sending commands" onClick={() => mark([...active], false)}>Reset list</button></>}
          </p>

          {group("effects", "Effects", null, countOn(POWERS.map((p) => p.id)), (
            <div className={grid}>
              {POWERS.map((pw) => (
                <button key={pw.id} type="button" className={`mc-btn mc-btn-sm mc-btn-stack ${isOn(pw.id) ? "mc-btn-active" : ""}`} aria-pressed={isOn(pw.id)} title={pw.blurb} disabled={busy !== null || !player} onClick={() => togglePower(pw)}>
                  {stack(isOn(pw.id), pw.label, pw.blurb)}
                </button>
              ))}
            </div>
          ))}

          {group("tricks", "Tricks", null, countOn(TRICKS.map((t) => t.id)), (
            <div className={grid}>
              {TRICKS.map((tr) => (
                <button key={tr.id} type="button" className={`mc-btn mc-btn-sm mc-btn-stack ${isOn(tr.id) ? "mc-btn-active" : ""}`} aria-pressed={!!tr.undo && isOn(tr.id)} title={tr.blurb} disabled={busy !== null || !player} onClick={() => toggleTrick(tr)}>
                  {stack(isOn(tr.id), tr.label, tr.blurb)}
                </button>
              ))}
            </div>
          ))}

          {group("fun", "Fun stuff", null, countOn(FUN.map((f) => f.id)), (
            <>
              <div className={`${grid} mb-3`}>
                {FUN.map((f) => (
                  <button key={f.id} type="button" className={`mc-btn mc-btn-sm mc-btn-stack ${isOn(f.id) ? "mc-btn-active" : ""}`} aria-pressed={!!f.undo && isOn(f.id)} title={f.blurb} disabled={busy !== null || !player} onClick={() => toggleTrick(f)}>
                    {stack(isOn(f.id), f.label, f.blurb)}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label htmlFor="big-text" className="mc-stat-label">Big message</label>
                <input id="big-text" className="mc-input" style={{ width: "auto", flex: "1 1 220px" }} placeholder={`Text to splash across ${d || "their"} screen`} maxLength={40} value={bigText} onChange={(e) => setBigText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && showBigText()} />
                <button type="button" className="mc-btn mc-btn-sm" disabled={busy !== null || !player || !bigText.trim()} onClick={showBigText}>Show</button>
              </div>
            </>
          ))}

          {group("pranks", "Pranks", "on the selected player, all over in seconds", 0, (
            <div className={grid}>
              {PRANKS.map((pr) => (
                <button key={pr.id} type="button" className="mc-btn mc-btn-sm mc-btn-stack" title={pr.blurb} disabled={busy !== null || !player} onClick={() => toggleTrick(pr)}>
                  {stack(false, pr.label, pr.blurb)}
                </button>
              ))}
            </div>
          ))}

          {group("silent", "Silent buff", `for everyone except ${d}; no message, no particles`, countOn(SILENT.map((b) => b.id)), (
            <div className={grid}>
              {SILENT.map((b) => (
                <button key={b.id} type="button" className={`mc-btn mc-btn-sm mc-btn-stack ${isOn(b.id) ? "mc-btn-active" : ""}`} aria-pressed={isOn(b.id)} title={b.blurb} disabled={busy !== null || !player} onClick={() => toggleTrick(b)}>
                  {stack(isOn(b.id), b.label, b.blurb)}
                </button>
              ))}
            </div>
          ))}

          {group("gear", "Best gear", "select an empty hotbar slot first; the item lands there, armour then goes on from your inventory", 0, (
            <div className={grid}>
              {GEAR.map((g) => (
                <button key={g.id} type="button" className="mc-btn mc-btn-sm mc-btn-stack" title={g.blurb} disabled={busy !== null || !player} onClick={() => toggleTrick(g)}>
                  {stack(false, g.label, g.blurb)}
                </button>
              ))}
            </div>
          ))}

          {group("script", "Pack powers", "need the Superpowers add-on installed in this world", tags.size, (
            <div className={grid}>
              {SCRIPT_POWERS.map((sp) => (
                <button key={sp.tag} type="button" className={`mc-btn mc-btn-sm mc-btn-stack ${tags.has(sp.tag) ? "mc-btn-active" : ""}`} aria-pressed={tags.has(sp.tag)} title={sp.blurb} disabled={busy !== null || !player}
                  onClick={() => toggleScriptPower(sp.tag, sp.label)}>
                  {stack(tags.has(sp.tag), sp.label, sp.blurb)}
                </button>
              ))}
            </div>
          ))}

          {players.length > 1 && group("teleport", `Teleport ${d} to`, null, 0, (
            <div className="flex flex-wrap items-center gap-2">
              {players.filter((p) => p !== player).map((p) => (
                <button key={p} type="button" className="mc-btn mc-btn-sm" disabled={busy !== null} onClick={() => player && run(`tp ${q(player)} ${q(p)}`, `${d} teleported to ${transform(p, "gamertag")}`)}>
                  {transform(p, "gamertag")}
                </button>
              ))}
            </div>
          ))}

          <div className="flex flex-wrap gap-2 pt-2" style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
            {isOn("creative") ? (
              <button type="button" className="mc-btn mc-btn-sm mc-btn-active" aria-pressed="true" disabled={busy !== null || !player}
                onClick={async () => { if (!player) return; const r = await run(`gamemode survival ${q(player)}`, `${d} back to survival`); if (r.ok) mark(["creative", "ghost"], false); }}>✓ Creative mode (tap for survival)</button>
            ) : (
              <button type="button" className="mc-btn mc-btn-sm mc-btn-amber" disabled={busy !== null || !player}
                onClick={async () => { if (!player || !okToLoseAchievements("Creative mode")) return; const r = await run(`gamemode creative ${q(player)}`, `${d} can fly (creative)`); if (r.ok) { mark(["creative"], true); mark(["ghost"], false); } }} title="Switches achievements off for this world">Fly (creative mode)</button>
            )}
            <button type="button" className="mc-btn mc-btn-sm mc-btn-red" disabled={busy !== null || !player} title="Removes every effect. Creative mode and items like the wings stay."
              onClick={async () => { if (!player) return; await run(`effect ${q(player)} clear`, `Effects cleared for ${d}`); mark(effectIds, false); }}>Clear all effects</button>
          </div>
        </>
      )}
    </section>
  );
}

function WorldBackups({ id, busy, setBusy, online, worldName, players }: { id: string; busy: string | null; setBusy: (v: string | null) => void; online: boolean; worldName: string; players: number }) {
  const { toast } = useToast();
  const { data, mutate } = useSWR<BackupsData>(`/api/servers/${id}/backups`, fetcher, { refreshInterval: 60000 });
  const daily = data?.daily ?? [];
  const safety = data?.safety ?? [];
  const manual = data?.manual ?? [];
  const fmt = (d: Date) => d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  const [confirmFor, setConfirmFor] = useState<{ source: string; filename: string; when: string } | null>(null);
  const [typed, setTyped] = useState("");
  useEscape(confirmFor !== null && busy !== "restore", () => setConfirmFor(null));

  async function handleNightly() {
    const enabled = data?.enabled === false; // flipping
    if (!enabled && !confirm(`Turn off nightly backups for ${worldName}? Existing archives stay; no new ones will be made until you turn it back on.`)) return;
    setBusy("nightly");
    try {
      const res = await fetch(`/api/servers/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "nightlyBackups", enabled }) });
      const r = await res.json();
      if (r.success) { toast(enabled ? "Nightly backups on" : "Nightly backups off", "success"); mutate(); }
      else toast(r.error || "Couldn't change that", "error");
    } catch { toast("Couldn't reach the dashboard server", "error"); } finally { setBusy(null); }
  }
  async function handleBackup() {
    if (!confirm("Create a backup now? Players stay connected.")) return;
    setBusy("backup"); toast("Backing up...", "info");
    try {
      const res = await fetch(`/api/servers/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "backup" }) });
      const r = await res.json();
      toast(r.success ? `Saved: ${r.filename}` : `Failed: ${r.error}`, r.success ? "success" : "error");
      if (r.success) setTimeout(() => mutate(), 1500);
    } catch { toast("Backup failed", "error"); } finally { setBusy(null); }
  }

  async function doRestore() {
    if (!confirmFor) return;
    const target = confirmFor;
    setBusy("restore");
    toast(`Restoring to ${target.when}… this takes about a minute`, "info");
    try {
      const res = await fetch(`/api/servers/${id}/backups`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source: target.source, filename: target.filename }) });
      const r = await res.json().catch(() => ({}));
      if (r.success) {
        toast(`Restored to ${target.when}. A safety copy of the world from just before is in "Before a restore".`, "success");
        setConfirmFor(null); setTyped("");
      } else {
        toast(r.error || "Restore failed", "error");
      }
    } catch {
      toast("Couldn't reach the dashboard server; check the world before trying again", "error");
    } finally {
      setBusy(null);
      mutate();
    }
  }

  const row = (key: string, when: string, size: number, filename: string, source: string) => (
    <li key={key} className="mc-row flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-2">
      <span className="mc-white">{when}</span>
      <span className="flex flex-wrap items-center gap-3">
        <span className="mc-note">{formatBytes(size)} · <span className="mc-mono" style={{ fontSize: 12, userSelect: "text" }}>{filename}</span></span>
        <button type="button" className="mc-btn mc-btn-sm" disabled={busy !== null || !online} title={online ? "Put the world back to this moment" : "Start the world first"} onClick={() => { setTyped(""); setConfirmFor({ source, filename, when }); }}>Restore</button>
      </span>
    </li>
  );
  const sub = (title: string) => <div className="px-3 pt-3 pb-1 mc-stat-label">{title}</div>;

  return (
    <section className="mc-dark-panel mb-4" aria-labelledby="backups-heading">
      <div className="p-3 pb-2 flex flex-wrap items-center justify-between gap-2 border-b border-black/20">
        <h2 id="backups-heading" className="mc-section" style={{ marginBottom: 0 }}>Backups</h2>
        <div className="flex flex-wrap gap-2">
          <button className={`mc-btn mc-btn-sm ${data?.enabled === false ? "" : "mc-btn-active"}`} onClick={handleNightly} disabled={busy !== null || !data} aria-pressed={data?.enabled !== false} title="Whether the nightly backup job includes this world">
            {busy === "nightly" ? "Saving..." : data?.enabled === false ? "Nightly: off" : "Nightly: on"}
          </button>
          <button className="mc-btn mc-btn-sm" onClick={handleBackup} disabled={busy !== null || !online} title={online ? undefined : "Start the world to make a backup"}>
            {busy === "backup" ? "Saving..." : "Back up now"}
          </button>
        </div>
      </div>
      <div className="px-3 py-2">
        <p className="mc-note">
          {data?.enabled === false
            ? "This world is left out of the nightly backup job (a test world). Use Back up now for a manual copy, or turn Nightly back on."
            : <>Automatic backups run every day{data?.schedule ? ` at ${data.schedule}` : ""} and are kept on the server host{data?.keep ? ` (newest ${data.keep})` : ""}.</>}
          {data?.lastRun && <> Last run: {data.lastRun}{data.lastStatus ? ` — ${data.lastStatus}` : ""}.</>}
          {" "}Restore puts the world back to that moment; a safety copy of the world as it is now is saved first, so it can be undone.
        </p>
      </div>
      {sub("Nightly backups")}
      {daily.length > 0 ? (
        <ul className="divide-y divide-black/10">{daily.map((b) => row(`d-${b.filename}`, fmt(new Date(b.modified * 1000)), b.sizeBytes, b.filename, "daily"))}</ul>
      ) : (
        <p className="mc-note px-3 pb-3">{data ? "No automatic backups yet." : "Loading…"}</p>
      )}
      {safety.length > 0 && (
        <>
          {sub("Before a restore (safety copies, newest 3)")}
          <ul className="divide-y divide-black/10">{safety.map((b) => row(`s-${b.filename}`, fmt(new Date(b.modified * 1000)), b.sizeBytes, b.filename, "safety"))}</ul>
        </>
      )}
      {manual.length > 0 && (
        <>
          {sub("Manual backups (stored inside the world)")}
          <ul className="divide-y divide-black/10">{manual.map((b) => row(`m-${b.filename}`, fmt(new Date(b.date)), b.size, b.filename, "manual"))}</ul>
        </>
      )}

      {confirmFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.7)" }} onClick={() => { if (busy !== "restore") setConfirmFor(null); }}>
          <div role="dialog" aria-modal="true" aria-labelledby="restore-title" className="mc-dark-panel p-5 w-full max-w-md" style={{ borderColor: "var(--mc-gold)", borderWidth: 2 }} onClick={(e) => e.stopPropagation()}>
            <h3 id="restore-title" className="mc-gold text-sm font-bold uppercase tracking-wide mb-3">Restore {worldName}?</h3>
            <p className="mc-white mb-2">Put the world back to <b>{confirmFor.when}</b>.</p>
            <ul className="mc-note mb-3" style={{ listStyle: "disc", paddingLeft: 18 }}>
              <li>Anything built or changed after that moment will be gone.</li>
              <li>A safety copy of the world as it is right now is saved first, so you can undo this from &quot;Before a restore&quot;.</li>
              <li>The world restarts: {players > 0 ? <span className="mc-gold">{players} player{players === 1 ? " is" : "s are"} online and will be disconnected for about a minute.</span> : "nobody is online right now."}</li>
              <li>Afterwards, the first person joins through the Friends tab; then LAN works for everyone again.</li>
            </ul>
            <label htmlFor="restore-confirm" className="mc-note block mb-1.5">Type <b className="mc-white">RESTORE</b> to confirm:</label>
            <input id="restore-confirm" className="mc-input mb-4" value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && typed.trim().toUpperCase() === "RESTORE" && busy === null) doRestore(); }} disabled={busy === "restore"} autoFocus />
            <div className="flex gap-2">
              <button className="mc-btn flex-1" onClick={() => setConfirmFor(null)} disabled={busy === "restore"}>Cancel</button>
              <button className="mc-btn mc-btn-amber flex-1" onClick={doRestore} disabled={busy !== null || typed.trim().toUpperCase() !== "RESTORE"}>
                {busy === "restore" ? "Restoring…" : "Restore"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
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
      if (ok) { toast(`${primary.name} ${!primary.enabled ? "enabled" : "disabled"}. Restart the world to apply.`, "success"); mutate(); }
    } catch { toast("Couldn't reach the dashboard server", "error"); }
    finally { setBusy(null); }
  }

  async function handleRemove(group: AddonGroup) {
    const { primary, linked } = group;
    if (!confirm(`Remove "${primary.name}"? This deletes the pack files from this world.`)) return;
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
      if (ok) { toast(`${primary.name} removed. Restart the world to apply.`, "success"); mutate(); }
    } catch { toast("Couldn't reach the dashboard server", "error"); }
    finally { setBusy(null); }
  }

  return (
    <div className="mc-dark-panel mb-4 overflow-hidden">
      <div className="p-3 pb-2 flex flex-wrap items-center justify-between gap-2 border-b border-black/20">
        <div className="mc-section" style={{ marginBottom: 0 }}>Installed Add-ons</div>
        <Link href="/addons" className="mc-btn mc-btn-green mc-btn-sm">Browse add-ons</Link>
      </div>

      <div className="divide-y divide-black/10">
        {groups.length === 0 && (
          <p className="mc-note p-4 text-center">No add-ons installed. Browse the library to get started.</p>
        )}

        {groups.map(({ primary, linked }) => {
          const kind = linked.length > 0 ? "Behavior + resource pack" : primary.packType === "behavior" ? "Behavior pack" : "Resource pack";
          return (
          <div key={primary.uuid} className="mc-row flex items-center justify-between px-3 py-3">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div
                className={`mc-item-slot-sm ${primary.enabled ? "mc-glint" : ""}`}
                aria-hidden="true"
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
                <div className={`text-sm truncate font-bold ${primary.enabled ? "mc-white" : "mc-dark-gray"}`}>
                  {primary.name || primary.uuid.slice(0, 8)}
                </div>
                <div className="mc-note flex flex-wrap items-center gap-x-2">
                  <span className="mc-green">{kind}</span>
                  <span>&middot;</span>
                  <span>v{Array.isArray(primary.version) ? primary.version.join(".") : String(primary.version ?? "")}</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-4 flex-shrink-0 ml-2">
              <div className="flex flex-col items-end gap-1">
                <span className="mc-note" style={{ fontSize: 11 }}>{primary.enabled ? "Enabled" : "Disabled"}</span>
                <McToggle on={primary.enabled} label={`${primary.name || "add-on"} enabled`} onChange={() => handleToggle({ primary, linked })} disabled={busy !== null} />
              </div>
              <button
                className="mc-btn mc-btn-red mc-btn-sm mc-btn-icon"
                aria-label={`Remove ${primary.name || "add-on"}`}
                title="Remove from this world"
                onClick={() => handleRemove({ primary, linked })}
                disabled={busy !== null}
              >
                {busy === `remove-${primary.uuid}` ? "…" : "✕"}
              </button>
            </div>
          </div>
          );
        })}
      </div>
    </div>
  );
}

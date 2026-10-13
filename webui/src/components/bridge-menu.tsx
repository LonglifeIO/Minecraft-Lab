"use client";

import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { useToast } from "@/components/toast";
import { useDemoMode } from "@/lib/demoMode";

interface Bridge {
  account: string;
  service: string;
  active: boolean;
  gamertag: string | null;
  world: { id: string; name: string } | null;
  lastCheckIn: number | null;
  lastHandoff: number | null;
  lastHandoffPlayer: string | null;
  lastError: number | null;
  lastErrorText: string | null;
  healthy: boolean;
  problem: string | null;
  build: number | null;
  bridgeVersion: string | null;
  protocol: { bridge: number | null; server: number | null; match: boolean | null };
}

// Never throw: an SWR error would stop the interval polling; a failed poll just shows "unknown".
const fetcher = async (url: string): Promise<Bridge[] | null> => {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const j = await r.json();
    return Array.isArray(j) ? j : null;
  } catch {
    return null;
  }
};

function ago(epoch: number | null): string {
  if (!epoch) return "never";
  const s = Math.max(0, Math.floor(Date.now() / 1000 - epoch));
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

// Top-menu entry: overall status of the Xbox bridges, opening a panel with per-bridge details and restart.
export function BridgeMenu() {
  const { toast } = useToast();
  const { transform } = useDemoMode();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const { data, mutate } = useSWR<Bridge[] | null>("/api/bridges", fetcher, { refreshInterval: 30000 });

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false); }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const bridges = data ?? [];
  const overall = data == null ? "unknown" : bridges.length === 0 ? "none" : bridges.every((b) => b.healthy) ? "ok" : bridges.some((b) => b.active) ? "check" : "off";
  const chip = overall === "ok" ? { cls: "mc-chip-on", word: "OK" } : overall === "check" ? { cls: "mc-chip-wait", word: "Check" } : overall === "off" ? { cls: "mc-chip-off", word: "Off" } : { cls: "mc-chip-off", word: "…" };

  async function restart(account: string, label: string) {
    setBusy(account);
    toast(`Restarting ${label}… (takes up to a minute)`, "info");
    try {
      const res = await fetch("/api/bridges", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ account }) });
      const r = await res.json().catch(() => ({}));
      if (r.success) toast(`${label} restarted and signed in`, "success");
      else toast(r.error || r.results?.find((x: { success: boolean; error?: string }) => !x.success)?.error || "Restart didn't confirm", "error");
    } catch {
      toast("Couldn't reach the dashboard server", "error");
    } finally {
      setBusy(null);
      mutate();
    }
  }

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button type="button" className="mc-btn mc-btn-sm" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}>
        Xbox bridge <span className={`mc-chip ${chip.cls}`} style={{ fontSize: 10, padding: "0 6px", marginLeft: 6 }}>{chip.word}</span>
      </button>
      {open && (
        <div role="dialog" aria-label="Xbox bridges" className="mc-menu mc-popover">
          <p className="mc-note mb-3">
            Console players (PS5, Switch, Xbox) join through these Friends-tab accounts. If one can&apos;t get in, restart its bridge; anyone already playing stays connected.
          </p>
          {data == null && <p className="mc-note">Couldn&apos;t read the bridges right now.</p>}
          {bridges.map((b) => {
            const label = b.world ? transform(b.world.name, "worldName") : b.service;
            const state = !b.active ? { cls: "mc-chip-off", word: "Off" } : b.healthy ? { cls: "mc-chip-on", word: "Connected" } : { cls: "mc-chip-wait", word: "Problem" };
            return (
              <div key={b.account} className="mb-3 pb-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="mc-white font-bold break-words">{label}</div>
                    <div className="mc-note">via <span className="mc-mono" style={{ fontSize: 13, userSelect: "text" }}>{b.gamertag ? transform(b.gamertag, "gamertag") : "not signed in"}</span></div>
                  </div>
                  <span className={`mc-chip ${state.cls}`}>{state.word}</span>
                </div>
                {b.problem && <p className="mc-gold mt-1" style={{ fontSize: 13 }}>{b.problem}</p>}
                <p className="mc-note mt-1">
                  Checked in {ago(b.lastCheckIn)} · last console join {b.lastHandoffPlayer ? `${transform(b.lastHandoffPlayer, "gamertag")}, ${ago(b.lastHandoff)}` : "none since it started"}
                </p>
                <p className="mc-note">
                  {b.protocol?.match === true && <>Up to date: {b.bridgeVersion ? `built for ${b.bridgeVersion}, ` : ""}same game version as the world (protocol {b.protocol.bridge}).</>}
                  {b.protocol?.match === false && <span className="mc-red">Outdated: bridge protocol {b.protocol.bridge}, world protocol {b.protocol.server}. Console joins will fail until it&apos;s updated.</span>}
                  {b.protocol?.match == null && <>Version check unavailable right now.</>}
                </p>
                <button type="button" className="mc-btn mc-btn-sm mt-2" disabled={busy !== null} onClick={() => restart(b.account, `the ${label} bridge`)}>
                  {busy === b.account ? "Restarting…" : "Restart this bridge"}
                </button>
              </div>
            );
          })}
          {bridges.length > 1 && (
            <button type="button" className="mc-btn mc-btn-sm mc-btn-amber w-full" disabled={busy !== null} onClick={() => restart("all", "both bridges")}>
              {busy === "all" ? "Restarting both…" : "Restart both bridges"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

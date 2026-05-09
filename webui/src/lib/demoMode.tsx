"use client";

import {
  Suspense,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useSearchParams } from "next/navigation";

type Kind = "worldName" | "gamertag" | "worldId";
// TODO(demo-mode): add 'xuid' kind when an xuid is actually displayed in the UI.
// Spec: prefix "2535000000000000" + 8-char hex suffix derived from fnv1a(value).
// e.g. `2535${fnv1a(value).toString(16).padStart(8, "0").slice(0, 8)}` — pad to a 16-digit
// xuid by truncating the prefix as needed.

interface DemoModeValue {
  isDemoMode: boolean;
  toggle: () => void;
  transform: <T>(value: T, kind: Kind) => T;
}

const DemoModeContext = createContext<DemoModeValue>({
  isDemoMode: false,
  toggle: () => {},
  transform: (v) => v,
});

const STORAGE_KEY = "mc-demo-mode";

// Optional explicit overrides — populate at runtime/per-deployment if you want
// stable demo names for specific worlds. Otherwise the deterministic pool below
// is used (same input always maps to the same display name).
const WORLD_NAME_MAP: Record<string, string> = {};
const WORLD_NAME_POOL = [
  "Creative Sandbox",
  "Survival Hub",
  "Adventure Lands",
  "Hardcore Trial",
  "Vanilla Realm",
  "Modded Frontier",
];
const GAMERTAG_POOL = [
  "AzureKnight",
  "OakRanger",
  "PixelMage",
  "EmberSmith",
  "GlacierWolf",
  "TwilightFox",
  "CrimsonHawk",
  "VerdantMonk",
];

function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function transformString(value: string, kind: Kind): string {
  if (!value) return value;
  if (kind === "worldName") {
    return (
      WORLD_NAME_MAP[value] ??
      WORLD_NAME_POOL[fnv1a(value) % WORLD_NAME_POOL.length]
    );
  }
  if (kind === "gamertag") {
    return GAMERTAG_POOL[fnv1a(value) % GAMERTAG_POOL.length];
  }
  if (kind === "worldId") {
    return fnv1a(value).toString(16).padStart(8, "0").slice(0, 8);
  }
  return value;
}

function FlagReader({ onRead }: { onRead: (v: boolean) => void }) {
  const params = useSearchParams();
  useEffect(() => {
    if (params?.get("demo") === "true") onRead(true);
  }, [params, onRead]);
  return null;
}

export function DemoModeProvider({ children }: { children: ReactNode }) {
  const [isDemoMode, setIsDemoMode] = useState(false);

  // Load persisted state once on mount
  useEffect(() => {
    try {
      if (window.localStorage.getItem(STORAGE_KEY) === "1") setIsDemoMode(true);
    } catch { /* ignore */ }
  }, []);

  // Keyboard shortcut: Ctrl+Shift+D toggles demo mode
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.ctrlKey && e.shiftKey && (e.key === "D" || e.key === "d")) {
        e.preventDefault();
        setIsDemoMode((prev) => {
          const next = !prev;
          try { window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0"); } catch { /* ignore */ }
          return next;
        });
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const toggle = () => setIsDemoMode((prev) => {
    const next = !prev;
    try { window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0"); } catch { /* ignore */ }
    return next;
  });

  const value = useMemo<DemoModeValue>(
    () => ({
      isDemoMode,
      toggle,
      transform: <T,>(v: T, kind: Kind): T => {
        if (!isDemoMode || typeof v !== "string") return v;
        return transformString(v, kind) as unknown as T;
      },
    }),
    [isDemoMode],
  );
  return (
    <DemoModeContext.Provider value={value}>
      <Suspense fallback={null}>
        <FlagReader onRead={setIsDemoMode} />
      </Suspense>
      {children}
    </DemoModeContext.Provider>
  );
}

export function useDemoMode() {
  return useContext(DemoModeContext);
}

export function DemoModeBadge() {
  const { isDemoMode, toggle } = useDemoMode();
  if (!isDemoMode) return null;
  return (
    <button
      type="button"
      onClick={toggle}
      title="Click to exit demo mode (or press Ctrl+Shift+D)"
      style={{
        position: "fixed",
        top: 12,
        right: 12,
        zIndex: 9999,
        padding: "4px 10px",
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.18em",
        color: "#ffaa00",
        background: "rgba(0,0,0,0.75)",
        border: "1px solid #ffaa00",
        textShadow: "1px 1px 0 rgba(0,0,0,0.6)",
        cursor: "pointer",
        userSelect: "none",
      }}
    >
      DEMO MODE · CLICK TO EXIT
    </button>
  );
}

// Small unobtrusive toggle for activating demo mode (e.g., in a footer).
// When demo mode is OFF, renders a single "·" dot; clicking enables it.
// When ON, the DemoModeBadge already shows in the corner so this returns null.
export function DemoModeDevToggle() {
  const { isDemoMode, toggle } = useDemoMode();
  if (isDemoMode) return null;
  return (
    <button
      type="button"
      onClick={toggle}
      title="Enable demo mode for screenshots (Ctrl+Shift+D)"
      aria-label="Toggle demo mode"
      style={{
        background: "transparent",
        border: "none",
        color: "rgba(255,255,255,0.15)",
        cursor: "pointer",
        fontSize: 14,
        padding: "0 6px",
        userSelect: "none",
      }}
    >
      ·
    </button>
  );
}

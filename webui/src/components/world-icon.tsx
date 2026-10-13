"use client";

import { useMemo, useState } from "react";

// A world's icon. When the nightly map render has produced data/maps/<id>/thumb.png (mcmap-render in
// CT 103), that real top-down thumbnail is shown. Until then (new worlds, worlds that aren't backed up)
// it's a little pixel-art scene generated from the world's seed: same seed, same scene, so two worlds
// with the same seed look alike. The scene is always drawn underneath, so nothing flickers.

const N = 16;
type Cell = string | null;

function hash32(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) || 1;
}
function makeRng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

const BIOMES = [
  { top: "#7cbd4b", soil: "#79553d", leaves: "#4f8f2a", trees: 0.6, kind: "oak" },
  { top: "#5f9a3a", soil: "#6b4a30", leaves: "#2f6e23", trees: 1.0, kind: "oak" },
  { top: "#e3d59a", soil: "#d1bc73", leaves: "#3f8f3f", trees: 0.6, kind: "cactus" },
  { top: "#f2f6f8", soil: "#8b7355", leaves: "#3d7a52", trees: 0.8, kind: "spruce" },
  { top: "#8fcf6a", soil: "#79553d", leaves: "#f2a6d1", trees: 0.9, kind: "oak" },
  { top: "#b7b84a", soil: "#8d6a3f", leaves: "#6e8a2e", trees: 0.5, kind: "acacia" },
  { top: "#9a7bb0", soil: "#6b4a30", leaves: "#c0392b", trees: 0.8, kind: "mushroom" },
] as const;
const SKIES = [
  { top: "#6fb7ff", bottom: "#c2e4ff", sun: "#ffe66d", night: false },
  { top: "#4f93e8", bottom: "#a9d2ff", sun: "#ffe66d", night: false },
  { top: "#ef8a3e", bottom: "#ffd98a", sun: "#ff5e3a", night: false },
  { top: "#0b1f4b", bottom: "#2a4a86", sun: "#f4f1de", night: true },
] as const;
const STONE = "#7f7f7f", STONE2 = "#737373", WATER = "#3f76e4", TRUNK = "#5c4a2a", STEM = "#e8e0d0";
const ORES = ["#2b2b2b", "#2b2b2b", "#d8a07a", "#d8a07a", "#f5d442", "#4ee5e5"];

function buildScene(key: string) {
  const rnd = makeRng(hash32(key));
  const biome = BIOMES[Math.floor(rnd() * BIOMES.length)];
  const sky = SKIES[Math.floor(rnd() * SKIES.length)];
  const cells: Cell[][] = Array.from({ length: N }, () => Array<Cell>(N).fill(null));
  const put = (x: number, y: number, c: string) => { if (x >= 0 && x < N && y >= 0 && y < N) cells[y][x] = c; };

  // terrain: surface row per column from a bounded random walk (row 0 is the top of the icon)
  const h: number[] = [];
  let cur = 8 + Math.floor(rnd() * 3);
  for (let x = 0; x < N; x++) {
    const r = rnd();
    cur = Math.min(11, Math.max(6, cur + (r < 0.5 ? 0 : r < 0.75 ? -1 : 1)));
    h.push(cur);
  }
  // sometimes a pond: a flat stretch with water at the surface
  let pond: { from: number; to: number } | null = null;
  if (rnd() < 0.4) {
    const from = 1 + Math.floor(rnd() * 10), to = Math.min(N - 1, from + 3 + Math.floor(rnd() * 3));
    let level = 0;
    for (let x = from; x < to; x++) level = Math.max(level, h[x]);
    for (let x = from; x < to; x++) h[x] = level;
    pond = { from, to };
  }
  const inPond = (x: number) => !!pond && x >= pond.from && x < pond.to;
  for (let x = 0; x < N; x++) {
    const ground = inPond(x) ? h[x] + 1 : h[x];
    if (inPond(x)) put(x, h[x], WATER);
    for (let y = ground; y < N; y++) {
      const depth = y - ground;
      const r = rnd();
      put(x, y, depth === 0 ? biome.top : depth <= 2 ? biome.soil : r < 0.08 ? ORES[Math.floor(rnd() * ORES.length)] : r < 0.55 ? STONE : STONE2);
    }
  }

  // trees (one, or two in forests), never in the pond
  const trees = biome.trees >= 1 ? 2 : rnd() < biome.trees ? 1 : 0;
  for (let t = 0; t < trees; t++) {
    const c = 1 + Math.floor(rnd() * (N - 2));
    if (inPond(c)) continue;
    const g = h[c] - 1; // row just above the ground
    if (biome.kind === "cactus") { put(c, g, biome.leaves); put(c, g - 1, biome.leaves); put(c, g - 2, biome.leaves); }
    else if (biome.kind === "spruce") {
      put(c, g, TRUNK); put(c, g - 1, TRUNK);
      for (let dx = -1; dx <= 1; dx++) { put(c + dx, g - 2, biome.leaves); put(c + dx, g - 3, biome.leaves); }
      put(c, g - 4, biome.leaves); put(c, g - 5, biome.leaves);
    } else if (biome.kind === "acacia") {
      put(c, g, TRUNK); put(c, g - 1, TRUNK);
      for (let dx = -2; dx <= 2; dx++) put(c + dx, g - 2, biome.leaves);
    } else if (biome.kind === "mushroom") {
      put(c, g, STEM); put(c, g - 1, STEM);
      for (let dx = -1; dx <= 1; dx++) put(c + dx, g - 2, biome.leaves);
      put(c, g - 3, biome.leaves); put(c, g - 2, "#f2f2f2");
    } else {
      put(c, g, TRUNK); put(c, g - 1, TRUNK);
      for (let dx = -1; dx <= 1; dx++) { put(c + dx, g - 2, biome.leaves); put(c + dx, g - 3, biome.leaves); }
      put(c, g - 4, biome.leaves);
    }
  }

  // sun or moon, clouds by day, stars by night (only in empty sky)
  const skyFloor = Math.min(...h) - 1;
  const sx = 1 + Math.floor(rnd() * (N - 4)), sy = Math.floor(rnd() * 3);
  if (sy + 1 < skyFloor) for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 2; dy++) if (!cells[sy + dy][sx + dx]) put(sx + dx, sy + dy, sky.sun);
  if (sky.night) {
    for (let i = 0; i < 9; i++) { const x = Math.floor(rnd() * N), y = Math.floor(rnd() * Math.max(1, skyFloor)); if (!cells[y][x]) put(x, y, "#eef2ff"); }
  } else {
    const clouds = 1 + Math.floor(rnd() * 2);
    for (let i = 0; i < clouds; i++) {
      const y = 1 + Math.floor(rnd() * 3), x0 = Math.floor(rnd() * (N - 3)), w = 3 + Math.floor(rnd() * 2);
      if (y < skyFloor) for (let x = x0; x < Math.min(N, x0 + w); x++) if (!cells[y][x]) put(x, y, "#f6f9ff");
    }
  }
  return { cells, sky };
}

// one <rect> per run of equal colour in a row
function toRects(cells: Cell[][]) {
  const out: Array<{ x: number; y: number; w: number; c: string }> = [];
  for (let y = 0; y < N; y++) {
    let x = 0;
    while (x < N) {
      const c = cells[y][x];
      if (!c) { x++; continue; }
      let w = 1;
      while (x + w < N && cells[y][x + w] === c) w++;
      out.push({ x, y, w, c });
      x += w;
    }
  }
  return out;
}

export function WorldIcon({ id, seed }: { id: string; seed?: string | null }) {
  const key = seed && seed.trim() ? `seed:${seed.trim()}` : `id:${id}`;
  const { rects, sky, gradId } = useMemo(() => {
    const scene = buildScene(key);
    return { rects: toRects(scene.cells), sky: scene.sky, gradId: `sky-${hash32(key).toString(36)}` };
  }, [key]);
  const [thumb, setThumb] = useState<"loading" | "ok" | "none">("loading");

  return (
    <span style={{ position: "relative", display: "block", width: "100%", height: "100%" }} aria-hidden="true">
      <svg viewBox={`0 0 ${N} ${N}`} width="100%" height="100%" shapeRendering="crispEdges" style={{ display: "block" }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={sky.top} />
            <stop offset="1" stopColor={sky.bottom} />
          </linearGradient>
        </defs>
        <rect x="0" y="0" width={N} height={N} fill={`url(#${gradId})`} />
        {rects.map((r, i) => <rect key={i} x={r.x} y={r.y} width={r.w} height="1" fill={r.c} />)}
      </svg>
      {thumb !== "none" && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/maps/${encodeURIComponent(id)}/thumb.png`}
          alt=""
          onLoad={() => setThumb("ok")}
          onError={() => setThumb("none")}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", imageRendering: "pixelated", opacity: thumb === "ok" ? 1 : 0, transition: "opacity 300ms" }}
        />
      )}
    </span>
  );
}

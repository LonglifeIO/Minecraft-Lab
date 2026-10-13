"use client";

import { useEffect, useRef } from "react";

// Exact pixel boundaries derived from 1156x1012 sprite sheet (8 cols x 7 rows)
const COL_X = [0, 144, 289, 434, 578, 722, 867, 1012];
const ROW_Y = [0, 145, 289, 434, 578, 723, 867];
const SHEET_W = 1156;
const SHEET_H = 1012;
function cellW(col: number) { return (COL_X[col + 1] ?? SHEET_W) - COL_X[col]; }
function cellH(row: number) { return (ROW_Y[row + 1] ?? SHEET_H) - ROW_Y[row]; }

// Grid positions [col, row] — skip cobweb [3,2], fire [1,5], chest frames [2-6,5]
const GRID: [number, number][] = [
  // Row 0: stone, dirt, gravel, coal ore, lapis block, sandstone, stone variant, gold ore
  [0,0],[1,0],[2,0],[3,0],[4,0],[5,0],[6,0],[7,0],
  // Row 1: cobblestone, andesite, oak log, dark oak, spruce, birch, leaves, snow
  [0,1],[1,1],[2,1],[3,1],[4,1],[5,1],[6,1],[7,1],
  // Row 2: lapis ore, blue block, sand, (skip cobweb [3,2]), white, orange, magenta, light blue
  [0,2],[1,2],[2,2],[4,2],[5,2],[6,2],[7,2],
  // Row 3: yellow, lime, pink, gray, light gray, cyan, purple, blue wool
  [0,3],[1,3],[2,3],[3,3],[4,3],[5,3],[6,3],[7,3],
  // Row 4: brown, green, red, black, glowstone, brick, bookshelf, diamond ore
  [0,4],[1,4],[2,4],[3,4],[4,4],[5,4],[6,4],[7,4],
  // Row 5: obsidian only — skip fire [1,5] and chest frames [2-6,5]
  [0,5],
  // Row 6: diamond block, redstone ore, ice, blue ice, leaves, glowstone, sponge
  [0,6],[1,6],[2,6],[3,6],[4,6],[5,6],[6,6],
];

interface Cube {
  x: number; y: number;        // centre, in CSS pixels
  depth: number;               // 0 = far away (small, slow, faint) … 1 = close (big, fast, crisp)
  size: number;
  speed: number;               // upward, px per second
  swayPhase: number; swayAmp: number; swaySpeed: number;
  gridIdx: number;
  age: number; life: number;   // seconds
}

const MAX_CUBES = 40;
const BASE_ALPHA = 0.42;

function smoothstep(t: number) { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); }

// Floating block sprites behind the dashboard. Time-based so the speed is the same at any frame
// rate, three-dimensional-ish via depth (size, speed, alpha, softness and a touch of pointer and
// scroll parallax), paused while the tab is hidden, static under prefers-reduced-motion.
export function ParticleBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const sprite = new Image();
    sprite.src = "/blocks.png";
    let loaded = false;

    const cubes: Cube[] = [];
    let animId = 0;
    let running = true;
    let last = performance.now();
    let width = 0, height = 0, dpr = 1;
    let scrollY = window.scrollY;
    let mouseX = 0.5, mouseY = 0.5;   // pointer position, 0..1
    let px = 0, py = 0;               // smoothed parallax offset, -0.5..0.5

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas!.width = Math.floor(width * dpr);
      canvas!.height = Math.floor(height * dpr);
      canvas!.style.width = `${width}px`;
      canvas!.style.height = `${height}px`;
    }
    resize();

    // ~36 cubes on a laptop screen, fewer on small windows
    function maxCubes() { return Math.max(8, Math.min(MAX_CUBES, Math.round((width * height) / 32000))); }

    function makeCube(startY?: number): Cube {
      const depth = Math.random() ** 1.6;            // most cubes far away, a few up close
      const size = Math.round(14 + depth * 46);      // 14..60 px
      return {
        x: Math.random() * width,
        y: startY ?? height + size,
        depth, size,
        speed: 6 + depth * 18,                        // 6..24 px/s
        swayPhase: Math.random() * Math.PI * 2,
        swayAmp: 6 + Math.random() * 10,
        swaySpeed: 0.3 + Math.random() * 0.4,
        gridIdx: Math.floor(Math.random() * GRID.length),
        age: 0,
        life: 18 + Math.random() * 16,
      };
    }

    // Fill the screen on first paint instead of waiting for cubes to drift in from the bottom
    function prewarm() {
      const n = Math.round(maxCubes() * 0.75);
      for (let i = 0; i < n; i++) {
        const c = makeCube(Math.random() * height);
        c.age = Math.random() * c.life * 0.6;
        cubes.push(c);
      }
      cubes.sort((a, b) => a.depth - b.depth);     // far ones first, so near ones draw on top
    }

    function drawCube(c: Cube) {
      const t = c.age / c.life;
      const fade = smoothstep(t / 0.12) * (1 - smoothstep((t - 0.8) / 0.2));
      const sway = Math.sin(c.swayPhase + c.age * c.swaySpeed) * c.swayAmp;
      const parX = px * 48 * c.depth;
      const parY = py * 24 * c.depth - scrollY * 0.035 * c.depth;
      const [col, row] = GRID[c.gridIdx];
      ctx!.globalAlpha = BASE_ALPHA * (0.35 + 0.65 * c.depth) * fade;
      ctx!.imageSmoothingEnabled = c.depth < 0.45;   // far cubes soft and out of focus, near cubes crisp pixels
      ctx!.drawImage(
        sprite, COL_X[col], ROW_Y[row], cellW(col), cellH(row),
        Math.round(c.x + sway + parX - c.size / 2), Math.round(c.y + parY - c.size / 2), c.size, c.size,
      );
    }

    let spawnAcc = 0;
    function step(now: number) {
      if (!running) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx!.clearRect(0, 0, width, height);
      if (!loaded) { animId = requestAnimationFrame(step); return; }

      px += ((mouseX - 0.5) - px) * 0.04;
      py += ((mouseY - 0.5) - py) * 0.04;

      spawnAcc += dt;
      if (spawnAcc > 0.6 && cubes.length < maxCubes()) {
        spawnAcc = 0;
        cubes.push(makeCube());
        cubes.sort((a, b) => a.depth - b.depth);
      }

      for (let i = cubes.length - 1; i >= 0; i--) {
        const c = cubes[i];
        c.age += dt;
        c.y -= c.speed * dt;
        if (c.age >= c.life || c.y < -c.size * 2) { cubes.splice(i, 1); continue; }
        drawCube(c);
      }
      ctx!.globalAlpha = 1;
      animId = requestAnimationFrame(step);
    }

    function drawStatic() {
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx!.clearRect(0, 0, width, height);
      for (const c of cubes) { c.age = c.life * 0.4; drawCube(c); }
      ctx!.globalAlpha = 1;
    }

    sprite.onload = () => {
      loaded = true;
      prewarm();
      if (reduceMotion) drawStatic();
    };

    const onResize = () => { resize(); if (reduceMotion && loaded) drawStatic(); };
    const onMouse = (e: MouseEvent) => { mouseX = e.clientX / width; mouseY = e.clientY / height; };
    const onScroll = () => { scrollY = window.scrollY; };
    const onVisibility = () => {
      if (reduceMotion) return;
      if (document.hidden) { running = false; cancelAnimationFrame(animId); }
      else if (!running) { running = true; last = performance.now(); animId = requestAnimationFrame(step); }
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("mousemove", onMouse, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    if (!reduceMotion) animId = requestAnimationFrame(step);

    return () => {
      running = false;
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("mousemove", onMouse);
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return <canvas ref={canvasRef} className="fixed inset-0 pointer-events-none" style={{ zIndex: 1 }} aria-hidden="true" />;
}

"use client";

import { useEffect, useRef } from "react";

// Exact pixel boundaries derived from 1156x1012 sprite sheet (8 cols x 7 rows)
const COL_X = [0, 144, 289, 434, 578, 722, 867, 1012];
const ROW_Y = [0, 145, 289, 434, 578, 723, 867];

function cellW(col: number) { return COL_X[col + 1] !== undefined ? (COL_X[col + 1] ?? 1156) - COL_X[col] : 1156 - COL_X[col]; }
function cellH(row: number) { return ROW_Y[row + 1] !== undefined ? (ROW_Y[row + 1] ?? 1012) - ROW_Y[row] : 1012 - ROW_Y[row]; }

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
  x: number; y: number; size: number;
  speed: number; drift: number; sway: number;
  opacity: number; gridIdx: number;
  life: number; maxLife: number; dead: boolean;
}

export function ParticleBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;

    const sprite = new Image();
    sprite.src = "/blocks.png";
    let loaded = false;
    sprite.onload = () => { loaded = true; };

    let animId: number;
    const cubes: Cube[] = [];

    function resize() {
      canvas!.width = window.innerWidth;
      canvas!.height = window.innerHeight;
      ctx!.imageSmoothingEnabled = false;
    }
    resize();
    window.addEventListener("resize", resize);

    function spawn() {
      if (cubes.length >= 35 || !loaded) return;
      const size = 20 + Math.floor(Math.random() * 40);
      cubes.push({
        x: Math.random() * canvas!.width,
        y: canvas!.height + size,
        size,
        speed: 0.15 + Math.random() * 0.3,
        drift: (Math.random() - 0.5) * 0.08,
        sway: Math.random() * Math.PI * 2,
        opacity: 0,
        gridIdx: Math.floor(Math.random() * GRID.length),
        life: 0,
        maxLife: 700 + Math.random() * 500,
        dead: false,
      });
    }

    let tick = 0;
    function draw() {
      ctx!.clearRect(0, 0, canvas!.width, canvas!.height);

      if (!loaded) { animId = requestAnimationFrame(draw); return; }

      tick++;
      if (tick % 14 === 0) spawn();

      for (const c of cubes) {
        c.life++;
        c.y -= c.speed;
        c.x += c.drift + Math.sin(c.sway + c.life * 0.008) * 0.15;

        const progress = c.life / c.maxLife;
        if (progress < 0.1)       c.opacity = (progress / 0.1) * 0.4;
        else if (progress > 0.85) c.opacity = ((1 - progress) / 0.15) * 0.4;
        else                      c.opacity = 0.4;

        if (c.life >= c.maxLife || c.y < -c.size) { c.dead = true; continue; }

        const [col, row] = GRID[c.gridIdx];
        const sx = COL_X[col];
        const sy = ROW_Y[row];
        const sw = cellW(col);
        const sh = cellH(row);

        ctx!.globalAlpha = c.opacity;
        ctx!.drawImage(sprite, sx, sy, sw, sh, c.x - c.size / 2, c.y - c.size / 2, c.size, c.size);
      }

      ctx!.globalAlpha = 1;
      for (let i = cubes.length - 1; i >= 0; i--) {
        if (cubes[i].dead) cubes.splice(i, 1);
      }

      animId = requestAnimationFrame(draw);
    }
    draw();

    return () => { cancelAnimationFrame(animId); window.removeEventListener("resize", resize); };
  }, []);

  return <canvas ref={canvasRef} className="fixed inset-0 pointer-events-none" style={{ zIndex: 1, imageRendering: "pixelated" }} />;
}

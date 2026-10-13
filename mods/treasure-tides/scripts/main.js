import { world, system, BlockPermutation, ItemStack } from "@minecraft/server";

console.log("[Treasure Tides] loaded v1.5.0");

// =================== config ===================

const MIN_GAP_SEC = 12 * 60;
const MAX_GAP_SEC = 22 * 60;
const CHEST_LIFETIME_SEC = 5 * 60;
const COOLDOWN_SEC = 6 * 60;
const PROXIMITY_MIN = 6;
const PROXIMITY_MAX = 14;
const TICK = (s) => Math.floor(s * 20);

// =================== loot ===================

const LOOT_POOL = [
  { id: "minecraft:diamond",            min: 1, max: 2,  weight: 4  },
  { id: "minecraft:emerald",            min: 2, max: 5,  weight: 8  },
  { id: "minecraft:gold_ingot",         min: 4, max: 10, weight: 14 },
  { id: "minecraft:iron_ingot",         min: 6, max: 14, weight: 18 },
  { id: "minecraft:enchanted_book",     min: 1, max: 1,  weight: 3  },
  { id: "minecraft:golden_apple",       min: 1, max: 2,  weight: 7  },
  { id: "minecraft:cooked_beef",        min: 8, max: 16, weight: 18 },
  { id: "minecraft:bread",              min: 6, max: 12, weight: 14 },
  { id: "minecraft:experience_bottle",  min: 4, max: 10, weight: 8  },
  { id: "minecraft:redstone",           min: 8, max: 24, weight: 12 },
  { id: "minecraft:lapis_lazuli",       min: 6, max: 18, weight: 10 },
  { id: "minecraft:ender_pearl",        min: 1, max: 3,  weight: 6  },
  { id: "minecraft:totem_of_undying",   min: 1, max: 1,  weight: 1  },
];

// =================== state ===================

const cooldowns = new Map();
const liveChests = new Map();
let nextEventTick = system.currentTick + TICK(MIN_GAP_SEC);

// =================== helpers ===================

function pickWeighted(pool) {
  const total = pool.reduce((acc, x) => acc + x.weight, 0);
  let r = Math.random() * total;
  for (const item of pool) {
    if ((r -= item.weight) < 0) return item;
  }
  return pool[pool.length - 1];
}

function randomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function chestKey(loc, dim) {
  return `${loc.x},${loc.y},${loc.z}|${dim.id}`;
}

function findSafeSpot(player) {
  const dim = player.dimension;
  const origin = player.location;
  for (let attempt = 0; attempt < 12; attempt++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = PROXIMITY_MIN + Math.random() * (PROXIMITY_MAX - PROXIMITY_MIN);
    const x = Math.floor(origin.x + Math.cos(angle) * dist);
    const z = Math.floor(origin.z + Math.sin(angle) * dist);
    const yStart = Math.floor(origin.y) + 4;
    const yEnd = Math.max(yStart - 24, -64);
    for (let y = yStart; y > yEnd; y--) {
      try {
        const ground = dim.getBlock({ x, y, z });
        const above1 = dim.getBlock({ x, y: y + 1, z });
        const above2 = dim.getBlock({ x, y: y + 2, z });
        if (!ground || !above1 || !above2) continue;
        if (ground.isSolid && above1.isAir && above2.isAir) {
          return { x, y: y + 1, z };
        }
      } catch {
        break;
      }
    }
  }
  return null;
}

function fillChest(block) {
  const inv = block.getComponent("minecraft:inventory");
  if (!inv?.container) return 0;
  const target = 4 + Math.floor(Math.random() * 4);
  const used = new Set();
  const slots = [];
  for (let i = 0; i < inv.container.size; i++) slots.push(i);
  for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [slots[i], slots[j]] = [slots[j], slots[i]];
  }
  let placed = 0;
  for (const slot of slots) {
    if (placed >= target) break;
    const pick = pickWeighted(LOOT_POOL);
    if (used.has(pick.id)) continue;
    const count = pick.min + Math.floor(Math.random() * (pick.max - pick.min + 1));
    try {
      inv.container.setItem(slot, new ItemStack(pick.id, count));
      used.add(pick.id);
      placed++;
    } catch {
      // invalid id for this BDS version — skip
    }
  }
  return placed;
}

function fanfare(dim, loc) {
  for (let dy = 0; dy < 10; dy++) {
    try {
      dim.spawnParticle("minecraft:totem_particle", { x: loc.x + 0.5, y: loc.y + dy, z: loc.z + 0.5 });
    } catch { /* ignore */ }
  }
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    try {
      dim.spawnParticle("minecraft:happy_villager", {
        x: loc.x + 0.5 + Math.cos(a) * 1.5,
        y: loc.y + 0.4,
        z: loc.z + 0.5 + Math.sin(a) * 1.5,
      });
    } catch { /* ignore */ }
  }
}

function broadcastDrop(targetName) {
  for (const p of world.getAllPlayers()) {
    p.sendMessage(`§6⚡ A treasure has fallen near §e${targetName}§6 — find it before it vanishes!`);
    try { p.playSound("random.levelup", { volume: 0.5, pitch: 1.2 }); } catch {}
  }
}

function printStatus(messageSink) {
  const now = system.currentTick;
  const secsTo = (t) => Math.max(0, Math.floor((t - now) / 20));
  const cooldownActive = [...cooldowns.values()].filter((t) => t > now).length;
  const lines = [
    "§e=== Treasure Tides ===",
    `§7Next auto-drop in §f${secsTo(nextEventTick)}s`,
    `§7Live chests: §f${liveChests.size}`,
    `§7Players on cooldown: §f${cooldownActive}`,
  ];
  for (const line of lines) {
    if (messageSink) messageSink(line);
  }
}

// =================== main ===================

function dropTreasureNear(target) {
  if (!target) return false;
  const loc = findSafeSpot(target);
  if (!loc) return false;

  const dim = target.dimension;
  let block;
  try {
    block = dim.getBlock(loc);
    if (!block) return false;
    block.setPermutation(BlockPermutation.resolve("minecraft:chest"));
  } catch {
    return false;
  }

  const chest = dim.getBlock(loc);
  if (!chest || chest.typeId !== "minecraft:chest") return false;

  const placed = fillChest(chest);
  if (placed === 0) {
    try { chest.setPermutation(BlockPermutation.resolve("minecraft:air")); } catch {}
    return false;
  }

  fanfare(dim, loc);
  broadcastDrop(target.name);

  liveChests.set(chestKey(loc, dim), {
    dim, loc, expiresAt: system.currentTick + TICK(CHEST_LIFETIME_SEC),
  });

  return true;
}

function tryDropTreasure() {
  const players = world.getAllPlayers();
  const now = system.currentTick;
  const eligible = players.filter((p) => (cooldowns.get(p.id) ?? 0) <= now);
  if (eligible.length === 0) return false;
  const target = randomItem(eligible);
  if (dropTreasureNear(target)) {
    cooldowns.set(target.id, now + TICK(COOLDOWN_SEC));
    return true;
  }
  return false;
}

// =================== test triggers ===================
//
// Two paths so testing works regardless of how this BDS gates commands:
//   !testdrop / !teststatus       — chat keyword (any player)
//   /scriptevent treasure:drop    — when scriptEventReceive is available
//   /scriptevent treasure:status

world.beforeEvents?.chatSend?.subscribe((event) => {
  const msg = event.message.trim();
  const player = event.sender;

  if (msg === "!testdrop") {
    event.cancel = true;
    system.run(() => {
      const ok = dropTreasureNear(player);
      player.sendMessage(ok
        ? "§a✓ Treasure dropped near you."
        : "§c✗ Drop failed: no safe ground within range.");
    });
    return;
  }
  if (msg === "!teststatus") {
    event.cancel = true;
    system.run(() => printStatus((line) => player.sendMessage(line)));
    return;
  }
});

system.afterEvents?.scriptEventReceive?.subscribe((event) => {
  if (event.id === "treasure:drop") {
    let target = null;
    if (event.sourceEntity?.typeId === "minecraft:player") {
      target = event.sourceEntity;
    } else {
      const players = world.getAllPlayers();
      if (players.length > 0) target = randomItem(players);
    }
    if (!target) return;
    const ok = dropTreasureNear(target);
    if (event.sourceEntity?.typeId === "minecraft:player") {
      event.sourceEntity.sendMessage(ok
        ? `§a✓ Treasure dropped near §e${target.name}§a.`
        : "§c✗ Drop failed: no safe ground within range.");
    }
  } else if (event.id === "treasure:status") {
    const sink = event.sourceEntity?.typeId === "minecraft:player"
      ? (line) => event.sourceEntity.sendMessage(line)
      : null;
    printStatus(sink);
  }
});

// =================== main loop ===================

system.runInterval(() => {
  const now = system.currentTick;

  if (now >= nextEventTick) {
    if (tryDropTreasure()) {
      const span = MAX_GAP_SEC - MIN_GAP_SEC;
      nextEventTick = now + TICK(MIN_GAP_SEC + Math.random() * span);
    } else {
      nextEventTick = now + TICK(60);
    }
  }

  for (const [key, info] of liveChests.entries()) {
    if (now < info.expiresAt) continue;
    try {
      const b = info.dim.getBlock(info.loc);
      if (b?.typeId === "minecraft:chest") {
        b.setPermutation(BlockPermutation.resolve("minecraft:air"));
        for (let i = 0; i < 6; i++) {
          try {
            info.dim.spawnParticle("minecraft:basic_smoke_particle", {
              x: info.loc.x + 0.5, y: info.loc.y + 0.5, z: info.loc.z + 0.5,
            });
          } catch {}
        }
      }
    } catch {}
    liveChests.delete(key);
  }
}, 20);

import { world, system } from "@minecraft/server";

console.log("[Family Compass] loaded v1.2.0");

const UPDATE_INTERVAL_TICKS = 10; // 0.5s @ 20 tps — actionbar fades after ~3s, refresh well under that

function distance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function findBestTarget(player, players) {
  const others = players.filter((p) => p.id !== player.id);
  if (others.length === 0) return null;

  // Cross-dimension distance is meaningless, so prefer same-dimension players.
  const sameDim = others.filter((p) => p.dimension.id === player.dimension.id);
  if (sameDim.length > 0) {
    let nearest = sameDim[0];
    let nearestDist = distance(player.location, nearest.location);
    for (const other of sameDim.slice(1)) {
      const d = distance(player.location, other.location);
      if (d < nearestDist) {
        nearest = other;
        nearestDist = d;
      }
    }
    return { player: nearest, distance: nearestDist, sameDim: true };
  }
  return { player: others[0], distance: 0, sameDim: false };
}

function dimLabel(dimId) {
  return dimId.replace("minecraft:", "").replace("the_", "").replace(/_/g, " ");
}

system.runInterval(() => {
  const players = world.getAllPlayers();
  if (players.length < 2) return; // nothing useful to show solo

  for (const player of players) {
    const found = findBestTarget(player, players);
    if (!found) continue;
    if (found.sameDim) {
      const dist = Math.round(found.distance);
      player.onScreenDisplay.setActionBar(`§e${found.player.name}  §f${dist}§7 blocks`);
    } else {
      player.onScreenDisplay.setActionBar(`§e${found.player.name}  §7in §b${dimLabel(found.player.dimension.id)}`);
    }
  }
}, UPDATE_INTERVAL_TICKS);

import { world, system } from "@minecraft/server";

const VERSION = "1.3.5";
// Momentum jump: the fraction of your take-off ground speed a hop keeps on average. Air drag (~0.91 per
// tick) bleeds the forward burst off, so the burst is sized from the hop's air time; 1.0 means a momentum
// jump never slows you down, even with Speed III (2026-10-13). Lower it for a steeper arc.
const MOMENTUM_CARRY = 1.0;
// Slide: starts at speed x SLIDE_BOOST (clamped to [SLIDE_MIN, SLIDE_MAX] blocks/tick; sprint is 0.28).
// The boost fades by SLIDE_BOOST_FADE per tick down to SLIDE_KEEP of your running speed. That holds
// for SLIDE_HOLD_TICKS (bleeding only SLIDE_BLEED per tick), then the slide decelerates at
// SLIDE_BLEED_END per tick: ~2 s total from a sprint, ~2.5 s from a Speed III sprint (0.99 all the way
// through "goes on for too long", 2026-10-13). SLIDE_STEER is how fast the slide eases toward where
// you look, per tick.
const SLIDE_BOOST = 1.5, SLIDE_MIN = 0.3, SLIDE_MAX = 0.9, SLIDE_KEEP = 0.9;
const SLIDE_BOOST_FADE = 0.93, SLIDE_HOLD_TICKS = 20, SLIDE_BLEED = 0.995, SLIDE_BLEED_END = 0.95, SLIDE_STEER = 0.12;
console.log(`[Superpowers] loaded v${VERSION}`);

// Each ability is switched on per player with a scoreboard tag; the dashboard's hidden Powers
// panel sends `tag "<gamertag>" add sp_dash` and friends. No tag = this pack does nothing for you.
const ABILITIES = {
  sp_doublejump: "Double jump: tap jump again in mid-air",
  sp_chargejump: "Super jump: hold sneak on the ground, let go to launch 10-20 blocks, then glide (sneak to drop)",
  sp_momentum: "Momentum jump: the faster you run, the higher you jump",
  sp_dash: "Dash: tap sneak twice quickly",
  sp_slam: "Ground slam: sneak while falling",
  sp_slide: "Slide: sneak while sprinting or as you land to skid along the ground",
  sp_freeze: "Time freeze: mobs and arrows near you stop",
  sp_climb: "Spider climb: sneak while facing a wall",
  sp_punch: "Super punch: your hits send mobs flying",
  sp_pull: "Force pull: sneak while looking at a mob",
};

const state = new Map(); // player.id -> tracking between ticks

function track(p) {
  let s = state.get(p.id);
  if (!s) {
    s = { wasSneaking: false, airTicks: 0, doubleJumped: false, jumpReleased: false, launchSpeed: 0, charge: 0,
          lastSneakTick: -100, slamming: false, peakY: p.location.y, shown: "", gliding: false,
          sliding: false, slideFloor: 0, slideExcess: 0, slideFrom: 0, slideGain: 1, lastPush: 0, slideDir: null, slideTicks: 0, lastHop: -100, hopTicks: 0,
          wasSprinting: false, groundSpeed: 0, prevVy: 0, launchVy: 0 };
    state.set(p.id, s);
  }
  return s;
}

function safe(fn) { try { fn(); } catch { /* an entity vanished mid-tick, or a cosmetic call failed */ } }

function particle(p, name, loc) { safe(() => p.dimension.spawnParticle(name, loc ?? p.location)); }
function sound(p, id, pitch = 1, volume = 0.7) { safe(() => p.playSound(id, { pitch, volume })); }
function bar(p, text) { safe(() => p.onScreenDisplay.setActionBar(text)); }

// Horizontal knockback strength that makes a hop launched at vertical speed `vy` cover ground at
// `groundSpeed` on average. One burst at take-off only: per-tick pushes fight the client's physics,
// and the vertical argument is not a plain "set" (passing the current vertical speed back in each
// tick cancelled gravity and sent the player into orbit, 2026-10-13).
function carryBurst(groundSpeed, vy) {
  const T = Math.max(2, 25 * vy); // ticks airborne, up and down (gravity 0.08/tick)
  return MOMENTUM_CARRY * groundSpeed * 0.09 * T / (1 - Math.pow(0.91, T));
}

function landSlam(p, s) {
  s.slamming = false;
  const fell = s.peakY - p.location.y;
  if (fell < 3) return;
  const loc = p.location;
  const power = Math.min(1 + fell / 10, 2.5);
  let hit = 0;
  for (const e of p.dimension.getEntities({ location: loc, maxDistance: 7, excludeTypes: ["minecraft:player"] })) {
    safe(() => {
      const dx = e.location.x - loc.x, dz = e.location.z - loc.z;
      const l = Math.hypot(dx, dz) || 1;
      e.applyKnockback(dx / l, dz / l, 2.5 * power, 0.8);
      e.applyDamage(4 * power);
      hit++;
    });
  }
  particle(p, "minecraft:knockback_roar_particle", loc);
  particle(p, "minecraft:large_explosion", loc);
  sound(p, "random.explode", 1.3, 0.6);
  bar(p, `SLAM! fell ${fell.toFixed(0)} blocks, hit ${hit}`);
}

system.runInterval(() => {
  const tick = system.currentTick;
  for (const p of world.getAllPlayers()) {
    let tags;
    try { tags = p.getTags().filter((t) => t.startsWith("sp_")); } catch { continue; }
    const s = track(p);

    // Tell the player what just got switched on or off
    const shown = tags.slice().sort().join(",");
    if (shown !== s.shown) {
      s.shown = shown;
      const names = tags.map((t) => (ABILITIES[t] || t).split(":")[0]);
      bar(p, tags.length ? `Powers: ${names.join(", ")}` : "Powers off");
      sound(p, tags.length ? "random.levelup" : "random.orb", 1.2, 0.5);
    }
    if (tags.length === 0) { s.airTicks = 0; s.charge = 0; s.slamming = false; s.sliding = false; continue; }
    const has = (t) => tags.includes(t);

    const onGround = p.isOnGround;
    const sneaking = p.isSneaking;
    const sprinting = p.isSprinting;
    const jumping = p.isJumping;
    const loc = p.location;
    const vel = p.getVelocity();

    const landed = onGround && s.airTicks >= 3; // first tick back down after a real hop or fall
    const slammed = onGround && s.slamming;
    if (onGround) {
      if (s.slamming) landSlam(p, s);
      if (s.gliding) { s.gliding = false; bar(p, "Landed"); }
      s.airTicks = 0; s.doubleJumped = false; s.jumpReleased = false; s.launchSpeed = 0; s.launchVy = 0; s.peakY = loc.y;
    } else {
      s.airTicks++;
      if (loc.y > s.peakY) s.peakY = loc.y;
    }

    // Double jump: let go of jump after take-off, then press it again. Any gap counts, so a quick
    // double tap works (the old 6-tick minimum swallowed fast taps). With momentum jump also on, it
    // pushes along the current heading with a burst sized from the take-off ground speed instead of
    // the fixed push, so a sprint launch chains into a second jump without bleeding off ground speed.
    if (!onGround && !jumping) s.jumpReleased = true;
    if (has("sp_doublejump") && !onGround && jumping && s.jumpReleased && s.airTicks > 1 && !s.doubleJumped) {
      s.doubleJumped = true;
      // A fixed 0.95 up capped (or even cut) the climb when the player was still rising fast from a
      // momentum launch: "feels like it hits a ceiling" (2026-10-13). Keep any upward speed and add to
      // it, with the plain double jump as the floor and a cap so stacked launches stay sane (2.0 is
      // ~25 blocks of climb). The server's velocity read can lag a tick or two right after a launch,
      // so the climb speed is the best of this read, last tick's read and what the launch predicts; and
      // knockback halves a downward speed before adding, so a late (falling) double jump compensates
      // for that instead of coming out weak. Net: never slower than you already were, same height.
      const vyNow = Math.max(vel.y, s.prevVy - 0.08, s.launchVy > 0 ? s.launchVy - 0.08 * Math.max(0, s.airTicks - 1) : 0);
      const desired = Math.min(Math.max(0.95, vyNow + 0.6), 2.0);
      const up = vel.y < 0 ? desired - vel.y / 2 : desired;
      const speed = Math.hypot(vel.x, vel.z);
      let dx, dz, forward = 0.5;
      if (has("sp_momentum") && speed > 0.1) {
        dx = vel.x / speed; dz = vel.z / speed;
        forward = Math.max(0.5, s.launchSpeed > 0 ? carryBurst(s.launchSpeed, desired) : speed * 1.1);
      } else {
        const v = p.getViewDirection();
        const h = Math.hypot(v.x, v.z) || 1;
        dx = v.x / h; dz = v.z / h;
      }
      safe(() => p.applyKnockback(dx, dz, forward, up));
      safe(() => p.addEffect("resistance", 200, { amplifier: 4, showParticles: false })); // the landing never hurts
      particle(p, "minecraft:knockback_roar_particle", loc);
      sound(p, "mob.breeze.jump", 1.1, 0.6); // airy whoosh; the dragon flap was too heavy (2026-10-13)
    }

    // Super jump: hold sneak on the ground (up to 1.5 s), release to launch. Vertical strength v
    // reaches roughly 6*v*v blocks: 1.3 -> ~10 blocks, 1.8 -> ~20 blocks.
    if (has("sp_chargejump")) {
      if (s.sliding) {
        s.charge = 0; // a slide is not a charge: standing up out of one must not launch you
      } else if (sneaking && onGround) {
        s.charge = Math.min(s.charge + 1, 30);
        if (s.charge % 5 === 0) bar(p, `Charging ${"\u25AE".repeat(s.charge / 5)}${"\u25AF".repeat(6 - s.charge / 5)}`);
      } else if (!sneaking && s.charge >= 6) {
        const v = p.getViewDirection();
        const power = 1.3 + (s.charge / 30) * 0.5;
        s.launchVy = power;
        safe(() => p.applyKnockback(v.x, v.z, 0.4, power));
        safe(() => p.addEffect("resistance", 200, { amplifier: 4, showParticles: false })); // the landing never hurts
        sound(p, "mob.ghast.fireball", 1.4, 0.5);
        particle(p, "minecraft:large_explosion", loc);
        bar(p, "Launch! Look where you want to glide, sneak to drop");
        s.charge = 0;
        s.gliding = true;
      } else if (!sneaking) {
        s.charge = 0;
      }
    }

    // Glide after a charge-jump launch: on the way down, keep moving where the player looks and
    // mostly cancel gravity (~1 block/s descent, ~7 blocks/s forward). Sneak drops out of the glide.
    // Only the charge jump glides: this per-tick motion override made the double jump and momentum
    // jump fall floaty and jittery when they also set the flag (fixed 2026-10-13).
    if (s.gliding && !onGround && vel.y < 0 && !sneaking && !s.slamming) {
      const v = p.getViewDirection();
      const h = Math.hypot(v.x, v.z) || 1;
      safe(() => p.applyKnockback(v.x / h, v.z / h, 0.35, 0.03));
      if (tick % 5 === 0) particle(p, "minecraft:endrod", { x: loc.x, y: loc.y + 0.5, z: loc.z });
    }

    // Momentum jump: leaving the ground at speed throws you higher and forward (super speed + sprint =
    // big air). The take-off ground speed is remembered so a double jump on the way can keep it.
    if (has("sp_momentum") && !onGround && s.airTicks === 1 && jumping) {
      const speed = Math.hypot(vel.x, vel.z);
      if (speed > 0.16) {
        const vy = 0.42 + Math.min((speed - 0.12) * 4, 1.5);
        s.launchSpeed = speed; s.launchVy = vy;
        const forward = carryBurst(speed, vy);
        safe(() => p.applyKnockback(vel.x / speed, vel.z / speed, forward, vy));
        safe(() => p.addEffect("resistance", 200, { amplifier: 4, showParticles: false }));
        particle(p, "minecraft:knockback_roar_particle", loc);
        sound(p, "mob.breeze.jump", 0.8, 0.7); // same whoosh, deeper for the bigger launch
      }
    }

    // Dash: two sneak presses within 8 ticks
    if (has("sp_dash") && sneaking && !s.wasSneaking) {
      if (tick - s.lastSneakTick <= 8) {
        const v = p.getViewDirection();
        safe(() => p.applyKnockback(v.x, v.z, 3.2, 0.2));
        particle(p, "minecraft:endrod", loc);
        sound(p, "mob.endermen.portal", 1.8, 0.4);
        s.lastSneakTick = -100;
      } else {
        s.lastSneakTick = tick;
      }
    }

    // Ground slam: sneak while falling; resistance covers the landing. Slam and slide are one-or-the-other
    // on the dashboard (holding sneak into a landing means different things to each).
    if (has("sp_slam") && !onGround && sneaking && s.airTicks > 8 && vel.y < 0 && !s.slamming) {
      s.slamming = true;
      safe(() => p.addEffect("resistance", 80, { amplifier: 4, showParticles: false }));
      safe(() => p.applyKnockback(0, 0, 0, -1.8));
      sound(p, "mob.ghast.fireball", 0.7, 0.5);
    }

    // Slide (Titanfall-style): sneak while sprinting, or hold sneak as you land, and you skid along the
    // ground. The slide starts at a boost over the faster of your current speed and the ground speed you
    // had before take-off (so Speed III carries into a landing slide); the boost fades over ~1 s down to
    // SLIDE_KEEP of your running speed, which then bleeds off slowly, so a slide costs you a little
    // momentum, never a lot. Steering eases toward the camera. Let go of sneak to stand up, or jump out
    // with the speed intact (with momentum jump on that chains into a big launch, and the next landing
    // slides faster, up to SLIDE_MAX). A slam landing never slides; a short drop mid-slide keeps it
    // going. These are the one safe per-tick pushes: on the ground with zero vertical they can't fight
    // gravity or a jump arc (see carryBurst for why air pushes are off the table).
    if (has("sp_slide")) {
      const speed = Math.hypot(vel.x, vel.z);
      if (!s.sliding) {
        const fromLanding = landed && sneaking && !slammed;
        const fromSprint = onGround && sneaking && !s.wasSneaking && (sprinting || s.wasSprinting);
        const base = Math.max(speed, fromLanding ? s.groundSpeed : 0);
        if ((fromLanding || fromSprint) && base > 0.1) {
          s.sliding = true; s.slideTicks = 0; s.lastPush = 0;
          s.slideFrom = Math.max(speed, 0.15); // where the ramp starts: your actual speed right now
          const startSpeed = Math.min(SLIDE_MAX, Math.max(base * SLIDE_BOOST, SLIDE_MIN));
          s.slideFloor = Math.min(startSpeed, base * SLIDE_KEEP);
          s.slideExcess = startSpeed - s.slideFloor;
          s.hopTicks = 0;
          if (speed > 0.05) {
            s.slideDir = { x: vel.x / speed, z: vel.z / speed };
          } else {
            const v = p.getViewDirection();
            const h = Math.hypot(v.x, v.z) || 1;
            s.slideDir = { x: v.x / h, z: v.z / h };
          }
          sound(p, "mob.breeze.slide", 1.0, 0.6);
        }
      }
      if (onGround) s.groundSpeed = speed; // remembered for the next landing
      if (s.sliding) {
        s.slideTicks++;
        // Ramp from your actual speed to the full slide speed over 5 ticks. A sprint slide starts near
        // the floor anyway, but a landing slide after a big jump starts from a crawl (air drag), and
        // yanking that up to full speed on the touchdown tick stuttered (2026-10-13).
        const full = s.slideFloor + s.slideExcess;
        const target = s.slideFrom + (full - s.slideFrom) * Math.min(1, s.slideTicks / 5);
        const stuck = onGround && s.slideTicks > 6 && speed < 0.04 && s.lastPush > 0.15;
        let aheadAir = false;
        if (stuck) {
          // Minecraft's crouch guard won't let a sneaking player step off a drop, so a slide jams at
          // every edge. Air ahead at foot level = an edge: a tiny one-shot hop clears the guard and the
          // slide carries on after the landing. Anything else ahead = a wall: stop cleanly.
          safe(() => {
            const ax = loc.x + s.slideDir.x * 0.8, az = loc.z + s.slideDir.z * 0.8;
            const foot = p.dimension.getBlock({ x: ax, y: loc.y + 0.1, z: az });
            const head = p.dimension.getBlock({ x: ax, y: loc.y + 1.1, z: az });
            aheadAir = !!foot && foot.isAir && !!head && head.isAir; // clear at foot AND head height = an edge
          });
        }
        // a hop that didn't get us moving again (still ~0 three ticks later) means it wasn't a simple edge
        const hopFailed = s.hopTicks > 0 && tick - s.lastHop >= 3 && tick - s.lastHop <= 4 && speed < 0.05;
        if (!sneaking || target < 0.1 || (stuck && !aheadAir) || hopFailed || (!onGround && s.airTicks > 10)) {
          s.sliding = false; // stood up, ran out, hit a wall, or properly left the ground
        } else if (stuck && aheadAir && tick - s.lastHop > 8) {
          s.lastHop = tick; s.hopTicks++;
          const sx = s.slideDir.x, sz = s.slideDir.z, push = s.lastPush;
          safe(() => p.applyKnockback(sx, sz, push, 0.25));
        } else if (onGround || (s.airTicks <= 2 && vel.y <= 0.05)) {
          // Keep pushing through a 1-2 tick ground-flag flicker (hard landings, small steps down) so the
          // speed doesn't alternate; never while rising, so a jump out of the slide is untouched.
          // How much of last tick's push became movement (the engine applies ground friction between
          // the push and the move: measured ~0.67 on 2026-10-13). Smoothed per player, so the real
          // slide speed tracks the target.
          if (s.slideTicks > 2 && s.lastPush > 0 && speed > 0.05) {
            const f = Math.min(1.2, Math.max(0.4, speed / s.lastPush));
            s.slideGain += 0.2 * (f - s.slideGain);
          }
          const v = p.getViewDirection();
          const h = Math.hypot(v.x, v.z) || 1;
          const nx = s.slideDir.x * (1 - SLIDE_STEER) + (v.x / h) * SLIDE_STEER;
          const nz = s.slideDir.z * (1 - SLIDE_STEER) + (v.z / h) * SLIDE_STEER;
          const nl = Math.hypot(nx, nz) || 1;
          s.slideDir = { x: nx / nl, z: nz / nl };
          s.slideExcess *= SLIDE_BOOST_FADE;
          s.slideFloor *= s.slideTicks <= SLIDE_HOLD_TICKS ? SLIDE_BLEED : SLIDE_BLEED_END;
          const push = Math.min(SLIDE_MAX * 1.5, target / s.slideGain);
          s.lastPush = push;
          const sx = s.slideDir.x, sz = s.slideDir.z;
          safe(() => p.applyKnockback(sx, sz, push, 0));
          // dust trails behind the player, never through the first-person camera
          if (tick % 2 === 0) particle(p, "minecraft:basic_smoke_particle", { x: loc.x - sx * 0.7, y: loc.y + 0.15, z: loc.z - sz * 0.7 });
        }
      }
    } else if (s.sliding) {
      s.sliding = false;
    }

    // Time freeze: everything that isn't a player stops within 12 blocks
    if (has("sp_freeze")) {
      for (const e of p.dimension.getEntities({ location: loc, maxDistance: 12, excludeTypes: ["minecraft:player"] })) {
        safe(() => {
          e.clearVelocity();
          e.addEffect("slowness", 10, { amplifier: 15, showParticles: false });
          e.addEffect("weakness", 10, { amplifier: 5, showParticles: false });
        });
      }
      if (tick % 10 === 0) particle(p, "minecraft:endrod", { x: loc.x + (Math.random() - 0.5) * 8, y: loc.y + 1 + Math.random() * 2, z: loc.z + (Math.random() - 0.5) * 8 });
    }

    // Spider climb: sneak while facing a wall
    if (has("sp_climb") && sneaking && vel.y < 0.25) {
      const hit = p.getBlockFromViewDirection({ maxDistance: 1.6, includeLiquidBlocks: false, includePassableBlocks: false });
      if (hit && hit.face !== "Up" && hit.face !== "Down") {
        safe(() => p.applyKnockback(0, 0, 0, 0.32));
        if (tick % 6 === 0) sound(p, "step.stone", 1.3, 0.3);
      }
    }

    // Force pull: sneak while looking at a mob, it comes to you
    if (has("sp_pull") && sneaking && tick % 2 === 0) {
      const hits = p.getEntitiesFromViewDirection({ maxDistance: 16 });
      for (const h of hits.slice(0, 1)) {
        const e = h.entity;
        if (!e || e.typeId === "minecraft:player") continue;
        const dx = loc.x - e.location.x, dy = loc.y + 1 - e.location.y, dz = loc.z - e.location.z;
        const d = Math.hypot(dx, dy, dz);
        if (d < 2.5) continue;
        const k = 0.35 + Math.min(d, 12) * 0.02;
        safe(() => e.applyImpulse({ x: (dx / d) * k, y: (dy / d) * k + 0.05, z: (dz / d) * k }));
        particle(p, "minecraft:endrod", e.location);
      }
    }

    s.wasSneaking = sneaking;
    s.wasSprinting = sprinting;
    s.prevVy = vel.y;
  }
}, 1);

// Super punch: melee hits launch the target
world.afterEvents.entityHurt.subscribe((ev) => {
  const src = ev.damageSource;
  const p = src && src.damagingEntity;
  if (!p || p.typeId !== "minecraft:player" || src.cause !== "entityAttack") return;
  if (!p.hasTag("sp_punch")) return;
  const t = ev.hurtEntity;
  const v = p.getViewDirection();
  safe(() => t.applyKnockback(v.x, v.z, 4.5, 0.9));
  sound(p, "mob.irongolem.hit", 0.8, 0.8);
});

world.afterEvents.playerLeave.subscribe((ev) => { state.delete(ev.playerId); });

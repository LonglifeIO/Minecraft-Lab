// Welcome: one friendly welcome box per player, shown once they are actually ready for it.
//
// Why this exists: several add-ons pop their own box on a player's first spawn (language pickers,
// "quick setup" screens, "thanks for installing" notes), and Bedrock shows only one form at a time,
// so they fight with Origins' class picker and each other. This pack quiets the ones we know about,
// waits until the player has picked an origin (when Origins is installed), then shows a single,
// tidy welcome with an Origins guide.
//
// The host can re-open it for a player from the dashboard console:  tag "Name" add welcome_show
// Operators (worlds with cheats on) also get /function admin/on, admin/off, admin/god and admin/kit:
// a quick switch between normal play as your origin and a fly-anywhere test mode. See functions/admin/.
import { world, system } from "@minecraft/server";
import { ActionFormData, FormCancelationReason } from "@minecraft/server-ui";

// ---- Edit this block for your world ---------------------------------------------------------
const TITLE = "Welcome to the Playground";
const INTRO =
  "§7A test world for trying out add-ons. Build, explore, experiment: nothing here is precious.§r";
// [name, one-line description] pairs, shown under "What's in this world".
const FEATURES = [
  ["Origins", "You picked an origin: each has its own powers and drawbacks. An Orb of Origin lets you change it."],
  ["Roll and Stamina", "A stamina bar, dodge rolls and wall climbing."],
  ["WAILA", "Names whatever you look at."],
  ["A Magic Way", "100+ spells from scrolls, with a mana bar."],
  ["Bedrock Essentials+", "Tree capitator, vein miner and other small survival helpers."],
  ["Effortless Building", "Place lines, walls and floors in one go, like the Java mod."],
  ["More Ores", "28 new ores with matching armor and tools."],
  ["Mythological Craft", "Dragons, cyclops, ogres and giants roam the world."],
  ["Recurrent Complex", "Towers, temples and dungeons to find."],
  ["More Simple Structures", "Lots of smaller structures to stumble on."],
];
const TIPS = [
  "New structures and creatures only appear in parts of the map nobody has explored yet, so head somewhere new.",
  "Lost this box? Ask the host to bring it back from the dashboard.",
  "This world restarts now and then when add-ons change. If it's not in the LAN list afterwards, join it by address once.",
];
// What each thing on the screen is and which add-on it belongs to (shown under "Your screen").
const SCREEN = [
  ["Hearts, hunger, hotbar, XP", "Plain Minecraft, untouched."],
  ["Green bar: stamina (Roll and Stamina)", "Sprinting, climbing and rolling spend it; it refills while you rest. Roll: jump, then press sneak in mid-air."],
  ["Spell panel and mana (A Magic Way)", "Your chosen spell and how much mana you have. Spells come from scrolls; sneak cancels a cast."],
  ["Name under the crosshair (WAILA)", "Whatever block or creature you're looking at."],
  ["Gold hearts above your health", "Bonus hearts from your origin."],
  ["Bar above the hearts (Origins)", "Your origin's power charging up. Each origin explains its own powers in the picker's View page."],
  ["Testing (operators)", "/function admin/on for creative, admin/off to play normally, admin/god to stay unhurt, admin/kit for basic gear."],
];
// Every origin in Origins BE 1.5.5, from its own text files (names and blurbs), grouped by pack.
const ORIGINS = [
  ["Classic", "Arachnid", "Climbs and traps foes in cobweb: a perfect hunter."],
  ["Classic", "Avian", "Lost the ability to fly long ago; now glides from place to place."],
  ["Classic", "Blazeborn", "Descended from the Blaze; naturally immune to the perils of the Nether."],
  ["Classic", "Elytrian", "Flies on the winds; uncomfortable without enough space overhead."],
  ["Classic", "Enderian", "Child of the Ender Dragon: can teleport, but is vulnerable to water."],
  ["Classic", "Feline", "Cat-like: scares creepers away and always lands safely on its feet."],
  ["Classic", "Human", "A regular human. Your ordinary Minecraft experience awaits."],
  ["Classic", "Merling", "A natural inhabitant of the ocean; can't stay out of water for long."],
  ["Classic", "Phantom", "Half human, half phantom; can switch between the two forms."],
  ["Classic", "Shulk", "Related to Shulkers, with a protective shell-like skin."],
  ["Extra", "Bee", "A little honey maker with small wings but a big love for flowers."],
  ["Extra", "Beetle", "Smaller than humans, larger than beetles, and quite the armor."],
  ["Extra", "Blighter", "Born of the Pale Garden; brings a gloomy, uncomfortable presence."],
  ["Extra", "Cow", "A beefy cow that eats bread and produces milk."],
  ["Extra", "Dire Wolf", "A natural born hunter with a craving for meat; nothing stops it devouring its next meal."],
  ["Extra", "Fallen Angel", "A failure of the Aether, fallen from a former standing."],
  ["Extra", "Feral Wolfwalker", "Looks human, but beware the wolf hiding in sheep's clothing. The wilder one."],
  ["Extra", "Fox", "Dwells around settlements waiting for treasure to be left unguarded. Weak, but hides extremely well and escapes most danger with ease."],
  ["Extra", "Frogling", "A strange humanoid frog. Smells like swamp water."],
  ["Extra", "Ghastling", "Is it a balloon? No, it's a Ghastling!"],
  ["Extra", "Goat", "Roams, climbs mountains and defends itself with its horns."],
  ["Extra", "Krakkling", "Trench-dwelling creatures of myth, said to descend from a legendary kraken."],
  ["Extra", "Looshian", "Said to be the common ancestor of almost all Origins; extremely rare."],
  ["Extra", "Pufferfish", "A small fish that may get toxic if it blows up."],
  ["Extra", "Rabbit", "A fast and hard working rabbit."],
  ["Extra", "Raccoon Lord", "The lord of all the raccoons."],
  ["Extra", "Ravager", "Big and slow, hits hard and lives for combat."],
  ["Extra", "Redstone Bug", "Anyone who has dealt with redstone can tell you of its annoying bugs."],
  ["Extra", "Sheep", "A sheep with a wool growth problem."],
  ["Extra", "Slime", "A slime that has evolved into the shape of a human. Very unpleasant to touch."],
  ["Extra", "Snow Dude", "The chillest guy you will ever meet, and not just because it's made of snow."],
  ["Extra", "Starborne", "Born from the stars: nonviolent, star-obsessed, mysterious and potentially powerful."],
  ["Extra", "Strider", "A peaceful, lava-walking creature that loves warped fungus and dislikes being cold."],
  ["Extra", "TMOTD", "The Monster of the Depths was long forgotten, but now it rains terror in the sea."],
  ["Extra", "Tame Wolfwalker", "Looks human, but beware the wolf hiding in sheep's clothing."],
  ["Extra", "Twin Sporeling", "Mutated nether fungi come to life, with some interesting abilities."],
  ["Extra", "Witherin", "A long-dead skeleton that has mastered stone tools."],
  ["Weppl's", "Duck", "Peace was never an option."],
  ["Weppl's", "Llama", "A llama that can spit long range and be ridden places."],
  ["Weppl's", "The Cute One", "The cutest of them all."],
  ["Weppl's", "Troll", "A griefer, thief, and master escapist."],
];
const ORIGINS_PER_PAGE = 7;
// Other add-ons whose first-join pop-ups we quiet. Each one is a known flag the add-on itself sets
// after showing its box; setting it first means the box never appears.
const QUIET_OTHER_FIRST_JOIN_BOXES = true;
// ---------------------------------------------------------------------------------------------

const SEEN = "welcome:seen";
// Bump this when the box's content changes (new legend, new add-ons): everyone sees it once more.
const WELCOME_VERSION = "2";
const POLL_TICKS = 20;
const MAX_WAIT_TICKS = 20 * 60 * 10; // stop waiting for an origin pick after 10 minutes
const SHOW_DELAY_TICKS = 60; // breathing room after the origin pick closes
const BUSY_RETRY_TICKS = 40;
const BUSY_RETRIES = 30;

function isValid(entity) {
  try {
    return typeof entity.isValid === "function" ? entity.isValid() : entity.isValid;
  } catch {
    return false;
  }
}

function originsInstalled() {
  try {
    return world.scoreboard.getObjective("od:alive") !== undefined;
  } catch {
    return false;
  }
}

function hasChosenOrigin(player) {
  try {
    return player.hasTag("origins:selected_origin");
  } catch {
    return false;
  }
}

function originName(player) {
  // Origins tags the player "origins:selected_<name>" next to the generic "origins:selected_origin".
  try {
    const tag = player.getTags().find((t) => t.startsWith("origins:selected_") && t !== "origins:selected_origin");
    if (!tag) return null;
    // e.g. "origins:selected_base_feline_origin" -> "Feline"
    return tag
      .slice("origins:selected_".length)
      .replace(/^(base|extra|weppl)_/, "")
      .replace(/_origin$/, "")
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  } catch {
    return null;
  }
}

function quietOtherFirstJoinBoxes(player) {
  if (!QUIET_OTHER_FIRST_JOIN_BOXES) return;
  // Farmer's Delight shows its welcome unless the player already carries this tag.
  try {
    player.addTag("farmersdelight");
  } catch {}
  // Effortless Building's "Quick Setup" (device tier) runs until this flag is set; the defaults it
  // would keep are the same ones "Skip" keeps, and Settings offers it again later.
  try {
    if (player.getDynamicProperty("eb:onboarded") === undefined) {
      player.setDynamicProperty("eb:onboarded", true);
    }
  } catch {}
}

function markSeen(player) {
  try {
    player.setDynamicProperty(SEEN, WELCOME_VERSION);
  } catch {}
}

function bodyText(player) {
  const origin = originName(player);
  const who = origin ? `§lHi ${player.name}, the ${origin}!§r` : `§lHi ${player.name}!§r`;
  return `${who}\n\n${INTRO}\n\nPick a button to look around, or jump straight in.`;
}

async function showList(player, title, rows) {
  const form = new ActionFormData().title(title);
  const text = rows.map(([name, desc]) => `§e§l${name}§r\n${desc}`).join("\n\n");
  form.body(text).button("Back");
  try {
    await form.show(player);
  } catch {}
}

async function showOriginsGuide(player, page = 0) {
  const pages = Math.ceil(ORIGINS.length / ORIGINS_PER_PAGE);
  const rows = ORIGINS.slice(page * ORIGINS_PER_PAGE, (page + 1) * ORIGINS_PER_PAGE);
  const text = rows.map(([pack, name, desc]) => `§e§l${name}§r §8(${pack})§r\n${desc}`).join("\n\n");
  const form = new ActionFormData()
    .title(`Origins guide  ${page + 1}/${pages}  (${ORIGINS.length} origins)`)
    .body(`§7In the picker, use < and > to move through them, then Select. An Orb of Origin lets you change later.§r\n\n${text}`);
  const buttons = [];
  if (page + 1 < pages) buttons.push(["Next page", () => showOriginsGuide(player, page + 1)]);
  if (page > 0) buttons.push(["Previous page", () => showOriginsGuide(player, page - 1)]);
  buttons.push(["Back to welcome", () => showMain(player)]);
  for (const [label] of buttons) form.button(label);
  let response;
  try {
    response = await form.show(player);
  } catch {
    return;
  }
  if (response.canceled) return;
  const pick = buttons[response.selection];
  if (pick) await pick[1]();
}

async function showMain(player, attempt = 0) {
  if (!isValid(player)) return;
  const buttons = [
    ["What's in this world", async () => { await showList(player, "What's in this world", FEATURES); return showMain(player); }],
    ["Your screen", async () => { await showList(player, "Your screen: what's what", SCREEN); return showMain(player); }],
    ["Tips", async () => { await showList(player, "Tips", TIPS.map((t) => ["Tip", t])); return showMain(player); }],
  ];
  if (originsInstalled()) buttons.push([`Origins guide (${ORIGINS.length})`, () => showOriginsGuide(player)]);
  // Operators get a one-tap admin switch (runs the same /function admin/... commands as the player).
  let isOp = false;
  try {
    isOp = Number(player.commandPermissionLevel ?? 0) >= 2;
  } catch {}
  if (isOp) {
    let creative = false;
    try {
      creative = player.getGameMode() === "Creative" || String(player.getGameMode()).toLowerCase() === "creative";
    } catch {}
    buttons.push([creative ? "Admin mode: ON (tap to play normally)" : "Admin mode: off (tap for creative)", () => {
      try {
        player.runCommand(creative ? "function admin/off" : "function admin/on");
      } catch (e) {
        try { player.sendMessage("§cCouldn't switch: " + e); } catch {}
      }
    }]);
  }
  buttons.push(["Let's play!", () => {
    markSeen(player);
    try {
      player.playSound("random.levelup");
      player.onScreenDisplay.setTitle(`§aHave fun, ${player.name}!`, { fadeInDuration: 5, stayDuration: 40, fadeOutDuration: 15 });
    } catch {}
  }]);
  const form = new ActionFormData().title(TITLE).body(bodyText(player));
  for (const [label] of buttons) form.button(label);
  let response;
  try {
    response = await form.show(player);
  } catch {
    return;
  }
  if (response.canceled) {
    // Another box is open (Origins, a chest, a menu): try again shortly instead of giving up.
    if (response.cancelationReason === FormCancelationReason.UserBusy && attempt < BUSY_RETRIES) {
      system.runTimeout(() => showMain(player, attempt + 1), BUSY_RETRY_TICKS);
      return;
    }
    markSeen(player); // closed on purpose: don't nag, !welcome brings it back
    return;
  }
  const pick = buttons[response.selection];
  if (pick) await pick[1]();
}

// playerJoin fires before the first spawn, so flags set here beat the other packs' spawn handlers.
world.afterEvents.playerJoin.subscribe(({ playerId }) => {
  let tries = 0;
  const poll = system.runInterval(() => {
    tries += 1;
    let player = null;
    try {
      player = world.getPlayers().find((p) => p.id === playerId) ?? null;
    } catch {}
    if (player) {
      quietOtherFirstJoinBoxes(player);
      system.clearRun(poll);
    } else if (tries > 200) {
      system.clearRun(poll);
    }
  }, 1);
});

world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  if (!initialSpawn) return;
  quietOtherFirstJoinBoxes(player);
  let seen = false;
  try {
    seen = player.getDynamicProperty(SEEN) === WELCOME_VERSION;
  } catch {}
  if (seen) return;

  // Origins goes first: wait for its class pick before showing the welcome. On a brand-new world Origins
  // may not have created its scoreboards yet when the first player spawns, so also treat any "origins:"
  // tag on the player as proof it's installed, and only give up on it after a quiet 20 seconds.
  let waited = 0;
  const poll = system.runInterval(() => {
    if (!isValid(player)) {
      system.clearRun(poll);
      return;
    }
    waited += POLL_TICKS;
    let originsHere = originsInstalled();
    try {
      originsHere = originsHere || player.getTags().some((t) => t.startsWith("origins:"));
    } catch {}
    const ready = originsHere ? hasChosenOrigin(player) : waited >= 20 * 20;
    if (ready || waited >= MAX_WAIT_TICKS) {
      system.clearRun(poll);
      system.runTimeout(() => showMain(player), SHOW_DELAY_TICKS);
    }
  }, POLL_TICKS);
});

// Re-open on request. The stable 2.0 scripting API has no chat events, so the hook is a tag: from the
// dashboard console run  tag "Name" add welcome_show  (or /scriptevent welcome:show as an operator).
const SHOW_TAG = "welcome_show";
system.runInterval(() => {
  let players = [];
  try {
    players = world.getPlayers({ tags: [SHOW_TAG] });
  } catch {}
  for (const player of players) {
    try {
      player.removeTag(SHOW_TAG);
    } catch {}
    showMain(player);
  }
}, 40);

try {
  system.afterEvents.scriptEventReceive.subscribe((event) => {
    if (event.id !== "welcome:show") return;
    const player = event.sourceEntity;
    if (player && typeof player.name === "string") showMain(player);
  });
} catch {}

// Welcome: one friendly welcome box per player, shown once they are actually ready for it.
//
// Why this exists: several add-ons pop their own box on a player's first spawn (language pickers,
// "thanks for installing" screens), and Bedrock shows only one form at a time, so they fight with
// Origins' class picker and each other. This pack quiets the ones we know about, waits until the
// player has picked an origin (when Origins is installed), then shows a single, tidy welcome.
//
// Players can re-open it any time by typing  !welcome  in chat (no cheats needed).
import { world, system } from "@minecraft/server";
import { ActionFormData, FormCancelationReason } from "@minecraft/server-ui";

// ---- Edit this block for your world ---------------------------------------------------------
const TITLE = "Welcome to the Playground";
const INTRO =
  "§7A test world for trying out add-ons. Build, explore, experiment: nothing here is precious.§r";
// [name, one-line description] pairs, shown under "What's in this world".
const FEATURES = [
  ["Origins", "You picked an origin: each has its own powers and drawbacks. An Orb of Origin lets you change it."],
  ["Farmer's Delight", "New crops, a cooking pot, a cutting board and lots of meals."],
  ["Bedrock Essentials+", "Tree capitator, vein miner and other small survival helpers."],
  ["Effortless Building", "Place lines, walls and floors in one go, like the Java mod."],
  ["More Ores", "28 new ores with matching armor and tools."],
  ["Mythological Craft", "Dragons, cyclops, ogres and giants roam the world."],
  ["Recurrent Complex", "Towers, temples and dungeons to find."],
  ["More Simple Structures", "Lots of smaller structures to stumble on."],
];
const TIPS = [
  "New structures and creatures only appear in parts of the map nobody has explored yet, so head somewhere new.",
  "Type §a!welcome§r in chat to see this box again.",
  "This world restarts now and then when add-ons change. If it's not in the LAN list afterwards, join it by address once.",
];
// Other add-ons whose first-join pop-ups we quiet. Each one is a known flag the add-on itself sets
// after showing its box; setting it first means the box never appears.
const QUIET_OTHER_FIRST_JOIN_BOXES = true;
// ---------------------------------------------------------------------------------------------

const SEEN = "welcome:seen";
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

function quietOtherFirstJoinBoxes(player) {
  if (!QUIET_OTHER_FIRST_JOIN_BOXES) return;
  // Farmer's Delight shows its welcome unless the player already carries this tag.
  try {
    player.addTag("farmersdelight");
  } catch {}
}

function markSeen(player) {
  try {
    player.setDynamicProperty(SEEN, true);
  } catch {}
}

function originName(player) {
  // Origins tags the player "origins:selected_<name>" next to the generic "origins:selected_origin".
  try {
    const tag = player.getTags().find((t) => t.startsWith("origins:selected_") && t !== "origins:selected_origin");
    if (!tag) return null;
    return tag.slice("origins:selected_".length).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  } catch {
    return null;
  }
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
  await form.show(player);
}

async function showMain(player, attempt = 0) {
  if (!isValid(player)) return;
  const form = new ActionFormData()
    .title(TITLE)
    .body(bodyText(player))
    .button("What's in this world")
    .button("Tips")
    .button("Let's play!");
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
  if (response.selection === 0) {
    await showList(player, "What's in this world", FEATURES);
    return showMain(player);
  }
  if (response.selection === 1) {
    await showList(player, "Tips", TIPS.map((t) => ["Tip", t]));
    return showMain(player);
  }
  markSeen(player);
  try {
    player.playSound("random.levelup");
    player.onScreenDisplay.setTitle(`§aHave fun, ${player.name}!`, { fadeInDuration: 5, stayDuration: 40, fadeOutDuration: 15 });
  } catch {}
}

world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  if (!initialSpawn) return;
  quietOtherFirstJoinBoxes(player);
  let seen = false;
  try {
    seen = player.getDynamicProperty(SEEN) === true;
  } catch {}
  if (seen) return;

  const waitForOrigin = originsInstalled();
  let waited = 0;
  const poll = system.runInterval(() => {
    if (!isValid(player)) {
      system.clearRun(poll);
      return;
    }
    waited += POLL_TICKS;
    if (!waitForOrigin || hasChosenOrigin(player) || waited >= MAX_WAIT_TICKS) {
      system.clearRun(poll);
      system.runTimeout(() => showMain(player), SHOW_DELAY_TICKS);
    }
  }, POLL_TICKS);
});

// "!welcome" in chat re-opens the box for that player and is never shown to others.
world.beforeEvents.chatSend.subscribe((event) => {
  if (event.message.trim().toLowerCase() !== "!welcome") return;
  event.cancel = true;
  const player = event.sender;
  system.run(() => showMain(player));
});

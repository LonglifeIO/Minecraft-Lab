// Player-view probe: join a (hidden, offline-mode) test server as a headless client and print what a
// player would be shown: chat, titles/action bar (the add-ons' HUD data channels), forms, NPC dialogue,
// disconnects. It cannot render the HUD; it shows the text and the order of events.
// Usage: node player-probe.js <host> <port> <seconds> [answerForms]
//
// Runs from CT 103 at /opt/probe (bedrock-protocol with raknet-native built there: cmake, g++, git and
// the system Node headers; cmake-js runs out of memory in that container, so the module was built with
// plain cmake, see the session notes). The target must be a HIDDEN test clone with online-mode=false and
// allow-list=false; never point it at a family world (those require Xbox sign-in and an allowlist).
const { createClient } = require("bedrock-protocol");

const host = process.argv[2] || "192.168.2.198";
const port = Number(process.argv[3] || 19132);
const seconds = Number(process.argv[4] || 60);
const answerForms = (process.argv[5] || "yes") !== "no";
const t0 = Date.now();
const stamp = () => ((Date.now() - t0) / 1000).toFixed(1).padStart(6) + "s";
const log = (...a) => console.log(stamp(), ...a);
const strip = (s) => String(s ?? "").replace(/§./g, "");
const seenTitles = new Map();

const client = createClient({
  host, port,
  username: "ClaudeProbe",
  offline: true,
  raknetBackend: "raknet-native",
  skipPing: true,
  conLog: () => {},
});

client.on("join", () => log("JOIN: handshake done"));
client.on("spawn", () => log("SPAWN: in the world"));
client.on("error", (e) => log("ERROR:", e?.message || e));
client.on("close", (r) => log("CLOSE:", r || ""));
client.on("kick", (p) => log("KICK:", strip(p?.message)));
client.on("disconnect", (p) => log("DISCONNECT:", strip(p?.message || p?.reason)));

client.on("start_game", (p) => log("start_game: world", JSON.stringify(p.level_id || ""), "gamemode", p.player_gamemode, "cheats", p.commands_enabled));
client.on("resource_packs_info", (p) => {
  const n = (p.texture_packs || []).length;
  const mb = (p.texture_packs || []).reduce((a, x) => a + Number(x.size || 0), 0) / 1e6;
  log(`resource packs offered: ${n} (${mb.toFixed(1)} MB), must_accept=${p.must_accept}`);
});
client.on("text", (p) => {
  const m = strip(p.message);
  if (m.trim()) log(`CHAT [${p.type}]${p.source_name ? " " + p.source_name + ":" : ""} ${m.slice(0, 160)}`);
});
client.on("set_title", (p) => {
  const key = p.type + "|" + p.text;
  const n = (seenTitles.get(key) || 0) + 1; seenTitles.set(key, n);
  if (n <= 2) log(`TITLE ${p.type}: ${JSON.stringify(String(p.text).slice(0, 120))}${n === 2 ? " (repeats; further copies hidden)" : ""}`);
});
client.on("npc_dialogue", (p) => {
  log(`NPC DIALOGUE [${p.action_type}] scene=${p.scene_name} name="${strip(p.npc_name).slice(0, 40)}"`);
  log(`   text: ${strip(p.dialogue).replace(/\n/g, " / ").slice(0, 300)}`);
  try {
    const actions = JSON.parse(p.action_json || "[]");
    log(`   buttons: ${actions.map((a) => strip(a.button_name)).join(" | ")}`);
  } catch {}
});
client.on("modal_form_request", (p) => {
  let form = null;
  try { form = JSON.parse(p.data); } catch {}
  const title = strip(form?.title); const body = strip(form?.content ?? form?.body ?? "");
  const buttons = (form?.buttons || []).map((b) => strip(b.text));
  log(`FORM #${p.form_id} "${title}"`);
  if (body) log(`   body: ${body.replace(/\n+/g, " / ").slice(0, 400)}`);
  if (buttons.length) log(`   buttons: ${buttons.join(" | ")}`);
  if (answerForms && form?.type === "form" && buttons.length) {
    // pick the last button ("Let's play!" style) after a moment, like a player would
    const choice = buttons.length - 1;
    setTimeout(() => {
      try {
        client.queue("modal_form_response", { form_id: p.form_id, has_response_data: true, data: JSON.stringify(choice) + "\n", has_cancel_reason: false });
        log(`   -> answered with button ${choice} (${buttons[choice]})`);
      } catch (e) { log("   form answer failed:", e?.message); }
    }, 1500);
  }
});
client.on("set_health", (p) => log("health", p.health));
client.on("available_commands", (p) => log(`commands available to this player: ${(p.values_len ?? p.commands?.length ?? "?")}`));
client.on("update_attributes", () => {});

setTimeout(() => {
  log("done; disconnecting");
  try { client.close(); } catch {}
  setTimeout(() => process.exit(0), 500);
}, seconds * 1000);

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import path from "path";

const STATE_FILE = path.join(process.cwd(), "data", "restart-pending.json");
mkdirSync(path.dirname(STATE_FILE), { recursive: true });

function load(): Record<string, boolean> {
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function save(state: Record<string, boolean>) {
  writeFileSync(STATE_FILE, JSON.stringify(state));
}

export function setRestartPending(worldId: string) {
  const state = load();
  state[worldId] = true;
  save(state);
}

export function clearRestartPending(worldId: string) {
  const state = load();
  delete state[worldId];
  save(state);
}

export function isRestartPending(worldId: string): boolean {
  return load()[worldId] === true;
}

export interface ServerConfig {
  id: string;
  name: string;
  host: string;
  apiPort: number;
}

const API_TOKEN = process.env.BDS_API_TOKEN || "";

async function bdsRequest(server: ServerConfig, path: string, options?: RequestInit & { timeoutMs?: number }) {
  const url = `http://${server.host}:${server.apiPort}${path}`;
  const controller = new AbortController();
  const timeoutMs = options?.timeoutMs ?? 8000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${API_TOKEN}`,
        "Content-Type": "application/json",
        ...options?.headers,
      },
      cache: "no-store",
      signal: controller.signal,
    });
    return res.json();
  } finally {
    clearTimeout(timeout);
  }
}

export async function getStatus(server: ServerConfig) {
  try {
    return await bdsRequest(server, "/status");
  } catch {
    return {
      online: false,
      players: 0,
      maxPlayers: 0,
      playerList: [],
      version: "unknown",
      worldName: server.name,
      difficulty: "unknown",
      gamemode: "unknown",
      error: "API unreachable",
    };
  }
}

export async function getAllowlist(server: ServerConfig) {
  try {
    const result = await bdsRequest(server, "/allowlist");
    return Array.isArray(result) ? result : [];
  } catch {
    return [];
  }
}

export async function getPermissions(server: ServerConfig) {
  try {
    const result = await bdsRequest(server, "/permissions");
    return Array.isArray(result) ? result : [];
  } catch {
    return [];
  }
}

export async function setPermission(server: ServerConfig, name: string, permission: string) {
  return bdsRequest(server, "/permissions/set", {
    method: "POST",
    body: JSON.stringify({ name, permission }),
  });
}

export async function getBackups(server: ServerConfig) {
  try {
    return await bdsRequest(server, "/backups");
  } catch {
    return [];
  }
}

export async function setGamemode(server: ServerConfig, mode: string) {
  return bdsRequest(server, "/gamemode", { method: "POST", body: JSON.stringify({ mode }) });
}

export async function setDifficulty(server: ServerConfig, level: string) {
  return bdsRequest(server, "/difficulty", { method: "POST", body: JSON.stringify({ level }) });
}

export async function setHardcore(server: ServerConfig, enabled: boolean) {
  // Toggling hardcore stops + restarts BDS so the level.dat patch isn't clobbered
  // by BDS's shutdown-time flush, so this request can take up to ~30s.
  return bdsRequest(server, "/hardcore", { method: "POST", body: JSON.stringify({ enabled }), timeoutMs: 45000 });
}

export async function power(server: ServerConfig, action: string) {
  return bdsRequest(server, "/power", {
    method: "POST",
    body: JSON.stringify({ action }),
  });
}

export async function sendCommand(server: ServerConfig, command: string) {
  return bdsRequest(server, "/command", {
    method: "POST",
    body: JSON.stringify({ command }),
  });
}

export async function addToAllowlist(server: ServerConfig, name: string) {
  return bdsRequest(server, "/allowlist/add", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export async function removeFromAllowlist(server: ServerConfig, name: string) {
  return bdsRequest(server, "/allowlist/remove", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export async function applyPreset(server: ServerConfig, preset: string) {
  return bdsRequest(server, "/preset", {
    method: "POST",
    body: JSON.stringify({ preset }),
  });
}

export async function triggerBackup(server: ServerConfig) {
  return bdsRequest(server, "/backup", { method: "POST" });
}

export async function getAddons(server: ServerConfig) {
  try { return await bdsRequest(server, "/addons"); } catch { return []; }
}

export async function getWorldAddons(server: ServerConfig, worldName: string) {
  try { return await bdsRequest(server, `/addons/world?name=${encodeURIComponent(worldName)}`); } catch { return []; }
}

export async function getProperties(server: ServerConfig) {
  try { return await bdsRequest(server, "/properties"); } catch { return {}; }
}

export async function installAddon(server: ServerConfig, data: { url: string; worldName: string; modId: number; fileId: number; addonName: string }) {
  return bdsRequest(server, "/addons/install", { method: "POST", body: JSON.stringify(data) });
}

export async function removeAddon(server: ServerConfig, data: { uuid: string; worldName: string }) {
  return bdsRequest(server, "/addons/remove", { method: "POST", body: JSON.stringify(data) });
}

export async function toggleAddon(server: ServerConfig, data: { uuid: string; worldName: string; enabled: boolean }) {
  return bdsRequest(server, "/addons/toggle", { method: "POST", body: JSON.stringify(data) });
}

export async function importWorld(server: ServerConfig, data: { url: string; worldName: string }) {
  return bdsRequest(server, "/worlds/import", { method: "POST", body: JSON.stringify(data) });
}

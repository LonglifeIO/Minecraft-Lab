import { ServerConfig } from "./config";

const API_TOKEN = process.env.BDS_API_TOKEN || "";

async function bdsRequest(server: ServerConfig, path: string, options?: RequestInit) {
  const url = `http://${server.host}:${server.apiPort}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      "Content-Type": "application/json",
      ...options?.headers,
    },
    cache: "no-store",
  });
  return res.json();
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
    return await bdsRequest(server, "/allowlist");
  } catch {
    return [];
  }
}

export async function getBackups(server: ServerConfig) {
  try {
    return await bdsRequest(server, "/backups");
  } catch {
    return [];
  }
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

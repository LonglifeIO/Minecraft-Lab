const HOST_API = process.env.HOST_API_URL || "";
const API_TOKEN = process.env.BDS_API_TOKEN || "";

async function hostRequest(path: string, options?: RequestInit) {
  const res = await fetch(`${HOST_API}${path}`, {
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

export async function listWorlds() {
  try {
    return await hostRequest("/worlds");
  } catch {
    return [];
  }
}

export async function createWorld(name: string, seed?: string) {
  return hostRequest("/worlds", {
    method: "POST",
    body: JSON.stringify({ name, ...(seed ? { seed } : {}) }),
  });
}

export async function deleteWorld(id: string) {
  return hostRequest(`/worlds/${id}`, { method: "DELETE" });
}

export async function startWorldContainer(id: string) {
  return hostRequest(`/worlds/${id}/start`, { method: "POST" });
}

export async function stopWorldContainer(id: string) {
  return hostRequest(`/worlds/${id}/stop`, { method: "POST" });
}

export async function setWorldImporting(id: string, importing: boolean) {
  return hostRequest(`/worlds/${id}/importing`, {
    method: "POST",
    body: JSON.stringify({ importing }),
  });
}

export async function checkUpdates() {
  return hostRequest("/updates/check");
}

export async function applyUpdates(force = false) {
  return hostRequest("/updates/apply", {
    method: "POST",
    body: JSON.stringify({ force }),
  });
}

export async function getUpdateStatus() {
  return hostRequest("/updates/status");
}

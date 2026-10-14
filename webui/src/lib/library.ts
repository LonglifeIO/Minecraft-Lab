const HOST_API = process.env.HOST_API_URL || "";
const API_TOKEN = process.env.BDS_API_TOKEN || "";

async function libraryRequest(path: string, options?: RequestInit) {
  const res = await fetch(`${HOST_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      "Content-Type": "application/json",
      ...options?.headers,
    },
    cache: "no-store",
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

export interface LibraryPack {
  uuid: string;
  name: string;
  type: string;
}

export interface LibrarySource {
  kind?: string;
  modId?: number | null;
  fileId?: number | null;
  fileUrl?: string;
}

export interface LibraryEntry {
  id: string;
  name: string;
  description: string;
  version: string;
  type: "downloaded" | "custom" | "imported";
  author: string;
  thumbUrl: string;
  source: LibrarySource;
  packs: LibraryPack[];
  packUuids: string[];
  needsBetaApis?: boolean;
  sizeBytes: number;
  addedAt: string;
}

export async function listLibrary(): Promise<LibraryEntry[]> {
  try {
    const { body } = await libraryRequest("/library");
    return Array.isArray(body) ? body : [];
  } catch {
    return [];
  }
}

export async function getLibraryEntry(id: string) {
  return libraryRequest(`/library/${encodeURIComponent(id)}`);
}

export async function deleteLibraryEntry(id: string) {
  return libraryRequest(`/library/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function installLibraryEntry(id: string, worldId: string) {
  return libraryRequest(`/library/${encodeURIComponent(id)}/install`, {
    method: "POST",
    body: JSON.stringify({ worldId }),
  });
}

export interface SaveCurseforgePayload {
  modId: number;
  fileId: number;
  fileUrl: string;
  extraFileIds?: number[];
  extraFileUrls?: string[];
  name: string;
  description?: string;
  author?: string;
  thumbUrl?: string;
}

export async function saveCurseforgeToLibrary(payload: SaveCurseforgePayload) {
  return libraryRequest("/library/from-curseforge", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export interface UploadPayload {
  name: string;
  contentBase64: string;
  description?: string;
  author?: string;
}

export async function uploadToLibrary(payload: UploadPayload) {
  return libraryRequest("/library/upload", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// Where an add-on came from: the CurseForge catalogue, built on this server, or a file someone uploaded
// (MCPEDL, Planet Minecraft, ...). Falls back to the raw type for anything older.
export function sourceLabel(entry: Pick<LibraryEntry, "type" | "source">): string {
  if (entry.source?.kind === "curseforge" || entry.type === "downloaded") return "CurseForge";
  if (entry.type === "custom") return "Made here";
  if (entry.source?.kind === "upload" || entry.type === "imported") return "Uploaded";
  return entry.type;
}

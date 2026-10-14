import "server-only";

const CURSEFORGE_API_BASE_URL = "https://api.curseforge.com";
const CURSEFORGE_API_KEY = process.env.CURSEFORGE_API || process.env.CURSEDFORGE_API || "";
const RETRY_DELAY_MS = 1000;

export const CURSEFORGE_GAME_ID = 78022; // Minecraft Bedrock (not 432 = Java)
export const DEFAULT_CLASS_ID = 4984;  // Addons class under Bedrock game

export interface SearchParams {
  query?: string;
  classId?: number;
  categoryId?: number;
  gameVersion?: string;
  sortField?: number;
  sortOrder?: "asc" | "desc";
  pageSize?: number;
  index?: number;
}

export interface SearchResult {
  id: number;
  name: string;
  slug: string;
  summary: string;
  downloadCount: number;
  thumbUrl: string;
  authors: { name: string; url: string }[];
  categories: { id: number; name: string }[];
  dateModified: string;
  dateCreated: string;
  latestFilesIndexes: { gameVersion: string; fileId: number; filename: string }[];
}

export interface SearchResponse {
  results: SearchResult[];
  pagination: Pagination;
}

export interface AddonDetail {
  id: number;
  name: string;
  slug: string;
  summary: string;
  description: string;
  downloadCount: number;
  thumbUrl: string;
  classId: number;
  screenshots: { id: number; title: string; url: string }[];
  authors: { name: string; url: string }[];
  categories: { id: number; name: string }[];
  dateModified: string;
  dateCreated: string;
  links: { websiteUrl: string; sourceUrl: string };
  latestFilesIndexes: { gameVersion: string; fileId: number; filename: string }[];
}

export interface AddonSummary {
  id: number;
  name: string;
  slug: string;
  summary: string;
  downloadCount: number;
  thumbUrl: string;
  authors: { name: string; url: string }[];
  categories: { id: number; name: string }[];
  dateModified: string;
  dateCreated: string;
  latestFilesIndexes: { gameVersion: string; fileId: number; filename: string }[];
}

export interface AddonFile {
  id: number;
  displayName: string;
  fileName: string;
  fileDate: string;
  fileLength: number;
  downloadUrl: string | null;
  gameVersions: string[];
  dependencies: { modId: number; relationType: number }[];
}

export interface FilesResponse {
  files: AddonFile[];
  pagination: Pagination;
}

export interface Pagination {
  index: number;
  pageSize: number;
  resultCount: number;
  totalCount: number;
}

interface CurseForgeEnvelope<T> {
  data: T;
  pagination?: Pagination;
}

interface CurseForgeAuthor {
  name: string;
  url: string;
}

interface CurseForgeCategory {
  id: number;
  name: string;
}

interface CurseForgeLogo {
  thumbnailUrl?: string | null;
}

interface CurseForgeScreenshot {
  id: number;
  title: string;
  url: string;
}

interface CurseForgeLinks {
  websiteUrl?: string | null;
  sourceUrl?: string | null;
}

interface CurseForgeLatestFilesIndex {
  gameVersion: string;
  fileId: number;
  filename: string;
}

interface CurseForgeDependency {
  modId: number;
  relationType: number;
}

interface CurseForgeFile {
  id: number;
  displayName: string;
  fileName: string;
  fileDate: string;
  fileLength: number;
  downloadUrl?: string | null;
  gameVersions?: string[];
  dependencies?: CurseForgeDependency[];
}

interface CurseForgeMod {
  id: number;
  name: string;
  slug: string;
  summary: string;
  downloadCount: number;
  classId?: number;
  logo?: CurseForgeLogo | null;
  authors?: CurseForgeAuthor[];
  categories?: CurseForgeCategory[];
  dateModified: string;
  dateCreated: string;
  latestFilesIndexes?: CurseForgeLatestFilesIndex[];
  screenshots?: CurseForgeScreenshot[];
  links?: CurseForgeLinks | null;
}

function assertApiKey() {
  if (!CURSEFORGE_API_KEY) {
    throw new Error("Missing CURSEFORGE_API environment variable.");
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function parseErrorBody(response: Response): Promise<string> {
  const text = await response.text();
  if (!text) {
    return "No response body";
  }

  try {
    const parsed = JSON.parse(text) as { error?: string; message?: string };
    return parsed.error || parsed.message || text;
  } catch {
    return text;
  }
}

async function curseforgeRequest<T>(
  path: string,
  init?: RequestInit,
  retryCount = 0,
): Promise<CurseForgeEnvelope<T>> {
  assertApiKey();

  const response = await fetch(`${CURSEFORGE_API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": CURSEFORGE_API_KEY,
      ...init?.headers,
    },
    cache: "no-store",
  });

  if (response.status === 429 && retryCount < 3) {
    // Exponential backoff: 1s, 2s, 4s
    await sleep(Math.pow(2, retryCount) * RETRY_DELAY_MS);
    return curseforgeRequest<T>(path, init, retryCount + 1);
  }

  if (!response.ok) {
    const details = await parseErrorBody(response);
    throw new Error(
      `CurseForge API request failed (${response.status} ${response.statusText}) for ${path}: ${details}`,
    );
  }

  return (await response.json()) as CurseForgeEnvelope<T>;
}

function mapAuthors(authors: CurseForgeAuthor[] | undefined): { name: string; url: string }[] {
  return (authors || []).map((author) => ({
    name: author.name,
    url: author.url,
  }));
}

function mapCategories(categories: CurseForgeCategory[] | undefined): { id: number; name: string }[] {
  return (categories || []).map((category) => ({
    id: category.id,
    name: category.name,
  }));
}

function mapLatestFilesIndexes(
  indexes: CurseForgeLatestFilesIndex[] | undefined,
): { gameVersion: string; fileId: number; filename: string }[] {
  return (indexes || []).map((entry) => ({
    gameVersion: entry.gameVersion,
    fileId: entry.fileId,
    filename: entry.filename,
  }));
}

function mapAddonSummary(mod: CurseForgeMod): AddonSummary {
  return {
    id: mod.id,
    name: mod.name,
    slug: mod.slug,
    summary: mod.summary,
    downloadCount: mod.downloadCount,
    thumbUrl: mod.logo?.thumbnailUrl || "",
    authors: mapAuthors(mod.authors),
    categories: mapCategories(mod.categories),
    dateModified: mod.dateModified,
    dateCreated: mod.dateCreated,
    latestFilesIndexes: mapLatestFilesIndexes(mod.latestFilesIndexes),
  };
}

function clampPageSize(pageSize?: number): number {
  if (!pageSize || pageSize < 1) {
    return 20;
  }

  return Math.min(pageSize, 50);
}

function buildFileDownloadUrl(fileId: number, fileName: string): string {
  const fileIdString = String(fileId);
  const firstSegment = fileIdString.slice(0, 4);
  const secondSegment = fileIdString.slice(4);
  return `https://edge.forgecdn.net/files/${firstSegment}/${secondSegment}/${fileName}`;
}

function mapAddonFile(file: CurseForgeFile): AddonFile {
  return {
    id: file.id,
    displayName: file.displayName,
    fileName: file.fileName,
    fileDate: file.fileDate,
    fileLength: file.fileLength,
    downloadUrl: file.downloadUrl || buildFileDownloadUrl(file.id, file.fileName),
    gameVersions: file.gameVersions || [],
    dependencies: (file.dependencies || []).map((dependency) => ({
      modId: dependency.modId,
      relationType: dependency.relationType,
    })),
  };
}

export async function searchAddons(params: SearchParams = {}): Promise<SearchResponse> {
  const searchParams = new URLSearchParams({
    gameId: String(CURSEFORGE_GAME_ID),
    classId: String(params.classId ?? DEFAULT_CLASS_ID),
    pageSize: String(clampPageSize(params.pageSize)),
    index: String(params.index ?? 0),
  });

  if (params.query) {
    searchParams.set("searchFilter", params.query);
  }
  if (typeof params.categoryId === "number") {
    searchParams.set("categoryId", String(params.categoryId));
  }
  if (params.gameVersion) {
    searchParams.set("gameVersion", params.gameVersion);
  }
  if (typeof params.sortField === "number") {
    searchParams.set("sortField", String(params.sortField));
  }
  // Name (sortField 4) reads A→Z; everything else is "most first"
  searchParams.set("sortOrder", params.sortOrder ?? (params.sortField === 4 ? "asc" : "desc"));

  const response = await curseforgeRequest<CurseForgeMod[]>(
    `/v1/mods/search?${searchParams.toString()}`,
  );

  return {
    results: response.data.map((mod) => mapAddonSummary(mod)),
    pagination: response.pagination || {
      index: params.index ?? 0,
      pageSize: clampPageSize(params.pageSize),
      resultCount: response.data.length,
      totalCount: response.data.length,
    },
  };
}

export async function getAddon(modId: number): Promise<AddonDetail> {
  const [addonResponse, descriptionResponse] = await Promise.all([
    curseforgeRequest<CurseForgeMod>(`/v1/mods/${modId}`),
    curseforgeRequest<string>(`/v1/mods/${modId}/description`),
  ]);

  const addon = addonResponse.data;

  return {
    ...mapAddonSummary(addon),
    classId: addon.classId ?? 0,
    description: sanitizeHtml(descriptionResponse.data),
    screenshots: (addon.screenshots || []).map((screenshot) => ({
      id: screenshot.id,
      title: screenshot.title,
      url: screenshot.url,
    })),
    links: {
      websiteUrl: addon.links?.websiteUrl || "",
      sourceUrl: addon.links?.sourceUrl || "",
    },
  };
}

export async function getAddonFiles(
  modId: number,
  gameVersion?: string,
): Promise<FilesResponse> {
  const searchParams = new URLSearchParams();

  if (gameVersion) {
    searchParams.set("gameVersion", gameVersion);
  }

  const query = searchParams.toString();
  const response = await curseforgeRequest<CurseForgeFile[]>(
    `/v1/mods/${modId}/files${query ? `?${query}` : ""}`,
  );

  return {
    files: response.data.map((file) => mapAddonFile(file)),
    pagination: response.pagination || {
      index: 0,
      pageSize: response.data.length,
      resultCount: response.data.length,
      totalCount: response.data.length,
    },
  };
}

// Some creators publish the behavior pack and the resource pack of one add-on as two separate files
// uploaded together (names like "[BP] ..." / "[RP] ...", "... Behavior v1.9" / "... Resource v1.9").
// Given the file the user picked, find the other half released at the same time, if any.
const BP_RE = /(^|[^a-z])(bp|behaviou?rs?)([^a-z]|$)/i;
const RP_RE = /(^|[^a-z])(rp|resources?|textures?)([^a-z]|$)/i;
export async function findCompanionFiles(modId: number, fileId: number): Promise<AddonFile[]> {
  const { files } = await getAddonFiles(modId);
  const picked = files.find((f) => f.id === fileId);
  if (!picked) return [];
  const label = `${picked.displayName} ${picked.fileName}`;
  const pickedIsBp = BP_RE.test(label) && !RP_RE.test(label);
  const pickedIsRp = RP_RE.test(label) && !BP_RE.test(label);
  if (!pickedIsBp && !pickedIsRp) return [];
  const pickedDay = picked.fileDate.slice(0, 10);
  const wantRe = pickedIsBp ? RP_RE : BP_RE;
  const avoidRe = pickedIsBp ? BP_RE : RP_RE;
  return files
    .filter((f) => f.id !== fileId && f.fileDate.slice(0, 10) === pickedDay)
    .filter((f) => wantRe.test(`${f.displayName} ${f.fileName}`) && !avoidRe.test(`${f.displayName} ${f.fileName}`))
    .slice(0, 1);
}

export async function getDownloadUrl(modId: number, fileId: number): Promise<string> {
  const response = await curseforgeRequest<string>(
    `/v1/mods/${modId}/files/${fileId}/download-url`,
  );
  return response.data;
}

export async function getAddonsByIds(modIds: number[]): Promise<AddonSummary[]> {
  if (modIds.length === 0) {
    return [];
  }

  const response = await curseforgeRequest<CurseForgeMod[]>("/v1/mods", {
    method: "POST",
    body: JSON.stringify({ modIds }),
  });

  return response.data.map((mod) => mapAddonSummary(mod));
}

// Only CurseForge's CDN may be handed to the host/BDS downloaders. The browser sends the file URL
// it was shown, and anything else (internal addresses, file://) must fall back to a server-side lookup.
export function isAllowedDownloadUrl(url: unknown): url is string {
  if (typeof url !== "string") return false;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && (u.hostname === "forgecdn.net" || u.hostname.endsWith(".forgecdn.net"));
  } catch {
    return false;
  }
}

// Add-on descriptions are third-party HTML rendered with dangerouslySetInnerHTML. Strip what can run
// script or embed another document, and keep only plain web links. Not a full sanitizer, but it closes
// the obvious doors without pulling in a dependency.
export function sanitizeHtml(html: string): string {
  if (!html) return "";
  const safeUrl = (v: string) => /^(https?:\/\/|\/(?!\/)|#|mailto:)/i.test(v.trim());
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\s*(script|style|iframe|object|embed|form|meta|link|base|svg|math|template)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*\/?\s*(script|style|iframe|object|embed|form|meta|link|base|svg|math|template)\b[^>]*>/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s+(srcdoc|formaction|xlink:href|action|data)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s(href|src)\s*=\s*"([^"]*)"/gi, (m, attr, v) => (safeUrl(v) ? m : ""))
    .replace(/\s(href|src)\s*=\s*'([^']*)'/gi, (m, attr, v) => (safeUrl(v) ? m : ""))
    .replace(/\s(href|src)\s*=\s*([^\s"'>]+)/gi, (m, attr, v) => (safeUrl(v) ? m : ""));
}

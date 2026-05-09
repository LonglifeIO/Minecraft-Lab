import {
  getAddonFiles,
  getAddonsByIds,
  type AddonFile,
  type AddonSummary,
} from "./curseforge";

export interface DependencyInfo {
  modId: number;
  name: string;
  fileId: number;
  fileName: string;
  downloadUrl: string | null;
  relationType: number;
  isInstalled: boolean;
}

export interface DependencyResult {
  required: DependencyInfo[];
  optional: DependencyInfo[];
  incompatible: DependencyInfo[];
  errors: string[];
}

interface DependencyInput {
  modId: number;
  relationType: number;
}

const OPTIONAL_DEPENDENCY = 2;
const REQUIRED_DEPENDENCY = 3;
const INCOMPATIBLE_DEPENDENCY = 5;

function buildFallbackInfo(
  dependency: DependencyInput,
  addon: AddonSummary | undefined,
  installedModIds: Set<number>,
  file?: AddonFile,
): DependencyInfo {
  return {
    modId: dependency.modId,
    name: addon?.name || `Addon ${dependency.modId}`,
    fileId: file?.id || 0,
    fileName: file?.fileName || "",
    downloadUrl: file?.downloadUrl || null,
    relationType: dependency.relationType,
    isInstalled: installedModIds.has(dependency.modId),
  };
}

function dedupeDependencies(dependencies: DependencyInput[]): DependencyInput[] {
  const seen = new Set<string>();
  const unique: DependencyInput[] = [];

  for (const dependency of dependencies) {
    const key = `${dependency.modId}:${dependency.relationType}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(dependency);
  }

  return unique;
}

export async function resolveDependencies(
  dependencies: DependencyInput[],
  installedModIds: number[],
): Promise<DependencyResult> {
  const result: DependencyResult = {
    required: [],
    optional: [],
    incompatible: [],
    errors: [],
  };

  const installedSet = new Set(installedModIds);
  const uniqueDependencies = dedupeDependencies(
    dependencies.filter(
      (dependency) =>
        dependency.relationType === REQUIRED_DEPENDENCY ||
        dependency.relationType === OPTIONAL_DEPENDENCY ||
        dependency.relationType === INCOMPATIBLE_DEPENDENCY,
    ),
  );

  const resolvableDependencies = uniqueDependencies.filter(
    (dependency) =>
      dependency.relationType === REQUIRED_DEPENDENCY ||
      dependency.relationType === OPTIONAL_DEPENDENCY,
  );

  const addonMap = new Map<number, AddonSummary>();

  try {
    const addons = await getAddonsByIds(resolvableDependencies.map((dependency) => dependency.modId));
    for (const addon of addons) {
      addonMap.set(addon.id, addon);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result.errors.push(`Failed to load addon details: ${message}`);
  }

  // Fetch files in parallel batches of 3 to avoid hammering CurseForge
  const BATCH_SIZE = 3;
  const fileMap = new Map<number, AddonFile | undefined>();
  const fetchable = uniqueDependencies.filter(
    (d) => d.relationType !== INCOMPATIBLE_DEPENDENCY && !installedSet.has(d.modId),
  );
  for (let i = 0; i < fetchable.length; i += BATCH_SIZE) {
    const batch = fetchable.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async (dependency) => {
      try {
        const response = await getAddonFiles(dependency.modId);
        fileMap.set(dependency.modId, response.files[0]);
        if (!response.files[0]) {
          result.errors.push(`No files found for dependency ${dependency.modId}.`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result.errors.push(`Failed to load files for dependency ${dependency.modId}: ${message}`);
      }
    }));
  }

  for (const dependency of uniqueDependencies) {
    const addon = addonMap.get(dependency.modId);

    if (dependency.relationType === INCOMPATIBLE_DEPENDENCY) {
      result.incompatible.push(buildFallbackInfo(dependency, addon, installedSet));
      continue;
    }

    const info = buildFallbackInfo(dependency, addon, installedSet, fileMap.get(dependency.modId));

    if (dependency.relationType === REQUIRED_DEPENDENCY) {
      result.required.push(info);
      continue;
    }

    result.optional.push(info);
  }

  return result;
}

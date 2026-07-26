import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { StoreInvariantError } from "./errors";
import type { InstalledPack, StorageRoot } from "./types";

const MANIFEST_SCHEMA_VERSION = 1;
const MANIFEST_FILE = "installed-packs.json";

export interface InstalledPacksManifest {
  readonly schemaVersion: number;
  readonly generation: number;
  readonly packs: readonly InstalledPack[];
}

export function emptyManifest(): InstalledPacksManifest {
  return { schemaVersion: MANIFEST_SCHEMA_VERSION, generation: 0, packs: [] };
}

export function manifestPath(root: StorageRoot): string {
  return join(root.path, MANIFEST_FILE);
}

function isInstalledPack(value: unknown): value is InstalledPack {
  if (value === null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.name === "string" &&
    typeof record.version === "string" &&
    typeof record.artifactDigest === "string" &&
    typeof record.storageKey === "string" &&
    typeof record.installedAt === "string"
  );
}

function parseManifest(value: unknown): InstalledPacksManifest {
  if (value === null || typeof value !== "object") {
    throw new StoreInvariantError("Installed-pack manifest is not an object");
  }
  const record = value as Record<string, unknown>;
  if (
    record.schemaVersion !== MANIFEST_SCHEMA_VERSION ||
    typeof record.generation !== "number" ||
    !Number.isSafeInteger(record.generation) ||
    record.generation < 0 ||
    !Array.isArray(record.packs) ||
    !record.packs.every(isInstalledPack)
  ) {
    throw new StoreInvariantError("Installed-pack manifest has an unsupported shape");
  }

  const names = new Set<string>();
  for (const pack of record.packs) {
    if (names.has(pack.name)) {
      throw new StoreInvariantError(
        `Installed-pack manifest contains duplicate pack "${pack.name}"`,
      );
    }
    names.add(pack.name);
  }

  return {
    schemaVersion: record.schemaVersion,
    generation: record.generation,
    packs: [...record.packs].sort((left, right) => left.name.localeCompare(right.name)),
  };
}

export async function loadManifest(root: StorageRoot): Promise<InstalledPacksManifest> {
  try {
    const content = await readFile(manifestPath(root), "utf8");
    return parseManifest(JSON.parse(content) as unknown);
  } catch (error: unknown) {
    if (isNodeError(error, "ENOENT")) return emptyManifest();
    if (error instanceof StoreInvariantError) throw error;
    throw new StoreInvariantError(`Unable to read installed-pack manifest: ${errorMessage(error)}`);
  }
}

export async function writeManifest(
  root: StorageRoot,
  manifest: InstalledPacksManifest,
): Promise<void> {
  const path = manifestPath(root);
  await mkdir(root.path, { recursive: true });
  const temporaryPath = `${path}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

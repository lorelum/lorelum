import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { PackSchema } from "@lorelum/format";

import { ManifestError } from "../errors";

export const MANIFEST_FILE_NAME = "installed-packs.json";
export const MANIFEST_SCHEMA_VERSION = 1;

export interface InstalledPackManifestEntry {
  packName: string;
  packVersion: string;
  artifactDigest: string;
  storageKey: string;
  installedAt: string;
}

export interface InstalledPacksManifest {
  schemaVersion: number;
  generation: number;
  effectiveRevision: number;
  packs: readonly InstalledPackManifestEntry[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function manifestPath(rootPath: string): string {
  return join(rootPath, MANIFEST_FILE_NAME);
}

/** Validate and freeze the recovery-source manifest before any caller uses it. */
export function parseManifest(text: string, path: string): InstalledPacksManifest {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new ManifestError(path, "not valid JSON", error);
  }
  if (
    !isRecord(value) ||
    value.schemaVersion !== MANIFEST_SCHEMA_VERSION ||
    !isNonNegativeInteger(value.generation) ||
    !isNonNegativeInteger(value.effectiveRevision) ||
    !Array.isArray(value.packs)
  ) {
    throw new ManifestError(path, "has an unsupported shape");
  }
  const seenNames = new Set<string>();
  const packs = value.packs.map((entry) => {
    const packIdentity =
      isRecord(entry) &&
      PackSchema.pick({ name: true, version: true }).safeParse({
        name: entry.packName,
        version: entry.packVersion,
      }).success;
    if (
      !isRecord(entry) ||
      !packIdentity ||
      typeof entry.packName !== "string" ||
      typeof entry.packVersion !== "string" ||
      typeof entry.artifactDigest !== "string" ||
      !/^[a-f0-9]{64}$/.test(entry.artifactDigest) ||
      typeof entry.storageKey !== "string" ||
      entry.storageKey !== "p-" + entry.packName ||
      typeof entry.installedAt !== "string" ||
      Number.isNaN(Date.parse(entry.installedAt)) ||
      new Date(entry.installedAt).toISOString() !== entry.installedAt ||
      seenNames.has(entry.packName)
    ) {
      throw new ManifestError(path, "contains an invalid Pack entry");
    }
    seenNames.add(entry.packName);
    return Object.freeze({
      packName: entry.packName,
      packVersion: entry.packVersion,
      artifactDigest: entry.artifactDigest,
      storageKey: entry.storageKey,
      installedAt: entry.installedAt,
    });
  });
  if (
    packs.some(
      (entry, index) =>
        index > 0 && compareCodeUnits(packs[index - 1]?.packName ?? "", entry.packName) >= 0,
    )
  ) {
    throw new ManifestError(path, "Pack entries must be ordered by packName");
  }
  return Object.freeze({
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    generation: value.generation,
    effectiveRevision: value.effectiveRevision,
    packs: Object.freeze(packs),
  });
}

export function createEmptyManifest(): InstalledPacksManifest {
  return Object.freeze({
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    generation: 0,
    effectiveRevision: 0,
    packs: Object.freeze([]),
  });
}

export function serializeManifest(manifest: InstalledPacksManifest): string {
  return JSON.stringify(manifest) + "\n";
}

export async function readManifest(rootPath: string): Promise<InstalledPacksManifest> {
  const path = manifestPath(rootPath);
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    throw new ManifestError(path, "cannot be read", error);
  }
  return parseManifest(text, path);
}

/** Atomically publish the sole recovery-source manifest. */
export async function writeManifest(
  rootPath: string,
  manifest: InstalledPacksManifest,
): Promise<void> {
  const path = manifestPath(rootPath);
  const temporaryPath = path + ".tmp-" + crypto.randomUUID();
  parseManifest(serializeManifest(manifest), path);
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(temporaryPath, serializeManifest(manifest), "utf8");
    await rename(temporaryPath, path);
  } catch (error) {
    throw new ManifestError(path, "cannot be published atomically", error);
  }
}

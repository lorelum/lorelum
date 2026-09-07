import { createHash } from "node:crypto";
import { cp, lstat, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

import { ArtifactIntegrityError } from "../errors";

import {
  PROJECTION_RELATIVE_PATH,
  type SnapshotProjection,
  serializeProjection,
} from "./projection";

function posixRelative(rootPath: string, path: string): string {
  return relative(rootPath, path).split(sep).join("/");
}

async function collectFiles(rootPath: string, directory = rootPath): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new ArtifactIntegrityError(path, "symbolic links are not allowed in a snapshot");
    }
    if (entry.isDirectory()) {
      // eslint-disable-next-line no-await-in-loop -- recurse one directory at a time to preserve bounded I/O
      files.push(...(await collectFiles(rootPath, path)));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files.sort((left, right) => {
    const leftRelative = posixRelative(rootPath, left);
    const rightRelative = posixRelative(rootPath, right);
    return leftRelative < rightRelative ? -1 : leftRelative > rightRelative ? 1 : 0;
  });
}

/** Hash every regular snapshot file using ADR 0007's path-NUL-content-LF encoding. */
export async function calculateArtifactDigest(snapshotPath: string): Promise<string> {
  const hash = createHash("sha256");
  const paths = await collectFiles(snapshotPath);
  for (const path of paths) {
    hash.update(posixRelative(snapshotPath, path), "utf8");
    hash.update(Buffer.from([0]));
    // eslint-disable-next-line no-await-in-loop -- hash input order is part of the digest contract
    hash.update(await readFile(path));
    hash.update(Buffer.from([10]));
  }
  return hash.digest("hex");
}

/** Write the generated projection before calculating the sealed artifact digest. */
export async function sealSnapshot(
  snapshotPath: string,
  projection: SnapshotProjection,
): Promise<string> {
  const projectionPath = join(snapshotPath, PROJECTION_RELATIVE_PATH);
  const temporaryPath = projectionPath + ".tmp-" + crypto.randomUUID();
  await mkdir(join(snapshotPath, ".lorelum"), { recursive: true });
  try {
    await writeFile(temporaryPath, serializeProjection(projection), "utf8");
    await rename(temporaryPath, projectionPath);
  } catch {
    await rm(temporaryPath, { force: true });
    throw new ArtifactIntegrityError(snapshotPath, "cannot publish the generated projection");
  }
  return calculateArtifactDigest(snapshotPath);
}

export function artifactPath(rootPath: string, storageKey: string, artifactDigest: string): string {
  if (!/^p-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(storageKey) || !/^[a-f0-9]{64}$/.test(artifactDigest)) {
    throw new ArtifactIntegrityError(rootPath, "storage key or artifact digest is unsafe");
  }
  return join(rootPath, "packs", storageKey, artifactDigest);
}

export interface ArtifactReference {
  readonly storageKey: string;
  readonly artifactDigest: string;
}

/** The lifecycle must provide the active references before replacing a corrupt target. */
export interface ReplaceCorruptTargetAuthorization {
  readonly activeReferences: readonly ArtifactReference[];
}

export interface PromoteArtifactOptions {
  /**
   * Replacing an existing target is opt-in. The active references are checked
   * here (rather than trusting a boolean supplied by the lifecycle) so a
   * referenced artifact can never be removed accidentally.
   */
  readonly replaceCorruptTarget?: ReplaceCorruptTargetAuthorization;
}

export interface PromoteArtifactResult {
  readonly targetPath: string;
  /** False when an already-valid target was reused; the caller owns cleanup. */
  readonly stagedSnapshotConsumed: boolean;
}

function isArtifactReference(
  reference: ArtifactReference,
  storageKey: string,
  artifactDigest: string,
): boolean {
  return reference.storageKey === storageKey && reference.artifactDigest === artifactDigest;
}

/**
 * Promote a staged snapshot into its immutable location. Existing artifacts are
 * accepted only after recomputing their complete digest. A corrupt directory
 * can only be replaced with explicit lifecycle authorization and only when the
 * supplied active-manifest references prove that it is not currently active.
 */
export async function promoteArtifact(
  rootPath: string,
  storageKey: string,
  artifactDigest: string,
  stagedSnapshotPath: string,
  options: PromoteArtifactOptions = {},
): Promise<PromoteArtifactResult> {
  const stagedDigest = await calculateArtifactDigest(stagedSnapshotPath);
  if (stagedDigest !== artifactDigest) {
    throw new ArtifactIntegrityError(
      stagedSnapshotPath,
      "staged digest does not match requested artifact digest",
    );
  }
  const target = artifactPath(rootPath, storageKey, artifactDigest);
  try {
    const existing = await lstat(target);
    if (existing.isSymbolicLink())
      throw new ArtifactIntegrityError(target, "target must not be a symbolic link");
    if (!existing.isDirectory())
      throw new ArtifactIntegrityError(target, "target is not a directory");
    let existingDigest: string | undefined;
    try {
      existingDigest = await calculateArtifactDigest(target);
    } catch {
      // A malformed existing directory is still safely replaceable when the
      // lifecycle has explicitly authorized an unreferenced target.
    }
    if (existingDigest === artifactDigest) {
      return Object.freeze({ targetPath: target, stagedSnapshotConsumed: false });
    }
    const authorization = options.replaceCorruptTarget;
    if (authorization === undefined) {
      throw new ArtifactIntegrityError(target, "existing artifact digest differs");
    }
    if (
      authorization.activeReferences.some((reference) =>
        isArtifactReference(reference, storageKey, artifactDigest),
      )
    ) {
      throw new ArtifactIntegrityError(
        target,
        "cannot replace an artifact referenced by the active manifest",
      );
    }

    // Quarantine the old directory before publishing the staged one. If the
    // second rename fails, restore the old target so callers do not lose it.
    const quarantine = target + ".corrupt-" + crypto.randomUUID();
    await rename(target, quarantine);
    try {
      await rename(stagedSnapshotPath, target);
    } catch (error) {
      try {
        await rename(quarantine, target);
      } catch {
        throw new ArtifactIntegrityError(
          target,
          "cannot restore the corrupt artifact after promotion failure",
        );
      }
      throw error;
    }
    await rm(quarantine, { recursive: true, force: true });
    return Object.freeze({ targetPath: target, stagedSnapshotConsumed: true });
  } catch (error) {
    if (
      !(typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")
    ) {
      if (error instanceof ArtifactIntegrityError) throw error;
      throw new ArtifactIntegrityError(target, "cannot inspect promotion target");
    }
  }
  await mkdir(join(rootPath, "packs", storageKey), { recursive: true });
  await rename(stagedSnapshotPath, target);
  return Object.freeze({ targetPath: target, stagedSnapshotConsumed: true });
}

/** Convenience for tests and future lifecycle staging; it never follows symlinks. */
export async function copySnapshot(sourcePath: string, stagingPath: string): Promise<void> {
  await cp(sourcePath, stagingPath, { recursive: true, dereference: false, errorOnExist: true });
}

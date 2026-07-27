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
  async function visit(index: number): Promise<void> {
    const entry = entries[index];
    if (entry === undefined) return;
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new ArtifactIntegrityError(path, "symbolic links are not allowed in a snapshot");
    }
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(rootPath, path)));
    } else if (entry.isFile()) {
      files.push(path);
    }
    await visit(index + 1);
  }
  await visit(0);
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
  async function hashFile(index: number): Promise<void> {
    const path = paths[index];
    if (path === undefined) return;
    hash.update(posixRelative(snapshotPath, path), "utf8");
    hash.update(Buffer.from([0]));
    hash.update(await readFile(path));
    hash.update(Buffer.from([10]));
    await hashFile(index + 1);
  }
  await hashFile(0);
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

/**
 * Promote a staged snapshot into its immutable location. Existing artifacts are
 * accepted only after recomputing their complete digest.
 */
export async function promoteArtifact(
  rootPath: string,
  storageKey: string,
  artifactDigest: string,
  stagedSnapshotPath: string,
): Promise<string> {
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
    if ((await calculateArtifactDigest(target)) === artifactDigest) return target;
    throw new ArtifactIntegrityError(target, "existing artifact digest differs");
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
  return target;
}

/** Convenience for tests and future lifecycle staging; it never follows symlinks. */
export async function copySnapshot(sourcePath: string, stagingPath: string): Promise<void> {
  await cp(sourcePath, stagingPath, { recursive: true, dereference: false, errorOnExist: true });
}

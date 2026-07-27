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
  const nestedFiles = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new ArtifactIntegrityError(path, "symbolic links are not allowed in a snapshot");
      }
      if (entry.isDirectory()) return collectFiles(rootPath, path);
      return entry.isFile() ? [path] : [];
    }),
  );
  const files = nestedFiles.flat();
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
  const contents = await Promise.all(paths.map((path) => readFile(path)));
  for (const [index, path] of paths.entries()) {
    const content = contents[index];
    if (content === undefined) throw new ArtifactIntegrityError(path, "file content was not read");
    hash.update(posixRelative(snapshotPath, path), "utf8");
    hash.update(Buffer.from([0]));
    hash.update(content);
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

/**
 * Promote a staged snapshot into its immutable location. Existing artifacts are
 * accepted only after recomputing their complete digest.
 */
export async function promoteArtifact(
  rootPath: string,
  storageKey: string,
  artifactDigest: string,
  stagedSnapshotPath: string,
  replaceExisting = false,
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
    if (!replaceExisting)
      throw new ArtifactIntegrityError(target, "existing artifact digest differs");
    await rm(target, { recursive: true, force: false });
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

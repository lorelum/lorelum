import { access, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

import { normalizeSnapshotPath } from "./canonicalize";
import { InvalidPreparedPackError } from "./errors";
import type { SnapshotFile, StorageRoot } from "./types";

export interface StagedArtifact {
  readonly directory: string;
}

export function artifactPath(
  root: StorageRoot,
  storageKey: string,
  artifactDigest: string,
): string {
  return join(root.path, "packs", storageKey, artifactDigest);
}

export async function stageArtifact(
  root: StorageRoot,
  operationId: string,
  files: readonly SnapshotFile[],
): Promise<StagedArtifact> {
  const directory = join(root.path, "staging", operationId);
  const seen = new Set<string>();
  await mkdir(directory, { recursive: true });

  try {
    const writes: Promise<void>[] = [];
    for (const file of files) {
      const path = normalizeSnapshotPath(file.relativePath);
      if (seen.has(path)) {
        throw new InvalidPreparedPackError(`Duplicate snapshot path "${path}"`);
      }
      seen.add(path);

      const destination = safeDescendant(directory, path);
      writes.push(
        mkdir(join(destination, ".."), { recursive: true }).then(() =>
          writeFile(destination, file.bytes),
        ),
      );
    }

    const results = await Promise.allSettled(writes);
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failure !== undefined) throw failure.reason;
  } catch (error: unknown) {
    await discardStagedArtifact(root, { directory });
    throw error;
  }

  return { directory };
}

export async function promoteArtifact(
  root: StorageRoot,
  staged: StagedArtifact,
  storageKey: string,
  artifactDigest: string,
): Promise<void> {
  const destination = artifactPath(root, storageKey, artifactDigest);
  await mkdir(join(destination, ".."), { recursive: true });

  try {
    await access(destination);
    await discardStagedArtifact(root, staged);
  } catch (error: unknown) {
    if (!isNodeError(error, "ENOENT")) throw error;
    await rename(staged.directory, destination);
  }
}

export async function discardStagedArtifact(
  root: StorageRoot,
  staged: StagedArtifact,
): Promise<void> {
  const stagingRoot = resolve(root.path, "staging");
  const target = resolve(staged.directory);
  if (relative(stagingRoot, target).startsWith("..")) {
    throw new InvalidPreparedPackError(
      "Refusing to remove a staging directory outside StorageRoot",
    );
  }
  await rm(target, { recursive: true, force: true });
}

export async function removeArtifact(
  root: StorageRoot,
  storageKey: string,
  artifactDigest: string,
): Promise<void> {
  const packsRoot = resolve(root.path, "packs");
  const target = resolve(artifactPath(root, storageKey, artifactDigest));
  if (relative(packsRoot, target).startsWith("..")) {
    throw new InvalidPreparedPackError("Refusing to remove an artifact outside StorageRoot");
  }
  await rm(target, { recursive: true, force: true });
}

function safeDescendant(root: string, relativePath: string): string {
  const destination = resolve(root, ...relativePath.split("/"));
  if (relative(resolve(root), destination).startsWith("..")) {
    throw new InvalidPreparedPackError(`Unsafe snapshot path "${relativePath}"`);
  }
  return destination;
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

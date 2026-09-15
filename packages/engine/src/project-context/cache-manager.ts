import { access, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

import { withProjectArtifactPruneGuard } from "./artifact-lease";
import { projectCachePaths } from "./cache";
import { projectCacheCatalogStatus, removeProjectCacheArtifactRecords } from "./cache-catalog";
import { pruneSharedVectorCache, sharedVectorCacheStatus } from "./vector-cache";

const ARTIFACT_ID = /^[a-f0-9]{64}$/;

type ArtifactKind = "keyword" | "semantic";

interface ArtifactDirectory {
  readonly artifactId: string;
  readonly kind: ArtifactKind;
  readonly directory: string;
  readonly byteSize: number;
  readonly hasReady: boolean;
  readonly hasProgress: boolean;
}

export interface ProjectCacheStatus {
  readonly artifactCount: number;
  readonly keywordArtifactCount: number;
  readonly semanticArtifactCount: number;
  readonly progressArtifactCount: number;
  readonly artifactByteSize: number;
  readonly vectorCount: number;
  readonly vectorByteSize: number;
  readonly catalogArtifactCount: number;
}

export interface ProjectCachePruneResult {
  readonly removedArtifactCount: number;
  readonly skippedArtifactCount: number;
  readonly removedArtifactByteSize: number;
  readonly removedVectorByteSize: number;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function fileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}

async function artifactDirectories(cacheRoot: string): Promise<readonly ArtifactDirectory[]> {
  const artifacts = projectCachePaths(cacheRoot).artifacts;
  const values: ArtifactDirectory[] = [];
  for (const kind of ["keyword", "semantic"] as const) {
    const directory = join(artifacts, kind);
    let entries: readonly string[];
    try {
      entries = await readdir(directory);
    } catch {
      continue;
    }
    for (const artifactId of entries) {
      if (!ARTIFACT_ID.test(artifactId)) continue;
      const artifactDirectory = join(directory, artifactId);
      const ready = join(artifactDirectory, "active.sqlite");
      const progress = join(artifactDirectory, "progress.sqlite");
      const [hasReady, hasProgress, readySize, progressSize] = await Promise.all([
        exists(ready),
        exists(progress),
        fileSize(ready),
        fileSize(progress),
      ]);
      if (!hasReady && !hasProgress) continue;
      values.push({
        artifactId,
        kind,
        directory: artifactDirectory,
        byteSize: readySize + progressSize,
        hasReady,
        hasProgress,
      });
    }
  }
  return values;
}

/** Read cache state without creating a cache database or contacting a Backend. */
export async function projectCacheStatus(cacheRoot: string): Promise<ProjectCacheStatus> {
  const [artifacts, vectors, catalog] = await Promise.all([
    artifactDirectories(cacheRoot),
    sharedVectorCacheStatus(cacheRoot),
    projectCacheCatalogStatus(cacheRoot),
  ]);
  return Object.freeze({
    artifactCount: artifacts.length,
    keywordArtifactCount: artifacts.filter((artifact) => artifact.kind === "keyword").length,
    semanticArtifactCount: artifacts.filter((artifact) => artifact.kind === "semantic").length,
    progressArtifactCount: artifacts.filter((artifact) => artifact.hasProgress).length,
    artifactByteSize: artifacts.reduce((total, artifact) => total + artifact.byteSize, 0),
    vectorCount: vectors.vectorCount,
    vectorByteSize: vectors.byteSize,
    catalogArtifactCount: catalog.artifactCount,
  });
}

/**
 * Explicitly discard only unused derived state. Prune never reaches a project
 * source directory or LocalStore and skips an artifact held by a build/query.
 */
export async function pruneProjectCache(cacheRoot: string): Promise<ProjectCachePruneResult> {
  const artifacts = await artifactDirectories(cacheRoot);
  const removed: string[] = [];
  let removedArtifactByteSize = 0;
  let skippedArtifactCount = 0;
  for (const artifact of artifacts) {
    // eslint-disable-next-line no-await-in-loop -- each guard protects one independently removable directory.
    const outcome = await withProjectArtifactPruneGuard(artifact.directory, async () => {
      await rm(artifact.directory, { recursive: true, force: true });
    });
    if (outcome.pruned) {
      removed.push(artifact.artifactId);
      removedArtifactByteSize += artifact.byteSize;
    } else {
      skippedArtifactCount += 1;
    }
  }
  await removeProjectCacheArtifactRecords(cacheRoot, removed);
  // A shared vector can serve any artifact. If even one artifact has an active
  // build or partial reader, retain the vector database rather than guessing
  // whether that operation will need a compatible row in its next batch.
  const removedVectorByteSize =
    skippedArtifactCount === 0 ? await pruneSharedVectorCache(cacheRoot) : 0;
  // Keep the small catalog file: it is useful audit metadata and preserving it
  // avoids a status/prune race recreating it while a foreground query records an artifact.
  return Object.freeze({
    removedArtifactCount: removed.length,
    skippedArtifactCount,
    removedArtifactByteSize,
    removedVectorByteSize,
  });
}

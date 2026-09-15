import { createHash } from "node:crypto";
import { join } from "node:path";

import { resolveLorelumPaths } from "@lorelum/config";

import type { EffectivePractice } from "../local-store";
import type { PersistentKeywordIndexPaths } from "../query/keyword/persistent-keyword-index";
import { projectSemanticPractice } from "../query/semantic/projection";
import type { SemanticIndexPaths } from "../query/semantic/index/paths";

export const PROJECT_CONTEXT_CACHE_VERSION = "v1";

export interface ProjectCachePaths {
  readonly directory: string;
  readonly catalog: string;
  readonly catalogWriter: string;
  readonly artifacts: string;
}

export interface SemanticVectorCachePaths {
  readonly directory: string;
  readonly database: string;
  readonly writer: string;
}

/** A resolved active corpus; its sources stay outside derived cache identity. */
export interface ContentAddressedCorpus {
  readonly practices: readonly EffectivePractice[];
  readonly indexCorpusDigest: string;
}

function hash(parts: readonly string[]): string {
  const hasher = createHash("sha256");
  for (const part of parts) {
    hasher.update(part, "utf8");
    hasher.update("\0", "utf8");
  }
  return hasher.digest("hex");
}

/** User-owned derived state; it is separate from both source directories and LocalStore data. */
export function defaultProjectCacheRoot(): string {
  return join(resolveLorelumPaths().rootDirectory, "cache");
}

/** All project cache state is user-owned and outside ProjectContext source trees. */
export function projectCachePaths(cacheRoot: string): ProjectCachePaths {
  const directory = join(cacheRoot, "project-context", PROJECT_CONTEXT_CACHE_VERSION);
  return Object.freeze({
    directory,
    catalog: join(directory, "project-cache.sqlite"),
    catalogWriter: join(directory, "catalog-writer"),
    artifacts: join(directory, "artifacts"),
  });
}

/** Shared vectors are independent from one complete ProjectContext artifact. */
export function semanticVectorCachePaths(cacheRoot: string): SemanticVectorCachePaths {
  const directory = join(cacheRoot, "semantic", PROJECT_CONTEXT_CACHE_VERSION);
  return Object.freeze({
    directory,
    database: join(directory, "vector-cache.sqlite"),
    writer: join(directory, "writer"),
  });
}

export function indexCorpusDigest(practices: readonly EffectivePractice[]): string {
  return hash([
    "project-context-index/v1",
    ...[...practices]
      .sort((left, right) => left.practiceId.localeCompare(right.practiceId))
      .flatMap((practice) => {
        const projection = projectSemanticPractice(practice);
        return [practice.practiceId, practice.contentDigest, projection.projectionDigest];
      }),
  ]);
}

export function projectKeywordArtifactId(
  snapshot: Pick<ContentAddressedCorpus, "indexCorpusDigest">,
): string {
  return hash(["project-context-keyword/v1", snapshot.indexCorpusDigest]);
}

export function projectSemanticArtifactId(
  snapshot: Pick<ContentAddressedCorpus, "indexCorpusDigest">,
  profileId: string,
): string {
  return hash(["project-context-semantic/v1", profileId, snapshot.indexCorpusDigest]);
}

export function projectKeywordIndexPaths(
  cacheRoot: string,
  snapshot: Pick<ContentAddressedCorpus, "indexCorpusDigest">,
): PersistentKeywordIndexPaths {
  const directory = join(
    projectCachePaths(cacheRoot).artifacts,
    "keyword",
    projectKeywordArtifactId(snapshot),
  );
  return Object.freeze({
    directory,
    active: join(directory, "active.sqlite"),
    writer: join(directory, "writer"),
  });
}

export function projectSemanticIndexPaths(
  cacheRoot: string,
  snapshot: Pick<ContentAddressedCorpus, "indexCorpusDigest">,
  profileId: string,
): SemanticIndexPaths {
  const directory = join(
    projectCachePaths(cacheRoot).artifacts,
    "semantic",
    projectSemanticArtifactId(snapshot, profileId),
  );
  return Object.freeze({
    directory,
    active: join(directory, "active.sqlite"),
    writer: join(directory, "writer"),
  });
}

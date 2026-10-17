import { createHash } from "node:crypto";
import { join } from "node:path";

import { resolveLorelumPaths } from "@lorelum/config";

import type { EffectivePractice } from "../../local-store";
import type { PersistentKeywordIndexPaths } from "../keyword/persistent-keyword-index";
import type { SemanticIndexPaths } from "../semantic/index/paths";

export const CONTENT_ARTIFACT_CACHE_VERSION = "v1";

export interface ContentArtifactCachePaths {
  readonly directory: string;
  readonly catalog: string;
  readonly catalogWriter: string;
  readonly artifacts: string;
}

export interface ContentArtifactVectorCachePaths {
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
export function defaultQueryArtifactCacheRoot(): string {
  return join(resolveLorelumPaths().rootDirectory, "cache");
}

/** All content-addressed query cache state is user-owned and outside canonical sources. */
export function contentArtifactCachePaths(cacheRoot: string): ContentArtifactCachePaths {
  const directory = join(cacheRoot, "query-artifacts", CONTENT_ARTIFACT_CACHE_VERSION);
  return Object.freeze({
    directory,
    catalog: join(directory, "artifact-cache.sqlite"),
    catalogWriter: join(directory, "catalog-writer"),
    artifacts: join(directory, "artifacts"),
  });
}

/** Shared vectors are independent from one complete content-addressed artifact. */
export function contentArtifactVectorCachePaths(
  cacheRoot: string,
): ContentArtifactVectorCachePaths {
  const directory = join(cacheRoot, "semantic", CONTENT_ARTIFACT_CACHE_VERSION);
  return Object.freeze({
    directory,
    database: join(directory, "vector-cache.sqlite"),
    writer: join(directory, "writer"),
  });
}

export function indexCorpusDigest(practices: readonly EffectivePractice[]): string {
  return hash([
    "content-addressed-index/v2",
    ...[...practices]
      .sort((left, right) =>
        left.practiceId < right.practiceId ? -1 : left.practiceId > right.practiceId ? 1 : 0,
      )
      .flatMap((practice) => [practice.practiceId, practice.contentDigest]),
  ]);
}

export function contentKeywordArtifactId(
  snapshot: Pick<ContentAddressedCorpus, "indexCorpusDigest">,
): string {
  return hash(["content-addressed-keyword/v1", snapshot.indexCorpusDigest]);
}

export function contentSemanticArtifactId(
  snapshot: Pick<ContentAddressedCorpus, "indexCorpusDigest">,
  profileId: string,
): string {
  return hash(["content-addressed-semantic/v1", profileId, snapshot.indexCorpusDigest]);
}

export function contentKeywordIndexPaths(
  cacheRoot: string,
  snapshot: Pick<ContentAddressedCorpus, "indexCorpusDigest">,
): PersistentKeywordIndexPaths {
  return contentKeywordIndexPathsForArtifactId(cacheRoot, contentKeywordArtifactId(snapshot));
}

/** Resolve a verified opaque keyword artifact ID without retaining source paths. */
export function contentKeywordIndexPathsForArtifactId(
  cacheRoot: string,
  artifactId: string,
): PersistentKeywordIndexPaths {
  const directory = join(contentArtifactCachePaths(cacheRoot).artifacts, "keyword", artifactId);
  return Object.freeze({
    directory,
    active: join(directory, "active.sqlite"),
    writer: join(directory, "writer"),
  });
}

export function contentSemanticIndexPaths(
  cacheRoot: string,
  snapshot: Pick<ContentAddressedCorpus, "indexCorpusDigest">,
  profileId: string,
): SemanticIndexPaths {
  return contentSemanticIndexPathsForArtifactId(
    cacheRoot,
    contentSemanticArtifactId(snapshot, profileId),
  );
}

/** Resolve one opaque semantic artifact ID without retaining source paths. */
export function contentSemanticIndexPathsForArtifactId(
  cacheRoot: string,
  artifactId: string,
): SemanticIndexPaths {
  const directory = join(contentArtifactCachePaths(cacheRoot).artifacts, "semantic", artifactId);
  return Object.freeze({
    directory,
    active: join(directory, "active.sqlite"),
    writer: join(directory, "writer"),
  });
}

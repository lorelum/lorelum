import { isAbsolute } from "node:path";

import {
  defaultQueryArtifactCacheRoot,
  indexCorpusDigest,
  type ContentAddressedCorpus,
  type EmbeddingPort,
  type EmbeddingProfile,
  type LocalStore,
  type StorageRoot,
} from "@lorelum/engine";

import { createContentAddressedSemanticCandidateTraceService } from "../../../engine/src/query/artifacts/semantic";
import type { Environment } from "../config";

/**
 * Benchmark-only derived-cache selector. It is read from the harness process
 * environment, so it never appears in the request payload, the `lore` CLI, the
 * Backend API or any part of the public package surface.
 */
export const BENCHMARK_CACHE_ROOT_ENV_VAR = "LORELUM_BENCHMARK_CACHE_ROOT";

export class BenchmarkCacheRootError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BenchmarkCacheRootError";
  }
}

/** Opaque virtual root: content-addressed artifacts never resolve paths from it. */
const CONTENT_ADDRESSED_ROOT: StorageRoot = Object.freeze({
  rootPath: "content-addressed-artifact",
});

/**
 * Resolve the derived cache that owns the content-addressed semantic artifact.
 * Unset falls back to the same user-level cache the product uses; a configured
 * value must be an absolute path and never falls back silently.
 */
export function resolveBenchmarkCacheRoot(
  environment: Environment = process.env,
  fallback: () => string = defaultQueryArtifactCacheRoot,
): string {
  const configured = environment[BENCHMARK_CACHE_ROOT_ENV_VAR];
  if (configured === undefined || configured.length === 0) return fallback();
  if (!isAbsolute(configured)) {
    throw new BenchmarkCacheRootError(
      `${BENCHMARK_CACHE_ROOT_ENV_VAR} must be an absolute derived-cache root`,
    );
  }
  return configured;
}

export interface BenchmarkSemanticTraceRequest {
  readonly text: string;
  readonly candidateWidth: number;
  readonly resultLimit: number;
}

export interface BenchmarkSemanticTraceResult {
  readonly candidateIds: readonly string[];
  readonly finalIds: readonly string[];
}

export interface BenchmarkSemanticTraceService {
  query(
    root: StorageRoot,
    request: BenchmarkSemanticTraceRequest,
  ): Promise<BenchmarkSemanticTraceResult>;
}

export interface BenchmarkSemanticTraceDependencies {
  /** Canonical source reader only; it never selects the derived index location. */
  readonly store: Pick<LocalStore, "readEffectivePracticeSnapshot">;
  readonly cacheRoot: string;
  readonly profile: EmbeddingProfile;
  readonly embedding: EmbeddingPort;
}

/**
 * Read the canonical Store corpus once and query the content-addressed semantic
 * artifact that a Store-only `lore index build --cache-root` publishes for that
 * exact corpus. The requested Store root selects sources only: derived index
 * lookup always uses `cacheRoot`, and a missing or foreign artifact stays an
 * index failure instead of silently reading a Store-local index.
 */
export function createBenchmarkSemanticTraceService(
  dependencies: BenchmarkSemanticTraceDependencies,
): BenchmarkSemanticTraceService {
  const { store, cacheRoot, profile, embedding } = dependencies;
  return Object.freeze({
    async query(root: StorageRoot, request: BenchmarkSemanticTraceRequest) {
      const snapshot = await store.readEffectivePracticeSnapshot(root);
      const corpus: ContentAddressedCorpus = Object.freeze({
        practices: snapshot.practices,
        indexCorpusDigest: indexCorpusDigest(snapshot.practices),
      });
      const trace = createContentAddressedSemanticCandidateTraceService(
        corpus,
        cacheRoot,
        profile,
        embedding,
      );
      return trace.query(CONTENT_ADDRESSED_ROOT, request);
    },
  });
}

import { access, mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";

import { acquireMutationLock } from "../local-store/storage/mutation-lock";
import { openSqliteConnection } from "../persistence/database/connection";
import {
  projectSemanticIndexDatabaseDefinition,
  semanticProgressIndexDatabaseDefinition,
} from "../persistence/definitions";
import { semanticVectors } from "../persistence/schemas/semantic-index";
import { validateEmbeddingBatch, type EmbeddingPort } from "../query/semantic/encoding";
import { SemanticIndexError, SemanticIndexQueryError } from "../query/semantic/errors";
import {
  applySemanticIndexChanges,
  initializeSemanticIndex,
  readSemanticIndexMetadata,
  type SemanticIndexConnection,
  verifySemanticIndexIntegrity,
} from "../query/semantic/index/database";
import { metadataFor, stateForMetadata } from "../query/semantic/index/metadata";
import { openSemanticIndexReaderAt } from "../query/semantic/index/reader";
import { projectSemanticPractice, type SemanticDocument } from "../query/semantic/projection";
import type { EmbeddingProfile } from "../query/semantic/profile";
import { parseQueryRequest } from "../query/request";
import { assembleQueryHits } from "../query/result";
import type { QueryRequest } from "../query/types";
import type { SemanticQueryResult } from "../query/semantic/query-service";
import { withProjectArtifactLease } from "./artifact-lease";
import {
  projectSemanticArtifactId,
  projectSemanticIndexPaths,
  type ContentAddressedCorpus,
} from "./cache";
import { recordProjectCacheArtifact } from "./cache-catalog";
import { readSharedEmbeddingVectors, writeSharedEmbeddingVectors } from "./vector-cache";

export interface ProjectSemanticProgressStatus {
  readonly state: "missing" | "indexing" | "ready" | "incompatible";
  readonly indexedPracticeCount: number;
  readonly totalPracticeCount: number;
}

export interface ProjectSemanticPartialResult {
  readonly result: SemanticQueryResult;
  readonly indexedPracticeCount: number;
  readonly totalPracticeCount: number;
}

function targetIdentity(snapshot: ContentAddressedCorpus) {
  return Object.freeze({
    rootBinding: `content-addressed:${snapshot.indexCorpusDigest}`,
    generation: 0,
    effectiveRevision: 0,
    manifestDigest: snapshot.indexCorpusDigest,
  });
}

function progressPath(
  cacheRoot: string,
  snapshot: ContentAddressedCorpus,
  profile: EmbeddingProfile,
): string {
  return join(
    projectSemanticIndexPaths(cacheRoot, snapshot, profile.profileId).directory,
    "progress.sqlite",
  );
}

function progressPaths(
  cacheRoot: string,
  snapshot: ContentAddressedCorpus,
  profile: EmbeddingProfile,
) {
  const paths = projectSemanticIndexPaths(cacheRoot, snapshot, profile.profileId);
  return Object.freeze({ ...paths, active: progressPath(cacheRoot, snapshot, profile) });
}

function documents(snapshot: ContentAddressedCorpus): readonly SemanticDocument[] {
  return Object.freeze(snapshot.practices.map(projectSemanticPractice));
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function openProgress(
  path: string,
  snapshot: ContentAddressedCorpus,
  profile: EmbeddingProfile,
): SemanticIndexConnection {
  const connection = openSqliteConnection(path, semanticProgressIndexDatabaseDefinition.schema);
  try {
    verifySemanticIndexIntegrity(connection);
    const metadata = readSemanticIndexMetadata(connection);
    if (stateForMetadata(metadata, targetIdentity(snapshot), profile) !== "ready") {
      throw new SemanticIndexError("Project semantic progress belongs to another target");
    }
    return connection;
  } catch (error) {
    connection.close();
    throw error;
  }
}

function readyIds(connection: SemanticIndexConnection): ReadonlySet<string> {
  return new Set(
    connection.orm
      .select({ practiceId: semanticVectors.practiceId })
      .from(semanticVectors)
      .all()
      .map((row) => row.practiceId),
  );
}

async function ensureProgress(
  path: string,
  snapshot: ContentAddressedCorpus,
  profile: EmbeddingProfile,
): Promise<SemanticIndexConnection> {
  if (await exists(path)) {
    try {
      return openProgress(path, snapshot, profile);
    } catch {
      await rm(path, { force: true }).catch(() => undefined);
    }
  }
  const connection = openSqliteConnection(path, semanticProgressIndexDatabaseDefinition.schema);
  try {
    initializeSemanticIndex(
      connection,
      metadataFor(targetIdentity(snapshot), profile, 0),
      [],
      [],
      semanticProgressIndexDatabaseDefinition,
    );
    verifySemanticIndexIntegrity(connection);
    return connection;
  } catch (error) {
    connection.close();
    throw error;
  }
}

async function embedBatch(
  embedding: EmbeddingPort,
  profile: EmbeddingProfile,
  batch: readonly SemanticDocument[],
): Promise<readonly Float32Array[]> {
  const inputs = batch.map((document) => document.text);
  return validateEmbeddingBatch(profile, inputs, await embedding.embed(inputs));
}

async function vectorsForBatch(
  cacheRoot: string,
  embedding: EmbeddingPort,
  profile: EmbeddingProfile,
  batch: readonly SemanticDocument[],
): Promise<readonly Float32Array[]> {
  const cached = await readSharedEmbeddingVectors(cacheRoot, profile, batch);
  const missing = batch.filter((document) => !cached.has(document.projectionDigest));
  const embedded = missing.length === 0 ? [] : await embedBatch(embedding, profile, missing);
  if (missing.length > 0) {
    await writeSharedEmbeddingVectors(cacheRoot, profile, missing, embedded);
  }
  const embeddedByProjection = new Map(
    missing.map((document, index) => [document.projectionDigest, embedded[index]!] as const),
  );
  return Object.freeze(
    batch.map((document) => {
      const vector =
        cached.get(document.projectionDigest) ??
        embeddedByProjection.get(document.projectionDigest);
      if (vector === undefined)
        throw new SemanticIndexError("Project semantic batch vector is missing");
      return vector;
    }),
  );
}

/**
 * Incrementally publishes vector rows for one content-addressed project target.
 * Its only mutable file is `progress.sqlite`; a complete artifact is still published
 * atomically, and old target progress is unreachable from a changed context digest.
 */
export class ProjectSemanticProgressService {
  constructor(
    private readonly snapshot: ContentAddressedCorpus,
    private readonly cacheRoot: string,
    private readonly profile: EmbeddingProfile,
    private readonly embedding: EmbeddingPort,
    private readonly shouldContinue?: () => boolean,
    private readonly onProgress?: (status: ProjectSemanticProgressStatus) => Promise<void>,
  ) {}

  private get paths() {
    return projectSemanticIndexPaths(this.cacheRoot, this.snapshot, this.profile.profileId);
  }

  private get progress() {
    return progressPath(this.cacheRoot, this.snapshot, this.profile);
  }

  async status(): Promise<ProjectSemanticProgressStatus> {
    if (await exists(this.paths.active)) {
      try {
        const reader = await openSemanticIndexReaderAt(
          this.paths,
          this.profile,
          projectSemanticIndexDatabaseDefinition,
        );
        try {
          return Object.freeze({
            state: "ready",
            indexedPracticeCount: reader.metadata.vectorCount,
            totalPracticeCount: this.snapshot.practices.length,
          });
        } finally {
          reader.close();
        }
      } catch {
        return Object.freeze({
          state: "incompatible",
          indexedPracticeCount: 0,
          totalPracticeCount: this.snapshot.practices.length,
        });
      }
    }
    if (!(await exists(this.progress))) {
      return Object.freeze({
        state: "missing",
        indexedPracticeCount: 0,
        totalPracticeCount: this.snapshot.practices.length,
      });
    }
    try {
      const connection = openProgress(this.progress, this.snapshot, this.profile);
      try {
        return Object.freeze({
          state: "indexing",
          indexedPracticeCount: readSemanticIndexMetadata(connection).vectorCount,
          totalPracticeCount: this.snapshot.practices.length,
        });
      } finally {
        connection.close();
      }
    } catch {
      return Object.freeze({
        state: "incompatible",
        indexedPracticeCount: 0,
        totalPracticeCount: this.snapshot.practices.length,
      });
    }
  }

  /**
   * `force` creates a complete replacement in progress.sqlite while retaining
   * the prior active.sqlite until the replacement passes publication checks.
   */
  async build(options: { readonly force?: boolean } = {}): Promise<ProjectSemanticProgressStatus> {
    await mkdir(this.paths.directory, { recursive: true });
    return withProjectArtifactLease(this.paths.directory, async () => {
      await mkdir(this.paths.writer, { recursive: true });
      const lock = await acquireMutationLock(this.paths.writer);
      try {
        const current = await this.status();
        if (current.state === "ready" && options.force !== true) return current;
        if (options.force === true) {
          // Rebuild must reconstruct this target's complete artifact. The prior
          // active file remains in place until the fresh progress file publishes.
          await rm(this.progress, { force: true }).catch(() => undefined);
        }
        const connection = await ensureProgress(this.progress, this.snapshot, this.profile);
        try {
          const completed = readyIds(connection);
          const missing = documents(this.snapshot).filter(
            (document) => !completed.has(document.practiceId),
          );
          for (let start = 0; start < missing.length; start += this.embedding.maxBatchSize) {
            if (this.shouldContinue !== undefined && !this.shouldContinue()) return this.status();
            const batch = missing.slice(start, start + this.embedding.maxBatchSize);
            // eslint-disable-next-line no-await-in-loop -- each completed batch must be queryable before the next one starts.
            const vectors = await vectorsForBatch(
              this.cacheRoot,
              this.embedding,
              this.profile,
              batch,
            );
            applySemanticIndexChanges(
              connection,
              metadataFor(targetIdentity(this.snapshot), this.profile, 0),
              [],
              batch,
              vectors,
            );
            verifySemanticIndexIntegrity(connection);
            // eslint-disable-next-line no-await-in-loop -- each batch advances observable progress.
            await recordProjectCacheArtifact(this.cacheRoot, {
              artifactId: projectSemanticArtifactId(this.snapshot, this.profile.profileId),
              kind: "semantic",
              profileId: this.profile.profileId,
              corpusDigest: this.snapshot.indexCorpusDigest,
              documentCount: this.snapshot.practices.length,
              state: "progress",
              filePath: this.progress,
              verified: false,
            });
            await this.onProgress?.({
              state: "indexing",
              indexedPracticeCount: readSemanticIndexMetadata(connection).vectorCount,
              totalPracticeCount: this.snapshot.practices.length,
            });
          }
          const metadata = readSemanticIndexMetadata(connection);
          if (metadata.vectorCount !== this.snapshot.practices.length) {
            throw new SemanticIndexError(
              "Project semantic progress did not cover the current snapshot",
            );
          }
        } finally {
          connection.close();
        }
        if (this.shouldContinue !== undefined && !this.shouldContinue()) return this.status();
        await rename(this.progress, this.paths.active);
        await recordProjectCacheArtifact(this.cacheRoot, {
          artifactId: projectSemanticArtifactId(this.snapshot, this.profile.profileId),
          kind: "semantic",
          profileId: this.profile.profileId,
          corpusDigest: this.snapshot.indexCorpusDigest,
          documentCount: this.snapshot.practices.length,
          state: "ready",
          filePath: this.paths.active,
          verified: true,
        });
        return this.status();
      } finally {
        await lock.release();
      }
    });
  }

  async queryPartial(request: QueryRequest): Promise<ProjectSemanticPartialResult | undefined> {
    const input = parseQueryRequest(request);
    const status = await this.status();
    if (status.state !== "indexing" || status.indexedPracticeCount === 0) return undefined;
    return withProjectArtifactLease(this.paths.directory, async () => {
      const reader = await openSemanticIndexReaderAt(
        progressPaths(this.cacheRoot, this.snapshot, this.profile),
        this.profile,
        semanticProgressIndexDatabaseDefinition,
      );
      try {
        const batch = await this.embedding.embed([input.text]);
        const [queryVector] = validateEmbeddingBatch(this.profile, [input.text], batch);
        if (queryVector === undefined)
          throw new SemanticIndexQueryError("Query embedding is missing");
        const candidates = reader.search(queryVector, new Set(), input.limit);
        return Object.freeze({
          result: Object.freeze({
            mode: "semantic",
            profileId: this.profile.profileId,
            coverage: "partial",
            results: assembleQueryHits(
              this.snapshot.practices,
              candidates,
              (message) => new SemanticIndexQueryError(message),
            ),
          }),
          indexedPracticeCount: status.indexedPracticeCount,
          totalPracticeCount: status.totalPracticeCount,
        });
      } finally {
        reader.close();
      }
    });
  }
}

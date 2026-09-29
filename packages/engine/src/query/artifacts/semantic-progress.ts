import { access, copyFile, mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";

import { acquireMutationLock } from "../../local-store/storage/mutation-lock";
import { openSqliteConnection } from "../../persistence/database/connection";
import {
  projectSemanticIndexDatabaseDefinition,
  semanticProgressIndexDatabaseDefinition,
} from "../../persistence/definitions";
import { semanticVectors } from "../../persistence/schemas/semantic-index";
import { validateEmbeddingBatch, type EmbeddingPort } from "../semantic/encoding";
import { SemanticIndexError } from "../semantic/errors";
import {
  applySemanticIndexChanges,
  initializeSemanticIndex,
  readSemanticIndexMetadata,
  readSemanticIndexVector,
  type SemanticIndexConnection,
  verifySemanticIndexIntegrity,
} from "../semantic/index/database";
import { isCompatibleMetadata, metadataFor, stateForMetadata } from "../semantic/index/metadata";
import { openSemanticIndexReaderAt } from "../semantic/index/reader";
import { projectSemanticPractice, type SemanticDocument } from "../semantic/projection";
import type { EmbeddingProfile } from "../semantic/profile";
import type { QueryRequest } from "../types";
import type { SemanticQueryResult } from "../semantic/query-service";
import { assembleSemanticArtifactResult, searchSemanticArtifact } from "../semantic/read";
import { withContentArtifactLease } from "./artifact-lease";
import {
  contentSemanticArtifactId,
  contentSemanticIndexPaths,
  contentSemanticIndexPathsForArtifactId,
  type ContentAddressedCorpus,
} from "./cache";
import { recordContentArtifactCacheArtifact } from "./cache-catalog";
import { readSharedEmbeddingVectors, writeSharedEmbeddingVectors } from "./vector-cache";

export interface ContentAddressedSemanticProgressStatus {
  readonly state: "missing" | "indexing" | "ready" | "incompatible";
  readonly indexedPracticeCount: number;
  readonly totalPracticeCount: number;
}

export interface ContentAddressedSemanticPartialResult {
  readonly result: SemanticQueryResult;
  readonly indexedPracticeCount: number;
  readonly totalPracticeCount: number;
}

/**
 * A verified predecessor is an optional accelerator only. A Store delta seed
 * copies an immutable complete artifact and removes precisely the revision
 * interval's affected rows before the normal batch publisher fills the final
 * current rows. No source path or Practice body is retained here.
 */
export type ContentAddressedSemanticProgressSeed =
  | {
      readonly kind: "artifact";
      readonly artifactId: string;
    }
  | {
      readonly kind: "store-delta";
      readonly artifactId: string;
      readonly sourceDocumentCount: number;
      readonly touchedPracticeIds: readonly string[];
    };

export interface ContentAddressedSemanticArtifactSource {
  readonly sourceSlotId?: string;
  readonly sourceRevision?: number;
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
    contentSemanticIndexPaths(cacheRoot, snapshot, profile.profileId).directory,
    "progress.sqlite",
  );
}

function progressPaths(
  cacheRoot: string,
  snapshot: ContentAddressedCorpus,
  profile: EmbeddingProfile,
) {
  const paths = contentSemanticIndexPaths(cacheRoot, snapshot, profile.profileId);
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
      throw new SemanticIndexError("Content-addressed semantic progress belongs to another target");
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
        throw new SemanticIndexError("Content-addressed semantic batch vector is missing");
      return vector;
    }),
  );
}

async function seedProgressFromArtifact(
  connection: SemanticIndexConnection,
  input: {
    readonly artifactId: string;
    readonly cacheRoot: string;
    readonly snapshot: ContentAddressedCorpus;
    readonly profile: EmbeddingProfile;
  },
): Promise<number> {
  const sourcePaths = contentSemanticIndexPathsForArtifactId(input.cacheRoot, input.artifactId);
  if (!(await exists(sourcePaths.active))) return 0;
  return withContentArtifactLease(sourcePaths.directory, async () => {
    let source: SemanticIndexConnection | undefined;
    try {
      source = openSqliteConnection(
        sourcePaths.active,
        projectSemanticIndexDatabaseDefinition.schema,
        {
          readonly: true,
        },
      );
      verifySemanticIndexIntegrity(source);
      const sourceMetadata = readSemanticIndexMetadata(source);
      if (!isCompatibleMetadata(sourceMetadata, input.profile, sourceMetadata.rootBinding))
        return 0;
      const reusableDocuments: SemanticDocument[] = [];
      const reusableVectors: Float32Array[] = [];
      for (const document of documents(input.snapshot)) {
        const prior = readSemanticIndexVector(
          source,
          document.practiceId,
          input.profile.dimensions,
        );
        if (prior?.projectionDigest !== document.projectionDigest) continue;
        reusableDocuments.push(document);
        reusableVectors.push(prior.vector);
      }
      if (reusableDocuments.length === 0) return 0;
      return applySemanticIndexChanges(
        connection,
        metadataFor(targetIdentity(input.snapshot), input.profile, 0),
        [],
        reusableDocuments,
        reusableVectors,
      ).vectorCount;
    } catch {
      // A previous artifact is an optional accelerator. A corrupt or pruned one
      // must never make the current canonical target unavailable.
      return 0;
    } finally {
      source?.close();
    }
  });
}

/**
 * Reconcile a Store revision interval by copying its immutable predecessor.
 * This deliberately performs no embedding: after the touched rows have been
 * removed, the normal batch loop below reuses shared vectors or encodes only
 * the missing current projections. Any doubt falls back to generic seeding.
 */
async function seedProgressFromStoreDelta(
  targetProgressPath: string,
  input: {
    readonly artifactId: string;
    readonly cacheRoot: string;
    readonly snapshot: ContentAddressedCorpus;
    readonly profile: EmbeddingProfile;
    readonly sourceDocumentCount: number;
    readonly touchedPracticeIds: readonly string[];
  },
): Promise<boolean> {
  if (
    !Number.isSafeInteger(input.sourceDocumentCount) ||
    input.sourceDocumentCount < 0 ||
    input.touchedPracticeIds.length === 0
  ) {
    return false;
  }
  const sourcePaths = contentSemanticIndexPathsForArtifactId(input.cacheRoot, input.artifactId);
  if (!(await exists(sourcePaths.active))) return false;
  return withContentArtifactLease(sourcePaths.directory, async () => {
    let source: SemanticIndexConnection | undefined;
    let target: SemanticIndexConnection | undefined;
    try {
      source = openSqliteConnection(
        sourcePaths.active,
        projectSemanticIndexDatabaseDefinition.schema,
        {
          readonly: true,
        },
      );
      verifySemanticIndexIntegrity(source);
      const sourceMetadata = readSemanticIndexMetadata(source);
      if (
        !isCompatibleMetadata(sourceMetadata, input.profile, sourceMetadata.rootBinding) ||
        sourceMetadata.vectorCount !== input.sourceDocumentCount
      ) {
        return false;
      }
      await copyFile(sourcePaths.active, targetProgressPath);
      target = openSqliteConnection(
        targetProgressPath,
        semanticProgressIndexDatabaseDefinition.schema,
      );
      verifySemanticIndexIntegrity(target);
      const copied = readSemanticIndexMetadata(target);
      if (
        !isCompatibleMetadata(copied, input.profile, copied.rootBinding) ||
        copied.vectorCount !== input.sourceDocumentCount
      ) {
        return false;
      }
      const touched = [...new Set(input.touchedPracticeIds)].sort();
      const currentIds = new Set(input.snapshot.practices.map((practice) => practice.practiceId));
      const currentTouched = touched.filter((practiceId) => currentIds.has(practiceId));
      applySemanticIndexChanges(
        target,
        metadataFor(targetIdentity(input.snapshot), input.profile, 0),
        touched,
        [],
        [],
      );
      verifySemanticIndexIntegrity(target);
      const expectedRetained = input.snapshot.practices.length - currentTouched.length;
      if (readSemanticIndexMetadata(target).vectorCount !== expectedRetained) return false;
      return true;
    } catch {
      return false;
    } finally {
      target?.close();
      source?.close();
    }
  });
}

/**
 * Incrementally publishes vector rows for one content-addressed target.
 * Its only mutable file is `progress.sqlite`; a complete artifact is still published
 * atomically, and old target progress is unreachable from a changed context digest.
 */
export class ContentAddressedSemanticProgressService {
  constructor(
    private readonly snapshot: ContentAddressedCorpus,
    private readonly cacheRoot: string,
    private readonly profile: EmbeddingProfile,
    private readonly documentEmbedding: EmbeddingPort,
    private readonly shouldContinue?: () => boolean,
    private readonly onProgress?: (status: ContentAddressedSemanticProgressStatus) => Promise<void>,
    private readonly queryEmbedding: EmbeddingPort = documentEmbedding,
    private readonly seed?: ContentAddressedSemanticProgressSeed,
    private readonly artifactSource: ContentAddressedSemanticArtifactSource = {},
  ) {}

  private get paths() {
    return contentSemanticIndexPaths(this.cacheRoot, this.snapshot, this.profile.profileId);
  }

  private get progress() {
    return progressPath(this.cacheRoot, this.snapshot, this.profile);
  }

  async status(): Promise<ContentAddressedSemanticProgressStatus> {
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
  async build(
    options: { readonly force?: boolean } = {},
  ): Promise<ContentAddressedSemanticProgressStatus> {
    await mkdir(this.paths.directory, { recursive: true });
    return withContentArtifactLease(this.paths.directory, async () => {
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
        let connection: SemanticIndexConnection | undefined = await ensureProgress(
          this.progress,
          this.snapshot,
          this.profile,
        );
        const openConnection = (): SemanticIndexConnection => {
          if (connection === undefined)
            throw new SemanticIndexError("Semantic progress is not open");
          return connection;
        };
        try {
          let completed = readyIds(openConnection());
          if (completed.size === 0 && options.force !== true && this.seed !== undefined) {
            if (this.seed.kind === "store-delta") {
              openConnection().close();
              connection = undefined;
              const copied = await seedProgressFromStoreDelta(this.progress, {
                artifactId: this.seed.artifactId,
                cacheRoot: this.cacheRoot,
                snapshot: this.snapshot,
                profile: this.profile,
                sourceDocumentCount: this.seed.sourceDocumentCount,
                touchedPracticeIds: this.seed.touchedPracticeIds,
              });
              if (!copied) await rm(this.progress, { force: true }).catch(() => undefined);
              connection = await ensureProgress(this.progress, this.snapshot, this.profile);
              if (!copied) {
                await seedProgressFromArtifact(openConnection(), {
                  artifactId: this.seed.artifactId,
                  cacheRoot: this.cacheRoot,
                  snapshot: this.snapshot,
                  profile: this.profile,
                });
              }
            } else {
              await seedProgressFromArtifact(openConnection(), {
                artifactId: this.seed.artifactId,
                cacheRoot: this.cacheRoot,
                snapshot: this.snapshot,
                profile: this.profile,
              });
            }
            completed = readyIds(openConnection());
            if (completed.size > 0) {
              // Seeded rows are verified against the current Practice IDs and
              // projection digests before publication, so they are immediately
              // eligible for partial query coverage.
              await this.onProgress?.({
                state: "indexing",
                indexedPracticeCount: completed.size,
                totalPracticeCount: this.snapshot.practices.length,
              });
            }
          }
          const missing = documents(this.snapshot).filter(
            (document) => !completed.has(document.practiceId),
          );
          for (
            let start = 0;
            start < missing.length;
            start += this.documentEmbedding.maxBatchSize
          ) {
            if (this.shouldContinue !== undefined && !this.shouldContinue()) return this.status();
            const batch = missing.slice(start, start + this.documentEmbedding.maxBatchSize);
            // eslint-disable-next-line no-await-in-loop -- each completed batch must be queryable before the next one starts.
            const vectors = await vectorsForBatch(
              this.cacheRoot,
              this.documentEmbedding,
              this.profile,
              batch,
            );
            applySemanticIndexChanges(
              openConnection(),
              metadataFor(targetIdentity(this.snapshot), this.profile, 0),
              [],
              batch,
              vectors,
            );
            verifySemanticIndexIntegrity(openConnection());
            // eslint-disable-next-line no-await-in-loop -- each batch advances observable progress.
            await recordContentArtifactCacheArtifact(this.cacheRoot, {
              artifactId: contentSemanticArtifactId(this.snapshot, this.profile.profileId),
              kind: "semantic",
              profileId: this.profile.profileId,
              corpusDigest: this.snapshot.indexCorpusDigest,
              ...(this.artifactSource.sourceSlotId === undefined
                ? {}
                : { sourceSlotId: this.artifactSource.sourceSlotId }),
              ...(this.artifactSource.sourceRevision === undefined
                ? {}
                : { sourceRevision: this.artifactSource.sourceRevision }),
              documentCount: this.snapshot.practices.length,
              state: "progress",
              filePath: this.progress,
              verified: false,
            });
            // eslint-disable-next-line no-await-in-loop -- journal progress must commit before the next batch is visible.
            await this.onProgress?.({
              state: "indexing",
              indexedPracticeCount: readSemanticIndexMetadata(openConnection()).vectorCount,
              totalPracticeCount: this.snapshot.practices.length,
            });
          }
          const metadata = readSemanticIndexMetadata(openConnection());
          if (metadata.vectorCount !== this.snapshot.practices.length) {
            throw new SemanticIndexError(
              "Project semantic progress did not cover the current snapshot",
            );
          }
        } finally {
          connection?.close();
        }
        if (this.shouldContinue !== undefined && !this.shouldContinue()) return this.status();
        await rename(this.progress, this.paths.active);
        await recordContentArtifactCacheArtifact(this.cacheRoot, {
          artifactId: contentSemanticArtifactId(this.snapshot, this.profile.profileId),
          kind: "semantic",
          profileId: this.profile.profileId,
          corpusDigest: this.snapshot.indexCorpusDigest,
          ...(this.artifactSource.sourceSlotId === undefined
            ? {}
            : { sourceSlotId: this.artifactSource.sourceSlotId }),
          ...(this.artifactSource.sourceRevision === undefined
            ? {}
            : { sourceRevision: this.artifactSource.sourceRevision }),
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

  async queryPartial(
    request: QueryRequest,
  ): Promise<ContentAddressedSemanticPartialResult | undefined> {
    const status = await this.status();
    if (status.state !== "indexing" || status.indexedPracticeCount === 0) return undefined;
    return withContentArtifactLease(this.paths.directory, async () => {
      const reader = await openSemanticIndexReaderAt(
        progressPaths(this.cacheRoot, this.snapshot, this.profile),
        this.profile,
        semanticProgressIndexDatabaseDefinition,
      );
      try {
        const candidates = await searchSemanticArtifact({
          reader,
          profile: this.profile,
          embedding: this.queryEmbedding,
          request,
          excludedPracticeIds: new Set(),
        });
        return Object.freeze({
          result: assembleSemanticArtifactResult({
            profile: this.profile,
            coverage: "partial",
            practices: this.snapshot.practices,
            candidates,
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

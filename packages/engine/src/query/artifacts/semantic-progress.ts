import { access, copyFile, mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";

import { acquireMutationLock } from "../../local-store/storage/mutation-lock";
import { openSqliteConnection } from "../../persistence/database/connection";
import {
  projectSemanticIndexDatabaseDefinition,
  semanticProgressIndexDatabaseDefinition,
} from "../../persistence/definitions";
import { embedInBatches, type EmbeddingPort } from "../semantic/encoding";
import { SemanticIndexError } from "../semantic/errors";
import {
  applySemanticIndexChanges,
  initializeSemanticIndex,
  readSemanticIndexMetadata,
  readSemanticIndexInputs,
  readSemanticIndexVectors,
  type SemanticIndexConnection,
  verifySemanticIndexIntegrity,
} from "../semantic/index/database";
import { isCompatibleMetadata, metadataFor, stateForMetadata } from "../semantic/index/metadata";
import { openSemanticIndexReaderAt } from "../semantic/index/reader";
import type { PracticeVectorProjection, EmbeddingInput } from "../semantic/representation";
import type { EmbeddingProfile, VectorExecution } from "../semantic/profile";
import { parseQueryRequest } from "../request";
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

function readyIds(
  connection: SemanticIndexConnection,
  documents: readonly PracticeVectorProjection[],
): ReadonlySet<string> {
  const ready = new Set<string>();
  for (const document of documents) {
    const rows = readSemanticIndexInputs(connection, document.practiceId);
    if (rows.length !== document.inputs.length || rows.length === 0) continue;
    const byKey = new Map(rows.map((row) => [row.inputKey, row] as const));
    if (
      document.inputs.every((input) => {
        const row = byKey.get(input.inputKey);
        return (
          row?.inputDigest === input.inputDigest &&
          row.channel === input.channel &&
          row.ordinal === input.ordinal &&
          row.contentDigest === document.contentDigest
        );
      })
    )
      ready.add(document.practiceId);
  }
  return ready;
}

async function ensureProgress(
  path: string,
  snapshot: ContentAddressedCorpus,
  profile: EmbeddingProfile,
): Promise<SemanticIndexConnection> {
  if (await exists(path)) {
    try {
      const connection = openProgress(path, snapshot, profile);
      try {
        verifySemanticIndexIntegrity(connection);
        return connection;
      } catch (error) {
        connection.close();
        throw error;
      }
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
  batch: readonly EmbeddingInput[],
): Promise<readonly Float32Array[]> {
  return embedInBatches(
    profile,
    embedding,
    batch.map((view) => view.text),
  );
}

async function vectorsForBatch(
  cacheRoot: string,
  embedding: EmbeddingPort,
  profile: EmbeddingProfile,
  batch: readonly EmbeddingInput[],
): Promise<readonly Float32Array[]> {
  const cached = await readSharedEmbeddingVectors(cacheRoot, profile, batch);
  const missing = batch.filter((input) => !cached.has(input.inputDigest));
  const embedded = missing.length === 0 ? [] : await embedBatch(embedding, profile, missing);
  if (missing.length > 0) {
    await writeSharedEmbeddingVectors(cacheRoot, profile, missing, embedded);
  }
  const embeddedByProjection = new Map(
    missing.map((input, index) => [input.inputDigest, embedded[index]!] as const),
  );
  return Object.freeze(
    batch.map((view) => {
      const vector = cached.get(view.inputDigest) ?? embeddedByProjection.get(view.inputDigest);
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
    readonly execution: VectorExecution;
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
      if (
        !isCompatibleMetadata(sourceMetadata, input.execution.profile, sourceMetadata.rootBinding)
      )
        return 0;
      const reusableDocuments: PracticeVectorProjection[] = [];
      const reusableVectors: (readonly Float32Array[])[] = [];
      for (const document of input.snapshot.practices.map((practice) =>
        input.execution.method.projectDocument(practice),
      )) {
        const priorByView = new Map(
          (
            readSemanticIndexVectors(
              source,
              document.practiceId,
              input.execution.profile.dimensions,
            ) ?? []
          ).map((vector) => [vector.inputKey, vector] as const),
        );
        const vectors: Float32Array[] = [];
        for (const view of document.inputs) {
          const prior = priorByView.get(view.inputKey);
          if (prior?.inputDigest !== view.inputDigest) break;
          vectors.push(prior.embedding);
        }
        if (vectors.length !== document.inputs.length) continue;
        reusableDocuments.push(document);
        reusableVectors.push(Object.freeze(vectors));
      }
      if (reusableDocuments.length === 0) return 0;
      return applySemanticIndexChanges(
        connection,
        metadataFor(targetIdentity(input.snapshot), input.execution.profile, 0),
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
    readonly execution: VectorExecution;
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
        !isCompatibleMetadata(
          sourceMetadata,
          input.execution.profile,
          sourceMetadata.rootBinding,
        ) ||
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
        !isCompatibleMetadata(copied, input.execution.profile, copied.rootBinding) ||
        copied.vectorCount !== input.sourceDocumentCount
      ) {
        return false;
      }
      const touched = [...new Set(input.touchedPracticeIds)].sort();
      const currentIds = new Set(input.snapshot.practices.map((practice) => practice.practiceId));
      const currentTouched = touched.filter((practiceId) => currentIds.has(practiceId));
      applySemanticIndexChanges(
        target,
        metadataFor(targetIdentity(input.snapshot), input.execution.profile, 0),
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
    private readonly execution: VectorExecution,
    private readonly documentEmbedding: EmbeddingPort,
    private readonly shouldContinue?: () => boolean,
    private readonly onProgress?: (status: ContentAddressedSemanticProgressStatus) => Promise<void>,
    private readonly queryEmbedding: EmbeddingPort = documentEmbedding,
    private readonly seed?: ContentAddressedSemanticProgressSeed,
    private readonly artifactSource: ContentAddressedSemanticArtifactSource = {},
  ) {
    this.documents = Object.freeze(
      snapshot.practices.map((practice) => execution.method.projectDocument(practice)),
    );
  }

  private readonly documents: readonly PracticeVectorProjection[];

  private get paths() {
    return contentSemanticIndexPaths(
      this.cacheRoot,
      this.snapshot,
      this.execution.profile.profileId,
    );
  }

  private get progress() {
    return progressPath(this.cacheRoot, this.snapshot, this.execution.profile);
  }

  async status(): Promise<ContentAddressedSemanticProgressStatus> {
    if (await exists(this.paths.active)) {
      try {
        const connection = openProgress(this.paths.active, this.snapshot, this.execution.profile);
        try {
          const indexed = readyIds(connection, this.documents).size;
          if (
            indexed !== this.documents.length ||
            readSemanticIndexMetadata(connection).vectorCount !== indexed
          ) {
            throw new SemanticIndexError(
              "Complete semantic artifact has incomplete Practice inputs",
            );
          }
          return Object.freeze({
            state: "ready",
            indexedPracticeCount: indexed,
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
    if (!(await exists(this.progress))) {
      return Object.freeze({
        state: "missing",
        indexedPracticeCount: 0,
        totalPracticeCount: this.snapshot.practices.length,
      });
    }
    try {
      const connection = openProgress(this.progress, this.snapshot, this.execution.profile);
      try {
        return Object.freeze({
          state: "indexing",
          indexedPracticeCount: readyIds(connection, this.documents).size,
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
          this.execution.profile,
        );
        const openConnection = (): SemanticIndexConnection => {
          if (connection === undefined)
            throw new SemanticIndexError("Semantic progress is not open");
          return connection;
        };
        try {
          let completed = readyIds(openConnection(), this.documents);
          if (completed.size === 0 && options.force !== true && this.seed !== undefined) {
            if (this.seed.kind === "store-delta") {
              openConnection().close();
              connection = undefined;
              const copied = await seedProgressFromStoreDelta(this.progress, {
                artifactId: this.seed.artifactId,
                cacheRoot: this.cacheRoot,
                snapshot: this.snapshot,
                execution: this.execution,
                sourceDocumentCount: this.seed.sourceDocumentCount,
                touchedPracticeIds: this.seed.touchedPracticeIds,
              });
              if (!copied) await rm(this.progress, { force: true }).catch(() => undefined);
              connection = await ensureProgress(
                this.progress,
                this.snapshot,
                this.execution.profile,
              );
              if (!copied) {
                await seedProgressFromArtifact(openConnection(), {
                  artifactId: this.seed.artifactId,
                  cacheRoot: this.cacheRoot,
                  snapshot: this.snapshot,
                  execution: this.execution,
                });
              }
            } else {
              await seedProgressFromArtifact(openConnection(), {
                artifactId: this.seed.artifactId,
                cacheRoot: this.cacheRoot,
                snapshot: this.snapshot,
                execution: this.execution,
              });
            }
            completed = readyIds(openConnection(), this.documents);
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
          const missing = this.documents.filter((document) => !completed.has(document.practiceId));
          for (
            let start = 0;
            start < missing.length;
            start += this.documentEmbedding.maxBatchSize
          ) {
            if (this.shouldContinue !== undefined && !this.shouldContinue()) return this.status();
            const batch = missing.slice(start, start + this.documentEmbedding.maxBatchSize);
            const views = batch.flatMap((document) => document.inputs);
            // eslint-disable-next-line no-await-in-loop -- each completed batch must be queryable before the next one starts.
            const flatVectors = await vectorsForBatch(
              this.cacheRoot,
              this.documentEmbedding,
              this.execution.profile,
              views,
            );
            let vectorIndex = 0;
            const vectors = Object.freeze(
              batch.map((document) =>
                Object.freeze(
                  document.inputs.map(() => {
                    const vector = flatVectors[vectorIndex];
                    vectorIndex += 1;
                    if (vector === undefined)
                      throw new SemanticIndexError("Project semantic view vector is missing");
                    return vector;
                  }),
                ),
              ),
            );
            applySemanticIndexChanges(
              openConnection(),
              metadataFor(targetIdentity(this.snapshot), this.execution.profile, 0),
              batch.map((document) => document.practiceId),
              batch,
              vectors,
            );
            verifySemanticIndexIntegrity(openConnection());
            // eslint-disable-next-line no-await-in-loop -- each batch advances observable progress.
            await recordContentArtifactCacheArtifact(this.cacheRoot, {
              artifactId: contentSemanticArtifactId(
                this.snapshot,
                this.execution.profile.profileId,
              ),
              kind: "semantic",
              profileId: this.execution.profile.profileId,
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
              indexedPracticeCount: readyIds(openConnection(), this.documents).size,
              totalPracticeCount: this.snapshot.practices.length,
            });
          }
          const metadata = readSemanticIndexMetadata(openConnection());
          if (
            metadata.vectorCount !== this.snapshot.practices.length ||
            readyIds(openConnection(), this.documents).size !== this.documents.length
          ) {
            throw new SemanticIndexError(
              "Project semantic progress did not cover the current snapshot",
            );
          }
          verifySemanticIndexIntegrity(openConnection());
        } finally {
          connection?.close();
        }
        if (this.shouldContinue !== undefined && !this.shouldContinue()) return this.status();
        await rename(this.progress, this.paths.active);
        await recordContentArtifactCacheArtifact(this.cacheRoot, {
          artifactId: contentSemanticArtifactId(this.snapshot, this.execution.profile.profileId),
          kind: "semantic",
          profileId: this.execution.profile.profileId,
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
    const parsed = parseQueryRequest(request);
    return withContentArtifactLease(this.paths.directory, async () => {
      const connection = openProgress(this.progress, this.snapshot, this.execution.profile);
      let completed: ReadonlySet<string>;
      try {
        completed = readyIds(connection, this.documents);
      } finally {
        connection.close();
      }
      const reader = await openSemanticIndexReaderAt(
        progressPaths(this.cacheRoot, this.snapshot, this.execution.profile),
        this.execution.profile,
        semanticProgressIndexDatabaseDefinition,
      );
      try {
        const candidates = await searchSemanticArtifact({
          reader,
          execution: this.execution,
          embedding: this.queryEmbedding,
          text: parsed.text,
          excludedPracticeIds: new Set(
            this.documents
              .filter((document) => !completed.has(document.practiceId))
              .map((document) => document.practiceId),
          ),
        });
        return Object.freeze({
          result: assembleSemanticArtifactResult({
            profile: this.execution.profile,
            coverage: "partial",
            practices: this.snapshot.practices,
            candidates: candidates.slice(0, parsed.limit),
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

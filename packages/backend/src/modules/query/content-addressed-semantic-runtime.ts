import { createHash, randomUUID } from "node:crypto";
import { noopEmitter, type LogEmitter } from "@lorelum/log";

import {
  createContentAddressedSemanticServices,
  createVectorExecution,
  DEFAULT_VECTOR_RETRIEVAL_METHOD_ID,
  resolveVectorRetrievalMethod,
  indexCorpusDigest,
  InvalidProjectRootError,
  ContentAddressedSemanticProgressService,
  contentSemanticArtifactId,
  contentSemanticIndexPaths,
  recentContentArtifactPredecessors,
  revisionDeltaPracticeIds,
  resolveProjectContext,
  withContentArtifactLease,
  type ContentAddressedCorpus,
  type ContentAddressedSemanticProgressSeed,
  type EmbeddingPort,
  type EncodingContract,
  type VectorExecution,
  type VectorRetrievalMethodId,
  type LocalStore,
  type QueryRequest,
  type SemanticQueryResult,
  type StorageRoot,
  StoreBusyError,
  StoreRecoveryRequiredError,
} from "@lorelum/engine";

import { waitForCompletionOrDeadline } from "../../lifecycle/deadline";
import { BackendError } from "../../protocol/errors";
import { EmbeddingError, embeddingErrorCodes } from "../embedding/errors";
import type { ModelPreparation, ModelStatus } from "../embedding/dto";
import type { IndexOperation, IndexOperationErrorCode, IndexStatus } from "../index/model";
import {
  SemanticOperationJournal,
  type SemanticOperationRecord,
} from "./project-operation-journal";

export interface StoreTargetRequest {
  readonly kind: "store";
  readonly cacheRoot: string;
  readonly retrievalMethod?: VectorRetrievalMethodId;
}
export interface ProjectContextTargetRequest {
  readonly kind: "project";
  readonly cacheRoot: string;
  readonly retrievalMethod?: VectorRetrievalMethodId;
  /** CLI working directory used for Backend-side automatic layer discovery. */
  readonly startDirectory?: string;
  /** Explicit leaf supplied by --project-root, when present. */
  readonly projectRoot?: string;
}
export type ContentAddressedTargetRequest = StoreTargetRequest | ProjectContextTargetRequest;

export interface QueryContextSummary {
  readonly state: "ready" | "degraded";
  readonly warnings: {
    readonly code: "config.invalid" | "pack.invalid" | "practice.invalid" | "source.unsafe";
    readonly layerDepth: number;
    readonly packName?: string;
    readonly practiceId?: string;
  }[];
}
export interface ContentAddressedSemanticIndexingResult {
  readonly state: "indexing";
  readonly operationId: string;
  readonly indexedPracticeCount: number;
  readonly totalPracticeCount: number;
  readonly context?: QueryContextSummary;
}
export interface ContentAddressedSemanticPreparingResult {
  readonly state: "preparing";
  readonly preparationId: string;
  readonly context?: QueryContextSummary;
}
export interface ContentAddressedSemanticPartialResult extends SemanticQueryResult {
  readonly indexedPracticeCount: number;
  readonly totalPracticeCount: number;
  readonly operationId: string;
  readonly context?: QueryContextSummary;
}
export type ContentAddressedSemanticQueryResult =
  | (SemanticQueryResult & { readonly context?: QueryContextSummary })
  | ContentAddressedSemanticPartialResult
  | ContentAddressedSemanticIndexingResult
  | ContentAddressedSemanticPreparingResult;

export interface ContentAddressedSemanticRuntimePort {
  query(
    root: StorageRoot,
    target: ContentAddressedTargetRequest,
    query: QueryRequest,
    policy: QueryPolicy,
  ): Promise<ContentAddressedSemanticQueryResult>;
  indexStatus(root: StorageRoot, target: ContentAddressedTargetRequest): Promise<IndexStatus>;
  build(root: StorageRoot, target: ContentAddressedTargetRequest): Promise<IndexOperation>;
  rebuild(root: StorageRoot, target: ContentAddressedTargetRequest): Promise<IndexOperation>;
  indexOperation(operationId: string): Promise<IndexOperation | undefined>;
  waitForIdle(deadline?: number): Promise<void>;
}
export interface ContentAddressedSemanticModelPreparation {
  /** Read-only state lets a successful explicit model load clear an old terminal failure. */
  status?(): Pick<ModelStatus, "state">;
  beginModelPreparation(): ModelPreparation;
  waitModelPreparation(preparationId: string): Promise<ModelStatus>;
}

interface QueryPolicy {
  readonly maxWaitMs: number;
  readonly minCoveragePercent: number;
}
interface SemanticTarget {
  readonly kind: "project" | "store";
  readonly sourceId: string;
  readonly targetSlotId: string;
  readonly cacheScopeId: string;
  readonly artifactId: string;
  readonly corpus: ContentAddressedCorpus;
  readonly cacheRoot: string;
  readonly execution: VectorExecution;
  /** Store revision is only an opaque cache checkpoint, never an artifact key. */
  readonly sourceRevision?: number;
  readonly seed?: ContentAddressedSemanticProgressSeed;
  readonly context?: QueryContextSummary;
  readonly isCurrent: () => Promise<boolean>;
}
interface SemanticOperation {
  readonly operationId: string;
  readonly key: string;
  readonly target: SemanticTarget;
  readonly task: Promise<void>;
}

/** Shared persistent target queue for Store-only and ProjectContext corpora. */
export class ContentAddressedSemanticRuntime implements ContentAddressedSemanticRuntimePort {
  private readonly operations = new Map<string, SemanticOperation>();
  private readonly starting = new Map<string, Promise<SemanticOperation>>();
  private readonly desiredTargetBySlot = new Map<string, string>();
  private queue: Promise<void> = Promise.resolve();
  private readonly recovered: Promise<readonly SemanticOperationRecord[]>;

  constructor(
    private readonly store: Pick<LocalStore, "readEffectivePracticeSnapshot"> &
      Partial<Pick<LocalStore, "readEffectivePracticeChanges">>,
    private readonly encoding: EncodingContract,
    private readonly documentEmbedding: EmbeddingPort,
    private readonly queryEmbedding: EmbeddingPort,
    private readonly modelPreparation: ContentAddressedSemanticModelPreparation,
    private readonly journal?: SemanticOperationJournal,
    private readonly onIndexActivityChange?: (active: boolean) => Promise<void>,
    private readonly diagnostics: LogEmitter = noopEmitter,
  ) {
    this.recovered = journal?.recover() ?? Promise.resolve([]);
  }

  private static hash(parts: readonly string[]): string {
    const hasher = createHash("sha256");
    for (const part of parts) {
      hasher.update(part, "utf8");
      hasher.update("\0", "utf8");
    }
    return hasher.digest("hex");
  }
  private cacheScopeId(cacheRoot: string): string {
    return ContentAddressedSemanticRuntime.hash(["semantic-cache-scope/v1", cacheRoot]);
  }
  private targetSlotId(
    kind: SemanticTarget["kind"],
    sourceId: string,
    cacheScopeId: string,
    execution: VectorExecution,
  ): string {
    return ContentAddressedSemanticRuntime.hash([
      "semantic-target-slot/v1",
      kind,
      sourceId,
      execution.profile.profileId,
      cacheScopeId,
    ]);
  }
  private operationKey(target: Pick<SemanticTarget, "cacheScopeId" | "artifactId">): string {
    return `${target.cacheScopeId}:${target.artifactId}`;
  }

  /**
   * Catalog rows are advisory: validate their bounded source checkpoint against
   * the Store's retained history before touching a predecessor artifact.
   */
  private async storeDeltaSeed(input: {
    readonly root: StorageRoot;
    readonly cacheRoot: string;
    readonly targetSlotId: string;
    readonly artifactId: string;
    readonly corpus: ContentAddressedCorpus;
    readonly effectiveRevision: number;
  }): Promise<ContentAddressedSemanticProgressSeed | undefined> {
    const readChanges = this.store.readEffectivePracticeChanges;
    if (readChanges === undefined) return undefined;
    const predecessors = await recentContentArtifactPredecessors(input.cacheRoot, {
      kind: "semantic",
      sourceSlotId: input.targetSlotId,
      limit: 2,
    });
    for (const predecessor of predecessors) {
      if (
        predecessor.artifactId === input.artifactId ||
        predecessor.sourceRevision === undefined ||
        predecessor.sourceRevision >= input.effectiveRevision
      ) {
        continue;
      }
      // eslint-disable-next-line no-await-in-loop -- predecessor validation is bounded and must preserve recency order.
      const changes = await readChanges.call(this.store, input.root, predecessor.sourceRevision);
      const touchedPracticeIds = revisionDeltaPracticeIds(
        changes?.deltas.map((change) => change.delta) ?? [],
        true,
      );
      const currentTouched = input.corpus.practices
        .filter((practice) => touchedPracticeIds.includes(practice.practiceId))
        .sort((left, right) => left.practiceId.localeCompare(right.practiceId));
      const returnedTouched = [...(changes?.currentPractices ?? [])].sort((left, right) =>
        left.practiceId.localeCompare(right.practiceId),
      );
      if (
        changes === undefined ||
        changes.identity.effectiveRevision !== input.effectiveRevision ||
        currentTouched.length !== returnedTouched.length ||
        currentTouched.some(
          (practice, index) =>
            practice.practiceId !== returnedTouched[index]?.practiceId ||
            practice.contentDigest !== returnedTouched[index]?.contentDigest,
        )
      ) {
        continue;
      }
      if (touchedPracticeIds.length === 0) continue;
      return Object.freeze({
        kind: "store-delta",
        artifactId: predecessor.artifactId,
        sourceDocumentCount: predecessor.documentCount,
        touchedPracticeIds,
      });
    }
    return undefined;
  }

  private async predecessorSeed(
    cacheRoot: string,
    targetSlotId: string,
    artifactId: string,
  ): Promise<ContentAddressedSemanticProgressSeed | undefined> {
    const predecessors = await recentContentArtifactPredecessors(cacheRoot, {
      kind: "semantic",
      sourceSlotId: targetSlotId,
      limit: 2,
    });
    const predecessor = predecessors.find((candidate) => candidate.artifactId !== artifactId);
    return predecessor === undefined
      ? undefined
      : Object.freeze({ kind: "artifact", artifactId: predecessor.artifactId });
  }

  private async record(
    target: SemanticTarget,
    operationId: string,
    state: SemanticOperationRecord["state"],
    input: {
      readonly indexedPracticeCount: number;
      readonly totalPracticeCount: number;
      readonly attempts: number;
      readonly createdAt: string;
      readonly preparationId?: string;
      readonly error?: IndexOperationErrorCode;
    },
  ): Promise<SemanticOperationRecord> {
    const record: SemanticOperationRecord = Object.freeze({
      operationId,
      targetKind: target.kind,
      sourceId: target.sourceId,
      targetSlotId: target.targetSlotId,
      cacheScopeId: target.cacheScopeId,
      artifactId: target.artifactId,
      corpusDigest: target.corpus.indexCorpusDigest,
      profileId: target.execution.profile.profileId,
      state,
      ...(input.preparationId === undefined ? {} : { preparationId: input.preparationId }),
      ...(state !== "failed" ? {} : { error: input.error ?? "backend.failed" }),
      indexedPracticeCount: input.indexedPracticeCount,
      totalPracticeCount: input.totalPracticeCount,
      attempts: input.attempts,
      createdAt: input.createdAt,
      updatedAt: new Date().toISOString(),
    });
    await this.journal?.upsert(record);
    return record;
  }

  private async projectTarget(
    root: StorageRoot,
    request: ProjectContextTargetRequest,
  ): Promise<SemanticTarget> {
    const snapshot = await resolveProjectContext({
      store: this.store,
      storageRoot: root,
      ...(request.startDirectory === undefined ? {} : { startDirectory: request.startDirectory }),
      ...(request.projectRoot === undefined ? {} : { projectRoot: request.projectRoot }),
    });
    if (snapshot === undefined) {
      if (request.projectRoot !== undefined) throw new InvalidProjectRootError();
      return this.storeTarget(root, {
        kind: "store",
        cacheRoot: request.cacheRoot,
        ...(request.retrievalMethod === undefined
          ? {}
          : { retrievalMethod: request.retrievalMethod }),
      });
    }
    const corpus: ContentAddressedCorpus = snapshot;
    const cacheScopeId = this.cacheScopeId(request.cacheRoot);
    const execution = this.executionFor(request);
    const targetSlotId = this.targetSlotId(
      "project",
      snapshot.projectRootId,
      cacheScopeId,
      execution,
    );
    const artifactId = contentSemanticArtifactId(corpus, execution.profile.profileId);
    const seed = await this.predecessorSeed(request.cacheRoot, targetSlotId, artifactId);
    return Object.freeze({
      kind: "project",
      sourceId: snapshot.projectRootId,
      targetSlotId,
      cacheScopeId,
      artifactId,
      corpus,
      cacheRoot: request.cacheRoot,
      execution,
      ...(seed === undefined ? {} : { seed }),
      context: Object.freeze({
        state: snapshot.state,
        warnings: snapshot.warnings.map((warning) =>
          Object.freeze({
            code: warning.code,
            layerDepth: warning.layerDepth,
            ...(warning.packName === undefined ? {} : { packName: warning.packName }),
            ...(warning.practiceId === undefined ? {} : { practiceId: warning.practiceId }),
          }),
        ),
      }),
      isCurrent: async () => {
        const current = await resolveProjectContext({
          store: this.store,
          storageRoot: root,
          ...(request.startDirectory === undefined
            ? {}
            : { startDirectory: request.startDirectory }),
          ...(request.projectRoot === undefined ? {} : { projectRoot: request.projectRoot }),
        });
        return (
          current !== undefined &&
          current.projectRootId === snapshot.projectRootId &&
          current.indexCorpusDigest === corpus.indexCorpusDigest
        );
      },
    });
  }

  private async storeTarget(
    root: StorageRoot,
    request: StoreTargetRequest,
  ): Promise<SemanticTarget> {
    const snapshot = await this.store.readEffectivePracticeSnapshot(root);
    const corpus: ContentAddressedCorpus = Object.freeze({
      practices: snapshot.practices,
      indexCorpusDigest: indexCorpusDigest(snapshot.practices),
    });
    const cacheScopeId = this.cacheScopeId(request.cacheRoot);
    const sourceId = ContentAddressedSemanticRuntime.hash([
      "semantic-store-source/v1",
      root.rootPath,
    ]);
    const execution = this.executionFor(request);
    const targetSlotId = this.targetSlotId("store", sourceId, cacheScopeId, execution);
    const artifactId = contentSemanticArtifactId(corpus, execution.profile.profileId);
    const deltaSeed = await this.storeDeltaSeed({
      root,
      cacheRoot: request.cacheRoot,
      targetSlotId,
      artifactId,
      corpus,
      effectiveRevision: snapshot.identity.effectiveRevision,
    });
    const seed =
      deltaSeed ?? (await this.predecessorSeed(request.cacheRoot, targetSlotId, artifactId));
    return Object.freeze({
      kind: "store",
      sourceId,
      targetSlotId,
      cacheScopeId,
      artifactId,
      corpus,
      cacheRoot: request.cacheRoot,
      execution,
      sourceRevision: snapshot.identity.effectiveRevision,
      ...(seed === undefined ? {} : { seed }),
      isCurrent: async () =>
        indexCorpusDigest((await this.store.readEffectivePracticeSnapshot(root)).practices) ===
        corpus.indexCorpusDigest,
    });
  }

  private executionFor(request: ContentAddressedTargetRequest): VectorExecution {
    return createVectorExecution(
      this.encoding,
      resolveVectorRetrievalMethod(request.retrievalMethod ?? DEFAULT_VECTOR_RETRIEVAL_METHOD_ID),
    );
  }

  private async resolveTarget(
    root: StorageRoot,
    request: ContentAddressedTargetRequest,
  ): Promise<SemanticTarget> {
    return request.kind === "project"
      ? this.projectTarget(root, request)
      : this.storeTarget(root, request);
  }

  private progress(target: SemanticTarget): ContentAddressedSemanticProgressService {
    return new ContentAddressedSemanticProgressService(
      target.corpus,
      target.cacheRoot,
      target.execution,
      this.documentEmbedding,
      undefined,
      undefined,
      this.queryEmbedding,
    );
  }

  private async indexStatusForTarget(target: SemanticTarget): Promise<IndexStatus> {
    const status = await this.progress(target).status();
    const live = this.operations.get(this.operationKey(target));
    const recorded = await this.journal?.findByTarget(target.artifactId, target.cacheScopeId);
    const operationId =
      live?.operationId ??
      (recorded !== undefined && isPending(recorded.state) ? recorded.operationId : undefined);
    if ((status.state === "indexing" || status.state === "missing") && operationId !== undefined) {
      return Object.freeze({
        state: "indexing",
        profileId: target.execution.profile.profileId,
        operationId,
        indexedPracticeCount:
          status.state === "indexing"
            ? status.indexedPracticeCount
            : (recorded?.indexedPracticeCount ?? 0),
        totalPracticeCount:
          status.state === "indexing"
            ? status.totalPracticeCount
            : (recorded?.totalPracticeCount ?? target.corpus.practices.length),
      });
    }
    if (status.state === "missing")
      return Object.freeze({ state: "missing", profileId: target.execution.profile.profileId });
    if (status.state === "indexing")
      return Object.freeze({ state: "stale", profileId: target.execution.profile.profileId });
    return Object.freeze({
      state: status.state,
      profileId: target.execution.profile.profileId,
      ...(status.state === "ready" ? { vectorCount: status.indexedPracticeCount } : {}),
    });
  }

  private async start(target: SemanticTarget, force = false): Promise<SemanticOperation> {
    const key = this.operationKey(target);
    this.desiredTargetBySlot.set(target.targetSlotId, key);
    const live = this.operations.get(key);
    if (live !== undefined) return live;
    const pending = this.starting.get(key);
    if (pending !== undefined) return pending;
    const work = this.startNew(target, force, key);
    this.starting.set(key, work);
    try {
      return await work;
    } finally {
      if (this.starting.get(key) === work) this.starting.delete(key);
    }
  }

  private async startNew(
    target: SemanticTarget,
    force: boolean,
    key: string,
  ): Promise<SemanticOperation> {
    await this.recovered;
    const active = this.operations.get(key);
    if (active !== undefined) return active;
    const previous = await this.journal?.latestForSlot(target.targetSlotId);
    const recovered = await this.journal?.findByTarget(target.artifactId, target.cacheScopeId);
    const reuse = force !== true && recovered !== undefined && isPending(recovered.state);
    const operationId = reuse ? recovered.operationId : randomUUID();
    const createdAt = reuse ? recovered.createdAt : new Date().toISOString();
    const attempts = reuse ? recovered.attempts : 0;
    if (
      previous !== undefined &&
      previous.operationId !== operationId &&
      isPending(previous.state)
    ) {
      await this.journal?.upsert(
        Object.freeze({ ...previous, state: "superseded", updatedAt: new Date().toISOString() }),
      );
    }
    await this.onIndexActivityChange?.(true);
    await this.record(target, operationId, "queued", {
      indexedPracticeCount: recovered?.indexedPracticeCount ?? 0,
      totalPracticeCount: target.corpus.practices.length,
      attempts,
      createdAt,
    });
    this.diagnostics.emit({
      time: new Date().toISOString(),
      level: "info",
      component: "backend",
      event: "backend.operation.started",
      operationId,
      count: target.corpus.practices.length,
    });
    const desired = () => this.desiredTargetBySlot.get(target.targetSlotId) === key;
    const progress = this.progress(target);
    const run = async (): Promise<"ready" | "superseded"> => {
      if (!desired()) return "superseded";
      const tracked = new ContentAddressedSemanticProgressService(
        target.corpus,
        target.cacheRoot,
        target.execution,
        this.documentEmbedding,
        desired,
        async (status) => {
          await this.record(target, operationId, "building", {
            indexedPracticeCount: status.indexedPracticeCount,
            totalPracticeCount: status.totalPracticeCount,
            attempts: attempts + 1,
            createdAt,
          });
        },
        this.queryEmbedding,
        force
          ? undefined
          : (target.seed ??
              (previous?.artifactId === undefined || previous.artifactId === target.artifactId
                ? undefined
                : { kind: "artifact", artifactId: previous.artifactId })),
        {
          sourceSlotId: target.targetSlotId,
          ...(target.sourceRevision === undefined ? {} : { sourceRevision: target.sourceRevision }),
        },
      );
      const build = () => tracked.build({ force });
      try {
        await this.record(target, operationId, "building", {
          indexedPracticeCount: (await tracked.status()).indexedPracticeCount,
          totalPracticeCount: target.corpus.practices.length,
          attempts: attempts + 1,
          createdAt,
        });
        const result = await build();
        return !desired() || result.state !== "ready" ? "superseded" : "ready";
      } catch (error) {
        if (!(error instanceof EmbeddingError) || error.code !== "embedding.not-loaded")
          throw error;
        const preparation = this.modelPreparation.beginModelPreparation();
        await this.record(target, operationId, "preparing", {
          preparationId: preparation.preparationId,
          indexedPracticeCount: (await tracked.status()).indexedPracticeCount,
          totalPracticeCount: target.corpus.practices.length,
          attempts: attempts + 1,
          createdAt,
        });
        await this.modelPreparation.waitModelPreparation(preparation.preparationId);
        const result = await build();
        return !desired() || result.state !== "ready" ? "superseded" : "ready";
      }
    };
    const task = this.queue
      .catch(() => undefined)
      .then(run)
      .then(async (outcome) => {
        const status = await progress.status();
        await this.record(target, operationId, outcome === "ready" ? "ready" : "superseded", {
          indexedPracticeCount: status.indexedPracticeCount,
          totalPracticeCount: target.corpus.practices.length,
          attempts: attempts + 1,
          createdAt,
        });
        this.diagnostics.emit({
          time: new Date().toISOString(),
          level: "info",
          component: "backend",
          event: "backend.operation.completed",
          operationId,
          count: status.indexedPracticeCount,
          ...(outcome === "ready" ? {} : { code: "superseded" }),
        });
      })
      .catch(async (error: unknown) => {
        const status = await progress.status().catch(() => ({ indexedPracticeCount: 0 }));
        await this.record(target, operationId, "failed", {
          error: publicFailureCode(error),
          indexedPracticeCount: status.indexedPracticeCount,
          totalPracticeCount: target.corpus.practices.length,
          attempts: attempts + 1,
          createdAt,
        });
        this.diagnostics.emit({
          time: new Date().toISOString(),
          level: "error",
          component: "backend",
          event: "backend.operation.failed",
          operationId,
          count: status.indexedPracticeCount,
          code: error instanceof EmbeddingError ? error.code : "backend.failed",
        });
        throw error;
      });
    this.queue = task.catch(() => undefined);
    const operation = Object.freeze({ operationId, key, target, task });
    this.operations.set(key, operation);
    void task
      .finally(async () => {
        if (this.operations.get(key) === operation) this.operations.delete(key);
        if (this.desiredTargetBySlot.get(target.targetSlotId) === key)
          this.desiredTargetBySlot.delete(target.targetSlotId);
        if (this.operations.size === 0) await this.onIndexActivityChange?.(false);
      })
      .catch(() => {
        // A failed clear remains conservative: activity inspection will defer recovery.
      });
    return operation;
  }

  private async queryTarget(
    target: SemanticTarget,
    query: QueryRequest,
    policy: QueryPolicy,
  ): Promise<ContentAddressedSemanticQueryResult> {
    const progress = this.progress(target);
    const complete = async (): Promise<SemanticQueryResult> => {
      const paths = contentSemanticIndexPaths(
        target.cacheRoot,
        target.corpus,
        target.execution.profile.profileId,
      );
      return withContentArtifactLease(paths.directory, async () => {
        const services = createContentAddressedSemanticServices(
          target.corpus,
          target.cacheRoot,
          target.execution,
          this.queryEmbedding,
        );
        return services.query.query(services.root, query);
      });
    };
    if ((await progress.status()).state === "ready")
      return this.withContext(target, await complete());
    const previousFailure = await this.unrecoveredEmbeddingFailure(target);
    if (previousFailure !== undefined) throwIndexOperationFailure(previousFailure);
    const operation = await this.start(target);
    if (policy.maxWaitMs > 0) {
      await waitForCompletionOrDeadline(
        operation.task.catch(() => undefined),
        Date.now() + policy.maxWaitMs,
      );
      if ((await progress.status()).state === "ready")
        return this.withContext(target, await complete());
    }
    const pending = async (): Promise<ContentAddressedSemanticQueryResult> => {
      const observed = await this.indexOperation(operation.operationId);
      if (observed?.state === "failed") throwIndexOperationFailure(observed);
      if (observed?.state === "preparing")
        return this.withContext(target, {
          state: "preparing",
          preparationId: observed.preparationId,
        });
      const status = await progress.status();
      return this.withContext(target, {
        state: "indexing",
        operationId: operation.operationId,
        indexedPracticeCount: status.indexedPracticeCount,
        totalPracticeCount: status.totalPracticeCount,
      });
    };
    const available = await progress.status();
    // Do not spend the single local model slot on a query embedding when the
    // caller cannot accept the resulting partial coverage anyway. This keeps
    // strict queries observational while a document batch continues indexing.
    if (
      available.state !== "indexing" ||
      available.indexedPracticeCount === 0 ||
      available.indexedPracticeCount * 100 <
        available.totalPracticeCount * policy.minCoveragePercent
    ) {
      return pending();
    }
    let partial: Awaited<ReturnType<ContentAddressedSemanticProgressService["queryPartial"]>>;
    try {
      partial = await progress.queryPartial(query);
    } catch (error) {
      if (!(error instanceof EmbeddingError) || error.code !== "embedding.not-loaded") {
        // Publication may atomically replace progress.sqlite after the status
        // check and before opening its reader. Recover by observing ready state.
        if ((await progress.status()).state === "ready")
          return this.withContext(target, await complete());
        throw error;
      }
    }
    if (
      partial !== undefined &&
      partial.indexedPracticeCount * 100 >= partial.totalPracticeCount * policy.minCoveragePercent
    ) {
      return this.withContext(target, {
        ...partial.result,
        indexedPracticeCount: partial.indexedPracticeCount,
        totalPracticeCount: partial.totalPracticeCount,
        operationId: operation.operationId,
      });
    }
    return pending();
  }

  private withContext<T extends ContentAddressedSemanticQueryResult>(
    target: SemanticTarget,
    result: T,
  ): T {
    if (target.context === undefined || "context" in result) return result;
    return Object.freeze({ ...result, context: target.context }) as unknown as T;
  }

  private async unrecoveredEmbeddingFailure(
    target: SemanticTarget,
  ): Promise<Extract<IndexOperation, { readonly state: "failed" }> | undefined> {
    const record = await this.journal?.findByTarget(target.artifactId, target.cacheScopeId);
    if (record?.state !== "failed") return undefined;
    const operation = this.toIndexOperation(record);
    if (operation.state !== "failed") return undefined;
    if (!embeddingErrorCodes.includes(operation.error as (typeof embeddingErrorCodes)[number])) {
      return undefined;
    }
    // A successful explicit `model load` makes the old embedding failure recoverable.
    // Ordinary repeated queries keep reporting the same failure instead of creating a retry loop.
    if (this.modelPreparation.status?.().state === "ready") {
      return undefined;
    }
    return operation;
  }

  private async queryCurrent(
    resolve: () => Promise<SemanticTarget>,
    query: QueryRequest,
    policy: QueryPolicy,
    attempts = 0,
  ): Promise<ContentAddressedSemanticQueryResult> {
    const target = await resolve();
    const result = await this.queryTarget(target, query, policy);
    if (await target.isCurrent()) return result;
    if (attempts === 0) return this.queryCurrent(resolve, query, policy, 1);
    const latest = await resolve();
    const operation = await this.start(latest);
    const status = await this.progress(latest).status();
    return this.withContext(latest, {
      state: "indexing",
      operationId: operation.operationId,
      indexedPracticeCount: status.indexedPracticeCount,
      totalPracticeCount: status.totalPracticeCount,
    });
  }

  async query(
    root: StorageRoot,
    target: ContentAddressedTargetRequest,
    query: QueryRequest,
    policy: QueryPolicy,
  ): Promise<ContentAddressedSemanticQueryResult> {
    return this.queryCurrent(() => this.resolveTarget(root, target), query, policy);
  }

  private async buildTarget(target: SemanticTarget, force: boolean): Promise<IndexOperation> {
    const status = await this.indexStatusForTarget(target);
    if (!force && status.state === "ready")
      return Object.freeze({ operationId: randomUUID(), state: "ready", index: status });
    const operation = await this.start(target, force);
    const record = await this.journal?.findById(operation.operationId);
    return this.toIndexOperation(
      record ?? this.fallbackRecord(operation, "queued", 0, target.corpus.practices.length),
    );
  }
  async indexStatus(
    root: StorageRoot,
    target: ContentAddressedTargetRequest,
  ): Promise<IndexStatus> {
    return this.indexStatusForTarget(await this.resolveTarget(root, target));
  }
  async build(root: StorageRoot, target: ContentAddressedTargetRequest): Promise<IndexOperation> {
    return this.buildTarget(await this.resolveTarget(root, target), false);
  }
  async rebuild(root: StorageRoot, target: ContentAddressedTargetRequest): Promise<IndexOperation> {
    return this.buildTarget(await this.resolveTarget(root, target), true);
  }

  async indexOperation(operationId: string): Promise<IndexOperation | undefined> {
    const live = [...this.operations.values()].find(
      (operation) => operation.operationId === operationId,
    );
    if (live !== undefined) {
      const status = await this.progress(live.target).status();
      const record = await this.journal?.findById(operationId);
      return this.toIndexOperation(
        record ??
          this.fallbackRecord(
            live,
            "building",
            status.indexedPracticeCount,
            status.totalPracticeCount,
          ),
        status,
      );
    }
    const record = await this.journal?.findById(operationId);
    return record === undefined ? undefined : this.toIndexOperation(record);
  }
  private fallbackRecord(
    operation: SemanticOperation,
    state: SemanticOperationRecord["state"],
    indexedPracticeCount: number,
    totalPracticeCount: number,
  ): SemanticOperationRecord {
    const now = new Date().toISOString();
    return Object.freeze({
      operationId: operation.operationId,
      targetKind: operation.target.kind,
      sourceId: operation.target.sourceId,
      targetSlotId: operation.target.targetSlotId,
      cacheScopeId: operation.target.cacheScopeId,
      artifactId: operation.target.artifactId,
      corpusDigest: operation.target.corpus.indexCorpusDigest,
      profileId: operation.target.execution.profile.profileId,
      state,
      indexedPracticeCount,
      totalPracticeCount,
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    });
  }
  private toIndexOperation(
    record: SemanticOperationRecord,
    observed?: Awaited<ReturnType<ContentAddressedSemanticProgressService["status"]>>,
  ): IndexOperation {
    const indexedPracticeCount = observed?.indexedPracticeCount ?? record.indexedPracticeCount;
    const totalPracticeCount = observed?.totalPracticeCount ?? record.totalPracticeCount;
    if (record.state === "ready")
      return Object.freeze({
        operationId: record.operationId,
        state: "ready",
        index: {
          state: "ready" as const,
          profileId: record.profileId,
          vectorCount: indexedPracticeCount,
        },
      });
    if (record.state === "failed")
      return Object.freeze({
        operationId: record.operationId,
        state: "failed",
        error: record.error ?? "backend.failed",
      });
    if (record.state === "waiting-for-source" || record.state === "queued")
      return Object.freeze({
        operationId: record.operationId,
        state: record.state,
        indexedPracticeCount,
        totalPracticeCount,
      });
    if (record.state === "preparing" && record.preparationId !== undefined)
      return Object.freeze({
        operationId: record.operationId,
        state: "preparing",
        preparationId: record.preparationId,
        indexedPracticeCount,
        totalPracticeCount,
      });
    return Object.freeze({
      operationId: record.operationId,
      state: "building",
      indexedPracticeCount,
      totalPracticeCount,
    });
  }
  async waitForIdle(deadline?: number): Promise<void> {
    const task = this.queue;
    if (deadline === undefined) return task;
    await waitForCompletionOrDeadline(task, deadline);
  }
}

function isPending(state: SemanticOperationRecord["state"]): boolean {
  return (
    state === "waiting-for-source" ||
    state === "queued" ||
    state === "preparing" ||
    state === "building"
  );
}

function publicFailureCode(error: unknown): IndexOperationErrorCode {
  if (error instanceof EmbeddingError) return error.code;
  if (error instanceof StoreBusyError) return "store.busy";
  if (error instanceof StoreRecoveryRequiredError) return "store.recovery-required";
  return "backend.failed";
}

function throwIndexOperationFailure(
  operation: Extract<IndexOperation, { readonly state: "failed" }>,
): never {
  if (embeddingErrorCodes.includes(operation.error as (typeof embeddingErrorCodes)[number])) {
    throw new EmbeddingError(operation.error as (typeof embeddingErrorCodes)[number]);
  }
  if (operation.error === "store.busy") throw new StoreBusyError("The local Pack store is busy.");
  if (operation.error === "store.recovery-required") throw new StoreRecoveryRequiredError();
  throw new BackendError("backend.failed");
}

import { createHash, randomUUID } from "node:crypto";

import {
  createContentAddressedSemanticServices,
  indexCorpusDigest,
  InvalidProjectRootError,
  ProjectSemanticProgressService,
  projectSemanticArtifactId,
  projectSemanticIndexPaths,
  resolveProjectContext,
  withProjectArtifactLease,
  type ContentAddressedCorpus,
  type EmbeddingPort,
  type EmbeddingProfile,
  type LocalStore,
  type QueryRequest,
  type SemanticQueryResult,
  type StorageRoot,
} from "@lorelum/engine";

import { EmbeddingError } from "../embedding/errors";
import type { ModelPreparation, ModelStatus } from "../embedding/dto";
import type { IndexOperation, IndexStatus } from "../index/model";
import {
  SemanticOperationJournal,
  type SemanticOperationRecord,
} from "./project-operation-journal";

export interface ProjectSemanticRequest {
  readonly projectRoot: string;
  readonly cacheRoot: string;
}
export interface StoreSemanticRequest {
  readonly cacheRoot: string;
}
export interface ProjectSemanticIndexingResult {
  readonly state: "indexing";
  readonly operationId: string;
  readonly indexedPracticeCount: number;
  readonly totalPracticeCount: number;
}
export interface ProjectSemanticPreparingResult {
  readonly state: "preparing";
  readonly preparationId: string;
}
export interface ProjectSemanticPartialResult extends SemanticQueryResult {
  readonly indexedPracticeCount: number;
  readonly totalPracticeCount: number;
  readonly operationId: string;
}
export type ProjectSemanticQueryResult =
  | SemanticQueryResult
  | ProjectSemanticPartialResult
  | ProjectSemanticIndexingResult
  | ProjectSemanticPreparingResult;

export interface ProjectSemanticRuntimePort {
  query(
    root: StorageRoot,
    request: ProjectSemanticRequest,
    query: QueryRequest,
    policy: QueryPolicy,
  ): Promise<ProjectSemanticQueryResult>;
  waitForIdle(deadline?: number): Promise<void>;
}
export interface StoreSemanticRuntimePort {
  queryStore(
    root: StorageRoot,
    request: StoreSemanticRequest,
    query: QueryRequest,
    policy: QueryPolicy,
  ): Promise<ProjectSemanticQueryResult>;
}
export interface ProjectSemanticIndexRuntimePort {
  indexStatus(root: StorageRoot, request: ProjectSemanticRequest): Promise<IndexStatus>;
  buildIndex(root: StorageRoot, request: ProjectSemanticRequest): Promise<IndexOperation>;
  rebuildIndex(root: StorageRoot, request: ProjectSemanticRequest): Promise<IndexOperation>;
  indexOperation(operationId: string): Promise<IndexOperation | undefined>;
}
export interface StoreSemanticIndexRuntimePort {
  indexStatusStore(root: StorageRoot, request: StoreSemanticRequest): Promise<IndexStatus>;
  buildStoreIndex(root: StorageRoot, request: StoreSemanticRequest): Promise<IndexOperation>;
  rebuildStoreIndex(root: StorageRoot, request: StoreSemanticRequest): Promise<IndexOperation>;
}
export interface ProjectSemanticModelPreparation {
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
  readonly isCurrent: () => Promise<boolean>;
}
interface SemanticOperation {
  readonly operationId: string;
  readonly key: string;
  readonly target: SemanticTarget;
  readonly task: Promise<void>;
}

/** Shared persistent target queue for Store-only and ProjectContext corpora. */
export class ProjectSemanticRuntime
  implements
    ProjectSemanticRuntimePort,
    StoreSemanticRuntimePort,
    ProjectSemanticIndexRuntimePort,
    StoreSemanticIndexRuntimePort
{
  private readonly operations = new Map<string, SemanticOperation>();
  private readonly starting = new Map<string, Promise<SemanticOperation>>();
  private readonly desiredTargetBySlot = new Map<string, string>();
  private queue: Promise<void> = Promise.resolve();
  private readonly recovered: Promise<readonly SemanticOperationRecord[]>;

  constructor(
    private readonly store: Pick<LocalStore, "readEffectivePracticeSnapshot">,
    private readonly profile: EmbeddingProfile,
    private readonly documentEmbedding: EmbeddingPort,
    private readonly queryEmbedding: EmbeddingPort,
    private readonly modelPreparation: ProjectSemanticModelPreparation,
    private readonly journal?: SemanticOperationJournal,
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
    return ProjectSemanticRuntime.hash(["semantic-cache-scope/v1", cacheRoot]);
  }
  private targetSlotId(
    kind: SemanticTarget["kind"],
    sourceId: string,
    cacheScopeId: string,
  ): string {
    return ProjectSemanticRuntime.hash([
      "semantic-target-slot/v1",
      kind,
      sourceId,
      this.profile.profileId,
      cacheScopeId,
    ]);
  }
  private operationKey(target: Pick<SemanticTarget, "cacheScopeId" | "artifactId">): string {
    return `${target.cacheScopeId}:${target.artifactId}`;
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
      profileId: this.profile.profileId,
      state,
      ...(input.preparationId === undefined ? {} : { preparationId: input.preparationId }),
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
    request: ProjectSemanticRequest,
  ): Promise<SemanticTarget> {
    const snapshot = await resolveProjectContext({
      store: this.store,
      storageRoot: root,
      projectRoot: request.projectRoot,
    });
    if (snapshot === undefined) throw new InvalidProjectRootError();
    const corpus: ContentAddressedCorpus = snapshot;
    const cacheScopeId = this.cacheScopeId(request.cacheRoot);
    return Object.freeze({
      kind: "project",
      sourceId: snapshot.projectRootId,
      targetSlotId: this.targetSlotId("project", snapshot.projectRootId, cacheScopeId),
      cacheScopeId,
      artifactId: projectSemanticArtifactId(corpus, this.profile.profileId),
      corpus,
      cacheRoot: request.cacheRoot,
      isCurrent: async () => {
        const current = await resolveProjectContext({
          store: this.store,
          storageRoot: root,
          projectRoot: request.projectRoot,
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
    request: StoreSemanticRequest,
  ): Promise<SemanticTarget> {
    const snapshot = await this.store.readEffectivePracticeSnapshot(root);
    const corpus: ContentAddressedCorpus = Object.freeze({
      practices: snapshot.practices,
      indexCorpusDigest: indexCorpusDigest(snapshot.practices),
    });
    const cacheScopeId = this.cacheScopeId(request.cacheRoot);
    const sourceId = ProjectSemanticRuntime.hash(["semantic-store-source/v1", root.rootPath]);
    return Object.freeze({
      kind: "store",
      sourceId,
      targetSlotId: this.targetSlotId("store", sourceId, cacheScopeId),
      cacheScopeId,
      artifactId: projectSemanticArtifactId(corpus, this.profile.profileId),
      corpus,
      cacheRoot: request.cacheRoot,
      isCurrent: async () =>
        indexCorpusDigest((await this.store.readEffectivePracticeSnapshot(root)).practices) ===
        corpus.indexCorpusDigest,
    });
  }

  private progress(target: SemanticTarget): ProjectSemanticProgressService {
    return new ProjectSemanticProgressService(
      target.corpus,
      target.cacheRoot,
      this.profile,
      this.documentEmbedding,
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
        profileId: this.profile.profileId,
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
      return Object.freeze({ state: "missing", profileId: this.profile.profileId });
    if (status.state === "indexing")
      return Object.freeze({ state: "stale", profileId: this.profile.profileId });
    return Object.freeze({
      state: status.state,
      profileId: this.profile.profileId,
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
    await this.record(target, operationId, "queued", {
      indexedPracticeCount: recovered?.indexedPracticeCount ?? 0,
      totalPracticeCount: target.corpus.practices.length,
      attempts,
      createdAt,
    });
    const desired = () => this.desiredTargetBySlot.get(target.targetSlotId) === key;
    const progress = this.progress(target);
    const run = async (): Promise<"ready" | "superseded"> => {
      if (!desired()) return "superseded";
      const tracked = new ProjectSemanticProgressService(
        target.corpus,
        target.cacheRoot,
        this.profile,
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
      })
      .catch(async (error: unknown) => {
        const status = await progress.status().catch(() => ({ indexedPracticeCount: 0 }));
        await this.record(target, operationId, "failed", {
          indexedPracticeCount: status.indexedPracticeCount,
          totalPracticeCount: target.corpus.practices.length,
          attempts: attempts + 1,
          createdAt,
        });
        throw error;
      });
    this.queue = task.catch(() => undefined);
    const operation = Object.freeze({ operationId, key, target, task });
    this.operations.set(key, operation);
    void task.finally(() => {
      if (this.operations.get(key) === operation) this.operations.delete(key);
      if (this.desiredTargetBySlot.get(target.targetSlotId) === key)
        this.desiredTargetBySlot.delete(target.targetSlotId);
    });
    return operation;
  }

  private async queryTarget(
    target: SemanticTarget,
    query: QueryRequest,
    policy: QueryPolicy,
  ): Promise<ProjectSemanticQueryResult> {
    const progress = this.progress(target);
    const complete = async (): Promise<SemanticQueryResult> => {
      const paths = projectSemanticIndexPaths(
        target.cacheRoot,
        target.corpus,
        this.profile.profileId,
      );
      return withProjectArtifactLease(paths.directory, async () => {
        const services = createContentAddressedSemanticServices(
          target.corpus,
          target.cacheRoot,
          this.profile,
          this.queryEmbedding,
        );
        return services.query.query(services.root, query);
      });
    };
    if ((await progress.status()).state === "ready") return complete();
    const operation = await this.start(target);
    if (policy.maxWaitMs > 0) {
      await Promise.race([operation.task.catch(() => undefined), Bun.sleep(policy.maxWaitMs)]);
      if ((await progress.status()).state === "ready") return complete();
    }
    let partial: Awaited<ReturnType<ProjectSemanticProgressService["queryPartial"]>>;
    try {
      partial = await progress.queryPartial(query);
    } catch (error) {
      if (!(error instanceof EmbeddingError) || error.code !== "embedding.not-loaded") {
        // Publication may atomically replace progress.sqlite after the status
        // check and before opening its reader. Recover by observing ready state.
        if ((await progress.status()).state === "ready") return complete();
        throw error;
      }
    }
    if (
      partial !== undefined &&
      partial.indexedPracticeCount * 100 >= partial.totalPracticeCount * policy.minCoveragePercent
    ) {
      return Object.freeze({
        ...partial.result,
        indexedPracticeCount: partial.indexedPracticeCount,
        totalPracticeCount: partial.totalPracticeCount,
        operationId: operation.operationId,
      });
    }
    const observed = await this.indexOperation(operation.operationId);
    if (observed?.state === "preparing")
      return Object.freeze({ state: "preparing", preparationId: observed.preparationId });
    const status = await progress.status();
    return Object.freeze({
      state: "indexing",
      operationId: operation.operationId,
      indexedPracticeCount: status.indexedPracticeCount,
      totalPracticeCount: status.totalPracticeCount,
    });
  }

  private async queryCurrent(
    resolve: () => Promise<SemanticTarget>,
    query: QueryRequest,
    policy: QueryPolicy,
    attempts = 0,
  ): Promise<ProjectSemanticQueryResult> {
    const target = await resolve();
    const result = await this.queryTarget(target, query, policy);
    if (await target.isCurrent()) return result;
    if (attempts === 0) return this.queryCurrent(resolve, query, policy, 1);
    const latest = await resolve();
    const operation = await this.start(latest);
    const status = await this.progress(latest).status();
    return Object.freeze({
      state: "indexing",
      operationId: operation.operationId,
      indexedPracticeCount: status.indexedPracticeCount,
      totalPracticeCount: status.totalPracticeCount,
    });
  }

  async query(
    root: StorageRoot,
    request: ProjectSemanticRequest,
    query: QueryRequest,
    policy: QueryPolicy,
  ): Promise<ProjectSemanticQueryResult> {
    return this.queryCurrent(() => this.projectTarget(root, request), query, policy);
  }
  async queryStore(
    root: StorageRoot,
    request: StoreSemanticRequest,
    query: QueryRequest,
    policy: QueryPolicy,
  ): Promise<ProjectSemanticQueryResult> {
    return this.queryCurrent(() => this.storeTarget(root, request), query, policy);
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
  async indexStatus(root: StorageRoot, request: ProjectSemanticRequest): Promise<IndexStatus> {
    return this.indexStatusForTarget(await this.projectTarget(root, request));
  }
  async indexStatusStore(root: StorageRoot, request: StoreSemanticRequest): Promise<IndexStatus> {
    return this.indexStatusForTarget(await this.storeTarget(root, request));
  }
  async buildIndex(root: StorageRoot, request: ProjectSemanticRequest): Promise<IndexOperation> {
    return this.buildTarget(await this.projectTarget(root, request), false);
  }
  async rebuildIndex(root: StorageRoot, request: ProjectSemanticRequest): Promise<IndexOperation> {
    return this.buildTarget(await this.projectTarget(root, request), true);
  }
  async buildStoreIndex(root: StorageRoot, request: StoreSemanticRequest): Promise<IndexOperation> {
    return this.buildTarget(await this.storeTarget(root, request), false);
  }
  async rebuildStoreIndex(
    root: StorageRoot,
    request: StoreSemanticRequest,
  ): Promise<IndexOperation> {
    return this.buildTarget(await this.storeTarget(root, request), true);
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
      profileId: this.profile.profileId,
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
    observed?: Awaited<ReturnType<ProjectSemanticProgressService["status"]>>,
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
        error: "backend.failed",
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
    const remaining = deadline - Date.now();
    if (remaining > 0) await Promise.race([task, Bun.sleep(remaining)]);
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

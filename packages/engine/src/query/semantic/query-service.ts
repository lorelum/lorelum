import {
  StoreBusyError,
  StoreSnapshotChangedError,
  type EffectivePractice,
  type StorageRoot,
  type StoreSnapshotIdentity,
} from "../../local-store";
import { revisionDeltaPracticeIds, type RevisionDelta } from "../../local-store/model";
import type { QueryHit, QueryRequest } from "../types";
import { InvalidQueryRequestError } from "../errors";
import { parseQueryRequest } from "../request";
import type { EmbeddingPort } from "./encoding";
import {
  SemanticIndexIncompatibleError,
  SemanticIndexNotReadyError,
  SemanticIndexQueryError,
} from "./errors";
import {
  openSemanticIndexReader,
  openSemanticIndexReaderAt,
  type SemanticCandidate,
} from "./index/reader";
import type { SemanticIndexPaths } from "./index/paths";
import type { SemanticIndexDatabaseDefinition } from "./index/database";
import type { VectorExecution } from "./profile";
import { assembleSemanticArtifactResult, searchSemanticArtifact } from "./read";

const MAX_QUERY_RETRIES = 3;

export interface SemanticQueryResult {
  readonly mode: "semantic";
  readonly profileId: string;
  readonly coverage: "complete" | "partial";
  readonly results: readonly QueryHit[];
  readonly emptyReason?: "corpus-empty";
}

export interface SemanticQueryService {
  query(root: StorageRoot, request: QueryRequest): Promise<SemanticQueryResult>;
}

export interface SemanticQueryDependencies {
  readonly store: {
    readSnapshotIdentity(root: StorageRoot): Promise<StoreSnapshotIdentity>;
    readEffectivePracticeChanges(
      root: StorageRoot,
      afterEffectiveRevision: number,
    ): Promise<
      | {
          readonly identity: StoreSnapshotIdentity;
          readonly deltas: readonly { readonly revision: number; readonly delta: RevisionDelta }[];
        }
      | undefined
    >;
    readEffectivePracticesAtSnapshot(
      root: StorageRoot,
      expected: StoreSnapshotIdentity,
      ids: readonly string[],
    ): Promise<readonly EffectivePractice[]>;
  };
  readonly execution: VectorExecution;
  readonly embedding: EmbeddingPort;
  readonly paths?: (root: StorageRoot, profileId: string) => SemanticIndexPaths;
  readonly definition?: SemanticIndexDatabaseDefinition;
}

interface QueryCoverage {
  readonly identity: StoreSnapshotIdentity;
  readonly excludedPracticeIds: ReadonlySet<string>;
  readonly coverage: "complete" | "partial";
}

function sameIdentity(left: StoreSnapshotIdentity, right: StoreSnapshotIdentity): boolean {
  return (
    left.rootBinding === right.rootBinding &&
    left.generation === right.generation &&
    left.effectiveRevision === right.effectiveRevision &&
    left.manifestDigest === right.manifestDigest
  );
}

async function prepareCoverage(
  store: SemanticQueryDependencies["store"],
  root: StorageRoot,
  metadata: {
    readonly rootBinding: string;
    readonly generation: number;
    readonly effectiveRevision: number;
    readonly manifestDigest: string;
  },
  current: StoreSnapshotIdentity,
): Promise<QueryCoverage> {
  if (metadata.rootBinding !== current.rootBinding) {
    throw new SemanticIndexIncompatibleError("Semantic index belongs to another Store");
  }
  if (sameIdentity(metadata, current)) {
    return Object.freeze({
      identity: current,
      excludedPracticeIds: new Set<string>(),
      coverage: "complete",
    });
  }
  if (
    metadata.effectiveRevision > current.effectiveRevision ||
    metadata.generation > current.generation
  ) {
    throw new SemanticIndexNotReadyError("Semantic index is ahead of the LocalStore");
  }

  const changes = await store.readEffectivePracticeChanges(root, metadata.effectiveRevision);
  if (changes === undefined) {
    throw new SemanticIndexNotReadyError(
      "Semantic index history is unavailable; run index build before querying",
    );
  }
  if (changes.identity.rootBinding !== metadata.rootBinding) {
    throw new SemanticIndexIncompatibleError("Semantic index history belongs to another Store");
  }
  if (changes.identity.effectiveRevision < metadata.effectiveRevision) {
    throw new SemanticIndexNotReadyError("Semantic index history moved backwards");
  }
  if (changes.identity.effectiveRevision < current.effectiveRevision) {
    // The Store changed while the delta snapshot was being read. Let the
    // bounded outer retry reopen both the index and Store view.
    throw new StoreSnapshotChangedError();
  }
  let expectedRevision = metadata.effectiveRevision + 1;
  for (const change of changes.deltas) {
    if (change.revision !== expectedRevision) {
      throw new SemanticIndexNotReadyError(
        "Semantic index history is not contiguous; run index build before querying",
      );
    }
    expectedRevision += 1;
  }
  if (expectedRevision !== changes.identity.effectiveRevision + 1) {
    throw new SemanticIndexNotReadyError(
      "Semantic index history is incomplete; run index build before querying",
    );
  }
  return Object.freeze({
    identity: changes.identity,
    excludedPracticeIds: new Set(
      revisionDeltaPracticeIds(
        changes.deltas.map((change) => change.delta),
        true,
      ),
    ),
    coverage: "partial",
  });
}

function semanticCandidateIds(candidates: readonly SemanticCandidate[]): readonly string[] {
  const ids = candidates.map((candidate) => candidate.practiceId);
  if (new Set(ids).size !== ids.length) {
    throw new SemanticIndexQueryError("Semantic candidates contain duplicate Practice IDs");
  }
  return Object.freeze(ids);
}

interface SemanticQueryWindow {
  readonly request: Required<QueryRequest>;
  readonly resultLimit: number;
}

function semanticQueryWindow(request: QueryRequest): SemanticQueryWindow {
  const parsed = parseQueryRequest(request);
  return Object.freeze({ request: parsed, resultLimit: parsed.limit });
}

interface SemanticQueryExecution {
  readonly result: SemanticQueryResult;
  /** Internal raw candidate order, returned only through the benchmark-only seam below. */
  readonly candidateIds: readonly string[];
}

async function executeSemanticQuery(
  dependencies: SemanticQueryDependencies,
  root: StorageRoot,
  window: SemanticQueryWindow,
  /** Maximum ids reported to the benchmark harness; scoring always uses the full corpus. */
  candidateCap?: number,
): Promise<SemanticQueryExecution> {
  const { store, execution, embedding } = dependencies;
  const { profile } = execution;
  const pathsFor = dependencies.paths;
  const definition = dependencies.definition;

  for (let attempt = 0; attempt < MAX_QUERY_RETRIES; attempt += 1) {
    let reader: Awaited<ReturnType<typeof openSemanticIndexReader>> | undefined;
    try {
      if (pathsFor === undefined) {
        // eslint-disable-next-line no-await-in-loop -- each retry reopens the active snapshot.
        reader = await openSemanticIndexReader(root.rootPath, profile);
      } else {
        // eslint-disable-next-line no-await-in-loop -- each retry reopens the active snapshot.
        reader = await openSemanticIndexReaderAt(
          pathsFor(root, profile.profileId),
          profile,
          definition,
        );
      }
      // eslint-disable-next-line no-await-in-loop -- coverage is bound to this retry's Store view.
      const current = await store.readSnapshotIdentity(root);
      // eslint-disable-next-line no-await-in-loop -- delta history is part of the same retry.
      const coverage = await prepareCoverage(store, root, reader.metadata, current);

      // eslint-disable-next-line no-await-in-loop -- the model admits one request at a time.
      const candidates = await searchSemanticArtifact({
        reader,
        execution,
        embedding,
        text: window.request.text,
        excludedPracticeIds: coverage.excludedPracticeIds,
      });
      const rankedCandidateIds = semanticCandidateIds(candidates);
      // eslint-disable-next-line no-await-in-loop -- final read validates this retry's snapshot.
      // Validate all N canonical candidates before observing or returning them.
      const practices = await store.readEffectivePracticesAtSnapshot(
        root,
        coverage.identity,
        candidates.map((candidate) => candidate.practiceId),
      );
      const assembled = assembleSemanticArtifactResult({
        profile,
        coverage: coverage.coverage,
        practices,
        candidates,
      });
      const results = Object.freeze(assembled.results.slice(0, window.resultLimit));
      // Candidate ids describe the full scored ordering; the cap only bounds reporting.
      const candidateIds =
        candidateCap === undefined
          ? rankedCandidateIds
          : Object.freeze(rankedCandidateIds.slice(0, candidateCap));
      return Object.freeze({ result: Object.freeze({ ...assembled, results }), candidateIds });
    } catch (error) {
      if (error instanceof StoreSnapshotChangedError) {
        if (attempt + 1 < MAX_QUERY_RETRIES) continue;
        throw new StoreBusyError("LocalStore changed repeatedly during semantic query");
      }
      throw error;
    } finally {
      reader?.close();
    }
  }
  throw new StoreBusyError("LocalStore changed repeatedly during semantic query");
}

export function createSemanticQueryService(
  dependencies: SemanticQueryDependencies,
): SemanticQueryService {
  return Object.freeze({
    async query(root: StorageRoot, request: QueryRequest): Promise<SemanticQueryResult> {
      return (await executeSemanticQuery(dependencies, root, semanticQueryWindow(request))).result;
    },
  });
}

/**
 * Internal measurement seam for the repository-local benchmark harness.
 * Deliberately not re-exported from the Engine package entry points.
 */
export function createSemanticCandidateTraceService(dependencies: SemanticQueryDependencies) {
  return Object.freeze({
    async query(
      root: StorageRoot,
      request: {
        readonly text: string;
        readonly candidateWidth: number;
        readonly resultLimit: number;
      },
    ): Promise<{ readonly candidateIds: readonly string[]; readonly finalIds: readonly string[] }> {
      const window = semanticQueryWindow({ text: request.text, limit: request.resultLimit });
      if (request.candidateWidth < window.resultLimit) {
        throw new InvalidQueryRequestError(
          "Semantic candidate width must be at least the result limit",
        );
      }
      const execution = await executeSemanticQuery(
        dependencies,
        root,
        window,
        request.candidateWidth,
      );
      return Object.freeze({
        candidateIds: execution.candidateIds,
        finalIds: Object.freeze(execution.result.results.map((hit) => hit.practiceId)),
      });
    },
  });
}

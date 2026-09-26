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
import type { EmbeddingProfile } from "./profile";
import { assembleSemanticArtifactResult, searchSemanticArtifact } from "./read";
import { orderSemanticCandidatesByTaskRelevance, type SemanticTaskSignal } from "./task-relevance";

const MAX_QUERY_RETRIES = 3;

export interface SemanticQueryResult {
  readonly mode: "semantic";
  readonly profileId: string;
  readonly coverage: "complete" | "partial";
  readonly results: readonly QueryHit[];
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
  readonly profile: EmbeddingProfile;
  readonly embedding: EmbeddingPort;
  readonly paths?: (root: StorageRoot, profileId: string) => SemanticIndexPaths;
  readonly definition?: SemanticIndexDatabaseDefinition;
}

/** Only the non-barrel benchmark trace exposes request-local test injection. */
interface SemanticQueryExecutionDependencies extends SemanticQueryDependencies {
  readonly taskSignal?: SemanticTaskSignal;
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
  readonly candidateWidth: number;
  readonly resultLimit: number;
}

function semanticQueryWindow(
  request: QueryRequest,
  candidateWidth: number,
  resultLimit: number,
): SemanticQueryWindow {
  const parsed = parseQueryRequest({ text: request.text, limit: resultLimit });
  const parsedCandidateWidth = parseQueryRequest({
    text: parsed.text,
    limit: candidateWidth,
  }).limit;
  if (parsedCandidateWidth < parsed.limit) {
    throw new InvalidQueryRequestError(
      "Semantic candidate width must be at least the result limit",
    );
  }
  return Object.freeze({
    request: parsed,
    candidateWidth: parsedCandidateWidth,
    resultLimit: parsed.limit,
  });
}

interface SemanticQueryExecution {
  readonly result: SemanticQueryResult;
  /** Internal raw candidate order, returned only through the benchmark-only seam below. */
  readonly candidateIds: readonly string[];
}

async function executeSemanticQuery(
  dependencies: SemanticQueryExecutionDependencies,
  root: StorageRoot,
  window: SemanticQueryWindow,
): Promise<SemanticQueryExecution> {
  const { store, profile, embedding } = dependencies;
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
        profile,
        embedding,
        request: { text: window.request.text, limit: window.candidateWidth },
        excludedPracticeIds: coverage.excludedPracticeIds,
      });
      const candidateReadIds = candidates.map((candidate) => candidate.practiceId);
      // eslint-disable-next-line no-await-in-loop -- final read validates this retry's snapshot.
      const practices = await store.readEffectivePracticesAtSnapshot(
        root,
        coverage.identity,
        candidateReadIds,
      );
      // Validate all N canonical candidates before observing or ranking them.
      const assembled = assembleSemanticArtifactResult({
        profile,
        coverage: coverage.coverage,
        practices,
        candidates,
      });
      const candidateIds = semanticCandidateIds(candidates);
      // Both observations belong to this successful snapshot attempt. Sorting
      // never mutates the reader order and never re-reads canonical state.
      const orderedCandidates = orderSemanticCandidatesByTaskRelevance({
        text: window.request.text,
        candidates,
        practices,
        ...(dependencies.taskSignal === undefined ? {} : { signal: dependencies.taskSignal }),
      });
      const summaries = new Map(assembled.results.map((hit) => [hit.practiceId, hit]));
      const results = Object.freeze(
        orderedCandidates.slice(0, window.resultLimit).map((candidate) =>
          // Ordering preserves membership of the already-validated candidate set.
          summaries.get(candidate.practiceId)!,
        ),
      );
      return Object.freeze({
        result: Object.freeze({ ...assembled, results }),
        candidateIds,
      });
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
      const parsed = parseQueryRequest(request);
      const resultLimit = parsed.limit;
      const candidateWidth = Math.max(20, resultLimit);
      return (
        await executeSemanticQuery(
          dependencies,
          root,
          semanticQueryWindow(parsed, candidateWidth, resultLimit),
        )
      ).result;
    },
  });
}

/**
 * Internal measurement seam for the repository-local benchmark harness.
 * Deliberately not re-exported from the Engine package entry points.
 */
export function createSemanticCandidateTraceService(
  dependencies: SemanticQueryExecutionDependencies,
) {
  return Object.freeze({
    async query(
      root: StorageRoot,
      request: {
        readonly text: string;
        readonly candidateWidth: number;
        readonly resultLimit: number;
      },
    ): Promise<{ readonly candidateIds: readonly string[]; readonly finalIds: readonly string[] }> {
      const parsed = parseQueryRequest({ text: request.text, limit: request.resultLimit });
      const resultLimit = parsed.limit;
      const execution = await executeSemanticQuery(
        dependencies,
        root,
        semanticQueryWindow(parsed, request.candidateWidth, resultLimit),
      );
      return Object.freeze({
        candidateIds: execution.candidateIds,
        finalIds: Object.freeze(execution.result.results.map((hit) => hit.practiceId)),
      });
    },
  });
}

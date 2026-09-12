import {
  StoreBusyError,
  StoreSnapshotChangedError,
  type EffectivePractice,
  type StorageRoot,
  type StoreSnapshotIdentity,
} from "../../local-store";
import { revisionDeltaPracticeIds, type RevisionDelta } from "../../local-store/model";
import { parseQueryRequest } from "../request";
import { assembleQueryHits } from "../result";
import type { QueryHit, QueryRequest } from "../types";
import { validateEmbeddingBatch, type EmbeddingPort } from "./encoding";
import {
  SemanticIndexIncompatibleError,
  SemanticIndexNotReadyError,
  SemanticIndexQueryError,
} from "./errors";
import { openSemanticIndexReader, type SemanticCandidate } from "./index/reader";
import type { EmbeddingProfile } from "./profile";

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
  return candidates.map((candidate) => candidate.practiceId);
}

export function createSemanticQueryService(
  dependencies: SemanticQueryDependencies,
): SemanticQueryService {
  const { store, profile, embedding } = dependencies;

  return Object.freeze({
    async query(root: StorageRoot, request: QueryRequest): Promise<SemanticQueryResult> {
      const input = parseQueryRequest(request);
      for (let attempt = 0; attempt < MAX_QUERY_RETRIES; attempt += 1) {
        let reader: Awaited<ReturnType<typeof openSemanticIndexReader>> | undefined;
        try {
          // eslint-disable-next-line no-await-in-loop -- each retry reopens the active snapshot.
          reader = await openSemanticIndexReader(root.rootPath, profile);
          // eslint-disable-next-line no-await-in-loop -- coverage is bound to this retry's Store view.
          const current = await store.readSnapshotIdentity(root);
          // eslint-disable-next-line no-await-in-loop -- delta history is part of the same retry.
          const coverage = await prepareCoverage(store, root, reader.metadata, current);

          let candidates: readonly SemanticCandidate[] = Object.freeze([]);
          if (reader.hasEligibleVectors(coverage.excludedPracticeIds)) {
            // eslint-disable-next-line no-await-in-loop -- the model admits one request at a time.
            const batch = await embedding.embed([input.text]);
            const [queryVector] = validateEmbeddingBatch(profile, [input.text], batch);
            if (queryVector === undefined) {
              throw new SemanticIndexQueryError("Embedding result did not contain a query vector");
            }
            candidates = reader.search(queryVector, coverage.excludedPracticeIds, input.limit);
          }

          const ids = semanticCandidateIds(candidates);
          // eslint-disable-next-line no-await-in-loop -- final read validates this retry's snapshot.
          const practices = await store.readEffectivePracticesAtSnapshot(
            root,
            coverage.identity,
            ids,
          );
          const results = assembleQueryHits(
            practices,
            candidates,
            (message) => new SemanticIndexQueryError(message),
          );
          return Object.freeze({
            mode: "semantic",
            profileId: profile.profileId,
            coverage: coverage.coverage,
            results,
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
    },
  });
}

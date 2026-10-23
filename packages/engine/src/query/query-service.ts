import {
  StoreSnapshotChangedError,
  type EffectivePractice,
  type StorageRoot,
  type StoreSnapshotIdentity,
} from "../local-store";
import { revisionDeltaPracticeIds } from "../local-store/model";
import { KeywordIndexError, KeywordIndexUnavailableError } from "./errors";
import type { KeywordCandidate } from "./keyword/keyword-index";
import {
  createPersistentKeywordIndex,
  openPersistentKeywordIndex,
  withPersistentKeywordIndexWriter,
  type PersistentKeywordIndex,
} from "./keyword/persistent-keyword-index";
import { projectKeywordPractice } from "./keyword/projection";
import { parseQueryRequest } from "./request";
import { assembleQueryHits } from "./result";
import type { QueryDependencies, QueryResult, QueryService } from "./types";

const MAX_QUERY_RETRIES = 3;

interface PreparedKeywordIndex {
  readonly index: PersistentKeywordIndex;
  readonly identity: StoreSnapshotIdentity;
  /** A first build may safely answer from the canonical snapshot that built it. */
  readonly practices: readonly EffectivePractice[] | undefined;
}

function isCompatible(index: PersistentKeywordIndex, identity: StoreSnapshotIdentity): boolean {
  return (
    index.checkpoint.rootBinding === identity.rootBinding &&
    index.checkpoint.effectiveRevision <= identity.effectiveRevision
  );
}

async function openExistingIndex(rootPath: string): Promise<PersistentKeywordIndex | undefined> {
  try {
    return await openPersistentKeywordIndex(rootPath);
  } catch (error) {
    if (error instanceof KeywordIndexUnavailableError) throw error;
    if (error instanceof KeywordIndexError) return undefined;
    throw error;
  }
}

async function prepareKeywordIndex(
  store: QueryDependencies["store"],
  root: StorageRoot,
): Promise<PreparedKeywordIndex> {
  const initialIdentity = await store.readSnapshotIdentity(root);
  let index = await openExistingIndex(root.rootPath);
  if (index !== undefined && isCompatible(index, initialIdentity)) {
    if (index.checkpoint.effectiveRevision === initialIdentity.effectiveRevision) {
      return Object.freeze({ index, identity: initialIdentity, practices: undefined });
    }
    index.close();
    index = undefined;
  } else {
    index?.close();
    index = undefined;
  }

  return withPersistentKeywordIndexWriter(root.rootPath, async () => {
    const identity = await store.readSnapshotIdentity(root);
    index = await openExistingIndex(root.rootPath);
    if (index !== undefined && isCompatible(index, identity)) {
      if (index.checkpoint.effectiveRevision === identity.effectiveRevision) {
        return Object.freeze({ index, identity, practices: undefined });
      }
      const changes = await store.readEffectivePracticeChanges(
        root,
        index.checkpoint.effectiveRevision,
      );
      if (changes !== undefined && changes.identity.rootBinding === identity.rootBinding) {
        index.applyChanges(
          {
            rootBinding: changes.identity.rootBinding,
            effectiveRevision: changes.identity.effectiveRevision,
          },
          revisionDeltaPracticeIds(
            changes.deltas.map((change) => change.delta),
            true,
          ),
          changes.currentPractices.map(projectKeywordPractice),
        );
        return Object.freeze({ index, identity: changes.identity, practices: undefined });
      }
      index.close();
      index = undefined;
    } else {
      index?.close();
      index = undefined;
    }

    const snapshot = await store.readEffectivePracticeSnapshot(root);
    const built = await createPersistentKeywordIndex(
      root.rootPath,
      {
        rootBinding: snapshot.identity.rootBinding,
        effectiveRevision: snapshot.identity.effectiveRevision,
      },
      snapshot.practices.map(projectKeywordPractice),
    );
    return Object.freeze({
      index: built,
      identity: snapshot.identity,
      practices: snapshot.practices,
    });
  });
}

/** Dependencies are shared; roots, snapshots and index connections belong to each call. */
export function createQueryService({ store }: QueryDependencies): QueryService {
  return Object.freeze({
    async query(root, request, diagnostics) {
      const startedAt = Date.now();
      const input = parseQueryRequest(request);
      diagnostics?.emitter.emit({
        time: new Date().toISOString(),
        level: "info",
        component: "engine",
        event: "engine.keyword-query.started",
        ...(diagnostics.traceId === undefined ? {} : { traceId: diagnostics.traceId }),
        query: input.text,
      });
      try {
        for (let attempt = 0; attempt < MAX_QUERY_RETRIES; attempt++) {
          let prepared: PreparedKeywordIndex | undefined;
          try {
            // eslint-disable-next-line no-await-in-loop -- each retry depends on the previous snapshot.
            prepared = await prepareKeywordIndex(store, root);
            const candidates = prepared.index.search(input.text, input.limit);
            let result: QueryResult;
            if (prepared.practices !== undefined) {
              result = assembleQueryResult(
                prepared.practices,
                candidates,
                prepared.practices.length === 0,
              );
            } else {
              // eslint-disable-next-line no-await-in-loop -- the candidate read validates this retry's snapshot.
              const practices = await store.readEffectivePracticesAtSnapshot(
                root,
                prepared.identity,
                candidates.map((candidate) => candidate.practiceId),
              );
              result = assembleQueryResult(practices, candidates);
            }
            diagnostics?.emitter.emit({
              time: new Date().toISOString(),
              level: "info",
              component: "engine",
              event: "engine.keyword-query.completed",
              ...(diagnostics.traceId === undefined ? {} : { traceId: diagnostics.traceId }),
              durationMs: Date.now() - startedAt,
              count: result.results.length,
            });
            return result;
          } catch (error) {
            if (error instanceof StoreSnapshotChangedError && attempt + 1 < MAX_QUERY_RETRIES) {
              continue;
            }
            throw error;
          } finally {
            prepared?.index.close();
          }
        }
        throw new KeywordIndexError("LocalStore changed repeatedly during query");
      } catch (error) {
        diagnostics?.emitter.emit({
          time: new Date().toISOString(),
          level: "error",
          component: "engine",
          event: "engine.keyword-query.failed",
          ...(diagnostics.traceId === undefined ? {} : { traceId: diagnostics.traceId }),
          durationMs: Date.now() - startedAt,
          query: input.text,
          code:
            error instanceof KeywordIndexUnavailableError ? "query.unavailable" : "query.failed",
        });
        throw error;
      }
    },
  } satisfies QueryService);
}

function assembleQueryResult(
  practices: readonly EffectivePractice[],
  candidates: readonly KeywordCandidate[],
  corpusIsProvenEmpty = false,
): QueryResult {
  const results = assembleQueryHits(
    practices,
    candidates,
    (message) => new KeywordIndexError(message),
  );
  return Object.freeze({
    mode: "keyword",
    results,
    ...(corpusIsProvenEmpty ? { emptyReason: "corpus-empty" } : {}),
  });
}

import { mkdir, rm } from "node:fs/promises";

import { KeywordIndexError } from "../errors";
import { projectKeywordIndexDatabaseDefinition } from "../../persistence/definitions";
import {
  createPersistentKeywordIndexAt,
  forkPersistentKeywordIndexAt,
  openPersistentKeywordIndexAt,
  withPersistentKeywordIndexWriterAt,
  type PersistentKeywordIndex,
} from "./persistent-keyword-index";
import { projectKeywordPractice } from "./projection";
import { parseQueryRequest } from "../request";
import { assembleQueryHits } from "../result";
import type { QueryRequest, QueryResult } from "../types";
import { withContentArtifactLease } from "../artifacts/artifact-lease";
import {
  contentKeywordArtifactId,
  contentKeywordIndexPaths,
  contentKeywordIndexPathsForArtifactId,
  type ContentAddressedCorpus,
} from "../artifacts/cache";
import {
  recentContentArtifactIds,
  recordContentArtifactCacheArtifact,
} from "../artifacts/cache-catalog";

function currentArtifact(index: PersistentKeywordIndex, corpus: ContentAddressedCorpus): boolean {
  return (
    index.checkpoint.rootBinding === corpus.indexCorpusDigest &&
    index.checkpoint.effectiveRevision === 0
  );
}

const MAX_REUSABLE_PREDECESSORS = 2;

interface ReusableKeywordArtifact {
  readonly paths: ReturnType<typeof contentKeywordIndexPaths>;
  readonly removedPracticeIds: readonly string[];
  readonly changedDocuments: ReturnType<typeof projectKeywordPractice>[];
  readonly unchangedCount: number;
}

async function reusableArtifact(
  corpus: ContentAddressedCorpus,
  cacheRoot: string,
  sourceSlotId: string | undefined,
): Promise<ReusableKeywordArtifact | undefined> {
  if (sourceSlotId === undefined) return undefined;
  const artifactIds = await recentContentArtifactIds(cacheRoot, {
    kind: "keyword",
    sourceSlotId,
    limit: MAX_REUSABLE_PREDECESSORS,
  });
  const documents = corpus.practices.map(projectKeywordPractice);
  let best: ReusableKeywordArtifact | undefined;
  for (const artifactId of artifactIds) {
    if (artifactId === contentKeywordArtifactId(corpus)) continue;
    const paths = contentKeywordIndexPathsForArtifactId(cacheRoot, artifactId);
    try {
      // eslint-disable-next-line no-await-in-loop -- each immutable artifact is independently validated.
      const previous = await withContentArtifactLease(paths.directory, async () => {
        const candidate = await openPersistentKeywordIndexAt(
          paths,
          projectKeywordIndexDatabaseDefinition,
        );
        if (candidate === undefined) return undefined;
        try {
          return candidate.documentDigests();
        } finally {
          candidate.close();
        }
      });
      if (previous === undefined) continue;
      const previousByPractice = new Map(
        previous.map((document) => [document.practiceId, document.contentDigest]),
      );
      const changedDocuments = documents.filter(
        (document) => previousByPractice.get(document.practiceId) !== document.contentDigest,
      );
      const currentIds = new Set(documents.map((document) => document.practiceId));
      const removedPracticeIds = [...previousByPractice.keys()].filter((id) => !currentIds.has(id));
      const unchangedCount = documents.length - changedDocuments.length;
      const next = Object.freeze({ paths, removedPracticeIds, changedDocuments, unchangedCount });
      if (unchangedCount > 0 && (best === undefined || next.unchangedCount > best.unchangedCount)) {
        best = next;
      }
    } catch {
      // A corrupt or concurrently pruned old artifact is merely an unusable
      // optimization. The current artifact will be built from canonical source.
    }
  }
  return best;
}

async function openOrBuild(
  corpus: ContentAddressedCorpus,
  cacheRoot: string,
  sourceSlotId: string | undefined,
): Promise<PersistentKeywordIndex> {
  const paths = contentKeywordIndexPaths(cacheRoot, corpus);
  return withPersistentKeywordIndexWriterAt(paths, async () => {
    let existing: PersistentKeywordIndex | undefined;
    try {
      existing = await openPersistentKeywordIndexAt(paths, projectKeywordIndexDatabaseDefinition);
      if (existing !== undefined && currentArtifact(existing, corpus)) return existing;
      existing?.close();
      existing = undefined;
    } catch (error) {
      existing?.close();
      if (!(error instanceof KeywordIndexError)) throw error;
      await rm(paths.active, { force: true }).catch(() => undefined);
    }
    const reusable = await reusableArtifact(corpus, cacheRoot, sourceSlotId);
    if (reusable !== undefined) {
      try {
        return await withContentArtifactLease(reusable.paths.directory, () =>
          forkPersistentKeywordIndexAt(
            reusable.paths,
            paths,
            { rootBinding: corpus.indexCorpusDigest, effectiveRevision: 0 },
            reusable.removedPracticeIds,
            reusable.changedDocuments,
            projectKeywordIndexDatabaseDefinition,
          ),
        );
      } catch {
        // Fall through to a complete artifact build. A source artifact is
        // optional derived state and never makes the current query fail.
      }
    }
    return createPersistentKeywordIndexAt(
      paths,
      { rootBinding: corpus.indexCorpusDigest, effectiveRevision: 0 },
      corpus.practices.map(projectKeywordPractice),
      projectKeywordIndexDatabaseDefinition,
    );
  });
}

/** Query a complete content-addressed artifact and read summaries from the current corpus. */
export async function queryContentAddressedKeyword(
  corpus: ContentAddressedCorpus,
  cacheRoot: string,
  request: QueryRequest,
  options: { readonly sourceSlotId?: string } = {},
): Promise<QueryResult> {
  const input = parseQueryRequest(request);
  const paths = contentKeywordIndexPaths(cacheRoot, corpus);
  await mkdir(paths.directory, { recursive: true });
  return withContentArtifactLease(paths.directory, async () => {
    const index = await openOrBuild(corpus, cacheRoot, options.sourceSlotId);
    try {
      await recordContentArtifactCacheArtifact(cacheRoot, {
        artifactId: contentKeywordArtifactId(corpus),
        kind: "keyword",
        corpusDigest: corpus.indexCorpusDigest,
        ...(options.sourceSlotId === undefined ? {} : { sourceSlotId: options.sourceSlotId }),
        documentCount: corpus.practices.length,
        state: "ready",
        filePath: paths.active,
        verified: true,
      });
      const candidates = index.search(input.text, input.limit);
      const results = assembleQueryHits(
        corpus.practices,
        candidates,
        (message) => new KeywordIndexError(message),
      );
      return Object.freeze({
        mode: "keyword",
        results,
        ...(corpus.practices.length === 0 ? { emptyReason: "corpus-empty" } : {}),
      });
    } finally {
      index.close();
    }
  });
}

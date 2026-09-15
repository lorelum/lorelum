import { mkdir, readdir, rm } from "node:fs/promises";

import { KeywordIndexError } from "../query/errors";
import { projectKeywordIndexDatabaseDefinition } from "../persistence/definitions";
import {
  createPersistentKeywordIndexAt,
  forkPersistentKeywordIndexAt,
  openPersistentKeywordIndexAt,
  withPersistentKeywordIndexWriterAt,
  type PersistentKeywordIndex,
} from "../query/keyword/persistent-keyword-index";
import { projectKeywordPractice } from "../query/keyword/projection";
import { parseQueryRequest } from "../query/request";
import { assembleQueryHits } from "../query/result";
import type { QueryRequest, QueryResult } from "../query/types";
import { withProjectArtifactLease } from "./artifact-lease";
import { projectCachePaths, projectKeywordArtifactId, projectKeywordIndexPaths } from "./cache";
import { recordProjectCacheArtifact } from "./cache-catalog";
import type { ProjectContextSnapshot } from "./types";

function currentArtifact(index: PersistentKeywordIndex, snapshot: ProjectContextSnapshot): boolean {
  return (
    index.checkpoint.rootBinding === snapshot.indexCorpusDigest &&
    index.checkpoint.effectiveRevision === 0
  );
}

const ARTIFACT_ID = /^[a-f0-9]{64}$/;

interface ReusableKeywordArtifact {
  readonly paths: ReturnType<typeof projectKeywordIndexPaths>;
  readonly removedPracticeIds: readonly string[];
  readonly changedDocuments: ReturnType<typeof projectKeywordPractice>[];
  readonly unchangedCount: number;
}

async function reusableArtifact(
  snapshot: ProjectContextSnapshot,
  cacheRoot: string,
): Promise<ReusableKeywordArtifact | undefined> {
  const directory = `${projectCachePaths(cacheRoot).artifacts}/keyword`;
  let entries: readonly string[];
  try {
    entries = await readdir(directory);
  } catch {
    return undefined;
  }
  const documents = snapshot.practices.map(projectKeywordPractice);
  let best: ReusableKeywordArtifact | undefined;
  for (const artifactId of entries.filter((entry) => ARTIFACT_ID.test(entry)).sort()) {
    if (artifactId === projectKeywordArtifactId(snapshot)) continue;
    const paths = Object.freeze({
      directory: `${directory}/${artifactId}`,
      active: `${directory}/${artifactId}/active.sqlite`,
      writer: `${directory}/${artifactId}/writer`,
    });
    try {
      // eslint-disable-next-line no-await-in-loop -- each immutable artifact is independently validated.
      const previous = await withProjectArtifactLease(paths.directory, async () => {
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
  snapshot: ProjectContextSnapshot,
  cacheRoot: string,
): Promise<PersistentKeywordIndex> {
  const paths = projectKeywordIndexPaths(cacheRoot, snapshot);
  return withPersistentKeywordIndexWriterAt(paths, async () => {
    let existing: PersistentKeywordIndex | undefined;
    try {
      existing = await openPersistentKeywordIndexAt(paths, projectKeywordIndexDatabaseDefinition);
      if (existing !== undefined && currentArtifact(existing, snapshot)) return existing;
      existing?.close();
      existing = undefined;
    } catch (error) {
      existing?.close();
      if (!(error instanceof KeywordIndexError)) throw error;
      await rm(paths.active, { force: true }).catch(() => undefined);
    }
    const reusable = await reusableArtifact(snapshot, cacheRoot);
    if (reusable !== undefined) {
      try {
        return await withProjectArtifactLease(reusable.paths.directory, () =>
          forkPersistentKeywordIndexAt(
            reusable.paths,
            paths,
            { rootBinding: snapshot.indexCorpusDigest, effectiveRevision: 0 },
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
      { rootBinding: snapshot.indexCorpusDigest, effectiveRevision: 0 },
      snapshot.practices.map(projectKeywordPractice),
      projectKeywordIndexDatabaseDefinition,
    );
  });
}

/** Query a complete, content-addressed ProjectContext artifact and read summaries from the snapshot. */
export async function queryProjectContextKeyword(
  snapshot: ProjectContextSnapshot,
  cacheRoot: string,
  request: QueryRequest,
): Promise<QueryResult> {
  const input = parseQueryRequest(request);
  const paths = projectKeywordIndexPaths(cacheRoot, snapshot);
  await mkdir(paths.directory, { recursive: true });
  return withProjectArtifactLease(paths.directory, async () => {
    const index = await openOrBuild(snapshot, cacheRoot);
    try {
      await recordProjectCacheArtifact(cacheRoot, {
        artifactId: projectKeywordArtifactId(snapshot),
        kind: "keyword",
        corpusDigest: snapshot.indexCorpusDigest,
        documentCount: snapshot.practices.length,
        state: "ready",
        filePath: paths.active,
        verified: true,
      });
      const candidates = index.search(input.text, input.limit);
      return Object.freeze({
        mode: "keyword",
        results: assembleQueryHits(
          snapshot.practices,
          candidates,
          (message) => new KeywordIndexError(message),
        ),
      });
    } finally {
      index.close();
    }
  });
}

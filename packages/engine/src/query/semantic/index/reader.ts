import { access } from "node:fs/promises";

import { openSqliteConnection } from "../../../persistence/database/connection";
import {
  semanticIndexDatabaseDefinition,
  type SqliteDatabaseDefinition,
} from "../../../persistence/definitions";
import { semanticVectors } from "../../../persistence/schemas/semantic-index";
import { SemanticIndexError } from "../errors";
import {
  SemanticIndexIncompatibleError,
  SemanticIndexNotReadyError,
  SemanticIndexQueryError,
} from "../errors";
import type { VectorPracticeScorer } from "../methods/types";
import type { EmbeddingProfile } from "../profile";
import { isCompatibleMetadata, type SemanticIndexMetadata } from "./metadata";
import {
  readSemanticIndexMetadata,
  readSemanticIndexVectors,
  type SemanticIndexConnection,
} from "./database";
import { semanticIndexPaths, type SemanticIndexPaths } from "./paths";

export interface SemanticCandidate {
  readonly practiceId: string;
  readonly contentDigest: string;
  /** Internal score used only for deterministic ordering. */
  readonly similarity: number;
}

export interface SemanticIndexReader {
  readonly metadata: SemanticIndexMetadata;
  /** Whether at least one Practice remains eligible after the supplied exclusions. */
  hasEligibleVectors(excludedPracticeIds: ReadonlySet<string>): boolean;
  search(
    scorer: VectorPracticeScorer,
    excludedPracticeIds: ReadonlySet<string>,
  ): readonly SemanticCandidate[];
  close(): void;
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function readPracticeIds(connection: SemanticIndexConnection): readonly string[] {
  try {
    const rows = connection.orm
      .select({ practiceId: semanticVectors.practiceId })
      .from(semanticVectors)
      .all();
    const ids = new Set<string>();
    for (const row of rows) {
      if (typeof row.practiceId !== "string" || row.practiceId.length === 0) {
        throw new SemanticIndexQueryError("Semantic index Practice ID is invalid");
      }
      ids.add(row.practiceId);
    }
    return Object.freeze([...ids].sort(compareCodeUnits));
  } catch (error) {
    if (error instanceof SemanticIndexQueryError) throw error;
    throw new SemanticIndexQueryError("Cannot read semantic index Practice IDs", { cause: error });
  }
}

function readCandidateRows(
  connection: SemanticIndexConnection,
  metadata: SemanticIndexMetadata,
  scorer: VectorPracticeScorer,
  excludedPracticeIds: ReadonlySet<string>,
): SemanticCandidate[] {
  const candidates: SemanticCandidate[] = [];
  for (const practiceId of readPracticeIds(connection)) {
    if (excludedPracticeIds.has(practiceId)) continue;
    const storedViews = readSemanticIndexVectors(connection, practiceId, metadata.dimensions);
    if (storedViews === undefined || storedViews.length === 0) {
      throw new SemanticIndexQueryError("Semantic index Practice has no vector views");
    }
    const contentDigest = storedViews[0]!.contentDigest;
    if (storedViews.some((view) => view.contentDigest !== contentDigest)) {
      throw new SemanticIndexQueryError("Semantic index views disagree on canonical content");
    }
    const similarity = scorer.score(storedViews);
    if (!Number.isFinite(similarity)) {
      throw new SemanticIndexQueryError("Semantic Practice similarity is not finite");
    }
    candidates.push({ practiceId, contentDigest, similarity });
  }
  candidates.sort((left, right) => {
    const scoreOrder = right.similarity - left.similarity;
    return scoreOrder === 0 ? compareCodeUnits(left.practiceId, right.practiceId) : scoreOrder;
  });
  return candidates;
}

/** Open one read-only SQLite connection for metadata and all candidate reads. */
export async function openSemanticIndexReader(
  rootPath: string,
  profile: EmbeddingProfile,
): Promise<SemanticIndexReader> {
  return openSemanticIndexReaderAt(semanticIndexPaths(rootPath, profile.profileId), profile);
}

/** Open one complete artifact at a caller-owned cache location. */
export async function openSemanticIndexReaderAt(
  paths: SemanticIndexPaths,
  profile: EmbeddingProfile,
  definition: SqliteDatabaseDefinition<
    typeof semanticIndexDatabaseDefinition.schema
  > = semanticIndexDatabaseDefinition,
): Promise<SemanticIndexReader> {
  const path = paths.active;
  try {
    await access(path);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      throw new SemanticIndexNotReadyError("Semantic index has not been built");
    }
    throw new SemanticIndexQueryError("Cannot access semantic SQLite index", { cause: error });
  }

  let connection: SemanticIndexConnection | undefined;
  try {
    connection = openSqliteConnection(path, definition.schema, {
      readonly: true,
    });
    const metadata = readSemanticIndexMetadata(connection);
    if (!isCompatibleMetadata(metadata, profile, metadata.rootBinding)) {
      throw new SemanticIndexIncompatibleError("Semantic index does not match the active Profile");
    }
    const activeConnection = connection;
    return Object.freeze({
      metadata,
      hasEligibleVectors(excludedPracticeIds: ReadonlySet<string>) {
        return readPracticeIds(activeConnection).some(
          (practiceId) => !excludedPracticeIds.has(practiceId),
        );
      },
      search(scorer, excludedPracticeIds) {
        try {
          return Object.freeze(
            readCandidateRows(activeConnection, metadata, scorer, excludedPracticeIds),
          );
        } catch (error) {
          if (error instanceof SemanticIndexError && !(error instanceof SemanticIndexQueryError)) {
            throw new SemanticIndexQueryError(error.message, { cause: error });
          }
          throw error;
        }
      },
      close() {
        activeConnection.close();
      },
    } satisfies SemanticIndexReader);
  } catch (error) {
    try {
      connection?.close();
    } catch {
      // Preserve the original index failure.
    }
    if (
      error instanceof SemanticIndexNotReadyError ||
      error instanceof SemanticIndexIncompatibleError ||
      error instanceof SemanticIndexQueryError
    ) {
      throw error;
    }
    if (error instanceof SemanticIndexError) {
      throw new SemanticIndexQueryError(error.message, { cause: error });
    }
    throw new SemanticIndexQueryError("Cannot open semantic SQLite index", { cause: error });
  }
}

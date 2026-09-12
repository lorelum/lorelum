import { access } from "node:fs/promises";
import { Database } from "bun:sqlite";

import { SemanticIndexError } from "../errors";
import {
  SemanticIndexIncompatibleError,
  SemanticIndexNotReadyError,
  SemanticIndexQueryError,
} from "../errors";
import type { EmbeddingProfile } from "../profile";
import { isCompatibleMetadata, type SemanticIndexMetadata } from "./metadata";
import {
  readSemanticIndexMetadata,
  readSemanticIndexVector,
  verifySemanticIndexIntegrity,
} from "./database";
import { semanticIndexPaths } from "./paths";

export interface SemanticCandidate {
  readonly practiceId: string;
  readonly contentDigest: string;
  /** Internal score used only for deterministic ordering. */
  readonly similarity: number;
}

export interface SemanticIndexReader {
  readonly metadata: SemanticIndexMetadata;
  /** Whether at least one vector remains eligible after the supplied exclusions. */
  hasEligibleVectors(excludedPracticeIds: ReadonlySet<string>): boolean;
  search(
    queryVector: Float32Array,
    excludedPracticeIds: ReadonlySet<string>,
    limit: number,
  ): readonly SemanticCandidate[];
  close(): void;
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function cosine(left: Float32Array, right: Float32Array): number {
  if (left.length !== right.length) {
    throw new SemanticIndexQueryError("Semantic query vector dimensions are invalid");
  }
  let score = 0;
  for (let index = 0; index < left.length; index += 1) score += left[index]! * right[index]!;
  if (!Number.isFinite(score)) {
    throw new SemanticIndexQueryError("Semantic similarity is not finite");
  }
  return score;
}

function readPracticeIds(database: Database): readonly string[] {
  try {
    const rows = database.query("SELECT practice_id FROM semantic_vectors").all() as unknown[];
    return Object.freeze(
      rows.map((row) => {
        if (
          typeof row !== "object" ||
          row === null ||
          !("practice_id" in row) ||
          typeof row.practice_id !== "string"
        ) {
          throw new SemanticIndexQueryError("Semantic index Practice ID is invalid");
        }
        return row.practice_id;
      }),
    );
  } catch (error) {
    if (error instanceof SemanticIndexQueryError) throw error;
    throw new SemanticIndexQueryError("Cannot read semantic index Practice IDs", { cause: error });
  }
}

function readCandidateRows(
  database: Database,
  metadata: SemanticIndexMetadata,
  queryVector: Float32Array,
  excludedPracticeIds: ReadonlySet<string>,
): SemanticCandidate[] {
  const candidates: SemanticCandidate[] = [];
  for (const practiceId of readPracticeIds(database)) {
    if (excludedPracticeIds.has(practiceId)) continue;
    const row = readSemanticIndexVector(database, practiceId, metadata.dimensions);
    if (row === undefined) {
      throw new SemanticIndexQueryError("Semantic index vector row disappeared during query");
    }
    candidates.push({
      practiceId,
      contentDigest: row.contentDigest,
      similarity: cosine(queryVector, row.vector),
    });
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
  const path = semanticIndexPaths(rootPath, profile.profileId).active;
  try {
    await access(path);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      throw new SemanticIndexNotReadyError("Semantic index has not been built");
    }
    throw new SemanticIndexQueryError("Cannot access semantic SQLite index", { cause: error });
  }

  let database: Database | undefined;
  try {
    database = new Database(path, { readonly: true });
    verifySemanticIndexIntegrity(database);
    const metadata = readSemanticIndexMetadata(database);
    if (!isCompatibleMetadata(metadata, profile, metadata.rootBinding)) {
      throw new SemanticIndexIncompatibleError("Semantic index does not match the active Profile");
    }
    const connection = database;
    return Object.freeze({
      metadata,
      hasEligibleVectors(excludedPracticeIds: ReadonlySet<string>) {
        return readPracticeIds(connection).some(
          (practiceId) => !excludedPracticeIds.has(practiceId),
        );
      },
      search(queryVector, excludedPracticeIds, limit) {
        if (queryVector.length !== metadata.dimensions) {
          throw new SemanticIndexQueryError("Semantic query vector dimensions are invalid");
        }
        const candidates = readCandidateRows(
          connection,
          metadata,
          queryVector,
          excludedPracticeIds,
        );
        return Object.freeze(candidates.slice(0, limit));
      },
      close() {
        connection.close();
      },
    } satisfies SemanticIndexReader);
  } catch (error) {
    try {
      database?.close();
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

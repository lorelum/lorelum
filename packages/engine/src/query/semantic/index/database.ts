import { count, eq, inArray } from "drizzle-orm";

import type { SqliteConnection } from "../../../persistence/database/connection";
import { migrateSqlite } from "../../../persistence/database/migrator";
import {
  semanticIndexDatabaseDefinition,
  type SqliteDatabaseDefinition,
} from "../../../persistence/definitions";
import {
  semanticIndexMetadata,
  semanticVectors,
} from "../../../persistence/schemas/semantic-index";
import { SemanticIndexError } from "../errors";
import type { SemanticDocument } from "../projection";
import type { SemanticIndexMetadata } from "./metadata";

export type SemanticIndexConnection = SqliteConnection<
  typeof semanticIndexDatabaseDefinition.schema
>;
export type SemanticIndexDatabaseDefinition = SqliteDatabaseDefinition<
  typeof semanticIndexDatabaseDefinition.schema
>;

interface MetadataRow extends Record<string, unknown> {
  readonly indexVersion: number;
  readonly rootBinding: string;
  readonly generation: number;
  readonly effectiveRevision: number;
  readonly manifestDigest: string;
  readonly profileId: string;
  readonly encodingId: string;
  readonly dimensions: number;
  readonly documentProjectionVersion: number;
  readonly normalization: string;
  readonly vectorCount: number;
}

export interface SemanticIndexVector {
  readonly contentDigest: string;
  readonly projectionDigest: string;
  readonly vector: Float32Array;
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function metadataFromRow(row: unknown): SemanticIndexMetadata {
  if (typeof row !== "object" || row === null) {
    throw new SemanticIndexError("Semantic index metadata is missing");
  }
  const value = row as Partial<MetadataRow>;
  if (
    !positiveInteger(value.indexVersion) ||
    typeof value.rootBinding !== "string" ||
    !positiveInteger(value.generation) ||
    !positiveInteger(value.effectiveRevision) ||
    typeof value.manifestDigest !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.profileId ?? "") ||
    !/^[a-f0-9]{64}$/.test(value.encodingId ?? "") ||
    !positiveInteger(value.dimensions) ||
    value.dimensions === 0 ||
    !positiveInteger(value.documentProjectionVersion) ||
    value.documentProjectionVersion === 0 ||
    value.normalization !== "l2" ||
    !positiveInteger(value.vectorCount)
  ) {
    throw new SemanticIndexError("Semantic index metadata is invalid");
  }
  return Object.freeze({
    indexVersion: value.indexVersion,
    rootBinding: value.rootBinding,
    generation: value.generation,
    effectiveRevision: value.effectiveRevision,
    manifestDigest: value.manifestDigest,
    profileId: value.profileId!,
    encodingId: value.encodingId!,
    dimensions: value.dimensions,
    documentProjectionVersion: value.documentProjectionVersion,
    normalization: value.normalization,
    vectorCount: value.vectorCount,
  });
}

function vectorBlob(vector: Float32Array): Buffer {
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
}

function validateVectorBlob(value: unknown, dimensions: number): void {
  if (
    !(value instanceof Uint8Array) ||
    value.byteLength !== dimensions * Float32Array.BYTES_PER_ELEMENT
  ) {
    throw new SemanticIndexError("Semantic index vector blob is invalid");
  }
  const copy = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  const vector = new Float32Array(copy);
  let squaredLength = 0;
  for (const item of vector) {
    if (!Number.isFinite(item)) throw new SemanticIndexError("Semantic index vector is not finite");
    squaredLength += item * item;
  }
  if (Math.abs(Math.sqrt(squaredLength) - 1) >= 0.001) {
    throw new SemanticIndexError("Semantic index vector is not L2-normalized");
  }
}

function vectorFromBlob(value: unknown, dimensions: number): Float32Array {
  validateVectorBlob(value, dimensions);
  const bytes = value as Uint8Array;
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new Float32Array(copy);
}

function metadataRow(connection: SemanticIndexConnection): MetadataRow | undefined {
  return connection.orm
    .select({
      indexVersion: semanticIndexMetadata.indexVersion,
      rootBinding: semanticIndexMetadata.rootBinding,
      generation: semanticIndexMetadata.generation,
      effectiveRevision: semanticIndexMetadata.effectiveRevision,
      manifestDigest: semanticIndexMetadata.manifestDigest,
      profileId: semanticIndexMetadata.profileId,
      encodingId: semanticIndexMetadata.encodingId,
      dimensions: semanticIndexMetadata.dimensions,
      documentProjectionVersion: semanticIndexMetadata.documentProjectionVersion,
      normalization: semanticIndexMetadata.normalization,
      vectorCount: semanticIndexMetadata.vectorCount,
    })
    .from(semanticIndexMetadata)
    .where(eq(semanticIndexMetadata.singleton, 1))
    .get();
}

function insertMetadata(
  connection: SemanticIndexConnection,
  metadata: SemanticIndexMetadata,
): void {
  connection.orm
    .insert(semanticIndexMetadata)
    .values({ singleton: 1, ...metadata })
    .run();
}

function updateMetadata(
  connection: SemanticIndexConnection,
  metadata: SemanticIndexMetadata,
): void {
  connection.orm
    .update(semanticIndexMetadata)
    .set(metadata)
    .where(eq(semanticIndexMetadata.singleton, 1))
    .run();
  if (metadataRow(connection) === undefined) {
    throw new SemanticIndexError("Semantic index metadata is missing");
  }
}

function finalMetadata(
  metadata: SemanticIndexMetadata,
  nextVectorCount: number,
): SemanticIndexMetadata {
  if (!Number.isSafeInteger(nextVectorCount) || nextVectorCount < 0) {
    throw new SemanticIndexError("Semantic index vector count is invalid");
  }
  return Object.freeze({
    ...metadata,
    vectorCount: nextVectorCount,
  });
}

function vectorRows(
  documents: readonly SemanticDocument[],
  vectors: readonly Float32Array[],
  dimensions: number,
) {
  return documents.map((document, index) => {
    const vector = vectors[index]!;
    const blob = vectorBlob(vector);
    validateVectorBlob(blob, dimensions);
    return {
      practiceId: document.practiceId,
      contentDigest: document.contentDigest,
      projectionDigest: document.projectionDigest,
      vector: blob,
    };
  });
}

function vectorCount(connection: SemanticIndexConnection): number {
  const row = connection.orm.select({ count: count() }).from(semanticVectors).get();
  if (row === undefined || !positiveInteger(row.count)) {
    throw new SemanticIndexError("Semantic index vector count is inconsistent");
  }
  return row.count;
}

export function initializeSemanticIndex(
  connection: SemanticIndexConnection,
  metadata: SemanticIndexMetadata,
  documents: readonly SemanticDocument[],
  vectors: readonly Float32Array[],
  definition: SemanticIndexDatabaseDefinition = semanticIndexDatabaseDefinition,
): void {
  if (documents.length !== vectors.length || metadata.vectorCount !== documents.length) {
    throw new SemanticIndexError("Semantic index document and vector counts differ");
  }
  try {
    migrateSqlite(connection, definition);
    const rows = vectorRows(documents, vectors, metadata.dimensions);
    connection.orm.transaction(() => {
      insertMetadata(connection, metadata);
      if (rows.length > 0) connection.orm.insert(semanticVectors).values(rows).run();
    });
  } catch (error) {
    if (error instanceof SemanticIndexError) throw error;
    throw new SemanticIndexError("Cannot initialize semantic SQLite index", { cause: error });
  }
}

/** Read one validated vector for incremental reuse. */
export function readSemanticIndexVector(
  connection: SemanticIndexConnection,
  practiceId: string,
  dimensions: number,
): SemanticIndexVector | undefined {
  try {
    const row = connection.orm
      .select({
        contentDigest: semanticVectors.contentDigest,
        projectionDigest: semanticVectors.projectionDigest,
        vector: semanticVectors.vector,
      })
      .from(semanticVectors)
      .where(eq(semanticVectors.practiceId, practiceId))
      .get();
    if (row === undefined) return undefined;
    if (
      typeof row.contentDigest !== "string" ||
      !/^[a-f0-9]{64}$/.test(row.contentDigest) ||
      typeof row.projectionDigest !== "string" ||
      !/^[a-f0-9]{64}$/.test(row.projectionDigest)
    ) {
      throw new SemanticIndexError("Semantic index vector row is invalid");
    }
    return Object.freeze({
      contentDigest: row.contentDigest,
      projectionDigest: row.projectionDigest,
      vector: vectorFromBlob(row.vector, dimensions),
    });
  } catch (error) {
    if (error instanceof SemanticIndexError) throw error;
    throw new SemanticIndexError("Cannot read semantic index vector", { cause: error });
  }
}

/** Replace the final rows touched by a retained Store revision sequence. */
export function applySemanticIndexChanges(
  connection: SemanticIndexConnection,
  target: SemanticIndexMetadata,
  removedPracticeIds: readonly string[],
  documents: readonly SemanticDocument[],
  vectors: readonly Float32Array[],
): SemanticIndexMetadata {
  if (documents.length !== vectors.length) {
    throw new SemanticIndexError("Semantic index document and vector counts differ");
  }
  const removed = [...new Set(removedPracticeIds)].sort();
  let written: SemanticIndexMetadata | undefined;
  try {
    const rows = vectorRows(documents, vectors, target.dimensions);
    connection.orm.transaction(() => {
      if (removed.length > 0) {
        connection.orm
          .delete(semanticVectors)
          .where(inArray(semanticVectors.practiceId, removed))
          .run();
      }
      if (rows.length > 0) connection.orm.insert(semanticVectors).values(rows).run();
      written = finalMetadata(target, vectorCount(connection));
      updateMetadata(connection, written);
    });
    if (written === undefined)
      throw new SemanticIndexError("Semantic index metadata was not updated");
    return written;
  } catch (error) {
    if (error instanceof SemanticIndexError) throw error;
    throw new SemanticIndexError("Cannot update semantic SQLite index", { cause: error });
  }
}

export function readSemanticIndexMetadata(
  connection: SemanticIndexConnection,
): SemanticIndexMetadata {
  try {
    const metadata = metadataFromRow(metadataRow(connection));
    const vectors = connection.orm
      .select({ vector: semanticVectors.vector })
      .from(semanticVectors)
      .all();
    if (vectors.length !== metadata.vectorCount) {
      throw new SemanticIndexError("Semantic index vector count is inconsistent");
    }
    for (const row of vectors) validateVectorBlob(row.vector, metadata.dimensions);
    return metadata;
  } catch (error) {
    if (error instanceof SemanticIndexError) throw error;
    throw new SemanticIndexError("Cannot read semantic SQLite index metadata", { cause: error });
  }
}

export function verifySemanticIndexIntegrity(connection: SemanticIndexConnection): void {
  try {
    // SQLite integrity_check is a database-engine diagnostic, not relational CRUD.
    const rows = connection.client.query("PRAGMA integrity_check").all() as unknown[];
    if (
      rows.length !== 1 ||
      typeof rows[0] !== "object" ||
      rows[0] === null ||
      !("integrity_check" in rows[0]) ||
      rows[0].integrity_check !== "ok"
    ) {
      throw new SemanticIndexError("Semantic SQLite index integrity check failed");
    }
  } catch (error) {
    if (error instanceof SemanticIndexError) throw error;
    throw new SemanticIndexError("Cannot verify semantic SQLite index", { cause: error });
  }
}

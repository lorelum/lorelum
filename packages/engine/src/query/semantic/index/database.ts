import { Database } from "bun:sqlite";

import { SemanticIndexError } from "../errors";
import type { SemanticDocument } from "../projection";
import type { SemanticIndexMetadata } from "./metadata";

const CREATE_METADATA_TABLE = `
  CREATE TABLE semantic_index_metadata (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    index_version INTEGER NOT NULL,
    root_binding TEXT NOT NULL,
    generation INTEGER NOT NULL,
    effective_revision INTEGER NOT NULL,
    manifest_digest TEXT NOT NULL,
    profile_id TEXT NOT NULL,
    encoding_id TEXT NOT NULL,
    dimensions INTEGER NOT NULL,
    document_projection_version INTEGER NOT NULL,
    normalization TEXT NOT NULL,
    vector_count INTEGER NOT NULL
  )
`;

const CREATE_VECTORS_TABLE = `
  CREATE TABLE semantic_vectors (
    practice_id TEXT PRIMARY KEY,
    content_digest TEXT NOT NULL,
    projection_digest TEXT NOT NULL,
    vector BLOB NOT NULL
  )
`;

const INSERT_METADATA = `
  INSERT INTO semantic_index_metadata (
    singleton, index_version, root_binding, generation, effective_revision, manifest_digest,
    profile_id, encoding_id, dimensions, document_projection_version, normalization, vector_count
  ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

const INSERT_VECTOR = `
  INSERT INTO semantic_vectors (practice_id, content_digest, projection_digest, vector)
  VALUES (?, ?, ?, ?)
`;

const UPDATE_METADATA = `
  UPDATE semantic_index_metadata
  SET index_version = ?, root_binding = ?, generation = ?, effective_revision = ?,
      manifest_digest = ?, profile_id = ?, encoding_id = ?, dimensions = ?,
      document_projection_version = ?, normalization = ?, vector_count = ?
  WHERE singleton = 1
`;

interface MetadataRow extends Record<string, unknown> {
  readonly index_version: number;
  readonly root_binding: string;
  readonly generation: number;
  readonly effective_revision: number;
  readonly manifest_digest: string;
  readonly profile_id: string;
  readonly encoding_id: string;
  readonly dimensions: number;
  readonly document_projection_version: number;
  readonly normalization: string;
  readonly vector_count: number;
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
    !positiveInteger(value.index_version) ||
    typeof value.root_binding !== "string" ||
    !positiveInteger(value.generation) ||
    !positiveInteger(value.effective_revision) ||
    typeof value.manifest_digest !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.profile_id ?? "") ||
    !/^[a-f0-9]{64}$/.test(value.encoding_id ?? "") ||
    !positiveInteger(value.dimensions) ||
    value.dimensions === 0 ||
    !positiveInteger(value.document_projection_version) ||
    value.document_projection_version === 0 ||
    value.normalization !== "l2" ||
    !positiveInteger(value.vector_count)
  ) {
    throw new SemanticIndexError("Semantic index metadata is invalid");
  }
  return Object.freeze({
    indexVersion: value.index_version,
    rootBinding: value.root_binding,
    generation: value.generation,
    effectiveRevision: value.effective_revision,
    manifestDigest: value.manifest_digest,
    profileId: value.profile_id!,
    encodingId: value.encoding_id!,
    dimensions: value.dimensions,
    documentProjectionVersion: value.document_projection_version,
    normalization: value.normalization,
    vectorCount: value.vector_count,
  });
}

function vectorBlob(vector: Float32Array): Uint8Array {
  return new Uint8Array(
    vector.buffer.slice(vector.byteOffset, vector.byteOffset + vector.byteLength),
  );
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

function insertMetadata(database: Database, metadata: SemanticIndexMetadata): void {
  database
    .query(INSERT_METADATA)
    .run(
      metadata.indexVersion,
      metadata.rootBinding,
      metadata.generation,
      metadata.effectiveRevision,
      metadata.manifestDigest,
      metadata.profileId,
      metadata.encodingId,
      metadata.dimensions,
      metadata.documentProjectionVersion,
      metadata.normalization,
      metadata.vectorCount,
    );
}

function updateMetadata(database: Database, metadata: SemanticIndexMetadata): void {
  const result = database
    .query(UPDATE_METADATA)
    .run(
      metadata.indexVersion,
      metadata.rootBinding,
      metadata.generation,
      metadata.effectiveRevision,
      metadata.manifestDigest,
      metadata.profileId,
      metadata.encodingId,
      metadata.dimensions,
      metadata.documentProjectionVersion,
      metadata.normalization,
      metadata.vectorCount,
    );
  if (result.changes !== 1) throw new SemanticIndexError("Semantic index metadata is missing");
}

function finalMetadata(
  metadata: SemanticIndexMetadata,
  vectorCount: number,
): SemanticIndexMetadata {
  if (!Number.isSafeInteger(vectorCount) || vectorCount < 0) {
    throw new SemanticIndexError("Semantic index vector count is invalid");
  }
  return Object.freeze({
    ...metadata,
    vectorCount,
  });
}

export function initializeSemanticIndex(
  database: Database,
  metadata: SemanticIndexMetadata,
  documents: readonly SemanticDocument[],
  vectors: readonly Float32Array[],
): void {
  if (documents.length !== vectors.length || metadata.vectorCount !== documents.length) {
    throw new SemanticIndexError("Semantic index document and vector counts differ");
  }
  database.exec(CREATE_METADATA_TABLE);
  database.exec(CREATE_VECTORS_TABLE);
  try {
    database.transaction(() => {
      insertMetadata(database, metadata);
      const insert = database.query(INSERT_VECTOR);
      for (let index = 0; index < documents.length; index += 1) {
        const document = documents[index]!;
        const vector = vectors[index]!;
        validateVectorBlob(vectorBlob(vector), metadata.dimensions);
        insert.run(
          document.practiceId,
          document.contentDigest,
          document.projectionDigest,
          vectorBlob(vector),
        );
      }
    })();
  } catch (error) {
    if (error instanceof SemanticIndexError) throw error;
    throw new SemanticIndexError("Cannot initialize semantic SQLite index", { cause: error });
  }
}

/** Read one validated vector for incremental reuse. */
export function readSemanticIndexVector(
  database: Database,
  practiceId: string,
  dimensions: number,
): SemanticIndexVector | undefined {
  try {
    const row = database
      .query(
        "SELECT content_digest, projection_digest, vector FROM semantic_vectors WHERE practice_id = ?",
      )
      .get(practiceId) as Record<string, unknown> | null | undefined;
    if (row === null || row === undefined) return undefined;
    if (
      typeof row.content_digest !== "string" ||
      !/^[a-f0-9]{64}$/.test(row.content_digest) ||
      typeof row.projection_digest !== "string" ||
      !/^[a-f0-9]{64}$/.test(row.projection_digest)
    ) {
      throw new SemanticIndexError("Semantic index vector row is invalid");
    }
    return Object.freeze({
      contentDigest: row.content_digest,
      projectionDigest: row.projection_digest,
      vector: vectorFromBlob(row.vector, dimensions),
    });
  } catch (error) {
    if (error instanceof SemanticIndexError) throw error;
    throw new SemanticIndexError("Cannot read semantic index vector", { cause: error });
  }
}

/** Replace the final rows touched by a retained Store revision sequence. */
export function applySemanticIndexChanges(
  database: Database,
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
    database.transaction(() => {
      if (removed.length > 0) {
        database
          .query(
            `DELETE FROM semantic_vectors WHERE practice_id IN (${removed.map(() => "?").join(", ")})`,
          )
          .run(...removed);
      }
      const insert = database.query(INSERT_VECTOR);
      for (let index = 0; index < documents.length; index += 1) {
        const document = documents[index]!;
        const vector = vectors[index]!;
        validateVectorBlob(vectorBlob(vector), target.dimensions);
        insert.run(
          document.practiceId,
          document.contentDigest,
          document.projectionDigest,
          vectorBlob(vector),
        );
      }
      const count = database
        .query("SELECT COUNT(*) AS count FROM semantic_vectors")
        .get() as unknown;
      if (
        typeof count !== "object" ||
        count === null ||
        !("count" in count) ||
        !positiveInteger(count.count)
      ) {
        throw new SemanticIndexError("Semantic index vector count is inconsistent");
      }
      written = finalMetadata(target, count.count);
      updateMetadata(database, written);
    })();
    if (written === undefined)
      throw new SemanticIndexError("Semantic index metadata was not updated");
    return written;
  } catch (error) {
    if (error instanceof SemanticIndexError) throw error;
    throw new SemanticIndexError("Cannot update semantic SQLite index", { cause: error });
  }
}

export function readSemanticIndexMetadata(database: Database): SemanticIndexMetadata {
  try {
    const metadata = metadataFromRow(
      database.query("SELECT * FROM semantic_index_metadata WHERE singleton = 1").get(),
    );
    const count = database.query("SELECT COUNT(*) AS count FROM semantic_vectors").get() as unknown;
    if (
      typeof count !== "object" ||
      count === null ||
      !("count" in count) ||
      !positiveInteger(count.count) ||
      count.count !== metadata.vectorCount
    ) {
      throw new SemanticIndexError("Semantic index vector count is inconsistent");
    }
    const vectors = database.query("SELECT vector FROM semantic_vectors").all() as unknown[];
    for (const row of vectors) {
      if (typeof row !== "object" || row === null || !("vector" in row)) {
        throw new SemanticIndexError("Semantic index vector row is invalid");
      }
      validateVectorBlob(row.vector, metadata.dimensions);
    }
    return metadata;
  } catch (error) {
    if (error instanceof SemanticIndexError) throw error;
    throw new SemanticIndexError("Cannot read semantic SQLite index metadata", { cause: error });
  }
}

export function verifySemanticIndexIntegrity(database: Database): void {
  try {
    const rows = database.query("PRAGMA integrity_check").all() as unknown[];
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

import { randomUUID } from "node:crypto";
import { access, copyFile, mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";

import { KeywordIndexError } from "../errors";
import { acquireMutationLock } from "../../local-store/storage/mutation-lock";
import { openSqliteConnection, type SqliteConnection } from "../../persistence/database/connection";
import { migrateSqlite } from "../../persistence/database/migrator";
import {
  keywordIndexDatabaseDefinition,
  type SqliteDatabaseDefinition,
} from "../../persistence/definitions";
import { keywordIndexMetadata } from "../../persistence/schemas/keyword-index";
import {
  KEYWORD_INDEX_VERSION,
  deleteKeywordDocuments,
  insertKeywordDocuments,
  openKeywordIndex,
  toKeywordIndexError,
  type KeywordIndex,
} from "./keyword-index";
import type { KeywordDocument } from "./projection";

export interface KeywordIndexCheckpoint {
  readonly rootBinding: string;
  readonly effectiveRevision: number;
}

export interface PersistentKeywordIndex extends KeywordIndex {
  readonly checkpoint: KeywordIndexCheckpoint;
  documentDigests(): readonly KeywordIndexDocumentDigest[];
  applyChanges(
    nextCheckpoint: KeywordIndexCheckpoint,
    removedPracticeIds: readonly string[],
    documents: readonly KeywordDocument[],
  ): void;
}

export interface KeywordIndexDocumentDigest {
  readonly practiceId: string;
  readonly contentDigest: string;
}

const INDEX_FILE_NAME = "active.sqlite";
const INDEX_WRITER_DIRECTORY = "writer";

type KeywordIndexConnection = SqliteConnection<typeof keywordIndexDatabaseDefinition.schema>;
type KeywordIndexDatabaseDefinition = SqliteDatabaseDefinition<
  typeof keywordIndexDatabaseDefinition.schema
>;

export interface PersistentKeywordIndexPaths {
  readonly directory: string;
  readonly active: string;
  readonly writer: string;
}

export function persistentKeywordIndexPaths(rootPath: string): PersistentKeywordIndexPaths {
  const directory = join(rootPath, "indexes", "keyword", `v${KEYWORD_INDEX_VERSION}`);
  return Object.freeze({
    directory,
    active: join(directory, INDEX_FILE_NAME),
    writer: join(directory, INDEX_WRITER_DIRECTORY),
  });
}

/** Serialize index publication and delta writes without blocking Store mutations. */
export async function withPersistentKeywordIndexWriter<T>(
  rootPath: string,
  work: () => Promise<T>,
): Promise<T> {
  return withPersistentKeywordIndexWriterAt(persistentKeywordIndexPaths(rootPath), work);
}

/** Same writer semantics at a caller-owned derived artifact location. */
export async function withPersistentKeywordIndexWriterAt<T>(
  paths: PersistentKeywordIndexPaths,
  work: () => Promise<T>,
): Promise<T> {
  await mkdir(paths.writer, { recursive: true });
  const lock = await acquireMutationLock(paths.writer);
  try {
    return await work();
  } finally {
    await lock.release();
  }
}

interface KeywordIndexMetadataRow extends Record<string, unknown> {
  readonly rootBinding: string;
  readonly effectiveRevision: number;
}

function isValidCheckpoint(value: unknown): value is KeywordIndexMetadataRow {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.rootBinding === "string" &&
    typeof row.effectiveRevision === "number" &&
    Number.isSafeInteger(row.effectiveRevision) &&
    row.effectiveRevision >= 0
  );
}

function readCheckpoint(connection: KeywordIndexConnection): KeywordIndexCheckpoint {
  const row = connection.orm
    .select({
      rootBinding: keywordIndexMetadata.rootBinding,
      effectiveRevision: keywordIndexMetadata.effectiveRevision,
    })
    .from(keywordIndexMetadata)
    .where(eq(keywordIndexMetadata.singleton, 1))
    .get();
  if (!isValidCheckpoint(row)) throw new KeywordIndexError("Keyword index metadata is invalid");
  return Object.freeze({
    rootBinding: row.rootBinding,
    effectiveRevision: row.effectiveRevision,
  });
}

function writeCheckpoint(
  connection: KeywordIndexConnection,
  checkpoint: KeywordIndexCheckpoint,
): void {
  connection.orm
    .update(keywordIndexMetadata)
    .set({
      rootBinding: checkpoint.rootBinding,
      effectiveRevision: checkpoint.effectiveRevision,
    })
    .where(eq(keywordIndexMetadata.singleton, 1))
    .run();
  if (!checkpointEquals(readCheckpoint(connection), checkpoint)) {
    throw new KeywordIndexError("Keyword index metadata is invalid");
  }
}

function writeInitialCheckpoint(
  connection: KeywordIndexConnection,
  checkpoint: KeywordIndexCheckpoint,
): void {
  connection.orm
    .insert(keywordIndexMetadata)
    .values({
      singleton: 1,
      rootBinding: checkpoint.rootBinding,
      effectiveRevision: checkpoint.effectiveRevision,
    })
    .run();
}

function checkpointEquals(left: KeywordIndexCheckpoint, right: KeywordIndexCheckpoint): boolean {
  return (
    left.rootBinding === right.rootBinding && left.effectiveRevision === right.effectiveRevision
  );
}

function uniqueIds(ids: readonly string[]): readonly string[] {
  return [...new Set(ids)];
}

function documentDigests(
  connection: KeywordIndexConnection,
): readonly KeywordIndexDocumentDigest[] {
  // FTS5 virtual-table reads are SQLite-specific and cannot be represented by
  // Drizzle's normal table model. These digests are only used to seed a new
  // immutable artifact; Practice content is still assembled from canonical source.
  const rows = connection.client
    .query(
      "SELECT practice_id AS practiceId, content_digest AS contentDigest FROM keyword_documents",
    )
    .all();
  const values = rows.map((row) => {
    if (
      typeof row !== "object" ||
      row === null ||
      !("practiceId" in row) ||
      !("contentDigest" in row) ||
      typeof row.practiceId !== "string" ||
      typeof row.contentDigest !== "string" ||
      !/^[a-f0-9]{64}$/.test(row.contentDigest)
    ) {
      throw new KeywordIndexError("Keyword index document metadata is invalid");
    }
    return Object.freeze({ practiceId: row.practiceId, contentDigest: row.contentDigest });
  });
  return Object.freeze(
    values.sort((left, right) => left.practiceId.localeCompare(right.practiceId)),
  );
}

function wrap(
  connection: KeywordIndexConnection,
  initial: KeywordIndexCheckpoint,
): PersistentKeywordIndex {
  let checkpoint = initial;
  const keywordIndex = openKeywordIndex(connection.client);
  return Object.freeze({
    get checkpoint() {
      return checkpoint;
    },
    search(text, limit) {
      return keywordIndex.search(text, limit);
    },
    documentDigests() {
      return documentDigests(connection);
    },
    applyChanges(nextCheckpoint, removedPracticeIds, documents) {
      if (nextCheckpoint.rootBinding !== checkpoint.rootBinding) {
        throw new KeywordIndexError("Keyword index root binding changed");
      }
      if (nextCheckpoint.effectiveRevision < checkpoint.effectiveRevision) {
        throw new KeywordIndexError("Keyword index revision moved backwards");
      }
      try {
        connection.orm.transaction(() => {
          // FTS5 document mutation remains native SQL because virtual-table
          // MATCH/bm25 semantics are outside Drizzle's table abstraction.
          deleteKeywordDocuments(connection.client, uniqueIds(removedPracticeIds));
          insertKeywordDocuments(connection.client, documents);
          writeCheckpoint(connection, nextCheckpoint);
        });
        checkpoint = nextCheckpoint;
      } catch (error) {
        if (error instanceof KeywordIndexError) throw error;
        throw new KeywordIndexError("Cannot update SQLite keyword index", { cause: error });
      }
    },
    close() {
      keywordIndex.close();
    },
  } satisfies PersistentKeywordIndex);
}

/** Open an existing persistent index. Missing means it has not been built yet. */
export async function openPersistentKeywordIndex(
  rootPath: string,
): Promise<PersistentKeywordIndex | undefined> {
  return openPersistentKeywordIndexAt(persistentKeywordIndexPaths(rootPath));
}

/** Open a complete keyword artifact without assuming it belongs to a Store root. */
export async function openPersistentKeywordIndexAt(
  paths: PersistentKeywordIndexPaths,
  definition: KeywordIndexDatabaseDefinition = keywordIndexDatabaseDefinition,
): Promise<PersistentKeywordIndex | undefined> {
  const { active } = paths;
  try {
    await access(active);
  } catch {
    return undefined;
  }
  let connection: KeywordIndexConnection | undefined;
  try {
    connection = openSqliteConnection(active, definition.schema);
    migrateSqlite(connection, definition);
    // WAL is a SQLite file-mode setting, outside Drizzle's relational schema API.
    connection.client.exec("PRAGMA journal_mode = WAL");
    return wrap(connection, readCheckpoint(connection));
  } catch (error) {
    try {
      connection?.close();
    } catch {
      // Keep the original corruption/open error.
    }
    throw toKeywordIndexError("Cannot open persistent SQLite keyword index", error);
  }
}

/** Build a complete index in a temporary file, then publish it atomically. */
export async function createPersistentKeywordIndex(
  rootPath: string,
  checkpoint: KeywordIndexCheckpoint,
  documents: readonly KeywordDocument[],
): Promise<PersistentKeywordIndex> {
  return createPersistentKeywordIndexAt(
    persistentKeywordIndexPaths(rootPath),
    checkpoint,
    documents,
  );
}

/** Build and publish one caller-owned complete keyword artifact atomically. */
export async function createPersistentKeywordIndexAt(
  paths: PersistentKeywordIndexPaths,
  checkpoint: KeywordIndexCheckpoint,
  documents: readonly KeywordDocument[],
  definition: KeywordIndexDatabaseDefinition = keywordIndexDatabaseDefinition,
): Promise<PersistentKeywordIndex> {
  const { directory, active } = paths;
  await mkdir(directory, { recursive: true });
  const temporary = join(directory, `build-${randomUUID()}.sqlite`);
  let connection: KeywordIndexConnection | undefined;
  try {
    const stagingConnection = openSqliteConnection(temporary, definition.schema);
    connection = stagingConnection;
    migrateSqlite(stagingConnection, definition);
    stagingConnection.orm.transaction(() => {
      insertKeywordDocuments(stagingConnection.client, documents);
      writeInitialCheckpoint(stagingConnection, checkpoint);
    });
    stagingConnection.close();
    connection = undefined;
    await rename(temporary, active);
    const opened = await openPersistentKeywordIndexAt(paths, definition);
    if (opened === undefined || !checkpointEquals(opened.checkpoint, checkpoint)) {
      opened?.close();
      throw new KeywordIndexError("Published keyword index did not retain its checkpoint");
    }
    return opened;
  } catch (error) {
    try {
      connection?.close();
    } catch {
      // Preserve the useful failure below.
    }
    await rm(temporary, { force: true }).catch(() => undefined);
    throw toKeywordIndexError("Cannot build persistent SQLite keyword index", error);
  }
}

/**
 * Publish a new immutable artifact by copying a verified compatible artifact
 * and changing only the requested FTS rows. The old artifact remains readable
 * throughout, so a failed replacement never destroys a prior query result.
 */
export async function forkPersistentKeywordIndexAt(
  source: PersistentKeywordIndexPaths,
  target: PersistentKeywordIndexPaths,
  checkpoint: KeywordIndexCheckpoint,
  removedPracticeIds: readonly string[],
  documents: readonly KeywordDocument[],
  definition: KeywordIndexDatabaseDefinition = keywordIndexDatabaseDefinition,
): Promise<PersistentKeywordIndex> {
  await mkdir(target.directory, { recursive: true });
  const temporary = join(target.directory, `build-${randomUUID()}.sqlite`);
  let connection: KeywordIndexConnection | undefined;
  try {
    // A completed artifact may still have committed FTS changes in its WAL.
    // Take the source writer lock and checkpoint before copying so the staging
    // file is a complete SQLite snapshot rather than just its main database.
    await withPersistentKeywordIndexWriterAt(source, async () => {
      const sourceConnection = openSqliteConnection(source.active, definition.schema);
      try {
        sourceConnection.client.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      } finally {
        sourceConnection.close();
      }
    });
    await copyFile(source.active, temporary);
    connection = openSqliteConnection(temporary, definition.schema);
    migrateSqlite(connection, definition);
    connection.orm.transaction(() => {
      // FTS5 row mutation is the narrow SQLite-specific exception; the
      // checkpoint is ordinary Drizzle metadata in the same transaction.
      deleteKeywordDocuments(
        connection!.client,
        uniqueIds([...removedPracticeIds, ...documents.map((document) => document.practiceId)]),
      );
      insertKeywordDocuments(connection!.client, documents);
      writeCheckpoint(connection!, checkpoint);
    });
    // The copied artifact retains WAL mode. Checkpoint the staging connection
    // before rename so its committed delta does not remain under the temporary
    // file name as an orphaned `build-*.sqlite-wal` sidecar.
    connection.client.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    connection.close();
    connection = undefined;
    await rename(temporary, target.active);
    const opened = await openPersistentKeywordIndexAt(target, definition);
    if (opened === undefined || !checkpointEquals(opened.checkpoint, checkpoint)) {
      opened?.close();
      throw new KeywordIndexError("Published keyword index did not retain its checkpoint");
    }
    return opened;
  } catch (error) {
    try {
      connection?.close();
    } catch {
      // Preserve the useful failure below.
    }
    await rm(temporary, { force: true }).catch(() => undefined);
    throw toKeywordIndexError(
      "Cannot incrementally publish persistent SQLite keyword index",
      error,
    );
  }
}

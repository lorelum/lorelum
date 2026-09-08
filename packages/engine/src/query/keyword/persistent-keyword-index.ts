import { randomUUID } from "node:crypto";
import { access, mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { Database } from "bun:sqlite";

import { KeywordIndexError } from "../errors";
import { acquireMutationLock } from "../../local-store/storage/mutation-lock";
import {
  KEYWORD_INDEX_VERSION,
  deleteKeywordDocuments,
  initializeKeywordIndex,
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
  applyChanges(
    nextCheckpoint: KeywordIndexCheckpoint,
    removedPracticeIds: readonly string[],
    documents: readonly KeywordDocument[],
  ): void;
}

const INDEX_FILE_NAME = "active.sqlite";
const INDEX_WRITER_DIRECTORY = "writer";

const CREATE_METADATA_TABLE = `
  CREATE TABLE keyword_index_metadata (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    root_binding TEXT NOT NULL,
    effective_revision INTEGER NOT NULL
  )
`;

function paths(rootPath: string): { readonly directory: string; readonly active: string } {
  const directory = join(rootPath, "indexes", "keyword", `v${KEYWORD_INDEX_VERSION}`);
  return Object.freeze({ directory, active: join(directory, INDEX_FILE_NAME) });
}

/** Serialize index publication and delta writes without blocking Store mutations. */
export async function withPersistentKeywordIndexWriter<T>(
  rootPath: string,
  work: () => Promise<T>,
): Promise<T> {
  const { directory } = paths(rootPath);
  const writerRoot = join(directory, INDEX_WRITER_DIRECTORY);
  await mkdir(writerRoot, { recursive: true });
  const lock = await acquireMutationLock(writerRoot);
  try {
    return await work();
  } finally {
    await lock.release();
  }
}

interface KeywordIndexMetadataRow extends Record<string, unknown> {
  readonly root_binding: string;
  readonly effective_revision: number;
}

function isValidCheckpoint(value: unknown): value is KeywordIndexMetadataRow {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.root_binding === "string" &&
    typeof row.effective_revision === "number" &&
    Number.isSafeInteger(row.effective_revision) &&
    row.effective_revision >= 0
  );
}

function readCheckpoint(database: Database): KeywordIndexCheckpoint {
  const row = database.query("SELECT * FROM keyword_index_metadata WHERE singleton = 1").get();
  if (!isValidCheckpoint(row)) throw new KeywordIndexError("Keyword index metadata is invalid");
  return Object.freeze({
    rootBinding: row.root_binding,
    effectiveRevision: row.effective_revision,
  });
}

function writeCheckpoint(database: Database, checkpoint: KeywordIndexCheckpoint): void {
  database
    .query(
      "UPDATE keyword_index_metadata SET root_binding = ?, effective_revision = ? WHERE singleton = 1",
    )
    .run(checkpoint.rootBinding, checkpoint.effectiveRevision);
}

function checkpointEquals(left: KeywordIndexCheckpoint, right: KeywordIndexCheckpoint): boolean {
  return (
    left.rootBinding === right.rootBinding && left.effectiveRevision === right.effectiveRevision
  );
}

function uniqueIds(ids: readonly string[]): readonly string[] {
  return [...new Set(ids)];
}

function wrap(database: Database, initial: KeywordIndexCheckpoint): PersistentKeywordIndex {
  let checkpoint = initial;
  const keywordIndex = openKeywordIndex(database);
  return Object.freeze({
    get checkpoint() {
      return checkpoint;
    },
    search(text, limit) {
      return keywordIndex.search(text, limit);
    },
    applyChanges(nextCheckpoint, removedPracticeIds, documents) {
      if (nextCheckpoint.rootBinding !== checkpoint.rootBinding) {
        throw new KeywordIndexError("Keyword index root binding changed");
      }
      if (nextCheckpoint.effectiveRevision < checkpoint.effectiveRevision) {
        throw new KeywordIndexError("Keyword index revision moved backwards");
      }
      try {
        database.transaction(() => {
          deleteKeywordDocuments(database, uniqueIds(removedPracticeIds));
          insertKeywordDocuments(database, documents);
          writeCheckpoint(database, nextCheckpoint);
        })();
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
  const { active } = paths(rootPath);
  try {
    await access(active);
  } catch {
    return undefined;
  }
  let database: Database | undefined;
  try {
    database = new Database(active);
    database.exec("PRAGMA journal_mode = WAL");
    return wrap(database, readCheckpoint(database));
  } catch (error) {
    try {
      database?.close();
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
  const { directory, active } = paths(rootPath);
  await mkdir(directory, { recursive: true });
  const temporary = join(directory, `build-${randomUUID()}.sqlite`);
  let database: Database | undefined;
  try {
    database = new Database(temporary);
    initializeKeywordIndex(database, documents);
    database.exec(CREATE_METADATA_TABLE);
    database
      .query(
        "INSERT INTO keyword_index_metadata (singleton, root_binding, effective_revision) VALUES (1, ?, ?)",
      )
      .run(checkpoint.rootBinding, checkpoint.effectiveRevision);
    database.close();
    database = undefined;
    await rename(temporary, active);
    const opened = await openPersistentKeywordIndex(rootPath);
    if (opened === undefined || !checkpointEquals(opened.checkpoint, checkpoint)) {
      opened?.close();
      throw new KeywordIndexError("Published keyword index did not retain its checkpoint");
    }
    return opened;
  } catch (error) {
    try {
      database?.close();
    } catch {
      // Preserve the useful failure below.
    }
    await rm(temporary, { force: true }).catch(() => undefined);
    throw toKeywordIndexError("Cannot build persistent SQLite keyword index", error);
  }
}

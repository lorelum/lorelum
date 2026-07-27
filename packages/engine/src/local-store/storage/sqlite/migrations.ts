import type { Database } from "bun:sqlite";

import { SqliteStateError } from "../errors";

export const LOCAL_STORE_SCHEMA_VERSION = 1;

const INITIAL_SCHEMA = [
  "CREATE TABLE IF NOT EXISTS local_store_metadata (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), schema_version INTEGER NOT NULL, installed_packs_generation INTEGER NOT NULL, effective_revision INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS active_packs (pack_name TEXT PRIMARY KEY, pack_version TEXT NOT NULL, artifact_digest TEXT NOT NULL, storage_key TEXT NOT NULL, installed_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS practice_sources (pack_name TEXT NOT NULL, practice_id TEXT NOT NULL, content_digest TEXT NOT NULL, source_path TEXT NOT NULL, PRIMARY KEY (pack_name, practice_id), FOREIGN KEY (pack_name) REFERENCES active_packs(pack_name) ON DELETE CASCADE, FOREIGN KEY (practice_id) REFERENCES effective_practices(practice_id) ON DELETE CASCADE)",
  "CREATE TABLE IF NOT EXISTS effective_practices (practice_id TEXT PRIMARY KEY, content_digest TEXT NOT NULL, canonical_content TEXT NOT NULL, title TEXT NOT NULL, stage TEXT NOT NULL, tech_stack_json TEXT NOT NULL, applies_when TEXT NOT NULL, severity TEXT NOT NULL, effective_revision INTEGER NOT NULL)",
  "CREATE INDEX IF NOT EXISTS practice_sources_by_practice ON practice_sources(practice_id, pack_name, source_path)",
].join(";");

function userVersion(database: Database): number {
  const row = database.prepare("PRAGMA user_version").get() as Record<string, unknown> | undefined;
  if (
    row === undefined ||
    typeof row.user_version !== "number" ||
    !Number.isSafeInteger(row.user_version)
  ) {
    throw new SqliteStateError("SQLite user_version is malformed");
  }
  return row.user_version;
}

/** Applies LocalStore-owned schema migrations in one SQLite transaction. */
export function migrateDatabase(database: Database): void {
  try {
    database.exec("PRAGMA foreign_keys = ON");
    database.transaction(() => {
      const currentVersion = userVersion(database);
      if (currentVersion < 0 || currentVersion > LOCAL_STORE_SCHEMA_VERSION) {
        throw new SqliteStateError("SQLite schema version is unsupported");
      }
      if (currentVersion === 0) {
        database.exec(INITIAL_SCHEMA);
        database.exec("PRAGMA user_version = " + LOCAL_STORE_SCHEMA_VERSION);
      }
    })();
  } catch (error) {
    if (error instanceof SqliteStateError) throw error;
    throw new SqliteStateError("SQLite migration failed", error);
  }
}

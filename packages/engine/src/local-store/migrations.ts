import type { Database } from "bun:sqlite";

import { StoreInvariantError } from "./errors";

export const LOCAL_STORE_SCHEMA_VERSION = 1;

export function migrateDatabase(database: Database): void {
  database.exec("PRAGMA foreign_keys = ON");
  database.exec(`
    CREATE TABLE IF NOT EXISTS store_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS active_packs (
      pack_name TEXT PRIMARY KEY,
      pack_version TEXT NOT NULL,
      artifact_digest TEXT NOT NULL,
      storage_key TEXT NOT NULL,
      installed_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS practice_sources (
      pack_name TEXT NOT NULL REFERENCES active_packs(pack_name) ON DELETE CASCADE,
      practice_id TEXT NOT NULL,
      content_digest TEXT NOT NULL,
      source_path TEXT NOT NULL,
      PRIMARY KEY (pack_name, practice_id)
    );

    CREATE TABLE IF NOT EXISTS effective_practices (
      practice_id TEXT PRIMARY KEY,
      content_digest TEXT NOT NULL,
      canonical_content TEXT NOT NULL,
      title TEXT NOT NULL,
      stage TEXT NOT NULL,
      tech_stack_json TEXT NOT NULL,
      applies_when TEXT NOT NULL,
      severity TEXT NOT NULL,
      body TEXT NOT NULL,
      anti_patterns_json TEXT NOT NULL,
      effective_revision INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS practice_sources_practice_id
      ON practice_sources(practice_id);
  `);

  const schemaVersion = metadataValue(database, "schema_version");
  if (schemaVersion === null) {
    setMetadata(database, "schema_version", String(LOCAL_STORE_SCHEMA_VERSION));
    setMetadata(database, "installed_packs_generation", "0");
    setMetadata(database, "effective_revision", "0");
    return;
  }

  if (schemaVersion !== String(LOCAL_STORE_SCHEMA_VERSION)) {
    throw new StoreInvariantError(`Unsupported LocalStore schema version "${schemaVersion}"`);
  }
}

function metadataValue(database: Database, key: string): string | null {
  const row = database
    .query<{ value: string }, [string]>("SELECT value FROM store_metadata WHERE key = ?")
    .get(key);
  return row?.value ?? null;
}

function setMetadata(database: Database, key: string, value: string): void {
  database
    .query<unknown, [string, string]>(
      "INSERT INTO store_metadata(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .run(key, value);
}

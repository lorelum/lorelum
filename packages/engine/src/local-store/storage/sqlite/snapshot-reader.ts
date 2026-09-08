import type { Database } from "bun:sqlite";

import type { EffectivePractice } from "../../model";
import { materializePracticeRows } from "./row-materializer";

import { SqliteStateError } from "../errors";
import type { InstalledPackManifestEntry } from "../manifest/manifest-store";

import { LOCAL_STORE_SCHEMA_VERSION } from "./migrations";

export interface StoreMetadataSnapshot {
  schemaVersion: number;
  generation: number;
  effectiveRevision: number;
}

export interface EffectivePracticeSnapshot {
  metadata: StoreMetadataSnapshot;
  effectivePractices: readonly EffectivePractice[];
}

/** One SQLite read transaction used by cold-open consistency verification. */
export interface LocalStoreSnapshot extends EffectivePracticeSnapshot {
  activePacks: readonly InstalledPackManifestEntry[];
}

/**
 * Read the store metadata row, or `undefined` when the database has never
 * been written (a freshly migrated store). Callers that must distinguish
 * "empty store" from "corrupt store" use this instead of the throwing
 * materializer.
 */
export function readStoreMetadata(database: Database): StoreMetadataSnapshot | undefined {
  try {
    const row = database
      .query(
        "SELECT schema_version, installed_packs_generation, effective_revision FROM local_store_metadata WHERE singleton = 1",
      )
      .get() as Record<string, unknown> | null | undefined;
    // bun:sqlite returns `null` for a missing row; treat both as "never written".
    if (row === undefined || row === null) return undefined;
    if (
      row.schema_version !== LOCAL_STORE_SCHEMA_VERSION ||
      typeof row.installed_packs_generation !== "number" ||
      typeof row.effective_revision !== "number"
    ) {
      throw new SqliteStateError("LocalStore metadata row is missing or malformed");
    }
    return Object.freeze({
      schemaVersion: row.schema_version,
      generation: row.installed_packs_generation,
      effectiveRevision: row.effective_revision,
    });
  } catch (error) {
    if (error instanceof SqliteStateError) throw error;
    throw new SqliteStateError("cannot read LocalStore metadata", error);
  }
}

export function materializeEffectivePractices(
  database: Database,
  metadata: StoreMetadataSnapshot,
): readonly EffectivePractice[] {
  const rows = database
    .query(
      "SELECT e.practice_id, e.content_digest, e.canonical_content, e.title, e.stage, e.tech_stack_json, e.applies_when, e.severity, e.effective_revision, s.pack_name, s.source_path, s.content_digest AS source_digest FROM effective_practices e LEFT JOIN practice_sources s ON s.practice_id = e.practice_id ORDER BY e.practice_id ASC, s.pack_name ASC, s.source_path ASC",
    )
    .all();

  return materializePracticeRows(rows, metadata);
}

/** Materializes a bounded subset while retaining the same row validation as full reads. */
export function materializeEffectivePracticesByIds(
  database: Database,
  metadata: StoreMetadataSnapshot,
  ids: readonly string[],
): readonly EffectivePractice[] {
  if (ids.length === 0) return Object.freeze([]);
  const uniqueIds = [...new Set(ids)].sort();
  try {
    const rows = database
      .query(
        `SELECT e.practice_id, e.content_digest, e.canonical_content, e.title, e.stage, e.tech_stack_json, e.applies_when, e.severity, e.effective_revision, s.pack_name, s.source_path, s.content_digest AS source_digest FROM effective_practices e LEFT JOIN practice_sources s ON s.practice_id = e.practice_id WHERE e.practice_id IN (${uniqueIds.map(() => "?").join(", ")}) ORDER BY e.practice_id ASC, s.pack_name ASC, s.source_path ASC`,
      )
      .all(...uniqueIds);
    return materializePracticeRows(rows, metadata);
  } catch (error) {
    if (error instanceof SqliteStateError) throw error;
    throw new SqliteStateError("cannot materialize selected Effective Practices", error);
  }
}

/** Materializes Effective Practices and sources from one deterministically ordered SQL statement. */
export function readEffectivePracticeSnapshot(database: Database): EffectivePracticeSnapshot {
  try {
    return database.transaction(() => {
      const metadata = readStoreMetadata(database);
      if (metadata === undefined) {
        throw new SqliteStateError("LocalStore metadata row is missing");
      }
      return Object.freeze({
        metadata,
        effectivePractices: materializeEffectivePractices(database, metadata),
      });
    })();
  } catch (error) {
    if (error instanceof SqliteStateError) throw error;
    throw new SqliteStateError("cannot materialize Effective Practices", error);
  }
}

/** Read the Active Pack rows deterministically ordered by pack name. */
export function readActivePackEntries(database: Database): readonly InstalledPackManifestEntry[] {
  try {
    const rows = database
      .query(
        "SELECT pack_name, pack_version, artifact_digest, storage_key, installed_at FROM active_packs ORDER BY pack_name ASC",
      )
      .all();
    return Object.freeze(
      rows.map((row) => {
        const value = row as Record<string, unknown>;
        if (
          typeof value.pack_name !== "string" ||
          typeof value.pack_version !== "string" ||
          typeof value.artifact_digest !== "string" ||
          typeof value.storage_key !== "string" ||
          typeof value.installed_at !== "string"
        ) {
          throw new SqliteStateError("active Pack row is malformed");
        }
        return Object.freeze({
          packName: value.pack_name,
          packVersion: value.pack_version,
          artifactDigest: value.artifact_digest,
          storageKey: value.storage_key,
          installedAt: value.installed_at,
        });
      }),
    );
  } catch (error) {
    if (error instanceof SqliteStateError) throw error;
    throw new SqliteStateError("cannot materialize Active Pack rows", error);
  }
}

/**
 * Read metadata, Active Packs, Effective Practices, and source rows from one
 * SQLite snapshot. Cold open pairs this with manifest A/B reads so it never
 * compares different committed generations.
 */
export function readLocalStoreSnapshot(database: Database): LocalStoreSnapshot | undefined {
  try {
    return database.transaction(() => {
      const metadata = readStoreMetadata(database);
      if (metadata === undefined) return undefined;
      return Object.freeze({
        metadata,
        activePacks: readActivePackEntries(database),
        effectivePractices: materializeEffectivePractices(database, metadata),
      });
    })();
  } catch (error) {
    if (error instanceof SqliteStateError) throw error;
    throw new SqliteStateError("cannot read a consistent LocalStore snapshot", error);
  }
}

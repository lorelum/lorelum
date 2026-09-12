import type { Database } from "bun:sqlite";

import {
  canonicalizePractice,
  isPracticeSourcePath,
  type EffectivePractice,
  type RevisionDelta,
} from "../../model";
import type { InstalledPackManifestEntry } from "../manifest/manifest-store";
import { SqliteStateError } from "../errors";
import type { MutationMetricsObserver } from "./mutation-metrics";
import { LOCAL_STORE_SCHEMA_VERSION } from "./migrations";
import { serializeRevisionDelta } from "./revision-delta";
import { appendEffectiveRevisionLog } from "./revision-log";

export interface DerivedStoreState {
  generation: number;
  effectiveRevision: number;
  activePacks: readonly InstalledPackManifestEntry[];
  effectivePractices: readonly EffectivePractice[];
  /** Persisted atomically with the revision so later deliveries cannot overtake it. */
  revisionNotification?:
    | {
        delta: RevisionDelta;
        /** A reindex notification is a full refresh and supersedes older pending deltas. */
        supersedesPending?: boolean;
      }
    | undefined;
  /** Persisted indexing history; independent of the consumable hook outbox. */
  revisionLogDelta?: RevisionDelta | undefined;
  /** Recovery rebuild invalidates every prior derived-index checkpoint. */
  clearRevisionLog?: boolean | undefined;
}

export interface IncrementalDerivedStoreState extends DerivedStoreState {
  /** The only active-Pack row changed by a normal lifecycle mutation. */
  activePackMutation:
    | { readonly kind: "upsert"; readonly entry: InstalledPackManifestEntry }
    | { readonly kind: "remove"; readonly packName: string };
  /** Complete before/after reconciliation is limited to these Practice IDs. */
  affectedPracticeIds: readonly string[];
}

function assertStateIsCoherent(state: DerivedStoreState): void {
  if (
    !Number.isSafeInteger(state.generation) ||
    state.generation < 0 ||
    !Number.isSafeInteger(state.effectiveRevision) ||
    state.effectiveRevision < 0
  ) {
    throw new SqliteStateError("generation or effective revision is invalid");
  }
  const packNames = new Set(state.activePacks.map((pack) => pack.packName));
  for (const effective of state.effectivePractices) {
    const canonical = canonicalizePractice(effective.practice);
    if (
      effective.sources.length === 0 ||
      canonical.canonicalContent !== effective.canonicalContent ||
      canonical.contentDigest !== effective.contentDigest ||
      canonical.practice.id !== effective.practiceId
    ) {
      throw new SqliteStateError("Effective Practice is inconsistent with canonical content");
    }
    for (const source of effective.sources) {
      if (
        !packNames.has(source.packName) ||
        source.practiceId !== effective.practiceId ||
        source.contentDigest !== effective.contentDigest ||
        source.canonicalPractice.canonicalContent !== effective.canonicalContent ||
        source.canonicalPractice.contentDigest !== effective.contentDigest ||
        !isPracticeSourcePath(source.sourcePath)
      ) {
        throw new SqliteStateError("Effective Practice source is inconsistent with derived state");
      }
    }
  }
}

function insertEffectivePracticeRows(
  database: Database,
  practices: readonly EffectivePractice[],
  revisionFor: (practice: EffectivePractice) => number,
  metrics?: MutationMetricsObserver,
): void {
  const insertEffective = database.query(
    "INSERT INTO effective_practices (practice_id, content_digest, canonical_content, title, stage, tech_stack_json, applies_when, severity, effective_revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const insertSource = database.query(
    "INSERT INTO practice_sources (pack_name, practice_id, content_digest, source_path) VALUES (?, ?, ?, ?)",
  );
  for (const effective of practices) {
    const practice = effective.practice;
    const effectiveResult = insertEffective.run(
      effective.practiceId,
      effective.contentDigest,
      effective.canonicalContent,
      practice.title,
      practice.stage,
      JSON.stringify(practice.tech_stack),
      practice.applies_when,
      practice.severity ?? "warn",
      revisionFor(effective),
    );
    metrics?.recordWrite("effective_practices", effectiveResult.changes);
    for (const source of effective.sources) {
      const sourceResult = insertSource.run(
        source.packName,
        source.practiceId,
        source.contentDigest,
        source.sourcePath,
      );
      metrics?.recordWrite("practice_sources", sourceResult.changes);
    }
  }
}

function writeRevisionRecords(
  database: Database,
  state: DerivedStoreState,
  metrics?: MutationMetricsObserver,
): void {
  if (state.clearRevisionLog === true) {
    const result = database.query("DELETE FROM effective_revision_log").run();
    metrics?.recordWrite("effective_revision_log", result.changes);
  }
  if (state.revisionNotification?.supersedesPending === true) {
    database.exec("DELETE FROM effective_revision_outbox");
  }
  if (state.revisionNotification !== undefined) {
    const outboxResult = database
      .query(
        "INSERT OR REPLACE INTO effective_revision_outbox (revision, delta_json, created_at) VALUES (?, ?, ?)",
      )
      .run(
        state.effectiveRevision,
        serializeRevisionDelta(state.revisionNotification.delta),
        new Date().toISOString(),
      );
    metrics?.recordWrite("effective_revision_outbox", outboxResult.changes);
  }
  if (state.revisionLogDelta !== undefined) {
    appendEffectiveRevisionLog(database, state.effectiveRevision, state.revisionLogDelta);
    metrics?.recordWrite("effective_revision_log", 1);
  }
}

/** Replaces SQLite's fully-derived LocalStore state in one write transaction. */
export function writeDerivedState(database: Database, state: DerivedStoreState): void {
  assertStateIsCoherent(state);
  try {
    database.transaction(() => {
      database.exec("DELETE FROM practice_sources");
      database.exec("DELETE FROM effective_practices");
      database.exec("DELETE FROM active_packs");
      database.exec("DELETE FROM local_store_metadata");

      const insertPack = database.query(
        "INSERT INTO active_packs (pack_name, pack_version, artifact_digest, storage_key, installed_at) VALUES (?, ?, ?, ?, ?)",
      );
      for (const pack of state.activePacks) {
        insertPack.run(
          pack.packName,
          pack.packVersion,
          pack.artifactDigest,
          pack.storageKey,
          pack.installedAt,
        );
      }

      insertEffectivePracticeRows(
        database,
        state.effectivePractices,
        () => state.effectiveRevision,
      );

      database
        .query(
          "INSERT INTO local_store_metadata (singleton, schema_version, installed_packs_generation, effective_revision) VALUES (1, ?, ?, ?)",
        )
        .run(LOCAL_STORE_SCHEMA_VERSION, state.generation, state.effectiveRevision);

      writeRevisionRecords(database, state);
    })();
  } catch (error) {
    if (error instanceof SqliteStateError) throw error;
    throw new SqliteStateError("cannot write LocalStore derived state", error);
  }
}

function uniqueSortedIds(ids: readonly string[]): readonly string[] {
  const result = [...new Set(ids)].sort();
  if (result.length !== ids.length) {
    throw new SqliteStateError("affected Practice IDs must be unique");
  }
  return result;
}

function rowRevisions(
  database: Database,
  ids: readonly string[],
  metrics?: MutationMetricsObserver,
): ReadonlyMap<string, number> {
  if (ids.length === 0) return new Map();
  const rows = database
    .query(
      `SELECT practice_id, effective_revision FROM effective_practices WHERE practice_id IN (${ids.map(() => "?").join(", ")})`,
    )
    .all(...ids) as readonly Record<string, unknown>[];
  metrics?.recordRead("effective_practices", rows.length);
  const revisions = new Map<string, number>();
  for (const row of rows) {
    if (
      typeof row.practice_id !== "string" ||
      typeof row.effective_revision !== "number" ||
      !Number.isSafeInteger(row.effective_revision) ||
      row.effective_revision < 0
    ) {
      throw new SqliteStateError("stored Effective Practice revision is malformed");
    }
    revisions.set(row.practice_id, row.effective_revision);
  }
  return revisions;
}

function changedPracticeIds(delta: RevisionDelta | undefined): ReadonlySet<string> {
  return new Set(delta === undefined ? [] : [...delta.added, ...delta.changed]);
}

/**
 * Apply one lifecycle reconciliation without rewriting unrelated canonical
 * rows. The journal and metadata tuple make this transaction the SQLite half
 * of the existing cross-medium commit protocol; `writeDerivedState` remains
 * the full-rebuild path for reindex.
 */
export function applyIncrementalDerivedState(
  database: Database,
  state: IncrementalDerivedStoreState,
  metrics?: MutationMetricsObserver,
): void {
  assertStateIsCoherent(state);
  const affectedIds = uniqueSortedIds(state.affectedPracticeIds);
  const affected = new Set(affectedIds);
  for (const effective of state.effectivePractices) {
    if (!affected.has(effective.practiceId)) {
      throw new SqliteStateError("incremental Effective Practice is outside the affected set");
    }
  }
  try {
    database.transaction(() => {
      const priorRevisions = rowRevisions(database, affectedIds, metrics);
      if (state.activePackMutation.kind === "upsert") {
        const entry = state.activePackMutation.entry;
        const packResult = database
          .query(
            "INSERT INTO active_packs (pack_name, pack_version, artifact_digest, storage_key, installed_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(pack_name) DO UPDATE SET pack_version = excluded.pack_version, artifact_digest = excluded.artifact_digest, storage_key = excluded.storage_key, installed_at = excluded.installed_at",
          )
          .run(
            entry.packName,
            entry.packVersion,
            entry.artifactDigest,
            entry.storageKey,
            entry.installedAt,
          );
        metrics?.recordWrite("active_packs", packResult.changes);
      }

      if (affectedIds.length > 0) {
        const sourceDelete = database
          .query(
            `DELETE FROM practice_sources WHERE practice_id IN (${affectedIds.map(() => "?").join(", ")})`,
          )
          .run(...affectedIds);
        metrics?.recordWrite("practice_sources", sourceDelete.changes);
        const effectiveDelete = database
          .query(
            `DELETE FROM effective_practices WHERE practice_id IN (${affectedIds.map(() => "?").join(", ")})`,
          )
          .run(...affectedIds);
        metrics?.recordWrite("effective_practices", effectiveDelete.changes);
      }

      if (state.activePackMutation.kind === "remove") {
        const packDelete = database
          .query("DELETE FROM active_packs WHERE pack_name = ?")
          .run(state.activePackMutation.packName);
        metrics?.recordWrite("active_packs", packDelete.changes);
      }

      const changedIds = changedPracticeIds(state.revisionLogDelta);
      insertEffectivePracticeRows(
        database,
        state.effectivePractices,
        (effective) => {
          const priorRevision = priorRevisions.get(effective.practiceId);
          const rowRevision = changedIds.has(effective.practiceId)
            ? state.effectiveRevision
            : priorRevision;
          if (rowRevision === undefined) {
            throw new SqliteStateError("unchanged Effective Practice has no prior revision");
          }
          return rowRevision;
        },
        metrics,
      );

      const metadataResult = database
        .query(
          "INSERT INTO local_store_metadata (singleton, schema_version, installed_packs_generation, effective_revision) VALUES (1, ?, ?, ?) ON CONFLICT(singleton) DO UPDATE SET schema_version = excluded.schema_version, installed_packs_generation = excluded.installed_packs_generation, effective_revision = excluded.effective_revision",
        )
        .run(LOCAL_STORE_SCHEMA_VERSION, state.generation, state.effectiveRevision);
      metrics?.recordWrite("local_store_metadata", metadataResult.changes);

      writeRevisionRecords(database, state, metrics);
    })();
  } catch (error) {
    if (error instanceof SqliteStateError) throw error;
    throw new SqliteStateError("cannot incrementally write LocalStore derived state", error);
  }
}

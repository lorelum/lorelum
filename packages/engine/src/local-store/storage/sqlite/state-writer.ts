import type { Database } from "bun:sqlite";

import {
  canonicalizePractice,
  isPracticeSourcePath,
  type EffectivePractice,
  type RevisionDelta,
} from "../../model";
import type { InstalledPackManifestEntry } from "../manifest/manifest-store";
import { SqliteStateError } from "../errors";
import { LOCAL_STORE_SCHEMA_VERSION } from "./migrations";
import { serializeRevisionDelta } from "./revision-outbox";

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

/** Replaces SQLite's fully-derived LocalStore state in one write transaction. */
export function writeDerivedState(database: Database, state: DerivedStoreState): void {
  assertStateIsCoherent(state);
  try {
    database.transaction(() => {
      database.exec("DELETE FROM practice_sources");
      database.exec("DELETE FROM effective_practices");
      database.exec("DELETE FROM active_packs");
      database.exec("DELETE FROM local_store_metadata");

      if (state.revisionNotification?.supersedesPending === true) {
        database.exec("DELETE FROM effective_revision_outbox");
      }

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

      const insertEffective = database.query(
        "INSERT INTO effective_practices (practice_id, content_digest, canonical_content, title, stage, tech_stack_json, applies_when, severity, effective_revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      );
      const insertSource = database.query(
        "INSERT INTO practice_sources (pack_name, practice_id, content_digest, source_path) VALUES (?, ?, ?, ?)",
      );
      for (const effective of state.effectivePractices) {
        const practice = effective.practice;
        insertEffective.run(
          effective.practiceId,
          effective.contentDigest,
          effective.canonicalContent,
          practice.title,
          practice.stage,
          JSON.stringify(practice.tech_stack),
          practice.applies_when,
          practice.severity,
          state.effectiveRevision,
        );
        for (const source of effective.sources) {
          insertSource.run(
            source.packName,
            source.practiceId,
            source.contentDigest,
            source.sourcePath,
          );
        }
      }

      database
        .query(
          "INSERT INTO local_store_metadata (singleton, schema_version, installed_packs_generation, effective_revision) VALUES (1, ?, ?, ?)",
        )
        .run(LOCAL_STORE_SCHEMA_VERSION, state.generation, state.effectiveRevision);

      if (state.revisionNotification !== undefined) {
        database
          .query(
            "INSERT OR REPLACE INTO effective_revision_outbox (revision, delta_json, created_at) VALUES (?, ?, ?)",
          )
          .run(
            state.effectiveRevision,
            serializeRevisionDelta(state.revisionNotification.delta),
            new Date().toISOString(),
          );
      }
    })();
  } catch (error) {
    if (error instanceof SqliteStateError) throw error;
    throw new SqliteStateError("cannot write LocalStore derived state", error);
  }
}

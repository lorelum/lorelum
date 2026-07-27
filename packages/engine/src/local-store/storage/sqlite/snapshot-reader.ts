import type { Database } from "bun:sqlite";

import { PracticeSchema } from "@lorelum/format";

import {
  canonicalizePractice,
  isPracticeSourcePath,
  type EffectivePractice,
  type PracticeSource,
} from "../../model";

import { SqliteStateError } from "../errors";

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

interface MaterializedRow {
  practice_id: string;
  content_digest: string;
  canonical_content: string;
  title: string;
  stage: string;
  tech_stack_json: string;
  applies_when: string;
  severity: string;
  effective_revision: number;
  pack_name: string;
  source_path: string;
  source_digest: string;
}

function isMaterializedRow(value: unknown): value is MaterializedRow {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.practice_id === "string" &&
    typeof row.content_digest === "string" &&
    typeof row.canonical_content === "string" &&
    typeof row.title === "string" &&
    typeof row.stage === "string" &&
    typeof row.tech_stack_json === "string" &&
    typeof row.applies_when === "string" &&
    typeof row.severity === "string" &&
    typeof row.effective_revision === "number" &&
    typeof row.pack_name === "string" &&
    typeof row.source_path === "string" &&
    typeof row.source_digest === "string"
  );
}

function effectiveFromRow(row: MaterializedRow): EffectivePractice {
  let canonicalObject: unknown;
  try {
    canonicalObject = JSON.parse(row.canonical_content);
  } catch (error) {
    throw new SqliteStateError("effective canonical content is not JSON", error);
  }
  const parsedPractice = PracticeSchema.safeParse(canonicalObject);
  if (!parsedPractice.success) {
    throw new SqliteStateError("effective canonical content violates Practice schema");
  }
  const canonical = canonicalizePractice(parsedPractice.data);
  if (
    canonical.canonicalContent !== row.canonical_content ||
    canonical.contentDigest !== row.content_digest ||
    canonical.practice.id !== row.practice_id ||
    canonical.practice.title !== row.title ||
    canonical.practice.stage !== row.stage ||
    JSON.stringify(canonical.practice.tech_stack) !== row.tech_stack_json ||
    canonical.practice.applies_when !== row.applies_when ||
    canonical.practice.severity !== row.severity
  ) {
    throw new SqliteStateError("effective Practice materialization is inconsistent");
  }
  return Object.freeze({
    practiceId: row.practice_id,
    contentDigest: row.content_digest,
    canonicalContent: row.canonical_content,
    practice: canonical.practice,
    sources: Object.freeze([]),
  });
}

function readMetadata(database: Database): StoreMetadataSnapshot {
  const row = database
    .prepare(
      "SELECT schema_version, installed_packs_generation, effective_revision FROM local_store_metadata WHERE singleton = 1",
    )
    .get() as Record<string, unknown> | undefined;
  if (
    row === undefined ||
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
}

/** Materializes Effective Practices and sources from one deterministically ordered SQL statement. */
export function readEffectivePracticeSnapshot(database: Database): EffectivePracticeSnapshot {
  try {
    return database.transaction(() => {
      const metadata = readMetadata(database);
      const rows = database
        .prepare(
          "SELECT e.practice_id, e.content_digest, e.canonical_content, e.title, e.stage, e.tech_stack_json, e.applies_when, e.severity, e.effective_revision, s.pack_name, s.source_path, s.content_digest AS source_digest FROM effective_practices e LEFT JOIN practice_sources s ON s.practice_id = e.practice_id ORDER BY e.practice_id ASC, s.pack_name ASC, s.source_path ASC",
        )
        .all();

      const practices: EffectivePractice[] = [];
      let effective: EffectivePractice | undefined;
      let sources: PracticeSource[] = [];
      for (const rawRow of rows) {
        if (!isMaterializedRow(rawRow)) throw new SqliteStateError("materialized row is malformed");
        if (
          rawRow.effective_revision !== metadata.effectiveRevision ||
          !isPracticeSourcePath(rawRow.source_path)
        ) {
          throw new SqliteStateError("materialized Practice row is inconsistent with metadata");
        }
        if (effective === undefined || effective.practiceId !== rawRow.practice_id) {
          if (effective !== undefined) {
            practices.push(Object.freeze({ ...effective, sources: Object.freeze(sources) }));
          }
          effective = effectiveFromRow(rawRow);
          sources = [];
        }
        if (effective.contentDigest !== rawRow.source_digest) {
          throw new SqliteStateError("source digest differs from effective Practice digest");
        }
        sources.push(
          Object.freeze({
            packName: rawRow.pack_name,
            practiceId: effective.practiceId,
            contentDigest: effective.contentDigest,
            sourcePath: rawRow.source_path,
            canonicalPractice: canonicalizePractice(effective.practice),
          }),
        );
      }
      if (effective !== undefined) {
        practices.push(Object.freeze({ ...effective, sources: Object.freeze(sources) }));
      }
      return Object.freeze({ metadata, effectivePractices: Object.freeze(practices) });
    })();
  } catch (error) {
    if (error instanceof SqliteStateError) throw error;
    throw new SqliteStateError("cannot materialize Effective Practices", error);
  }
}

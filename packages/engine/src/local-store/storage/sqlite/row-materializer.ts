import { PracticeSchema } from "@lorelum/format";
import {
  isPracticeSourcePath,
  type CanonicalPractice,
  type EffectivePractice,
  type PracticeSource,
  type PracticeSnapshot,
} from "../../model";
import { deepFreeze } from "../../model/freeze";
import { SqliteStateError } from "../errors";
import type { StoreMetadataSnapshot } from "./snapshot-reader";

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
  const practice = deepFreeze(parsedPractice.data) as PracticeSnapshot;
  if (
    !/^[a-f0-9]{64}$/.test(row.content_digest) ||
    practice.id !== row.practice_id ||
    practice.title !== row.title ||
    practice.stage !== row.stage ||
    JSON.stringify(practice.tech_stack) !== row.tech_stack_json ||
    practice.applies_when !== row.applies_when ||
    practice.severity !== row.severity
  ) {
    throw new SqliteStateError("effective Practice materialization is inconsistent");
  }
  return Object.freeze({
    practiceId: row.practice_id,
    contentDigest: row.content_digest,
    canonicalContent: row.canonical_content,
    practice,
    sources: Object.freeze([]),
  });
}

export function materializePracticeRows(
  rows: readonly unknown[],
  metadata: StoreMetadataSnapshot,
): readonly EffectivePractice[] {
  const practices: EffectivePractice[] = [];
  let effective: EffectivePractice | undefined;
  let canonical: CanonicalPractice | undefined;
  let sources: PracticeSource[] = [];
  for (const rawRow of rows) {
    if (!isMaterializedRow(rawRow)) throw new SqliteStateError("materialized row is malformed");
    if (
      !Number.isSafeInteger(rawRow.effective_revision) ||
      rawRow.effective_revision < 0 ||
      rawRow.effective_revision > metadata.effectiveRevision ||
      !isPracticeSourcePath(rawRow.source_path)
    ) {
      throw new SqliteStateError("materialized Practice row is inconsistent with metadata");
    }
    if (effective === undefined || effective.practiceId !== rawRow.practice_id) {
      if (effective !== undefined) {
        practices.push(Object.freeze({ ...effective, sources: Object.freeze(sources) }));
      }
      effective = effectiveFromRow(rawRow);
      canonical = Object.freeze({
        practice: effective.practice,
        canonicalContent: effective.canonicalContent,
        contentDigest: effective.contentDigest,
      });
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
        canonicalPractice: canonical!,
      }),
    );
  }
  if (effective !== undefined) {
    practices.push(Object.freeze({ ...effective, sources: Object.freeze(sources) }));
  }
  return Object.freeze(practices);
}

import type { Database } from "bun:sqlite";
import type { EffectivePractice } from "../../model";
import { materializePracticeRows } from "./row-materializer";
import type { StoreMetadataSnapshot } from "./snapshot-reader";

/** Run inside the caller's metadata read transaction. */
export function readPractice(
  database: Database,
  metadata: StoreMetadataSnapshot,
  practiceId: string,
): EffectivePractice | undefined {
  const rows = database
    .query(
      "SELECT e.practice_id, e.content_digest, e.canonical_content, e.title, e.stage, e.tech_stack_json, e.applies_when, e.severity, e.effective_revision, s.pack_name, s.source_path, s.content_digest AS source_digest FROM effective_practices e LEFT JOIN practice_sources s ON s.practice_id = e.practice_id WHERE e.practice_id = ? ORDER BY s.pack_name ASC, s.source_path ASC",
    )
    .all(practiceId);
  return materializePracticeRows(rows, metadata)[0];
}

import type { Database } from "bun:sqlite";

import type { RevisionDelta } from "../../model";

import { SqliteStateError } from "../errors";
import { parseRevisionDelta, serializeRevisionDelta } from "./revision-delta";

export interface EffectiveRevisionLogEntry {
  readonly revision: number;
  readonly delta: RevisionDelta;
}

export const EFFECTIVE_REVISION_LOG_RETENTION = 1_024;

function assertRevision(value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new SqliteStateError("effective revision log row is malformed");
  }
}

/** Append a canonical-state change record in the caller's write transaction. */
export function appendEffectiveRevisionLog(
  database: Database,
  revision: number,
  delta: RevisionDelta,
): void {
  try {
    assertRevision(revision);
    database
      .query(
        "INSERT INTO effective_revision_log (revision, delta_json, created_at) VALUES (?, ?, ?)",
      )
      .run(revision, serializeRevisionDelta(delta), new Date().toISOString());
    database
      .query(
        "DELETE FROM effective_revision_log WHERE revision < (SELECT COALESCE(MAX(revision), 0) - ? FROM effective_revision_log)",
      )
      .run(EFFECTIVE_REVISION_LOG_RETENTION - 1);
  } catch (error) {
    if (error instanceof SqliteStateError) throw error;
    throw new SqliteStateError("cannot append effective revision log", error);
  }
}

/** Read retained change records after a checkpoint, in strict revision order. */
export function readEffectiveRevisionLog(
  database: Database,
  afterRevision: number,
): readonly EffectiveRevisionLogEntry[] {
  try {
    assertRevision(afterRevision);
    const rows = database
      .query(
        "SELECT revision, delta_json FROM effective_revision_log WHERE revision > ? ORDER BY revision ASC",
      )
      .all(afterRevision) as readonly Record<string, unknown>[];
    return Object.freeze(
      rows.map((row) => {
        assertRevision(row.revision);
        if (typeof row.delta_json !== "string") {
          throw new SqliteStateError("effective revision log row is malformed");
        }
        return Object.freeze({ revision: row.revision, delta: parseRevisionDelta(row.delta_json) });
      }),
    );
  } catch (error) {
    if (error instanceof SqliteStateError) throw error;
    throw new SqliteStateError("cannot read effective revision log", error);
  }
}

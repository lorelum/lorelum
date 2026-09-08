import type { Database } from "bun:sqlite";

import type { RevisionDelta } from "../../model";
import { SqliteStateError } from "../errors";
import { parseRevisionDelta } from "./revision-delta";

export interface PendingRevisionNotification {
  readonly revision: number;
  readonly delta: RevisionDelta;
}

/** Read durable notifications in revision order. */
export function readPendingRevisionNotifications(
  database: Database,
): readonly PendingRevisionNotification[] {
  try {
    const rows = database
      .query("SELECT revision, delta_json FROM effective_revision_outbox ORDER BY revision ASC")
      .all() as readonly Record<string, unknown>[];
    return Object.freeze(
      rows.map((row) => {
        if (
          typeof row.revision !== "number" ||
          !Number.isSafeInteger(row.revision) ||
          row.revision < 0 ||
          typeof row.delta_json !== "string"
        ) {
          throw new SqliteStateError("revision outbox row is malformed");
        }
        return Object.freeze({
          revision: row.revision,
          delta: parseRevisionDelta(row.delta_json),
        });
      }),
    );
  } catch (error) {
    if (error instanceof SqliteStateError) throw error;
    throw new SqliteStateError("cannot read revision outbox", error);
  }
}

export function deletePendingRevisionNotification(database: Database, revision: number): void {
  try {
    database.query("DELETE FROM effective_revision_outbox WHERE revision = ?").run(revision);
  } catch (error) {
    throw new SqliteStateError("cannot acknowledge revision notification", error);
  }
}

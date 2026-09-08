import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";

import { migrateDatabase } from "./migrations";
import { EFFECTIVE_REVISION_LOG_RETENTION, readEffectiveRevisionLog } from "./revision-log";
import { writeDerivedState } from "./state-writer";

const emptyDelta = Object.freeze({
  added: Object.freeze([] as string[]),
  changed: Object.freeze([] as string[]),
  invalidated: Object.freeze([] as string[]),
});

test("revision log persists mutation deltas independently from the consumable outbox", () => {
  const database = new Database(":memory:");
  try {
    migrateDatabase(database);
    writeDerivedState(database, {
      generation: 1,
      effectiveRevision: 1,
      activePacks: [],
      effectivePractices: [],
      revisionLogDelta: { ...emptyDelta, added: ["platform.api"] },
    });
    writeDerivedState(database, {
      generation: 2,
      effectiveRevision: 2,
      activePacks: [],
      effectivePractices: [],
      revisionLogDelta: { ...emptyDelta, invalidated: ["platform.api"] },
    });
    expect(readEffectiveRevisionLog(database, 0)).toEqual([
      { revision: 1, delta: { added: ["platform.api"], changed: [], invalidated: [] } },
      { revision: 2, delta: { added: [], changed: [], invalidated: ["platform.api"] } },
    ]);
  } finally {
    database.close();
  }
});

test("revision log does not fabricate a duplicate record for a generation-only write", () => {
  const database = new Database(":memory:");
  try {
    migrateDatabase(database);
    writeDerivedState(database, {
      generation: 1,
      effectiveRevision: 1,
      activePacks: [],
      effectivePractices: [],
      revisionLogDelta: emptyDelta,
    });
    writeDerivedState(database, {
      generation: 2,
      effectiveRevision: 1,
      activePacks: [],
      effectivePractices: [],
    });
    expect(readEffectiveRevisionLog(database, 0)).toEqual([{ revision: 1, delta: emptyDelta }]);
  } finally {
    database.close();
  }
});

test("revision log retains a bounded contiguous tail for index catch-up", () => {
  const database = new Database(":memory:");
  try {
    migrateDatabase(database);
    for (let revision = 1; revision <= EFFECTIVE_REVISION_LOG_RETENTION + 1; revision++) {
      writeDerivedState(database, {
        generation: revision,
        effectiveRevision: revision,
        activePacks: [],
        effectivePractices: [],
        revisionLogDelta: emptyDelta,
      });
    }
    const retained = readEffectiveRevisionLog(database, 0);
    expect(retained).toHaveLength(EFFECTIVE_REVISION_LOG_RETENTION);
    expect(retained[0]?.revision).toBe(2);
    expect(retained.at(-1)?.revision).toBe(EFFECTIVE_REVISION_LOG_RETENTION + 1);
  } finally {
    database.close();
  }
});

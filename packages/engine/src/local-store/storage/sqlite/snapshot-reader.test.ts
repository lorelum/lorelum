import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";

import { createPackCandidate, reconcileEffectivePractices } from "../../model";
import { migrateDatabase } from "./migrations";
import { readEffectivePracticeSnapshot } from "./snapshot-reader";
import { writeDerivedState } from "./state-writer";

/**
 * Baseline fixtures for the single-statement materializer. ADR 0007 §3 freezes
 * the read path to one deterministically ordered SQL statement; the 1k/5k
 * fixtures record cold verification / full-read elapsed time and heap deltas
 * so a future regression back to N+1 queries (the prior implementation's
 * defect) is observable against these numbers.
 */

function buildScaleCandidate(count: number, packName: string) {
  const practices = [];
  for (let index = 0; index < count; index++) {
    practices.push({
      id: `scale.practice.${index}`,
      title: `Practice ${index}`,
      stage: "api",
      tech_stack: ["typescript"],
      applies_when: "building apis at scale",
      severity: "warn",
      body: `Body for practice ${index}.`,
    });
  }
  const sourcePaths: Record<string, string> = {};
  for (let index = 0; index < count; index++) {
    sourcePaths[`scale.practice.${index}`] = `practices/p${index}.md`;
  }
  return createPackCandidate(
    { pack: { name: packName, version: "1.0.0" }, practices, decisions: [] },
    sourcePaths,
  ).candidate;
}

function seedState(database: Database, count: number, packName = "scale-pack"): void {
  const candidate = buildScaleCandidate(count, packName);
  const reconciled = reconcileEffectivePractices([], candidate);
  writeDerivedState(database, {
    generation: 1,
    effectiveRevision: 1,
    activePacks: [
      {
        packName,
        packVersion: "1.0.0",
        artifactDigest: "a".repeat(64),
        storageKey: "p-" + packName,
        installedAt: "2026-07-27T00:00:00.000Z",
      },
    ],
    effectivePractices: reconciled.effectivePractices,
  });
}

test("materializes Effective Practices and sources with one joined query", () => {
  const database = new Database(":memory:");
  try {
    migrateDatabase(database);
    seedState(database, 25);

    let queryCalls = 0;
    const originalQuery = database.query.bind(database);
    // Count the public query calls issued by the reader: one for metadata and
    // one joined materialization query. An N+1 reader would call query once
    // per practice, blowing past this bound.
    database.query = ((sql: string) => {
      queryCalls += 1;
      return originalQuery(sql);
    }) as typeof database.query;

    const snapshot = readEffectivePracticeSnapshot(database);
    expect(snapshot.effectivePractices).toHaveLength(25);
    expect(queryCalls).toBe(2);
  } finally {
    database.close();
  }
});

test("cold open and full read baseline with 1k practices", () => {
  const database = new Database(":memory:");
  try {
    migrateDatabase(database);
    seedState(database, 1_000);

    const heapBefore = process.memoryUsage().heapUsed;
    const startedAt = performance.now();
    const snapshot = readEffectivePracticeSnapshot(database);
    const elapsedMs = performance.now() - startedAt;
    const heapDelta = process.memoryUsage().heapUsed - heapBefore;

    expect(snapshot.effectivePractices).toHaveLength(1_000);
    // First baseline: recorded, not asserted on a subjective threshold.
    console.log(
      `[baseline] 1k practices: materialize ${elapsedMs.toFixed(1)}ms, heap +${(heapDelta / 1024 / 1024).toFixed(1)}MiB`,
    );
  } finally {
    database.close();
  }
});

test("cold open and full read baseline with 5k practices", () => {
  const database = new Database(":memory:");
  try {
    migrateDatabase(database);
    seedState(database, 5_000);

    const heapBefore = process.memoryUsage().heapUsed;
    const startedAt = performance.now();
    const snapshot = readEffectivePracticeSnapshot(database);
    const elapsedMs = performance.now() - startedAt;
    const heapDelta = process.memoryUsage().heapUsed - heapBefore;

    expect(snapshot.effectivePractices).toHaveLength(5_000);
    // Regression guard: an N+1 reader issues one query per practice, which is
    // orders of magnitude slower than the single JOINed statement even on a
    // fast machine. The exact budget stays open; this only catches the shape
    // regression the baseline exists for.
    expect(elapsedMs).toBeLessThan(5_000);
    console.log(
      `[baseline] 5k practices: materialize ${elapsedMs.toFixed(1)}ms, heap +${(heapDelta / 1024 / 1024).toFixed(1)}MiB`,
    );
  } finally {
    database.close();
  }
});

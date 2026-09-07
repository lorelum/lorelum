import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { LOCAL_STORE_SCHEMA_VERSION, migrateDatabase } from "./migrations";
import { readPractice } from "./practice-reader";

test("point JOIN uses both existing indexes and one statement even when absent", () => {
  const database = new Database(":memory:");
  try {
    migrateDatabase(database);
    const prepared: string[] = [];
    const originalPrepare = database.prepare.bind(database);
    database.prepare = ((sql: string) => {
      prepared.push(sql);
      return originalPrepare(sql);
    }) as typeof database.prepare;
    expect(
      readPractice(
        database,
        {
          schemaVersion: LOCAL_STORE_SCHEMA_VERSION,
          generation: 0,
          effectiveRevision: 0,
        },
        "example.absent",
      ),
    ).toBeUndefined();
    expect(prepared).toHaveLength(1);
    const plan = database.query(`EXPLAIN QUERY PLAN ${prepared[0]}`).all("example.absent");
    const details = plan.map((row) => String((row as { detail: unknown }).detail));
    expect(details.some((detail) => /SEARCH e USING INDEX/.test(detail))).toBe(true);
    expect(
      details.some((detail) => /SEARCH s USING INDEX practice_sources_by_practice/.test(detail)),
    ).toBe(true);
    expect(details.some((detail) => /SCAN [es]\b/.test(detail))).toBe(false);
  } finally {
    database.close();
  }
});

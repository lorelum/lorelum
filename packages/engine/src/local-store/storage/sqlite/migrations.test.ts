import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";

import { LOCAL_STORE_SCHEMA_VERSION, migrateDatabase } from "./migrations";

test("migrations create the LocalStore-only schema and are idempotent", () => {
  const database = new Database(":memory:");
  try {
    migrateDatabase(database);
    migrateDatabase(database);

    expect(database.prepare("PRAGMA user_version").get()).toEqual({
      user_version: LOCAL_STORE_SCHEMA_VERSION,
    });
    expect(
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('local_store_metadata', 'active_packs', 'practice_sources', 'effective_practices') ORDER BY name",
        )
        .all()
        .map((row) => (row as { name: string }).name),
    ).toEqual(["active_packs", "effective_practices", "local_store_metadata", "practice_sources"]);
  } finally {
    database.close();
  }
});

test("migrations reject a database from a newer LocalStore schema", () => {
  const database = new Database(":memory:");
  try {
    database.exec("PRAGMA user_version = 2");
    expect(() => migrateDatabase(database)).toThrow("schema version is unsupported");
  } finally {
    database.close();
  }
});

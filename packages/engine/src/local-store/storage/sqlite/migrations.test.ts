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
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('local_store_metadata', 'active_packs', 'practice_sources', 'effective_practices', 'effective_revision_outbox', 'effective_revision_log') ORDER BY name",
        )
        .all()
        .map((row) => (row as { name: string }).name),
    ).toEqual([
      "active_packs",
      "effective_practices",
      "effective_revision_log",
      "effective_revision_outbox",
      "local_store_metadata",
      "practice_sources",
    ]);
  } finally {
    database.close();
  }
});

test("migrations reject a database from a newer LocalStore schema", () => {
  const database = new Database(":memory:");
  try {
    database.exec("PRAGMA user_version = " + (LOCAL_STORE_SCHEMA_VERSION + 1));
    expect(() => migrateDatabase(database)).toThrow("schema version is unsupported");
  } finally {
    database.close();
  }
});

test("migrations upgrade a v1 database with both revision queues", () => {
  const database = new Database(":memory:");
  try {
    database.exec(
      "CREATE TABLE local_store_metadata (singleton INTEGER PRIMARY KEY, schema_version INTEGER NOT NULL, installed_packs_generation INTEGER NOT NULL, effective_revision INTEGER NOT NULL); INSERT INTO local_store_metadata VALUES (1, 1, 7, 9)",
    );
    database.exec("PRAGMA user_version = 1");
    migrateDatabase(database);
    expect(
      database
        .query(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('effective_revision_outbox', 'effective_revision_log') ORDER BY name",
        )
        .all(),
    ).toEqual([{ name: "effective_revision_log" }, { name: "effective_revision_outbox" }]);
    expect(database.query("SELECT * FROM local_store_metadata").get()).toEqual({
      singleton: 1,
      schema_version: LOCAL_STORE_SCHEMA_VERSION,
      installed_packs_generation: 7,
      effective_revision: 9,
    });
  } finally {
    database.close();
  }
});

test("migrations upgrade a v2 database with the retained revision log", () => {
  const database = new Database(":memory:");
  try {
    database.exec(
      "CREATE TABLE local_store_metadata (singleton INTEGER PRIMARY KEY, schema_version INTEGER NOT NULL, installed_packs_generation INTEGER NOT NULL, effective_revision INTEGER NOT NULL); CREATE TABLE effective_revision_outbox (revision INTEGER PRIMARY KEY, delta_json TEXT NOT NULL, created_at TEXT NOT NULL); INSERT INTO local_store_metadata VALUES (1, 2, 7, 9)",
    );
    database.exec("PRAGMA user_version = 2");
    migrateDatabase(database);
    expect(
      database
        .query(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'effective_revision_log'",
        )
        .get(),
    ).toEqual({ name: "effective_revision_log" });
    expect(database.query("SELECT schema_version FROM local_store_metadata").get()).toEqual({
      schema_version: LOCAL_STORE_SCHEMA_VERSION,
    });
  } finally {
    database.close();
  }
});

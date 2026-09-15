import { expect, test } from "bun:test";

import {
  keywordIndexDatabaseDefinition,
  localStoreDatabaseDefinition,
  projectCacheDatabaseDefinition,
  projectKeywordIndexDatabaseDefinition,
  projectSemanticIndexDatabaseDefinition,
  semanticProgressIndexDatabaseDefinition,
  semanticIndexDatabaseDefinition,
  semanticVectorCacheDatabaseDefinition,
} from "../definitions";

import { openSqliteConnection } from "./connection";
import { migrateSqlite } from "./migrator";

test("Drizzle LocalStore init is versioned and idempotent", () => {
  const connection = openSqliteConnection(":memory:", localStoreDatabaseDefinition.schema);
  try {
    migrateSqlite(connection, localStoreDatabaseDefinition);
    migrateSqlite(connection, localStoreDatabaseDefinition);

    const tables = connection.client
      .query(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('__drizzle_migrations', 'local_store_metadata', 'active_packs', 'practice_sources', 'effective_practices', 'effective_revision_outbox', 'effective_revision_log') ORDER BY name",
      )
      .all()
      .map((row) => (row as { name: string }).name);

    expect(tables).toEqual([
      "__drizzle_migrations",
      "active_packs",
      "effective_practices",
      "effective_revision_log",
      "effective_revision_outbox",
      "local_store_metadata",
      "practice_sources",
    ]);
    expect(
      connection.client.query("SELECT COUNT(*) AS count FROM __drizzle_migrations").get(),
    ).toEqual({
      count: 1,
    });
  } finally {
    connection.close();
  }
});

test("Drizzle keyword init includes the owned FTS5 virtual table", () => {
  const connection = openSqliteConnection(":memory:", keywordIndexDatabaseDefinition.schema);
  try {
    migrateSqlite(connection, keywordIndexDatabaseDefinition);

    expect(
      connection.client
        .query("SELECT sql FROM sqlite_master WHERE name = 'keyword_documents'")
        .get(),
    ).toEqual({
      sql: "CREATE VIRTUAL TABLE keyword_documents USING fts5(\n  practice_id UNINDEXED,\n  content_digest UNINDEXED,\n  id,\n  title,\n  applies_when,\n  tech_stack,\n  stage,\n  anti_patterns,\n  body,\n  tokenize = 'unicode61 remove_diacritics 0'\n)",
    });
  } finally {
    connection.close();
  }
});

test("Drizzle semantic init creates the metadata and vector tables", () => {
  const connection = openSqliteConnection(":memory:", semanticIndexDatabaseDefinition.schema);
  try {
    migrateSqlite(connection, semanticIndexDatabaseDefinition);

    expect(
      connection.client
        .query(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('semantic_index_metadata', 'semantic_vectors') ORDER BY name",
        )
        .all(),
    ).toEqual([{ name: "semantic_index_metadata" }, { name: "semantic_vectors" }]);
  } finally {
    connection.close();
  }
});

test("ProjectContext keyword migrations include the owned FTS5 virtual table", () => {
  const connection = openSqliteConnection(":memory:", projectKeywordIndexDatabaseDefinition.schema);
  try {
    migrateSqlite(connection, projectKeywordIndexDatabaseDefinition);
    migrateSqlite(connection, projectKeywordIndexDatabaseDefinition);
    expect(
      connection.client
        .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'keyword_documents'")
        .get(),
    ).toEqual({ name: "keyword_documents" });
  } finally {
    connection.close();
  }
});

test.each([projectSemanticIndexDatabaseDefinition, semanticProgressIndexDatabaseDefinition])(
  "ProjectContext semantic migration definitions initialize idempotently",
  (definition) => {
    const connection = openSqliteConnection(":memory:", definition.schema);
    try {
      migrateSqlite(connection, definition);
      migrateSqlite(connection, definition);
      expect(
        connection.client.query("SELECT COUNT(*) AS count FROM __drizzle_migrations").get() as {
          readonly count: number;
        },
      ).toEqual({ count: 1 });
    } finally {
      connection.close();
    }
  },
);

test("Drizzle project cache init is versioned and idempotent", () => {
  const connection = openSqliteConnection(":memory:", projectCacheDatabaseDefinition.schema);
  try {
    migrateSqlite(connection, projectCacheDatabaseDefinition);
    migrateSqlite(connection, projectCacheDatabaseDefinition);
    expect(
      connection.client
        .query(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('project_context_artifacts', 'project_context_artifact_indexes') ORDER BY name",
        )
        .all(),
    ).toEqual([
      { name: "project_context_artifact_indexes" },
      { name: "project_context_artifacts" },
    ]);
    expect(
      connection.client.query("SELECT COUNT(*) AS count FROM __drizzle_migrations").get(),
    ).toEqual({ count: 1 });
  } finally {
    connection.close();
  }
});

test("Drizzle shared-vector cache init is versioned and idempotent", () => {
  const connection = openSqliteConnection(":memory:", semanticVectorCacheDatabaseDefinition.schema);
  try {
    migrateSqlite(connection, semanticVectorCacheDatabaseDefinition);
    migrateSqlite(connection, semanticVectorCacheDatabaseDefinition);
    expect(
      connection.client
        .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'embedding_vectors'")
        .all(),
    ).toEqual([{ name: "embedding_vectors" }]);
    expect(
      connection.client.query("SELECT COUNT(*) AS count FROM __drizzle_migrations").get(),
    ).toEqual({ count: 1 });
  } finally {
    connection.close();
  }
});

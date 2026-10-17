import { expect, test } from "bun:test";
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { semanticIndexMetadata, semanticVectors } from "../schemas/semantic-index";
import { embeddingVectors } from "../schemas/semantic-vector-cache";
import { isCompatibleMetadata, metadataFor } from "../../query/semantic/index/metadata";
import {
  readSemanticIndexMetadata,
  readSemanticIndexVectors,
} from "../../query/semantic/index/database";
import { createVectorExecution } from "../../query/semantic/profile";
import { resolveVectorRetrievalMethod } from "../../query/semantic/methods/catalog";

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

    // FTS5 MATCH is SQLite-specific; exercise tokenization rather than DDL text.
    connection.client
      .query(
        "INSERT INTO keyword_documents (practice_id, content_digest, id, title, applies_when, tech_stack, stage, anti_patterns, body) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run("example", "digest", "example", "SQLite indexing", "", "", "", "", "Canonical storage");
    expect(
      connection.client
        .query("SELECT practice_id FROM keyword_documents WHERE keyword_documents MATCH ?")
        .all("canonical"),
    ).toEqual([{ practice_id: "example" }]);
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
    expect(
      connection.client
        .query("PRAGMA table_info(semantic_vectors)")
        .all()
        .map((row) => (row as { readonly name: string }).name),
    ).toEqual([
      "practice_id",
      "input_key",
      "channel",
      "ordinal",
      "content_digest",
      "input_digest",
      "vector",
    ]);
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

test.each([
  semanticIndexDatabaseDefinition,
  projectSemanticIndexDatabaseDefinition,
  semanticProgressIndexDatabaseDefinition,
])("ProjectContext semantic migration definitions initialize idempotently", (definition) => {
  const connection = openSqliteConnection(":memory:", definition.schema);
  try {
    migrateSqlite(connection, definition);
    migrateSqlite(connection, definition);
    expect(
      connection.client.query("SELECT COUNT(*) AS count FROM __drizzle_migrations").get() as {
        readonly count: number;
      },
    ).toEqual({ count: 4 });
  } finally {
    connection.close();
  }
});

test("Drizzle project cache init is versioned and idempotent", () => {
  const connection = openSqliteConnection(":memory:", projectCacheDatabaseDefinition.schema);
  try {
    migrateSqlite(connection, projectCacheDatabaseDefinition);
    migrateSqlite(connection, projectCacheDatabaseDefinition);
    expect(
      connection.client
        .query(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('content_artifact_sources', 'project_context_artifacts', 'project_context_artifact_indexes') ORDER BY name",
        )
        .all(),
    ).toEqual([
      { name: "content_artifact_sources" },
      { name: "project_context_artifact_indexes" },
      { name: "project_context_artifacts" },
    ]);
    expect(
      connection.client.query("SELECT COUNT(*) AS count FROM __drizzle_migrations").get(),
    ).toEqual({ count: 2 });
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
    ).toEqual({ count: 2 });
  } finally {
    connection.close();
  }
});

const semanticDefinitions = [
  semanticIndexDatabaseDefinition,
  projectSemanticIndexDatabaseDefinition,
  semanticProgressIndexDatabaseDefinition,
];

const execution = createVectorExecution(
  { encodingId: "a".repeat(64), dimensions: 2 },
  resolveVectorRetrievalMethod("multi-view-vector"),
);

// Run the actual migration runner against a prefix of the checked-in journal,
// rather than reproducing historical DDL or inventing another migration runner.
async function withMigrationPrefix(
  definition: (typeof semanticDefinitions)[number] | typeof semanticVectorCacheDatabaseDefinition,
  count: number,
  run: (migrationsFolder: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "lorelum-migration-prefix-"));
  try {
    const journal = JSON.parse(
      await readFile(join(definition.migrationsFolder, "meta", "_journal.json"), "utf8"),
    ) as {
      entries: { tag: string }[];
    };
    const entries = journal.entries.slice(0, count);
    await mkdir(join(directory, "meta"));
    await writeFile(
      join(directory, "meta", "_journal.json"),
      JSON.stringify({ ...journal, entries }),
    );
    await Promise.all(
      entries.map(({ tag }) =>
        copyFile(join(definition.migrationsFolder, `${tag}.sql`), join(directory, `${tag}.sql`)),
      ),
    );
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test.each(semanticDefinitions)(
  "$id upgrades real legacy vector rows without changing their identities or falsely making metadata compatible",
  async (definition) => {
    await withMigrationPrefix(definition, 3, async (migrationsFolder) => {
      const connection = openSqliteConnection(":memory:", definition.schema);
      try {
        migrateSqlite(connection, { ...definition, migrationsFolder });
        const metadata = {
          ...metadataFor(
            {
              rootBinding: "legacy-root",
              generation: 7,
              effectiveRevision: 11,
              manifestDigest: "old-manifest",
            },
            execution.profile,
            2,
          ),
          indexVersion: 3,
        };
        connection.orm
          .insert(semanticIndexMetadata)
          .values({ singleton: 1, ...metadata })
          .run();
        const firstBlob = Buffer.from(new Float32Array([1, 0]).buffer);
        const secondBlob = Buffer.from(new Float32Array([0, 1]).buffer);
        // Historical column names have intentionally no current Drizzle mapping.
        const insertLegacy = connection.client.query(
          "INSERT INTO semantic_vectors (practice_id, view_id, view_kind, view_ordinal, content_digest, projection_digest, vector) VALUES (?, ?, ?, ?, ?, ?, ?)",
        );
        insertLegacy.run("a", "full:0000", "full", 0, "b".repeat(64), "c".repeat(64), firstBlob);
        insertLegacy.run("a", "body:0002", "body", 2, "b".repeat(64), "d".repeat(64), secondBlob);
        insertLegacy.run(
          "b",
          "task-card:0000",
          "task-card",
          0,
          "e".repeat(64),
          "f".repeat(64),
          firstBlob,
        );

        migrateSqlite(connection, definition);
        migrateSqlite(connection, definition);
        expect(connection.orm.select().from(semanticVectors).all()).toEqual([
          {
            practiceId: "a",
            inputKey: "full:0000",
            channel: "full",
            ordinal: 0,
            contentDigest: "b".repeat(64),
            inputDigest: "c".repeat(64),
            vector: firstBlob,
          },
          {
            practiceId: "a",
            inputKey: "body:0002",
            channel: "body",
            ordinal: 2,
            contentDigest: "b".repeat(64),
            inputDigest: "d".repeat(64),
            vector: secondBlob,
          },
          {
            practiceId: "b",
            inputKey: "task-card:0000",
            channel: "task-card",
            ordinal: 0,
            contentDigest: "e".repeat(64),
            inputDigest: "f".repeat(64),
            vector: firstBlob,
          },
        ]);
        expect(
          [...(readSemanticIndexVectors(connection, "a", 2) ?? [])]
            .sort((left, right) => left.ordinal - right.ordinal)
            .map((row) => ({
              inputKey: row.inputKey,
              channel: row.channel,
              ordinal: row.ordinal,
              inputDigest: row.inputDigest,
              embedding: [...row.embedding],
            })),
        ).toEqual([
          {
            inputKey: "full:0000",
            channel: "full",
            ordinal: 0,
            inputDigest: "c".repeat(64),
            embedding: [1, 0],
          },
          {
            inputKey: "body:0002",
            channel: "body",
            ordinal: 2,
            inputDigest: "d".repeat(64),
            embedding: [0, 1],
          },
        ]);
        const upgradedMetadata = readSemanticIndexMetadata(connection);
        expect(upgradedMetadata).toEqual(metadata);
        expect(
          isCompatibleMetadata(upgradedMetadata, execution.profile, metadata.rootBinding),
        ).toBe(false);
      } finally {
        connection.close();
      }
    });
  },
);

test.each(semanticDefinitions)(
  "$id supports method-neutral channels and enforces the Practice/input composite identity",
  (definition) => {
    const connection = openSqliteConnection(":memory:", definition.schema);
    try {
      migrateSqlite(connection, definition);
      const row = {
        practiceId: "a",
        inputKey: "custom:0000",
        channel: "future-method-channel",
        ordinal: 0,
        contentDigest: "b".repeat(64),
        inputDigest: "c".repeat(64),
        vector: Buffer.from(new Float32Array([1, 0]).buffer),
      };
      connection.orm.insert(semanticVectors).values(row).run();
      connection.orm
        .insert(semanticVectors)
        .values({ ...row, practiceId: "b" })
        .run();
      connection.orm
        .insert(semanticVectors)
        .values({ ...row, inputKey: "custom:0001", ordinal: 1 })
        .run();
      expect(connection.orm.select().from(semanticVectors).all()).toHaveLength(3);
      expect(() =>
        connection.orm
          .insert(semanticVectors)
          .values({ ...row, channel: "different" })
          .run(),
      ).toThrow();
      expect(() =>
        connection.orm
          .insert(semanticVectors)
          .values({ ...row, inputKey: "invalid-channel", channel: "" })
          .run(),
      ).toThrow();
      const metadata = metadataFor(
        {
          rootBinding: "current-root",
          generation: 1,
          effectiveRevision: 1,
          manifestDigest: "current-manifest",
        },
        execution.profile,
        2,
      );
      connection.orm
        .insert(semanticIndexMetadata)
        .values({ singleton: 1, ...metadata })
        .run();
      expect(
        isCompatibleMetadata(
          readSemanticIndexMetadata(connection),
          execution.profile,
          "current-root",
        ),
      ).toBe(true);
      expect(isCompatibleMetadata(metadata, execution.profile, "another-root")).toBe(false);
      const otherMethod = createVectorExecution(
        { encodingId: execution.profile.encodingId, dimensions: 2 },
        resolveVectorRetrievalMethod("single-vector"),
      );
      expect(isCompatibleMetadata(metadata, otherMethod.profile, "current-root")).toBe(false);
      expect(() =>
        connection.orm
          .insert(semanticVectors)
          .values({ ...row, inputKey: "invalid-ordinal", ordinal: -1 })
          .run(),
      ).toThrow();
    } finally {
      connection.close();
    }
  },
);

test("shared vector cache upgrades legacy digest keys and preserves vectors, profile isolation, and access times", async () => {
  const definition = semanticVectorCacheDatabaseDefinition;
  await withMigrationPrefix(definition, 1, async (migrationsFolder) => {
    const connection = openSqliteConnection(":memory:", definition.schema);
    try {
      migrateSqlite(connection, { ...definition, migrationsFolder });
      const blob = Buffer.from(new Float32Array([1, 0]).buffer);
      const createdAt = "2026-01-01T00:00:00.000Z";
      const lastAccessedAt = "2026-02-01T00:00:00.000Z";
      const digest = "b".repeat(64);
      // The removed projection_digest column only exists in the historical schema.
      const insertLegacy = connection.client.query(
        "INSERT INTO embedding_vectors (profile_id, projection_digest, encoding_id, dimensions, normalization, vector, created_at, last_accessed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      );
      for (const profileId of ["c".repeat(64), "d".repeat(64)]) {
        insertLegacy.run(
          profileId,
          digest,
          execution.profile.encodingId,
          2,
          "l2",
          blob,
          createdAt,
          lastAccessedAt,
        );
      }
      migrateSqlite(connection, definition);
      migrateSqlite(connection, definition);
      const rows = connection.orm.select().from(embeddingVectors).all();
      expect(rows).toEqual(
        ["c".repeat(64), "d".repeat(64)].map((profileId) => ({
          profileId,
          inputDigest: digest,
          encodingId: execution.profile.encodingId,
          dimensions: 2,
          normalization: "l2",
          vector: blob,
          createdAt,
          lastAccessedAt,
        })),
      );
      expect(() => connection.orm.insert(embeddingVectors).values(rows[0]!).run()).toThrow();
      connection.orm
        .insert(embeddingVectors)
        .values({ ...rows[0]!, inputDigest: "e".repeat(64) })
        .run();
      expect(connection.orm.select().from(embeddingVectors).all()).toHaveLength(3);
    } finally {
      connection.close();
    }
  });
});

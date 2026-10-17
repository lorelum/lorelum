import { expect, test } from "bun:test";
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { semanticIndexMetadata, semanticVectors } from "../schemas/semantic-index";
import { embeddingVectors } from "../schemas/semantic-vector-cache";
import { isCompatibleMetadata, metadataFor } from "../../query/semantic/index/metadata";
import { readSemanticIndexMetadata } from "../../query/semantic/index/database";
import { createVectorExecution } from "../../query/semantic/profile";
import { resolveVectorRetrievalMethod } from "../../query/semantic/methods/catalog";

import {
  keywordIndexDatabaseDefinition,
  projectKeywordIndexDatabaseDefinition,
  projectSemanticIndexDatabaseDefinition,
  semanticProgressIndexDatabaseDefinition,
  semanticIndexDatabaseDefinition,
  semanticVectorCacheDatabaseDefinition,
} from "../definitions";

import { openSqliteConnection } from "./connection";
import { migrateSqlite } from "./migrator";

test.each([keywordIndexDatabaseDefinition, projectKeywordIndexDatabaseDefinition])(
  "$id preserves searchable FTS content when migrations run again",
  (definition) => {
    const connection = openSqliteConnection(":memory:", definition.schema);
    try {
      migrateSqlite(connection, definition);
      // FTS5 MATCH is SQLite-specific; exercise tokenization rather than DDL text.
      connection.client
        .query(
          "INSERT INTO keyword_documents (practice_id, content_digest, id, title, applies_when, tech_stack, stage, anti_patterns, body) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          "example",
          "digest",
          "example",
          "SQLite indexing",
          "",
          "",
          "",
          "",
          "Canonical storage",
        );
      migrateSqlite(connection, definition);
      expect(
        connection.client
          .query("SELECT practice_id FROM keyword_documents WHERE keyword_documents MATCH ?")
          .all("canonical"),
      ).toEqual([{ practice_id: "example" }]);
    } finally {
      connection.close();
    }
  },
);

test.each([
  semanticIndexDatabaseDefinition,
  projectSemanticIndexDatabaseDefinition,
  semanticProgressIndexDatabaseDefinition,
])("$id does not replay destructive migrations over current vectors", (definition) => {
  const connection = openSqliteConnection(":memory:", definition.schema);
  try {
    migrateSqlite(connection, definition);
    const vector = {
      practiceId: "current",
      inputKey: "full:0000",
      channel: "full",
      ordinal: 0,
      contentDigest: "b".repeat(64),
      inputDigest: "c".repeat(64),
      vector: Buffer.from(new Float32Array([1, 0]).buffer),
    };
    connection.orm.insert(semanticVectors).values(vector).run();
    migrateSqlite(connection, definition);
    expect(connection.orm.select().from(semanticVectors).all()).toEqual([vector]);
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
  "$id discards incompatible main single-vector rows without making old metadata ready",
  async (definition) => {
    await withMigrationPrefix(definition, 1, async (migrationsFolder) => {
      const connection = openSqliteConnection(":memory:", definition.schema);
      try {
        migrateSqlite(connection, { ...definition, migrationsFolder });
        const metadata = {
          ...metadataFor(
            {
              rootBinding: "main-root",
              generation: 7,
              effectiveRevision: 11,
              manifestDigest: "old-manifest",
            },
            execution.profile,
            2,
          ),
          indexVersion: 2,
        };
        connection.orm
          .insert(semanticIndexMetadata)
          .values({ singleton: 1, ...metadata })
          .run();
        // main's single-vector columns have no mapping in the current Drizzle schema.
        const insertLegacy = connection.client.query(
          "INSERT INTO semantic_vectors (practice_id, content_digest, projection_digest, vector) VALUES (?, ?, ?, ?)",
        );
        insertLegacy.run(
          "a",
          "b".repeat(64),
          "c".repeat(64),
          Buffer.from(new Float32Array([1, 0]).buffer),
        );
        insertLegacy.run(
          "b",
          "d".repeat(64),
          "e".repeat(64),
          Buffer.from(new Float32Array([0, 1]).buffer),
        );

        migrateSqlite(connection, definition);
        migrateSqlite(connection, definition);
        expect(connection.orm.select().from(semanticVectors).all()).toEqual([]);
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

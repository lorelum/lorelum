import { expect, test } from "bun:test";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openSqliteConnection } from "../../../persistence/database/connection";
import { migrateSqlite } from "../../../persistence/database/migrator";
import {
  projectSemanticIndexDatabaseDefinition,
  semanticIndexDatabaseDefinition,
  semanticProgressIndexDatabaseDefinition,
} from "../../../persistence/definitions";
import {
  semanticIndexMetadata,
  semanticVectors,
} from "../../../persistence/schemas/semantic-index";
import {
  SemanticIndexIncompatibleError,
  SemanticIndexNotReadyError,
  SemanticIndexQueryError,
} from "../errors";
import { resolveVectorRetrievalMethod } from "../methods/catalog";
import { createVectorExecution } from "../profile";
import type { DocumentVector, PracticeVectorProjection } from "../representation";
import { initializeSemanticIndex } from "./database";
import { metadataFor } from "./metadata";
import type { SemanticIndexPaths } from "./paths";
import { openSemanticIndexReaderAt, type SemanticIndexReader } from "./reader";

const profile = createVectorExecution(
  { encodingId: "a".repeat(64), dimensions: 2 },
  resolveVectorRetrievalMethod("single-vector"),
).profile;

function document(practiceId: string, count = 1): PracticeVectorProjection {
  return {
    practiceId,
    contentDigest: "b".repeat(64),
    projectionDigest: "c".repeat(64),
    inputs: Array.from({ length: count }, (_, ordinal) => ({
      inputKey: `custom:${ordinal}`,
      channel: "opaque-custom-channel",
      ordinal,
      text: `${practiceId} input ${ordinal}`,
      inputDigest: String(ordinal + 1).padStart(64, "0"),
    })),
  };
}

async function withIndex(
  documents: readonly PracticeVectorProjection[],
  run: (paths: SemanticIndexPaths) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "lorelum-reader-"));
  const paths = {
    directory,
    active: join(directory, "active.sqlite"),
    writer: join(directory, "writer"),
  };
  try {
    const connection = openSqliteConnection(paths.active, semanticIndexDatabaseDefinition.schema);
    try {
      initializeSemanticIndex(
        connection,
        metadataFor(
          {
            rootBinding: directory,
            generation: 1,
            effectiveRevision: 2,
            manifestDigest: "manifest",
          },
          profile,
          documents.length,
        ),
        documents,
        documents.map((item) =>
          item.inputs.map((input) => Float32Array.from(input.ordinal % 2 === 0 ? [1, 0] : [0, 1])),
        ),
      );
    } finally {
      connection.close();
    }
    await run(paths);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function withReader(
  paths: SemanticIndexPaths,
  run: (reader: SemanticIndexReader) => void,
): Promise<void> {
  const reader = await openSemanticIndexReaderAt(paths, profile);
  try {
    run(reader);
  } finally {
    reader.close();
  }
}

test("groups actual SQLite inputs by Practice and delegates opaque vectors to the scorer", async () => {
  await withIndex([document("z", 2), document("a", 1)], async (paths) => {
    await withReader(paths, (reader) => {
      const calls: (readonly DocumentVector[])[] = [];
      const candidates = reader.search(
        {
          score(vectors) {
            calls.push(vectors);
            return vectors.length;
          },
        },
        new Set(),
      );
      expect(
        calls.map((vectors) =>
          vectors.map((vector) => ({
            inputKey: vector.inputKey,
            channel: vector.channel,
            ordinal: vector.ordinal,
            embedding: [...vector.embedding],
          })),
        ),
      ).toEqual([
        [{ inputKey: "custom:0", channel: "opaque-custom-channel", ordinal: 0, embedding: [1, 0] }],
        [
          { inputKey: "custom:0", channel: "opaque-custom-channel", ordinal: 0, embedding: [1, 0] },
          { inputKey: "custom:1", channel: "opaque-custom-channel", ordinal: 1, embedding: [0, 1] },
        ],
      ]);
      expect(candidates).toEqual([
        { practiceId: "z", contentDigest: "b".repeat(64), similarity: 2 },
        { practiceId: "a", contentDigest: "b".repeat(64), similarity: 1 },
      ]);
    });
  });
});

test("sorts all candidates by descending score then code-unit Practice ID without truncation", async () => {
  await withIndex(
    [document("z"), document("a"), document("Z"), document("top", 2)],
    async (paths) => {
      await withReader(paths, (reader) => {
        expect(
          reader
            .search({ score: (vectors) => vectors.length }, new Set())
            .map((row) => row.practiceId),
        ).toEqual(["top", "Z", "a", "z"]);
      });
    },
  );
});

test("excludes Practices before scoring and reports eligibility for each exclusion set", async () => {
  await withIndex([document("a"), document("b", 2)], async (paths) => {
    await withReader(paths, (reader) => {
      const calls: number[] = [];
      const scorer = {
        score(vectors: readonly DocumentVector[]) {
          calls.push(vectors.length);
          return -0.5;
        },
      };
      expect(reader.hasEligibleVectors(new Set(["a"]))).toBe(true);
      expect(reader.search(scorer, new Set(["a"]))).toEqual([
        { practiceId: "b", contentDigest: "b".repeat(64), similarity: -0.5 },
      ]);
      expect(calls).toEqual([2]);
      expect(reader.hasEligibleVectors(new Set(["a", "b"]))).toBe(false);
      expect(reader.search(scorer, new Set(["a", "b"]))).toEqual([]);
      expect(calls).toEqual([2]);
    });
  });
});

test("an empty SQLite index returns no candidates without invoking the scorer", async () => {
  await withIndex([], async (paths) => {
    await withReader(paths, (reader) => {
      expect(reader.hasEligibleVectors(new Set())).toBe(false);
      expect(
        reader.search(
          {
            score() {
              throw new Error("unexpected scoring");
            },
          },
          new Set(),
        ),
      ).toEqual([]);
    });
  });
});

test.each([NaN, Infinity, -Infinity])("rejects non-finite injected scores: %s", async (score) => {
  await withIndex([document("a")], async (paths) => {
    await withReader(paths, (reader) => {
      expect(() => reader.search({ score: () => score }, new Set())).toThrow(
        SemanticIndexQueryError,
      );
    });
  });
});

test("rejects grouped inputs that disagree on canonical content", async () => {
  await withIndex([document("a", 2)], async (paths) => {
    const connection = openSqliteConnection(paths.active, semanticIndexDatabaseDefinition.schema);
    try {
      const rows = connection.orm.select().from(semanticVectors).all();
      connection.orm.delete(semanticVectors).run();
      connection.orm
        .insert(semanticVectors)
        .values(rows.map((row, index) => ({ ...row, contentDigest: String(index + 3).repeat(64) })))
        .run();
    } finally {
      connection.close();
    }
    await withReader(paths, (reader) => {
      expect(() =>
        reader.search(
          {
            score() {
              throw new Error("unexpected scoring");
            },
          },
          new Set(),
        ),
      ).toThrow(SemanticIndexQueryError);
    });
  });
});

test("wraps connection failures after reader closure as query errors", async () => {
  await withIndex([document("a")], async (paths) => {
    const reader = await openSemanticIndexReaderAt(paths, profile);
    reader.close();
    expect(() => reader.hasEligibleVectors(new Set())).toThrow(SemanticIndexQueryError);
    expect(() => reader.search({ score: () => 1 }, new Set())).toThrow(SemanticIndexQueryError);
  });
});

test("distinguishes missing, corrupt, and incompatible artifacts", async () => {
  await withIndex([], async (paths) => {
    await expect(
      openSemanticIndexReaderAt(
        { ...paths, active: join(paths.directory, "missing.sqlite") },
        profile,
      ),
    ).rejects.toBeInstanceOf(SemanticIndexNotReadyError);
    const corrupt = join(paths.directory, "corrupt.sqlite");
    await writeFile(corrupt, "not a SQLite database");
    await expect(
      openSemanticIndexReaderAt({ ...paths, active: corrupt }, profile),
    ).rejects.toBeInstanceOf(SemanticIndexQueryError);
    const otherProfile = createVectorExecution(
      { encodingId: profile.encodingId, dimensions: 2 },
      resolveVectorRetrievalMethod("multi-view-vector"),
    ).profile;
    await expect(openSemanticIndexReaderAt(paths, otherProfile)).rejects.toBeInstanceOf(
      SemanticIndexIncompatibleError,
    );
    const connection = openSqliteConnection(paths.active, semanticIndexDatabaseDefinition.schema);
    try {
      connection.orm.update(semanticIndexMetadata).set({ indexVersion: 3 }).run();
    } finally {
      connection.close();
    }
    await expect(openSemanticIndexReaderAt(paths, profile)).rejects.toBeInstanceOf(
      SemanticIndexIncompatibleError,
    );
  });
});

test.each([
  semanticIndexDatabaseDefinition,
  projectSemanticIndexDatabaseDefinition,
  semanticProgressIndexDatabaseDefinition,
])(
  "$id rejects actual pre-input-column artifacts as incompatible before reading current vector columns",
  async (definition) => {
    const directory = await mkdtemp(join(tmpdir(), "lorelum-reader-legacy-"));
    const paths = {
      directory,
      active: join(directory, "active.sqlite"),
      writer: join(directory, "writer"),
    };
    const migrationsFolder = join(directory, "legacy-migrations");
    try {
      // The production migrator applies an actual checked-in historical journal
      // prefix; this fixture does not reproduce the old DDL or migration logic.
      const journal = JSON.parse(
        await readFile(join(definition.migrationsFolder, "meta", "_journal.json"), "utf8"),
      ) as {
        entries: { tag: string }[];
      };
      const entries = journal.entries.slice(0, 3);
      await mkdir(join(migrationsFolder, "meta"), { recursive: true });
      await writeFile(
        join(migrationsFolder, "meta", "_journal.json"),
        JSON.stringify({ ...journal, entries }),
      );
      await Promise.all(
        entries.map(({ tag }) =>
          copyFile(
            join(definition.migrationsFolder, `${tag}.sql`),
            join(migrationsFolder, `${tag}.sql`),
          ),
        ),
      );
      const connection = openSqliteConnection(paths.active, definition.schema);
      try {
        migrateSqlite(connection, { ...definition, migrationsFolder });
        connection.orm
          .insert(semanticIndexMetadata)
          .values({
            singleton: 1,
            ...metadataFor(
              {
                rootBinding: directory,
                generation: 1,
                effectiveRevision: 1,
                manifestDigest: "legacy-manifest",
              },
              profile,
              1,
            ),
            indexVersion: 3,
          })
          .run();
        // Historical column names intentionally have no current Drizzle mapping.
        connection.client
          .query(
            "INSERT INTO semantic_vectors (practice_id, view_id, view_kind, view_ordinal, content_digest, projection_digest, vector) VALUES (?, ?, ?, ?, ?, ?, ?)",
          )
          .run(
            "legacy",
            "full:0000",
            "full",
            0,
            "b".repeat(64),
            "c".repeat(64),
            Buffer.from(new Float32Array([1, 0]).buffer),
          );
      } finally {
        connection.close();
      }
      await expect(openSemanticIndexReaderAt(paths, profile, definition)).rejects.toBeInstanceOf(
        SemanticIndexIncompatibleError,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "../..");
const configs = [
  "packages/engine/drizzle.local-store.config.ts",
  "packages/engine/drizzle.keyword-index.config.ts",
  "packages/engine/drizzle.semantic-index.config.ts",
  "packages/engine/drizzle.project-cache.config.ts",
  "packages/engine/drizzle.semantic-vector-cache.config.ts",
  "packages/engine/drizzle.project-keyword-index.config.ts",
  "packages/engine/drizzle.project-semantic-index.config.ts",
  "packages/engine/drizzle.semantic-progress-index.config.ts",
] as const;

for (const config of configs) {
  const child = Bun.spawn(["bunx", "drizzle-kit", "generate", "--config", config], {
    cwd: repositoryRoot,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  // eslint-disable-next-line no-await-in-loop -- generation is serialized so shared package output stays deterministic.
  const exitCode = await child.exited;
  if (exitCode !== 0) process.exit(exitCode);
}
// Drizzle 0.31 table rebuilds use destination names in the source SELECT
// when columns are renamed alongside constraints. Repair only transitions
// whose previous snapshot still has the old names; later migrations already
// use the new source schema and must remain unchanged.
for (const kind of [
  "semantic-index",
  "project-semantic-index",
  "semantic-progress-index",
  "semantic-vector-cache",
]) {
  const directory = join(repositoryRoot, "packages/engine/src/persistence/migrations", kind);
  const files = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
  for (const file of files) {
    const sequence = Number(file.slice(0, 4));
    if (sequence === 0) continue;
    const priorPath = join(
      directory,
      "meta",
      `${String(sequence - 1).padStart(4, "0")}_snapshot.json`,
    );
    const previous = JSON.parse(await readFile(priorPath, "utf8")) as {
      tables: Record<string, { columns: Record<string, unknown> }>;
    };
    const path = join(directory, file);
    const generated = await readFile(path, "utf8");
    // SQLite rename validation cannot resolve the temporary table qualifier in
    // its own CHECK constraints. Unqualified columns preserve the same checks
    // before and after rename, including replay of existing generated history.
    let corrected = generated.replaceAll('"__new_semantic_vectors".', "");
    for (const [table, columns] of [
      [
        "semantic_vectors",
        [
          ["view_id", "input_key"],
          ["view_kind", "channel"],
          ["view_ordinal", "ordinal"],
          ["projection_digest", "input_digest"],
        ],
      ],
      ["embedding_vectors", [["projection_digest", "input_digest"]]],
    ] as const) {
      const priorColumns = previous.tables[table]?.columns;
      if (priorColumns === undefined) continue;
      corrected = corrected.replace(
        new RegExp(`SELECT ([^;]+) FROM \u0060${table}\u0060;`, "g"),
        (statement, selected: string) => {
          let source = selected;
          for (const [oldName, newName] of columns) {
            if (oldName in priorColumns && !(newName in priorColumns)) {
              source = source.replaceAll(`"${newName}"`, `"${oldName}"`);
            }
          }
          return statement.replace(selected, source);
        },
      );
    }
    if (corrected !== generated) await writeFile(path, corrected);
  }
}

// Drizzle does not model FTS5 virtual tables. The ProjectContext keyword
// artifact owns the same SQLite-specific FTS shape as the Store index, so
// keep that DDL in the one public migration generator rather than issuing it
// at runtime or requiring a second manual migration command.
const projectKeywordMigrations = join(
  repositoryRoot,
  "packages/engine/src/persistence/migrations/project-keyword-index",
);
const keywordFts = `
-- Custom SQLite FTS5 DDL. Drizzle schema owns only keyword_index_metadata.
CREATE VIRTUAL TABLE keyword_documents USING fts5(
  practice_id UNINDEXED,
  content_digest UNINDEXED,
  id,
  title,
  applies_when,
  tech_stack,
  stage,
  anti_patterns,
  body,
  tokenize = 'unicode61 remove_diacritics 0'
);
`;
const migrationFiles = (await readdir(projectKeywordMigrations))
  .filter((name) => name.endsWith(".sql"))
  .sort();
if (migrationFiles.length !== 1) {
  throw new Error("Project keyword FTS migration must have exactly one initial SQL file.");
}
const migration = join(projectKeywordMigrations, migrationFiles[0]!);
const sql = await readFile(migration, "utf8");
if (!sql.includes("CREATE VIRTUAL TABLE keyword_documents USING fts5")) {
  await writeFile(migration, `${sql}--> statement-breakpoint\n${keywordFts}`);
}

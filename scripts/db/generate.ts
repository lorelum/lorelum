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
  const process = Bun.spawn(["bunx", "drizzle-kit", "generate", "--config", config], {
    cwd: repositoryRoot,
    stdout: "inherit",
    stderr: "inherit",
  });
  // eslint-disable-next-line no-await-in-loop -- generation is serialized so shared package output stays deterministic.
  const exitCode = await process.exited;
  if (exitCode !== 0) process.exit(exitCode);
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

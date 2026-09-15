import { join } from "node:path";
import { fileURLToPath } from "node:url";

import * as keywordIndexSchema from "./schemas/keyword-index";
import * as localStoreSchema from "./schemas/local-store";
import * as projectCacheSchema from "./schemas/project-cache";
import * as semanticIndexSchema from "./schemas/semantic-index";
import * as semanticVectorCacheSchema from "./schemas/semantic-vector-cache";

export interface SqliteDatabaseDefinition<Schema extends Record<string, unknown>> {
  readonly id:
    | "local-store"
    | "keyword-index"
    | "semantic-index"
    | "project-cache"
    | "semantic-vector-cache"
    | "project-keyword-index"
    | "project-semantic-index"
    | "semantic-progress-index";
  readonly schema: Schema;
  readonly migrationsFolder: string;
}

function migrationFolder(name: string): string {
  if (Bun.isStandaloneExecutable) {
    return join(import.meta.dir, "migrations", name);
  }
  return fileURLToPath(new URL(`./migrations/${name}/`, import.meta.url));
}

export const localStoreDatabaseDefinition = {
  id: "local-store",
  schema: localStoreSchema,
  migrationsFolder: migrationFolder("local-store"),
} as const satisfies SqliteDatabaseDefinition<typeof localStoreSchema>;

export const keywordIndexDatabaseDefinition = {
  id: "keyword-index",
  schema: keywordIndexSchema,
  migrationsFolder: migrationFolder("keyword-index"),
} as const satisfies SqliteDatabaseDefinition<typeof keywordIndexSchema>;

export const semanticIndexDatabaseDefinition = {
  id: "semantic-index",
  schema: semanticIndexSchema,
  migrationsFolder: migrationFolder("semantic-index"),
} as const satisfies SqliteDatabaseDefinition<typeof semanticIndexSchema>;

export const projectCacheDatabaseDefinition = {
  id: "project-cache",
  schema: projectCacheSchema,
  migrationsFolder: migrationFolder("project-cache"),
} as const satisfies SqliteDatabaseDefinition<typeof projectCacheSchema>;

export const semanticVectorCacheDatabaseDefinition = {
  id: "semantic-vector-cache",
  schema: semanticVectorCacheSchema,
  migrationsFolder: migrationFolder("semantic-vector-cache"),
} as const satisfies SqliteDatabaseDefinition<typeof semanticVectorCacheSchema>;

/** Project artifacts deliberately use independent migration histories from Store-local indexes. */
export const projectKeywordIndexDatabaseDefinition = {
  id: "project-keyword-index",
  schema: keywordIndexSchema,
  migrationsFolder: migrationFolder("project-keyword-index"),
} as const satisfies SqliteDatabaseDefinition<typeof keywordIndexSchema>;

export const projectSemanticIndexDatabaseDefinition = {
  id: "project-semantic-index",
  schema: semanticIndexSchema,
  migrationsFolder: migrationFolder("project-semantic-index"),
} as const satisfies SqliteDatabaseDefinition<typeof semanticIndexSchema>;

/** A progress artifact is mutable, so it has a separate migration identity from complete artifacts. */
export const semanticProgressIndexDatabaseDefinition = {
  id: "semantic-progress-index",
  schema: semanticIndexSchema,
  migrationsFolder: migrationFolder("semantic-progress-index"),
} as const satisfies SqliteDatabaseDefinition<typeof semanticIndexSchema>;

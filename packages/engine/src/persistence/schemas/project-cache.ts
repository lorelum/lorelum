import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * This catalog is advisory, not a source of Practice content. It permits safe
 * inspection and cleanup of content-addressed files without retaining where a
 * user happened to keep a project or what its Practices said.
 */
export const projectContextArtifacts = sqliteTable(
  "project_context_artifacts",
  {
    artifactId: text("artifact_id").primaryKey(),
    kind: text("kind").notNull(),
    profileId: text("profile_id"),
    corpusDigest: text("corpus_digest").notNull(),
    documentCount: integer("document_count").notNull(),
    createdAt: text("created_at").notNull(),
    lastAccessedAt: text("last_accessed_at").notNull(),
  },
  (table) => [
    index("project_context_artifacts_by_access").on(table.lastAccessedAt),
    index("project_context_artifacts_by_kind").on(table.kind, table.profileId),
  ],
);

/** A catalog entry may describe the complete file and its in-progress sibling. */
export const projectContextArtifactIndexes = sqliteTable(
  "project_context_artifact_indexes",
  {
    artifactId: text("artifact_id")
      .notNull()
      .references(() => projectContextArtifacts.artifactId, { onDelete: "cascade" }),
    state: text("state").notNull(),
    relativePath: text("relative_path").notNull(),
    byteSize: integer("byte_size").notNull(),
    publishedAt: text("published_at").notNull(),
    verifiedAt: text("verified_at"),
  },
  (table) => [
    primaryKey({ columns: [table.artifactId, table.state] }),
    index("project_context_artifact_indexes_by_path").on(table.relativePath),
  ],
);

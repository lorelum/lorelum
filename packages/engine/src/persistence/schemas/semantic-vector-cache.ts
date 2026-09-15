import { index, integer, primaryKey, sqliteTable, text, blob } from "drizzle-orm/sqlite-core";

/**
 * User-level reusable embeddings. A row deliberately contains only the
 * semantic projection hash and validated vector material, never source paths
 * or canonical Practice content.
 */
export const embeddingVectors = sqliteTable(
  "embedding_vectors",
  {
    profileId: text("profile_id").notNull(),
    projectionDigest: text("projection_digest").notNull(),
    encodingId: text("encoding_id").notNull(),
    dimensions: integer("dimensions").notNull(),
    normalization: text("normalization").notNull(),
    vector: blob("vector", { mode: "buffer" }).notNull(),
    createdAt: text("created_at").notNull(),
    lastAccessedAt: text("last_accessed_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.profileId, table.projectionDigest] }),
    index("embedding_vectors_by_access").on(table.lastAccessedAt),
  ],
);

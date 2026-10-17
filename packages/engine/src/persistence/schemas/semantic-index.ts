import { sql } from "drizzle-orm";
import { blob, check, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const semanticIndexMetadata = sqliteTable(
  "semantic_index_metadata",
  {
    singleton: integer("singleton").primaryKey(),
    indexVersion: integer("index_version").notNull(),
    rootBinding: text("root_binding").notNull(),
    generation: integer("generation").notNull(),
    effectiveRevision: integer("effective_revision").notNull(),
    manifestDigest: text("manifest_digest").notNull(),
    profileId: text("profile_id").notNull(),
    encodingId: text("encoding_id").notNull(),
    dimensions: integer("dimensions").notNull(),
    documentProjectionVersion: integer("document_projection_version").notNull(),
    normalization: text("normalization").notNull(),
    vectorCount: integer("vector_count").notNull(),
  },
  (table) => [check("semantic_index_metadata_singleton", sql`${table.singleton} = 1`)],
);

export const semanticVectors = sqliteTable(
  "semantic_vectors",
  {
    practiceId: text("practice_id").notNull(),
    inputKey: text("input_key").notNull(),
    channel: text("channel").notNull(),
    ordinal: integer("ordinal").notNull(),
    contentDigest: text("content_digest").notNull(),
    inputDigest: text("input_digest").notNull(),
    vector: blob("vector", { mode: "buffer" }).notNull(),
  },
  (table) => [
    primaryKey({
      name: "semantic_vectors_practice_input_pk",
      columns: [table.practiceId, table.inputKey],
    }),
    check("semantic_vectors_channel", sql`length(${table.channel}) > 0`),
    check("semantic_vectors_ordinal", sql`${table.ordinal} >= 0`),
  ],
);

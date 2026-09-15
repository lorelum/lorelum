CREATE TABLE `keyword_index_metadata` (
	`singleton` integer PRIMARY KEY NOT NULL,
	`root_binding` text NOT NULL,
	`effective_revision` integer NOT NULL,
	CONSTRAINT "keyword_index_metadata_singleton" CHECK("keyword_index_metadata"."singleton" = 1)
);
--> statement-breakpoint

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

CREATE TABLE `semantic_index_metadata` (
	`singleton` integer PRIMARY KEY NOT NULL,
	`index_version` integer NOT NULL,
	`root_binding` text NOT NULL,
	`generation` integer NOT NULL,
	`effective_revision` integer NOT NULL,
	`manifest_digest` text NOT NULL,
	`profile_id` text NOT NULL,
	`encoding_id` text NOT NULL,
	`dimensions` integer NOT NULL,
	`document_projection_version` integer NOT NULL,
	`normalization` text NOT NULL,
	`vector_count` integer NOT NULL,
	CONSTRAINT "semantic_index_metadata_singleton" CHECK("semantic_index_metadata"."singleton" = 1)
);
--> statement-breakpoint
CREATE TABLE `semantic_vectors` (
	`practice_id` text PRIMARY KEY NOT NULL,
	`content_digest` text NOT NULL,
	`projection_digest` text NOT NULL,
	`vector` blob NOT NULL
);

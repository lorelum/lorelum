CREATE TABLE `embedding_vectors` (
	`profile_id` text NOT NULL,
	`projection_digest` text NOT NULL,
	`encoding_id` text NOT NULL,
	`dimensions` integer NOT NULL,
	`normalization` text NOT NULL,
	`vector` blob NOT NULL,
	`created_at` text NOT NULL,
	`last_accessed_at` text NOT NULL,
	PRIMARY KEY(`profile_id`, `projection_digest`)
);
--> statement-breakpoint
CREATE INDEX `embedding_vectors_by_access` ON `embedding_vectors` (`last_accessed_at`);
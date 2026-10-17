PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_embedding_vectors` (
	`profile_id` text NOT NULL,
	`input_digest` text NOT NULL,
	`encoding_id` text NOT NULL,
	`dimensions` integer NOT NULL,
	`normalization` text NOT NULL,
	`vector` blob NOT NULL,
	`created_at` text NOT NULL,
	`last_accessed_at` text NOT NULL,
	PRIMARY KEY(`profile_id`, `input_digest`)
);
--> statement-breakpoint
INSERT INTO `__new_embedding_vectors`("profile_id", "input_digest", "encoding_id", "dimensions", "normalization", "vector", "created_at", "last_accessed_at") SELECT "profile_id", "projection_digest", "encoding_id", "dimensions", "normalization", "vector", "created_at", "last_accessed_at" FROM `embedding_vectors`;--> statement-breakpoint
DROP TABLE `embedding_vectors`;--> statement-breakpoint
ALTER TABLE `__new_embedding_vectors` RENAME TO `embedding_vectors`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `embedding_vectors_by_access` ON `embedding_vectors` (`last_accessed_at`);
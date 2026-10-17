PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_semantic_vectors` (
	`practice_id` text NOT NULL,
	`view_id` text NOT NULL,
	`view_kind` text NOT NULL,
	`view_ordinal` integer NOT NULL,
	`content_digest` text NOT NULL,
	`projection_digest` text NOT NULL,
	`vector` blob NOT NULL,
	PRIMARY KEY(`practice_id`, `view_id`),
	CONSTRAINT "semantic_vectors_view_kind" CHECK("view_kind" IN ('full', 'task-card', 'body')),
	CONSTRAINT "semantic_vectors_view_ordinal" CHECK("view_ordinal" >= 0)
);
--> statement-breakpoint
DROP TABLE `semantic_vectors`;--> statement-breakpoint
ALTER TABLE `__new_semantic_vectors` RENAME TO `semantic_vectors`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
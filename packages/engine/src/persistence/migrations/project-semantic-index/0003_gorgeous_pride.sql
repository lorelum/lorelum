PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_semantic_vectors` (
	`practice_id` text NOT NULL,
	`input_key` text NOT NULL,
	`channel` text NOT NULL,
	`ordinal` integer NOT NULL,
	`content_digest` text NOT NULL,
	`input_digest` text NOT NULL,
	`vector` blob NOT NULL,
	PRIMARY KEY(`practice_id`, `input_key`),
	CONSTRAINT "semantic_vectors_channel" CHECK(length("channel") > 0),
	CONSTRAINT "semantic_vectors_ordinal" CHECK("ordinal" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_semantic_vectors`("practice_id", "input_key", "channel", "ordinal", "content_digest", "input_digest", "vector") SELECT "practice_id", "view_id", "view_kind", "view_ordinal", "content_digest", "projection_digest", "vector" FROM `semantic_vectors`;--> statement-breakpoint
DROP TABLE `semantic_vectors`;--> statement-breakpoint
ALTER TABLE `__new_semantic_vectors` RENAME TO `semantic_vectors`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
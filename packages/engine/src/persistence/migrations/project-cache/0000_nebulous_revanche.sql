CREATE TABLE `project_context_artifact_indexes` (
	`artifact_id` text NOT NULL,
	`state` text NOT NULL,
	`relative_path` text NOT NULL,
	`byte_size` integer NOT NULL,
	`published_at` text NOT NULL,
	`verified_at` text,
	PRIMARY KEY(`artifact_id`, `state`),
	FOREIGN KEY (`artifact_id`) REFERENCES `project_context_artifacts`(`artifact_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `project_context_artifact_indexes_by_path` ON `project_context_artifact_indexes` (`relative_path`);--> statement-breakpoint
CREATE TABLE `project_context_artifacts` (
	`artifact_id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`profile_id` text,
	`corpus_digest` text NOT NULL,
	`document_count` integer NOT NULL,
	`created_at` text NOT NULL,
	`last_accessed_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `project_context_artifacts_by_access` ON `project_context_artifacts` (`last_accessed_at`);--> statement-breakpoint
CREATE INDEX `project_context_artifacts_by_kind` ON `project_context_artifacts` (`kind`,`profile_id`);
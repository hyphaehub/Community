CREATE TABLE `log_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`batch_id` text,
	`body` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`batch_id`) REFERENCES `batches`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `log_entries_ws` ON `log_entries` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `log_entries_batch` ON `log_entries` (`batch_id`);--> statement-breakpoint
ALTER TABLE `photos` ADD `log_entry_id` text REFERENCES log_entries(id) ON DELETE cascade;
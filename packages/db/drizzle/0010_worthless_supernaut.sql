CREATE TABLE `environment_readings` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`batch_id` text,
	`culture_id` text,
	`recorded_at` integer NOT NULL,
	`temp_c` real,
	`humidity_pct` real,
	`co2_ppm` real,
	`note` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`batch_id`) REFERENCES `batches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`culture_id`) REFERENCES `cultures`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `env_ws` ON `environment_readings` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `env_batch` ON `environment_readings` (`batch_id`,`recorded_at`);--> statement-breakpoint
ALTER TABLE `cultures` ADD `contaminated_at` integer;--> statement-breakpoint
ALTER TABLE `cultures` ADD `contaminant_type` text;--> statement-breakpoint
ALTER TABLE `cultures` ADD `contamination_cause` text;
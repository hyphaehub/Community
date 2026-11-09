CREATE TABLE `installs` (
	`id` text PRIMARY KEY NOT NULL,
	`install_id` text NOT NULL,
	`version` text,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`ping_count` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `installs_install_id_unique` ON `installs` (`install_id`);
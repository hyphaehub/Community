CREATE TABLE `platform_settings` (
	`id` text PRIMARY KEY DEFAULT 'platform' NOT NULL,
	`feature_defaults` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `workspaces` ADD `features` text;
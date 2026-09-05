CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `batches` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`strain_id` text,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`goal_dry_weight_g` real,
	`started_at` integer,
	`completed_at` integer,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`strain_id`) REFERENCES `strains`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `batches_ws` ON `batches` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `batches_status` ON `batches` (`status`);--> statement-breakpoint
CREATE TABLE `cost_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`batch_id` text,
	`culture_id` text,
	`inventory_item_id` text,
	`description` text NOT NULL,
	`category` text DEFAULT 'MATERIALS' NOT NULL,
	`amount_cents` integer NOT NULL,
	`quantity` real,
	`occurred_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`batch_id`) REFERENCES `batches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`culture_id`) REFERENCES `cultures`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`inventory_item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `costs_ws` ON `cost_entries` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `costs_batch` ON `cost_entries` (`batch_id`);--> statement-breakpoint
CREATE TABLE `cultures` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`batch_id` text,
	`strain_id` text,
	`type` text NOT NULL,
	`label` text NOT NULL,
	`status` text DEFAULT 'PREPPING' NOT NULL,
	`source_type` text,
	`container_type` text,
	`substrate_type` text,
	`quantity` real,
	`quantity_unit` text,
	`dry_substrate_g` real,
	`vendor_source` text,
	`colonization_pct` real,
	`inoculated_at` integer,
	`colonized_at` integer,
	`fruiting_started_at` integer,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`batch_id`) REFERENCES `batches`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`strain_id`) REFERENCES `strains`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `cultures_ws` ON `cultures` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `cultures_batch` ON `cultures` (`batch_id`);--> statement-breakpoint
CREATE INDEX `cultures_type` ON `cultures` (`type`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`culture_id` text NOT NULL,
	`batch_id` text,
	`type` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`note` text,
	`data` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`culture_id`) REFERENCES `cultures`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`batch_id`) REFERENCES `batches`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `events_culture` ON `events` (`culture_id`);--> statement-breakpoint
CREATE INDEX `events_ws` ON `events` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `harvests` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`culture_id` text NOT NULL,
	`batch_id` text,
	`flush_number` integer DEFAULT 1 NOT NULL,
	`wet_weight_g` real NOT NULL,
	`dry_weight_g` real,
	`harvested_at` integer,
	`dried_at` integer,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`culture_id`) REFERENCES `cultures`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`batch_id`) REFERENCES `batches`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `harvests_culture` ON `harvests` (`culture_id`);--> statement-breakpoint
CREATE INDEX `harvests_batch` ON `harvests` (`batch_id`);--> statement-breakpoint
CREATE TABLE `inventory_items` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`category` text DEFAULT 'OTHER' NOT NULL,
	`unit` text DEFAULT 'unit' NOT NULL,
	`unit_cost_cents` integer DEFAULT 0 NOT NULL,
	`quantity_on_hand` real DEFAULT 0 NOT NULL,
	`supplier` text,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `inventory_ws` ON `inventory_items` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `lineage` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`parent_culture_id` text NOT NULL,
	`child_culture_id` text NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_culture_id`) REFERENCES `cultures`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`child_culture_id`) REFERENCES `cultures`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `lineage_parent` ON `lineage` (`parent_culture_id`);--> statement-breakpoint
CREATE INDEX `lineage_child` ON `lineage` (`child_culture_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `lineage_edge` ON `lineage` (`parent_culture_id`,`child_culture_id`);--> statement-breakpoint
CREATE TABLE `memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'MEMBER' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `memberships_ws_user` ON `memberships` (`workspace_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `photos` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`culture_id` text,
	`event_id` text,
	`harvest_id` text,
	`key` text NOT NULL,
	`caption` text,
	`content_type` text,
	`size_bytes` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`culture_id`) REFERENCES `cultures`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`harvest_id`) REFERENCES `harvests`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `photos_ws` ON `photos` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `photos_culture` ON `photos` (`culture_id`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE TABLE `strains` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text,
	`common_name` text NOT NULL,
	`species` text,
	`category` text DEFAULT 'GOURMET' NOT NULL,
	`vendor` text,
	`optimal_temp_min_c` real,
	`optimal_temp_max_c` real,
	`is_preset` integer DEFAULT false NOT NULL,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `strains_ws` ON `strains` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`plan` text DEFAULT 'FREE' NOT NULL,
	`stripe_customer_id` text,
	`stripe_subscription_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);

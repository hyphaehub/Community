CREATE TABLE `buyer_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`buyer_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`purpose` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`buyer_id`) REFERENCES `buyers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `buyer_tokens_hash` ON `buyer_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `buyer_tokens_buyer` ON `buyer_tokens` (`buyer_id`);--> statement-breakpoint
CREATE TABLE `buyers` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`email` text NOT NULL,
	`name` text,
	`status` text DEFAULT 'INVITED' NOT NULL,
	`last_seen_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `buyers_ws` ON `buyers` (`workspace_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `buyers_ws_email` ON `buyers` (`workspace_id`,`email`);--> statement-breakpoint
CREATE TABLE `dibs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`buyer_id` text NOT NULL,
	`listing_id` text,
	`batch_id` text,
	`requested_qty_g` real,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`buyer_id`) REFERENCES `buyers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`listing_id`) REFERENCES `listings`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`batch_id`) REFERENCES `batches`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `dibs_ws` ON `dibs` (`workspace_id`,`status`);--> statement-breakpoint
CREATE INDEX `dibs_buyer` ON `dibs` (`buyer_id`);--> statement-breakpoint
CREATE INDEX `dibs_listing` ON `dibs` (`listing_id`);--> statement-breakpoint
CREATE TABLE `listings` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`harvest_id` text,
	`batch_id` text,
	`strain_id` text,
	`title` text NOT NULL,
	`form` text DEFAULT 'FRESH' NOT NULL,
	`quantity_g` real DEFAULT 0 NOT NULL,
	`price_per_kg_cents` integer,
	`available_at` integer,
	`status` text DEFAULT 'AVAILABLE' NOT NULL,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`harvest_id`) REFERENCES `harvests`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`batch_id`) REFERENCES `batches`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`strain_id`) REFERENCES `strains`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `listings_ws` ON `listings` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `listings_status` ON `listings` (`status`);--> statement-breakpoint
ALTER TABLE `workspaces` ADD `storefront_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `storefront_show_forecast` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `storefront_forecast_days` integer DEFAULT 21 NOT NULL;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `storefront_blurb` text;
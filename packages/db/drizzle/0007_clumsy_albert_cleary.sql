CREATE TABLE `inventory_adjustments` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`inventory_item_id` text NOT NULL,
	`delta` real NOT NULL,
	`balance_after` real NOT NULL,
	`kind` text DEFAULT 'CORRECTION' NOT NULL,
	`reason` text,
	`note` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`inventory_item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `inv_adj_ws` ON `inventory_adjustments` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `inv_adj_item` ON `inventory_adjustments` (`inventory_item_id`);
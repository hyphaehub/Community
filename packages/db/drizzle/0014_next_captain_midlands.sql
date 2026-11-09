CREATE TABLE `strain_votes` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`buyer_id` text NOT NULL,
	`strain_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`buyer_id`) REFERENCES `buyers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`strain_id`) REFERENCES `strains`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `strain_votes_ws_strain` ON `strain_votes` (`workspace_id`,`strain_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `strain_votes_buyer_strain` ON `strain_votes` (`workspace_id`,`buyer_id`,`strain_id`);
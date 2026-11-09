CREATE TABLE `connect_links` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`server_url` text NOT NULL,
	`label` text,
	`last_seen_at` integer NOT NULL,
	`last_verified_at` integer,
	`last_status` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `connect_links_user` ON `connect_links` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `connect_links_user_server` ON `connect_links` (`user_id`,`server_url`);
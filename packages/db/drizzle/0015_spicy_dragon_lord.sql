CREATE TABLE `waitlist_signups` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text,
	`source` text,
	`referrer` text,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `waitlist_email` ON `waitlist_signups` (`email`);
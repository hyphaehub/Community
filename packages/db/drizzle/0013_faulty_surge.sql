ALTER TABLE `cultures` ADD `library_format` text;--> statement-breakpoint
ALTER TABLE `cultures` ADD `storage_method` text;--> statement-breakpoint
ALTER TABLE `cultures` ADD `storage_location` text;--> statement-breakpoint
ALTER TABLE `cultures` ADD `stored_at` integer;--> statement-breakpoint
ALTER TABLE `cultures` ADD `last_revived_at` integer;--> statement-breakpoint
ALTER TABLE `strains` ADD `source_form` text;--> statement-breakpoint
ALTER TABLE `strains` ADD `acquired_at` integer;--> statement-breakpoint
ALTER TABLE `strains` ADD `vendor_strain_name` text;--> statement-breakpoint
ALTER TABLE `strains` ADD `sequencing_note` text;
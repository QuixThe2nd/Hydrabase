DROP TABLE `votes`;--> statement-breakpoint
ALTER TABLE `albums` ADD `address` text NOT NULL;--> statement-breakpoint
ALTER TABLE `albums` ADD `confidence` integer;--> statement-breakpoint
ALTER TABLE `artists` ADD `address` text NOT NULL;--> statement-breakpoint
ALTER TABLE `artists` ADD `confidence` integer;--> statement-breakpoint
ALTER TABLE `tracks` ADD `address` text NOT NULL;--> statement-breakpoint
ALTER TABLE `tracks` ADD `confidence` integer;
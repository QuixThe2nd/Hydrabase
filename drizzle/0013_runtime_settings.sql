CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	`value` text NOT NULL
);
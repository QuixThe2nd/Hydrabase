CREATE TABLE `albums` (
	`id` text NOT NULL,
	`plugin_id` text NOT NULL,
	`name` text,
	`artists` text,
	`release_date` text,
	`total_tracks` integer,
	`album_type` text,
	`image_url` text,
	`external_urls` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_plugin_album` ON `albums` (`plugin_id`,`id`);--> statement-breakpoint
CREATE TABLE `artists` (
	`id` text NOT NULL,
	`plugin_id` text NOT NULL,
	`name` text NOT NULL,
	`popularity` integer NOT NULL,
	`genres` text NOT NULL,
	`followers` integer NOT NULL,
	`external_urls` text NOT NULL,
	`image_url` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_plugin_artist` ON `artists` (`plugin_id`,`id`);--> statement-breakpoint
CREATE TABLE `tracks` (
	`id` text NOT NULL,
	`plugin_id` text NOT NULL,
	`name` text NOT NULL,
	`artists` text NOT NULL,
	`album` text NOT NULL,
	`duration_ms` integer NOT NULL,
	`popularity` integer NOT NULL,
	`preview_url` text NOT NULL,
	`external_urls` text NOT NULL,
	`image_url` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_plugin_track` ON `tracks` (`plugin_id`,`id`);--> statement-breakpoint
CREATE TABLE `votes` (
	`type` text NOT NULL,
	`id` text NOT NULL,
	`plugin_id` text NOT NULL,
	`address` text NOT NULL,
	`confidence` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_vote` ON `votes` (`type`,`plugin_id`,`id`,`address`);
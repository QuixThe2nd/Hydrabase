PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_albums` (
	`id` text NOT NULL,
	`plugin_id` text NOT NULL,
	`name` text,
	`artists` text,
	`release_date` text,
	`total_tracks` integer,
	`album_type` text,
	`image_url` text,
	`external_urls` text,
	`address` text NOT NULL,
	`confidence` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_albums`("id", "plugin_id", "name", "artists", "release_date", "total_tracks", "album_type", "image_url", "external_urls", "address", "confidence") SELECT "id", "plugin_id", "name", "artists", "release_date", "total_tracks", "album_type", "image_url", "external_urls", "address", "confidence" FROM `albums`;--> statement-breakpoint
DROP TABLE `albums`;--> statement-breakpoint
ALTER TABLE `__new_albums` RENAME TO `albums`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_plugin_album` ON `albums` (`plugin_id`,`id`);--> statement-breakpoint
CREATE TABLE `__new_artists` (
	`id` text NOT NULL,
	`plugin_id` text NOT NULL,
	`name` text NOT NULL,
	`popularity` integer NOT NULL,
	`genres` text NOT NULL,
	`followers` integer NOT NULL,
	`external_urls` text NOT NULL,
	`image_url` text NOT NULL,
	`address` text NOT NULL,
	`confidence` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_artists`("id", "plugin_id", "name", "popularity", "genres", "followers", "external_urls", "image_url", "address", "confidence") SELECT "id", "plugin_id", "name", "popularity", "genres", "followers", "external_urls", "image_url", "address", "confidence" FROM `artists`;--> statement-breakpoint
DROP TABLE `artists`;--> statement-breakpoint
ALTER TABLE `__new_artists` RENAME TO `artists`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_plugin_artist` ON `artists` (`plugin_id`,`id`);--> statement-breakpoint
CREATE TABLE `__new_tracks` (
	`id` text NOT NULL,
	`plugin_id` text NOT NULL,
	`name` text NOT NULL,
	`artists` text NOT NULL,
	`album` text NOT NULL,
	`duration_ms` integer NOT NULL,
	`popularity` integer NOT NULL,
	`preview_url` text NOT NULL,
	`external_urls` text NOT NULL,
	`image_url` text NOT NULL,
	`address` text NOT NULL,
	`confidence` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_tracks`("id", "plugin_id", "name", "artists", "album", "duration_ms", "popularity", "preview_url", "external_urls", "image_url", "address", "confidence") SELECT "id", "plugin_id", "name", "artists", "album", "duration_ms", "popularity", "preview_url", "external_urls", "image_url", "address", "confidence" FROM `tracks`;--> statement-breakpoint
DROP TABLE `tracks`;--> statement-breakpoint
ALTER TABLE `__new_tracks` RENAME TO `tracks`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_plugin_track` ON `tracks` (`plugin_id`,`id`);
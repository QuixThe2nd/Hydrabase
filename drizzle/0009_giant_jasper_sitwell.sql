CREATE TABLE `search_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`query` text NOT NULL,
	`result_count` integer NOT NULL,
	`timestamp` integer NOT NULL,
	`type` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `soul` (
	`address` text NOT NULL,
	`idA` text NOT NULL,
	`idB` text NOT NULL,
	`plugin_idA` text NOT NULL,
	`plugin_idB` text NOT NULL,
	`soul_id` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_soul` ON `soul` (`plugin_idA`,`plugin_idB`,`address`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_albums` (
	`address` text NOT NULL,
	`album_type` text,
	`artist_id` text,
	`artists` text,
	`confidence` real NOT NULL,
	`external_urls` text,
	`id` text NOT NULL,
	`image_url` text,
	`name` text,
	`plugin_id` text NOT NULL,
	`release_date` text,
	`soul_id` text NOT NULL,
	`total_tracks` integer
);
--> statement-breakpoint
INSERT INTO `__new_albums`("address", "album_type", "artist_id", "artists", "confidence", "external_urls", "id", "image_url", "name", "plugin_id", "release_date", "soul_id", "total_tracks") SELECT "address", "album_type", "artist_id", "artists", "confidence", "external_urls", "id", "image_url", "name", "plugin_id", "release_date", "soul_id", "total_tracks" FROM `albums`;--> statement-breakpoint
DROP TABLE `albums`;--> statement-breakpoint
ALTER TABLE `__new_albums` RENAME TO `albums`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_plugin_album` ON `albums` (`plugin_id`,`id`,`address`);--> statement-breakpoint
CREATE TABLE `__new_artists` (
	`address` text NOT NULL,
	`confidence` real NOT NULL,
	`external_urls` text NOT NULL,
	`followers` integer NOT NULL,
	`genres` text NOT NULL,
	`id` text NOT NULL,
	`image_url` text NOT NULL,
	`name` text NOT NULL,
	`plugin_id` text NOT NULL,
	`popularity` integer NOT NULL,
	`soul_id` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_artists`("address", "confidence", "external_urls", "followers", "genres", "id", "image_url", "name", "plugin_id", "popularity", "soul_id") SELECT "address", "confidence", "external_urls", "followers", "genres", "id", "image_url", "name", "plugin_id", "popularity", "soul_id" FROM `artists`;--> statement-breakpoint
DROP TABLE `artists`;--> statement-breakpoint
ALTER TABLE `__new_artists` RENAME TO `artists`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_plugin_artist` ON `artists` (`plugin_id`,`id`,`address`);--> statement-breakpoint
CREATE TABLE `__new_tracks` (
	`address` text NOT NULL,
	`album` text NOT NULL,
	`artist_id` text,
	`artists` text NOT NULL,
	`confidence` real NOT NULL,
	`duration_ms` integer NOT NULL,
	`external_urls` text NOT NULL,
	`id` text NOT NULL,
	`image_url` text NOT NULL,
	`name` text NOT NULL,
	`plugin_id` text NOT NULL,
	`popularity` integer NOT NULL,
	`preview_url` text NOT NULL,
	`soul_id` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_tracks`("address", "album", "artist_id", "artists", "confidence", "duration_ms", "external_urls", "id", "image_url", "name", "plugin_id", "popularity", "preview_url", "soul_id") SELECT "address", "album", "artist_id", "artists", "confidence", "duration_ms", "external_urls", "id", "image_url", "name", "plugin_id", "popularity", "preview_url", "soul_id" FROM `tracks`;--> statement-breakpoint
DROP TABLE `tracks`;--> statement-breakpoint
ALTER TABLE `__new_tracks` RENAME TO `tracks`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_plugin_track` ON `tracks` (`plugin_id`,`id`,`address`);
DROP INDEX `idx_plugin_album`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_plugin_album` ON `albums` (`plugin_id`,`id`,`address`);--> statement-breakpoint
DROP INDEX `idx_plugin_artist`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_plugin_artist` ON `artists` (`plugin_id`,`id`,`address`);--> statement-breakpoint
DROP INDEX `idx_plugin_track`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_plugin_track` ON `tracks` (`plugin_id`,`id`,`address`);
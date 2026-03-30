CREATE TABLE `announced_peers` (
	`announced_address` text NOT NULL,
	`announcer_address` text NOT NULL,
	`timestamp` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_announcer_announced` on `announced_peers` (`announcer_address`,`announced_address`);

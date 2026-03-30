CREATE TABLE `authenticated_peers` (
	`address` text NOT NULL,
	`bio` text,
	`hostname` text PRIMARY KEY NOT NULL,
	`signature` text,
	`user_agent` text NOT NULL,
	`username` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `dht_nodes` (
	`host` text NOT NULL,
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`port` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_dht_node` ON `dht_nodes` (`host`,`port`);--> statement-breakpoint
CREATE TABLE `ws_servers` (
	`hostname` text PRIMARY KEY NOT NULL
);
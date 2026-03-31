CREATE TABLE `peer_stats` (
	`address` text PRIMARY KEY NOT NULL,
	`lifetime_ul` integer DEFAULT 0 NOT NULL,
	`lifetime_dl` integer DEFAULT 0 NOT NULL
);

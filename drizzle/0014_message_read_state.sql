CREATE TABLE `message_read_state` (
	`conversation_address` text NOT NULL,
	`last_read_timestamp` integer NOT NULL,
	`reader_address` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_message_read_state` ON `message_read_state` (`reader_address`,`conversation_address`);
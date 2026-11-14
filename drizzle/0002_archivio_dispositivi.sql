CREATE TABLE `device_status` (
	`device_id` text PRIMARY KEY NOT NULL,
	`last_seen_at` text NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `devices` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`line` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text NOT NULL,
	`revoked_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `devices_token_hash_unique` ON `devices` (`token_hash`);--> statement-breakpoint
CREATE TABLE `workspace_archive` (
	`workspace_id` text NOT NULL,
	`kind` text NOT NULL,
	`id` text NOT NULL,
	`day` text NOT NULL,
	`ref` text DEFAULT '' NOT NULL,
	`search` text DEFAULT '' NOT NULL,
	`payload` text NOT NULL,
	`archived_version` integer NOT NULL,
	PRIMARY KEY(`workspace_id`, `kind`, `id`)
);
--> statement-breakpoint
CREATE INDEX `workspace_archive_day` ON `workspace_archive` (`workspace_id`,`kind`,`day`,`id`);--> statement-breakpoint
CREATE INDEX `workspace_archive_ref` ON `workspace_archive` (`workspace_id`,`kind`,`ref`);--> statement-breakpoint
CREATE TABLE `workspace_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`at` text NOT NULL,
	`action` text NOT NULL,
	`detail` text NOT NULL,
	`actor` text,
	`moves` text,
	`version` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `workspace_audit_time` ON `workspace_audit` (`workspace_id`,`at`,`id`);--> statement-breakpoint
CREATE TABLE `workspace_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`version` integer NOT NULL,
	`reason` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `workspaces` ADD `last_request_id` text;
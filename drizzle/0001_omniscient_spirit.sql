CREATE TABLE `workspace_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`digest` text NOT NULL,
	`version` integer NOT NULL,
	`created_at` text NOT NULL
);

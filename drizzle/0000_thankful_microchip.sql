CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`request_ids` text DEFAULT '[]' NOT NULL,
	`updated_at` text NOT NULL
);

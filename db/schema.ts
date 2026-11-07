import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
// A bounded pilot workspace is committed atomically using a version lease.
// Operational records never belong in schema or migrations.
export const workspaces = sqliteTable('workspaces', {
 id: text('id').primaryKey(),
 payload: text('payload').notNull(),
 version: integer('version').notNull().default(0),
 requestIds: text('request_ids').notNull().default('[]'),
 updatedAt: text('updated_at').notNull(),
});

// Durable receipts make retries idempotent even after long offline intervals.
export const workspaceRequests = sqliteTable('workspace_requests', {
 id: text('id').primaryKey(),
 workspaceId: text('workspace_id').notNull(),
 digest: text('digest').notNull(),
 version: integer('version').notNull(),
 createdAt: text('created_at').notNull(),
});

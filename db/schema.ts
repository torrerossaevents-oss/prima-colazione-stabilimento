import { index, integer, sqliteTable, text, primaryKey } from 'drizzle-orm/sqlite-core';
// The hot workspace (daily working set) is committed atomically using a version lease.
// Operational records never belong in schema or migrations.
export const workspaces = sqliteTable('workspaces', {
 id: text('id').primaryKey(),
 payload: text('payload').notNull(),
 version: integer('version').notNull().default(0),
 requestIds: text('request_ids').notNull().default('[]'),
 updatedAt: text('updated_at').notNull(),
 // Request that produced the current version: side tables are written only when it matches.
 lastRequestId: text('last_request_id'),
});

// Durable receipts make retries idempotent even after long offline intervals.
export const workspaceRequests = sqliteTable('workspace_requests', {
 id: text('id').primaryKey(),
 workspaceId: text('workspace_id').notNull(),
 digest: text('digest').notNull(),
 version: integer('version').notNull(),
 createdAt: text('created_at').notNull(),
});

// Append-only activity log, paginated by time. Written in the same batch as the state.
export const workspaceAudit = sqliteTable('workspace_audit', {
 id: text('id').primaryKey(),
 workspaceId: text('workspace_id').notNull(),
 at: text('at').notNull(),
 action: text('action').notNull(),
 detail: text('detail').notNull(),
 actor: text('actor'),
 moves: text('moves'),
 version: integer('version').notNull(),
}, table => [index('workspace_audit_time').on(table.workspaceId, table.at, table.id)]);

// Closed orders/sessions and empty lots, moved out of the hot state without changes.
export const workspaceArchive = sqliteTable('workspace_archive', {
 workspaceId: text('workspace_id').notNull(),
 kind: text('kind').notNull(),
 id: text('id').notNull(),
 day: text('day').notNull(),
 ref: text('ref').notNull().default(''),
 search: text('search').notNull().default(''),
 payload: text('payload').notNull(),
 archivedVersion: integer('archived_version').notNull(),
}, table => [
 primaryKey({ columns: [table.workspaceId, table.kind, table.id] }),
 index('workspace_archive_day').on(table.workspaceId, table.kind, table.day, table.id),
 index('workspace_archive_ref').on(table.workspaceId, table.kind, table.ref),
]);

// Copy of a stored state taken before an automatic data move (recovery point).
export const workspaceSnapshots = sqliteTable('workspace_snapshots', {
 id: text('id').primaryKey(),
 workspaceId: text('workspace_id').notNull(),
 version: integer('version').notNull(),
 reason: text('reason').notNull(),
 payload: text('payload').notNull(),
 createdAt: text('created_at').notNull(),
});

// Dedicated, revocable device credentials (only the SHA-256 of the token is stored).
export const devices = sqliteTable('devices', {
 id: text('id').primaryKey(),
 workspaceId: text('workspace_id').notNull(),
 name: text('name').notNull(),
 line: text('line').notNull(),
 tokenHash: text('token_hash').notNull().unique(),
 createdAt: text('created_at').notNull(),
 createdBy: text('created_by').notNull(),
 revokedAt: text('revoked_at'),
});

// Last heartbeat of each device; not part of the operational state.
export const deviceStatus = sqliteTable('device_status', {
 deviceId: text('device_id').primaryKey(),
 lastSeenAt: text('last_seen_at').notNull(),
 payload: text('payload').notNull(),
});

/**
 * Complete logical backup of the workspace (state, receipts, log, archive, snapshots)
 * and restore into an EMPTY database, verified by re-reading and comparing digests.
 * Device tokens are never exported: after a restore, devices must be registered again.
 */
import { parseState, sha256, WORKSPACE_ID } from './workspace.ts';

export const BACKUP_FORMAT = 'prima-colazione-backup';
type Data = {
  workspace: { version: number; payload: string; updated_at: string; last_request_id: string | null } | null;
  receipts: { id: string; digest: string; version: number; created_at: string }[];
  audit: { id: string; at: string; action: string; detail: string; actor: string | null; moves: string | null; version: number }[];
  archive: { kind: string; id: string; day: string; ref: string; search: string; payload: string; archived_version: number }[];
  snapshots: { id: string; version: number; reason: string; payload: string; created_at: string }[];
};
export type Backup = { format: typeof BACKUP_FORMAT; formatVersion: 1; createdAt: string; digest: string; counts: Record<string, number>; devices: { id: string; name: string; revokedAt: string | null }[]; data: Data };

async function readData(db: D1Database): Promise<Data> {
  const all = async <T>(q: string) => (await db.prepare(q).bind(WORKSPACE_ID).all<T>()).results;
  return {
    workspace: await db.prepare('SELECT version, payload, updated_at, last_request_id FROM workspaces WHERE id = ?').bind(WORKSPACE_ID).first<Data['workspace']>(),
    receipts: await all('SELECT id, digest, version, created_at FROM workspace_requests WHERE workspace_id = ? ORDER BY id'),
    audit: await all('SELECT id, at, action, detail, actor, moves, version FROM workspace_audit WHERE workspace_id = ? ORDER BY id'),
    archive: await all('SELECT kind, id, day, ref, search, payload, archived_version FROM workspace_archive WHERE workspace_id = ? ORDER BY kind, id'),
    snapshots: await all('SELECT id, version, reason, payload, created_at FROM workspace_snapshots WHERE workspace_id = ? ORDER BY id'),
  };
}
const countsOf = (d: Data) => ({ version: d.workspace?.version ?? 0, receipts: d.receipts.length, audit: d.audit.length, archive: d.archive.length, snapshots: d.snapshots.length });
export const digestOf = (d: Data) => sha256(JSON.stringify(d));

export async function exportBackup(db: D1Database): Promise<Backup> {
  const data = await readData(db);
  if (data.workspace) parseState(data.workspace.payload); // refuse to export a state that does not validate
  const { results: devices } = await db.prepare('SELECT id, name, revoked_at FROM devices WHERE workspace_id = ? ORDER BY id').bind(WORKSPACE_ID).all<{ id: string; name: string; revoked_at: string | null }>();
  return { format: BACKUP_FORMAT, formatVersion: 1, createdAt: new Date().toISOString(), digest: await digestOf(data), counts: countsOf(data), devices: devices.map(d => ({ id: d.id, name: d.name, revokedAt: d.revoked_at })), data };
}

export class RestoreError extends Error {}

function chunk<T>(rows: T[], max = 700_000): T[][] {
  const out: T[][] = []; let cur: T[] = []; let size = 0;
  for (const row of rows) { const n = JSON.stringify(row).length; if (cur.length && size + n > max) { out.push(cur); cur = []; size = 0; } cur.push(row); size += n; }
  if (cur.length) out.push(cur);
  return out;
}

/** Restores only into an empty workspace, all-or-nothing, then verifies the stored copy. */
export async function restoreBackup(db: D1Database, input: unknown): Promise<{ digest: string; counts: Record<string, number> }> {
  const backup = input as Backup;
  if (!backup || backup.format !== BACKUP_FORMAT || backup.formatVersion !== 1 || !backup.data) throw new RestoreError('File di backup non riconosciuto.');
  if (await digestOf(backup.data) !== backup.digest) throw new RestoreError('Il backup è incompleto o modificato: impronta non corrispondente.');
  if (!backup.data.workspace) throw new RestoreError('Il backup non contiene lo stato operativo.');
  parseState(backup.data.workspace.payload);
  const current = await readData(db);
  if (current.workspace || current.receipts.length || current.audit.length || current.archive.length) throw new RestoreError('Il ripristino è consentito solo in un archivio vuoto: non sovrascrive dati esistenti.');
  const d = backup.data; const w = WORKSPACE_ID;
  const statements: D1PreparedStatement[] = [
    db.prepare('INSERT INTO workspaces (id, payload, version, request_ids, updated_at, last_request_id) VALUES (?, ?, ?, ?, ?, ?)').bind(w, d.workspace!.payload, d.workspace!.version, '[]', d.workspace!.updated_at, d.workspace!.last_request_id),
  ];
  for (const part of chunk(d.receipts)) statements.push(db.prepare("INSERT INTO workspace_requests (id, workspace_id, digest, version, created_at) SELECT json_extract(value,'$.id'), ?, json_extract(value,'$.digest'), json_extract(value,'$.version'), json_extract(value,'$.created_at') FROM json_each(?)").bind(w, JSON.stringify(part)));
  for (const part of chunk(d.audit)) statements.push(db.prepare("INSERT INTO workspace_audit (id, workspace_id, at, action, detail, actor, moves, version) SELECT json_extract(value,'$.id'), ?, json_extract(value,'$.at'), json_extract(value,'$.action'), json_extract(value,'$.detail'), json_extract(value,'$.actor'), json_extract(value,'$.moves'), json_extract(value,'$.version') FROM json_each(?)").bind(w, JSON.stringify(part)));
  for (const part of chunk(d.archive)) statements.push(db.prepare("INSERT INTO workspace_archive (workspace_id, kind, id, day, ref, search, payload, archived_version) SELECT ?, json_extract(value,'$.kind'), json_extract(value,'$.id'), json_extract(value,'$.day'), json_extract(value,'$.ref'), json_extract(value,'$.search'), json_extract(value,'$.payload'), json_extract(value,'$.archived_version') FROM json_each(?)").bind(w, JSON.stringify(part)));
  for (const s of d.snapshots) statements.push(db.prepare('INSERT INTO workspace_snapshots (id, workspace_id, version, reason, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(s.id, w, s.version, s.reason, s.payload, s.created_at));
  await db.batch(statements);
  const stored = await readData(db);
  const digest = await digestOf(stored);
  if (digest !== backup.digest) throw new RestoreError('Verifica dopo il ripristino non riuscita: i dati letti non corrispondono al backup. Non usare questo archivio.');
  return { digest, counts: countsOf(stored) };
}

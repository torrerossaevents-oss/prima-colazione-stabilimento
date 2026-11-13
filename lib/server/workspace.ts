/**
 * D1 persistence for the workspace. One commit = one D1 batch (a transaction):
 * hot state + durable receipt + audit rows + archive moves, all conditioned on the
 * same compare-and-swap result, so either everything is stored or nothing is.
 */
import { applyAction, DomainError, initialState, todayRome, upgradeState, validateState, type Action, type Audit, type State } from '../domain.ts';
import { archiveNeeds, partition, rehydrate, type ArchiveKind, type ArchiveRow } from '../archive.ts';

export const WORKSPACE_ID = 'prima-colazione';
export const MAX_STATE_BYTES = 2_000_000;
export const MAX_REQUEST_BYTES = 500_000;
/** Max bytes of JSON bound to a single statement (D1 limit per value is 2 MB). */
const CHUNK_BYTES = 800_000;
const RECENT_AUDIT = 20;

type Row = { payload: string; version: number; last_request_id: string | null };
type Receipt = { id: string; digest: string; version: number };
export type AuditRow = Audit;
export type CommitInput = { action: Action; expectedVersion: number | null; requestId: string; actor: string; device?: { id: string; line?: string }; devicesEnabled?: boolean };
export type CommitResult =
  | { ok: true; state: State; version: number; duplicate?: boolean; recentAudit: Audit[] }
  | { ok: false; status: number; error: string; code?: string; state?: State; version?: number; recentAudit?: Audit[] };

const encoder = new TextEncoder();
const bytes = (value: string) => encoder.encode(value).length;
export const REQUEST_ID = /^[a-zA-Z0-9_-]{8,128}$/;

export async function sha256(value: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function readRow(db: D1Database): Promise<Row | null> {
  return db.prepare('SELECT payload, version, last_request_id FROM workspaces WHERE id = ?').bind(WORKSPACE_ID).first<Row>();
}
async function readReceipt(db: D1Database, id: string) {
  return db.prepare('SELECT id, digest, version FROM workspace_requests WHERE id = ? AND workspace_id = ?').bind(id, WORKSPACE_ID).first<Receipt>();
}
/** Parses, upgrades (idempotent, no balance change) and validates a stored state. */
export function parseState(payload: string | null): State {
  const state = upgradeState(payload ? JSON.parse(payload) as State : initialState());
  validateState(state);
  return state;
}
function auditFromRow(row: { id: string; at: string; action: string; detail: string; actor: string | null; moves: string | null }): Audit {
  return { id: row.id, at: row.at, action: row.action, detail: row.detail, ...(row.actor ? { actor: row.actor } : {}), ...(row.moves ? { moves: JSON.parse(row.moves) } : {}) };
}

/** Latest audit entries: archived table plus any legacy entries still inside the hot payload. */
export async function auditPage(db: D1Database, options: { before?: { at: string; id: string }; limit?: number; q?: string; legacy?: Audit[] } = {}): Promise<{ items: Audit[]; next: { at: string; id: string } | null }> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const q = options.q?.trim().toLocaleLowerCase('it') || '';
  const where = ['workspace_id = ?']; const binds: unknown[] = [WORKSPACE_ID];
  if (options.before) { where.push('(at < ? OR (at = ? AND id < ?))'); binds.push(options.before.at, options.before.at, options.before.id); }
  if (q) { where.push("lower(detail) LIKE ? ESCAPE '\\'"); binds.push(`%${q.replace(/[\\%_]/g, m => '\\' + m)}%`); }
  const { results } = await db.prepare(`SELECT id, at, action, detail, actor, moves FROM workspace_audit WHERE ${where.join(' AND ')} ORDER BY at DESC, id DESC LIMIT ?`).bind(...binds, limit + 1).all<Parameters<typeof auditFromRow>[0]>();
  let items = results.map(auditFromRow);
  if (options.legacy?.length) {
    const before = options.before;
    const extra = options.legacy.filter(a => (!before || a.at < before.at || (a.at === before.at && a.id < before.id)) && (!q || a.detail.toLocaleLowerCase('it').includes(q)));
    items = [...items, ...extra].sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
  }
  const page = items.slice(0, limit);
  return { items: page, next: items.length > limit ? { at: page.at(-1)!.at, id: page.at(-1)!.id } : null };
}

export type ArchiveQuery = { kind: ArchiveKind; before?: { day: string; id: string }; from?: string; to?: string; q?: string; ref?: string; limit?: number };
export async function archivePage(db: D1Database, query: ArchiveQuery) {
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 500);
  const where = ['workspace_id = ?', 'kind = ?']; const binds: unknown[] = [WORKSPACE_ID, query.kind];
  if (query.before) { where.push('(day < ? OR (day = ? AND id < ?))'); binds.push(query.before.day, query.before.day, query.before.id); }
  if (query.from) { where.push('day >= ?'); binds.push(query.from); }
  if (query.to) { where.push('day <= ?'); binds.push(query.to); }
  if (query.ref) { where.push('ref = ?'); binds.push(query.ref); }
  const q = query.q?.trim().toLocaleLowerCase('it');
  if (q) { where.push("search LIKE ? ESCAPE '\\'"); binds.push(`%${q.replace(/[\\%_]/g, m => '\\' + m)}%`); }
  const { results } = await db.prepare(`SELECT id, day, payload FROM workspace_archive WHERE ${where.join(' AND ')} ORDER BY day DESC, id DESC LIMIT ?`).bind(...binds, limit + 1).all<{ id: string; day: string; payload: string }>();
  const page = results.slice(0, limit);
  const items = page.map(r => JSON.parse(r.payload));
  // Archived orders refer to lots that may be archived too: return them so quantities keep article and unit.
  let lots: unknown[] = [];
  if (query.kind === 'order') {
    const ids = [...new Set(items.flatMap((o: { lines: { lotId: string }[] }) => o.lines.map(l => l.lotId)))];
    if (ids.length) lots = (await db.prepare("SELECT payload FROM workspace_archive WHERE workspace_id = ? AND kind = 'lot' AND id IN (SELECT value FROM json_each(?))").bind(WORKSPACE_ID, JSON.stringify(ids)).all<{ payload: string }>()).results.map(r => JSON.parse(r.payload));
  }
  return { items, lots, next: results.length > limit ? { day: page.at(-1)!.day, id: page.at(-1)!.id } : null };
}

export async function archiveCounts(db: D1Database) {
  const { results } = await db.prepare('SELECT kind, count(*) AS n FROM workspace_archive WHERE workspace_id = ? GROUP BY kind').bind(WORKSPACE_ID).all<{ kind: string; n: number }>();
  const audit = await db.prepare('SELECT count(*) AS n FROM workspace_audit WHERE workspace_id = ?').bind(WORKSPACE_ID).first<{ n: number }>();
  const counts: Record<string, number> = { order: 0, session: 0, lot: 0, audit: audit?.n ?? 0 };
  for (const r of results) counts[r.kind] = r.n;
  return counts;
}

/** Hot state only (no log, no counts): for frequent readers such as the bridge. */
export async function readState(db: D1Database): Promise<State> { return parseState((await readRow(db))?.payload ?? null); }

/** Digest of a receipt that marks an abandoned request id: no SHA-256 of a real action equals it. */
export const ABANDONED = '0'.repeat(64);
/**
 * «Scarta»: burns a request id that never got a confirmed outcome, so a late arrival of the
 * original request cannot commit any more. Returns committed=true if it had in fact been saved.
 */
export async function abandonRequest(db: D1Database, id: string): Promise<{ committed: boolean }> {
  await db.prepare('INSERT OR IGNORE INTO workspace_requests (id, workspace_id, digest, version, created_at) VALUES (?, ?, ?, 0, ?)').bind(id, WORKSPACE_ID, ABANDONED, new Date().toISOString()).run();
  const row = await readReceipt(db, id);
  return { committed: Boolean(row && row.digest !== ABANDONED) };
}

/** Snapshot for the interface: hot state, version, recent activity and archive sizes. */
export async function readWorkspace(db: D1Database) {
  const row = await readRow(db);
  const state = parseState(row?.payload ?? null);
  const recent = await auditPage(db, { limit: RECENT_AUDIT, legacy: state.audit });
  return { state: { ...state, audit: [] }, version: row?.version ?? 0, recentAudit: recent.items, archive: await archiveCounts(db) };
}

function chunks<T>(items: T[]): T[][] {
  const out: T[][] = []; let current: T[] = []; let size = 2;
  for (const item of items) {
    const n = bytes(JSON.stringify(item)) + 1;
    if (current.length && size + n > CHUNK_BYTES) { out.push(current); current = []; size = 2; }
    current.push(item); size += n;
  }
  if (current.length) out.push(current);
  return out;
}

async function loadArchived(db: D1Database, kind: ArchiveKind, column: 'id' | 'ref', values: string[]) {
  if (!values.length) return [];
  const { results } = await db.prepare(`SELECT kind, id, payload FROM workspace_archive WHERE workspace_id = ? AND kind = ? AND ${column} IN (SELECT value FROM json_each(?))`).bind(WORKSPACE_ID, kind, JSON.stringify([...new Set(values)])).all<{ kind: ArchiveKind; id: string; payload: string }>();
  return results;
}

/** Applies one action. expectedVersion null = server-side retry on version conflicts (devices). */
export async function commit(db: D1Database, input: CommitInput): Promise<CommitResult> {
  const digest = await sha256(JSON.stringify(input.action));
  for (let attempt = 0; attempt < (input.expectedVersion === null ? 3 : 1); attempt++) {
    const repeated = await readReceipt(db, input.requestId);
    if (repeated) {
      if (repeated.digest === digest) return { ok: true, duplicate: true, ...(await readWorkspace(db)) };
      if (repeated.digest === ABANDONED) return { ok: false, status: 409, code: 'request-abandoned', error: 'Questa operazione era stata scartata: non è stata registrata. Inseriscila di nuovo se serve.' };
      return { ok: false, status: 409, code: 'event-id-reused', error: 'Identificativo operazione già utilizzato. Ricarica e riprova.' };
    }
    // A brand-new archive has no row yet: it is created by the first VALID commit, inside the batch,
    // so a rejected attempt never makes an empty database look «used».
    const stored_row = await readRow(db);
    const fresh = !stored_row;
    const row: Row = stored_row ?? { payload: JSON.stringify(initialState()), version: 0, last_request_id: null };
    if (input.expectedVersion !== null && row.version !== input.expectedVersion) {
      return { ok: false, status: 409, error: 'Un altro dispositivo ha aggiornato i dati. Sono stati ricaricati: controlla e ripeti l’operazione.', ...(await readWorkspace(db)) };
    }
    const now = new Date().toISOString();
    const stored = parseState(row.payload);
    // Bring back archived rows the action refers to (e.g. a document for an old order).
    const needs = archiveNeeds(input.action, stored);
    const loaded = [
      ...(await loadArchived(db, 'order', 'id', needs.order)),
      ...(await loadArchived(db, 'session', 'id', needs.session)),
      ...(await loadArchived(db, 'lot', 'id', needs.lot)),
      ...(await loadArchived(db, 'lot', 'ref', needs.lotRef)),
    ];
    let working = rehydrate(stored, loaded);
    const orderLots = loaded.filter(r => r.kind === 'order').flatMap(r => (JSON.parse(r.payload) as State['orders'][number]).lines.map(l => l.lotId)).filter(id => !working.lots.some(l => l.id === id));
    if (orderLots.length) { const more = await loadArchived(db, 'lot', 'id', orderLots); loaded.push(...more); working = rehydrate(working, more); }

    const next = applyAction(working, input.action, { now, actor: input.actor, device: input.device, devicesEnabled: input.devicesEnabled });
    const { hot, rows, audit } = partition(next, todayRome(now));
    const payload = JSON.stringify(hot);
    if (bytes(payload) > MAX_STATE_BYTES) return { ok: false, status: 413, error: 'Archivio operativo al limite anche dopo l’archiviazione dello storico. Esporta un backup e contatta l’assistenza prima di continuare.' };
    const version = row.version + 1;
    const hotIds = new Set([...hot.orders.map(o => 'order:' + o.id), ...hot.sessions.map(s => 'session:' + s.id), ...hot.lots.map(l => 'lot:' + l.id)]);
    const restored = [...new Set(loaded.map(r => `${r.kind}:${r.id}`))].filter(key => hotIds.has(key));
    const guard = 'EXISTS (SELECT 1 FROM workspaces WHERE id = ? AND version = ? AND last_request_id = ?)';
    const guardBinds = [WORKSPACE_ID, version, input.requestId];
    const statements: D1PreparedStatement[] = [
      fresh
        ? db.prepare("INSERT INTO workspaces (id, payload, version, request_ids, updated_at, last_request_id) SELECT ?, ?, ?, '[]', ?, ? WHERE NOT EXISTS (SELECT 1 FROM workspaces WHERE id = ?) AND NOT EXISTS (SELECT 1 FROM workspace_requests WHERE id = ?)").bind(WORKSPACE_ID, payload, version, now, input.requestId, WORKSPACE_ID, input.requestId)
        : db.prepare('UPDATE workspaces SET payload = ?, version = ?, updated_at = ?, last_request_id = ? WHERE id = ? AND version = ? AND NOT EXISTS (SELECT 1 FROM workspace_requests WHERE id = ?)').bind(payload, version, now, input.requestId, WORKSPACE_ID, row.version, input.requestId),
      db.prepare(`INSERT OR IGNORE INTO workspace_requests (id, workspace_id, digest, version, created_at) SELECT ?, ?, ?, ?, ? WHERE ${guard}`).bind(input.requestId, WORKSPACE_ID, digest, version, now, ...guardBinds),
    ];
    // A legacy payload still holding the full log: keep a recovery copy before moving it.
    if (stored.audit.length) statements.push(db.prepare(`INSERT OR IGNORE INTO workspace_snapshots (id, workspace_id, version, reason, payload, created_at) SELECT ?, ?, ?, ?, ?, ? WHERE ${guard}`).bind(`pre-archivio-${row.version}`, WORKSPACE_ID, row.version, 'Copia prima del trasferimento dello storico in archivio', row.payload, now, ...guardBinds));
    for (const part of chunks(audit.map(a => ({ id: a.id, at: a.at, action: a.action, detail: a.detail, actor: a.actor ?? null, moves: a.moves ? JSON.stringify(a.moves) : null })))) {
      statements.push(db.prepare(`INSERT OR IGNORE INTO workspace_audit (id, workspace_id, at, action, detail, actor, moves, version) SELECT json_extract(value, '$.id'), ?, json_extract(value, '$.at'), json_extract(value, '$.action'), json_extract(value, '$.detail'), json_extract(value, '$.actor'), json_extract(value, '$.moves'), ? FROM json_each(?) WHERE ${guard}`).bind(WORKSPACE_ID, version, JSON.stringify(part), ...guardBinds));
    }
    for (const part of chunks<ArchiveRow>(rows)) {
      statements.push(db.prepare(`INSERT INTO workspace_archive (workspace_id, kind, id, day, ref, search, payload, archived_version) SELECT ?, json_extract(value, '$.kind'), json_extract(value, '$.id'), json_extract(value, '$.day'), json_extract(value, '$.ref'), json_extract(value, '$.search'), json_extract(value, '$.payload'), ? FROM json_each(?) WHERE ${guard} ON CONFLICT (workspace_id, kind, id) DO UPDATE SET day = excluded.day, ref = excluded.ref, search = excluded.search, payload = excluded.payload, archived_version = excluded.archived_version`).bind(WORKSPACE_ID, version, JSON.stringify(part), ...guardBinds));
    }
    if (restored.length) statements.push(db.prepare(`DELETE FROM workspace_archive WHERE workspace_id = ? AND (kind || ':' || id) IN (SELECT value FROM json_each(?)) AND ${guard}`).bind(WORKSPACE_ID, JSON.stringify(restored), ...guardBinds));

    const results = await db.batch(statements);
    if (results[0].meta.changes !== 1) {
      const completed = await readReceipt(db, input.requestId);
      if (completed) return completed.digest === digest ? { ok: true, duplicate: true, ...(await readWorkspace(db)) } : { ok: false, status: 409, code: 'event-id-reused', error: 'Identificativo operazione già utilizzato.' };
      if (input.expectedVersion === null) continue;
      return { ok: false, status: 409, error: 'Dati aggiornati da un altro dispositivo. Controlla le quantità e riprova.', ...(await readWorkspace(db)) };
    }
    if (results[1].meta.changes !== 1) throw new Error('Durable receipt was not committed');
    const recent = await auditPage(db, { limit: RECENT_AUDIT });
    return { ok: true, state: hot, version, recentAudit: recent.items };
  }
  return { ok: false, status: 503, error: 'Archivio molto occupato: riprova fra poco con lo stesso identificativo.' };
}

export function domainStatus(error: unknown): { status: number; error: string; code?: string } | null {
  if (!(error instanceof DomainError)) return null;
  return { status: error.code ? 409 : 422, error: error.message, ...(error.code ? { code: error.code } : {}) };
}

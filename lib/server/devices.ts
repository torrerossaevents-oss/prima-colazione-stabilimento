/**
 * Device credentials for the local LOGO! bridge. Tokens are random, shown once and
 * stored only as SHA-256. A revoked device is refused immediately.
 */
import { PRODUCTION_LINE } from '../domain.ts';
import { sha256, WORKSPACE_ID } from './workspace.ts';

export type DeviceRecord = { id: string; name: string; line: string; createdAt: string; revokedAt: string | null; lastSeenAt: string | null; status: Record<string, unknown> | null };
const TOKEN = /^pcd_[A-Za-z0-9_-]{43}$/;
const base64url = (data: Uint8Array) => btoa(String.fromCharCode(...data)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');

export async function activeDeviceCount(db: D1Database): Promise<number> {
  const row = await db.prepare('SELECT count(*) AS n FROM devices WHERE workspace_id = ? AND revoked_at IS NULL').bind(WORKSPACE_ID).first<{ n: number }>();
  return row?.n ?? 0;
}

export async function listDevices(db: D1Database): Promise<DeviceRecord[]> {
  const { results } = await db.prepare('SELECT d.id, d.name, d.line, d.created_at, d.revoked_at, s.last_seen_at, s.payload FROM devices d LEFT JOIN device_status s ON s.device_id = d.id WHERE d.workspace_id = ? ORDER BY d.created_at DESC').bind(WORKSPACE_ID).all<{ id: string; name: string; line: string; created_at: string; revoked_at: string | null; last_seen_at: string | null; payload: string | null }>();
  return results.map(r => ({ id: r.id, name: r.name, line: r.line, createdAt: r.created_at, revokedAt: r.revoked_at, lastSeenAt: r.last_seen_at, status: r.payload ? JSON.parse(r.payload) : null }));
}

export async function createDevice(db: D1Database, name: string, actor: string): Promise<{ device: DeviceRecord; token: string }> {
  const clean = name.trim();
  if (!clean || clean.length > 60) throw new RangeError('Nome dispositivo: da 1 a 60 caratteri.');
  if ((await activeDeviceCount(db)) >= 3) throw new RangeError('Sono previsti al massimo 3 dispositivi attivi: revoca prima quelli non più usati.');
  const random = crypto.getRandomValues(new Uint8Array(32));
  const token = 'pcd_' + base64url(random);
  const id = 'dev_' + Array.from(crypto.getRandomValues(new Uint8Array(8))).map(b => b.toString(16).padStart(2, '0')).join('');
  const now = new Date().toISOString();
  await db.prepare('INSERT INTO devices (id, workspace_id, name, line, token_hash, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(id, WORKSPACE_ID, clean, PRODUCTION_LINE, await sha256(token), now, actor).run();
  return { token, device: { id, name: clean, line: PRODUCTION_LINE, createdAt: now, revokedAt: null, lastSeenAt: null, status: null } };
}

export async function revokeDevice(db: D1Database, id: string): Promise<boolean> {
  const result = await db.prepare('UPDATE devices SET revoked_at = ? WHERE id = ? AND workspace_id = ? AND revoked_at IS NULL').bind(new Date().toISOString(), id, WORKSPACE_ID).run();
  return result.meta.changes === 1;
}

export async function authenticateDevice(db: D1Database, request: Request): Promise<{ id: string; line: string } | null> {
  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!TOKEN.test(token)) return null;
  return db.prepare('SELECT id, line FROM devices WHERE token_hash = ? AND workspace_id = ? AND revoked_at IS NULL').bind(await sha256(token), WORKSPACE_ID).first<{ id: string; line: string }>();
}

/** Stores only known, bounded heartbeat fields; never touches the operational state. */
export async function recordHeartbeat(db: D1Database, deviceId: string, body: Record<string, unknown>) {
  const plc = (body.plc && typeof body.plc === 'object' ? body.plc : {}) as Record<string, unknown>;
  const session = (body.session && typeof body.session === 'object' ? body.session : null) as Record<string, unknown> | null;
  const str = (v: unknown, max = 60) => typeof v === 'string' ? v.slice(0, max) : null;
  const int = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null;
  const status = {
    at: str(body.at, 40), bridgeVersion: str(body.bridgeVersion, 20), queueLength: int(body.queueLength),
    plc: { reachable: plc.reachable === true, lastReadAt: str(plc.lastReadAt, 40) },
    session: session ? { id: str(session.id, 80), cartons: int(session.cartons) } : null,
  };
  const now = new Date().toISOString();
  await db.prepare('INSERT INTO device_status (device_id, last_seen_at, payload) VALUES (?, ?, ?) ON CONFLICT (device_id) DO UPDATE SET last_seen_at = excluded.last_seen_at, payload = excluded.payload').bind(deviceId, now, JSON.stringify(status)).run();
  return status;
}

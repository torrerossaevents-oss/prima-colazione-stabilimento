import { env } from 'cloudflare:workers';
import { activeSession, type Action } from '../../../../lib/domain.ts';
import { authenticateDevice, recordHeartbeat } from '../../../../lib/server/devices.ts';
import { commit, domainStatus, readState, REQUEST_ID, sha256 } from '../../../../lib/server/workspace.ts';
import { json, readLimited, serverError, requireDb } from '../../../../lib/server/http.ts';
export const dynamic = 'force-dynamic';
/**
 * Bridge endpoint (docs/CONTRATTO-PONTE.md). Authenticated only by a dedicated
 * device token; it can read the active session of its line and close it once.
 */
export async function GET(request: Request) {
 const device = await authenticateDevice(requireDb(env.DB), request).catch(() => null);
 if (!device) return json({ error: 'Credenziale dispositivo non valida o revocata.' }, 401);
 try {
  const state = await readState(requireDb(env.DB)); const session = activeSession(state);
  const active = session && session.source === 'device' && (session.line ?? 'linea-1') === device.line ? session : null;
  return json({ serverTime: new Date().toISOString(), line: device.line, deviceId: device.id, activeSession: active && { id: active.id, productCode: active.productCode, productName: active.productName, lotCode: active.lotCode, expiry: active.expiry, unitsPerBox: active.unitsPerBox, startedAt: active.startedAt, operator: active.operator, source: active.source } });
 } catch (error) { return serverError(error, 'Archivio non disponibile.'); }
}
export async function POST(request: Request) {
 const device = await authenticateDevice(requireDb(env.DB), request).catch(() => null);
 if (!device) return json({ error: 'Credenziale dispositivo non valida o revocata.' }, 401);
 const raw = await readLimited(request, 16_000); if (raw === null) return json({ error: 'Richiesta troppo grande.' }, 413);
 let body: Record<string, unknown>; try { body = JSON.parse(raw); } catch { return json({ error: 'Richiesta non valida.' }, 400); }
 if (!body || typeof body !== 'object' || typeof body.eventId !== 'string' || !REQUEST_ID.test(body.eventId)) return json({ error: 'Identificativo evento mancante o non valido.' }, 400);
 try {
  if (body.type === 'heartbeat') return json({ ok: true, status: await recordHeartbeat(requireDb(env.DB), device.id, body) });
  if (body.type !== 'session.close') return json({ error: 'Tipo di evento non supportato.' }, 400);
  const action: Action = { type: 'production.deviceClose', sessionId: String(body.sessionId ?? ''), eventId: body.eventId, cartons: body.cartons as number, counterStart: body.counterStart as number, counterEnd: body.counterEnd as number, ...(body.counterModulo !== undefined ? { counterModulo: body.counterModulo as number } : {}), closedAt: String(body.closedAt ?? ''), anomalies: body.anomalies as string[] | undefined };
  // Device event ids live in their own namespace inside the durable receipts.
  const requestId = 'd' + (await sha256(device.id + ':' + body.eventId)).slice(0, 40);
  const result = await commit(requireDb(env.DB), { action, expectedVersion: null, requestId, actor: 'dispositivo:' + device.id, device: { id: device.id, line: device.line }, devicesEnabled: true });
  if (!result.ok) return json({ error: result.error, ...(result.code ? { code: result.code } : {}) }, result.status);
  return json({ ok: true, duplicate: Boolean(result.duplicate), sessionId: action.sessionId });
 } catch (error) { const known = domainStatus(error); return known ? json(known, known.status) : serverError(error, 'Registrazione non confermata: ritenta con lo stesso identificativo.'); }
}

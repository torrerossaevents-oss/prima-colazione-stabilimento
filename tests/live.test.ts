/**
 * Conteggio dal vivo: /api/workspace/live espone solo l'ultimo heartbeat del ponte (campi limitati),
 * leggibile anche dal laboratorio; lib/live.ts decide cosa mostrare all'operatore.
 * Solo dati di prova.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Action, State } from '../lib/domain.ts';
import { loadRoute, setEnv, sqliteDb } from './helpers/d1.ts';
import { bridgeStatus, liveMessage, liveView, LIVE_STALE_MS } from '../lib/live.ts';

type Route = { GET: (r: Request) => Promise<Response>; POST: (r: Request) => Promise<Response> };
const origin = 'http://127.0.0.1';
const admin = { 'oai-authenticated-user-id': 'admin-prova', 'content-type': 'application/json' };
const lab = { 'oai-authenticated-user-id': 'lab-prova' };

test('/api/workspace/live: ultimo heartbeat, laboratorio ammesso, nessun identificativo del dispositivo', async () => {
  const t = await sqliteDb(); setEnv(t.db);
  Object.assign((globalThis as { __testEnv?: Record<string, unknown> }).__testEnv!, { ADMIN_EMAILS: 'admin-prova', LAB_EMAILS: 'lab-prova' });
  const workspace = await loadRoute<Route>('app/api/workspace/route.ts');
  const devices = await loadRoute<Route>('app/api/devices/route.ts');
  const production = await loadRoute<Route>('app/api/devices/production/route.ts');
  const live = await loadRoute<Route>('app/api/workspace/live/route.ts');
  let version = 0;
  const post = async (action: Action) => { const res = await workspace.POST(new Request(origin + '/api/workspace', { method: 'POST', headers: { ...admin, origin }, body: JSON.stringify({ action, expectedVersion: version, requestId: 'req-' + crypto.randomUUID() }) })); const body = await res.json() as { state: State; version: number; error?: string }; assert.equal(res.status, 200, body.error); version = body.version; return body.state; };
  const read = async (headers: Record<string, string>) => { const res = await live.GET(new Request(origin + '/api/workspace/live', { headers })); return { status: res.status, body: await res.json() as { live: null | Record<string, unknown>; serverTime: string } }; };
  try {
    assert.equal((await read({})).status, 401, 'login required');
    assert.deepEqual((await read(lab)).body.live, null, 'no device yet');
    await post({ type: 'product.add', product: { code: 'P1', name: 'Articolo PROVA', kind: 'finished', unit: 'CRT', unitsPerBox: 1, minStock: 0 } });
    const created = await (await devices.POST(new Request(origin + '/api/devices', { method: 'POST', headers: { ...admin, origin }, body: '{"op":"create","name":"PC prova"}' }))).json() as { token: string; device: { id: string; name: string } };
    const state = await post({ type: 'production.start', ident: 'P1', code: 'P1', operator: 'Operatore prova', lotCode: '261101', expiry: '2099-12-31', counting: 'device' });
    const sessionId = state.sessions[0].id;
    const beat = await production.POST(new Request(origin + '/api/devices/production', { method: 'POST', headers: { authorization: 'Bearer ' + created.token, 'content-type': 'application/json' }, body: JSON.stringify({ eventId: 'hb_' + crypto.randomUUID(), type: 'heartbeat', at: new Date().toISOString(), bridgeVersion: '1.0.0', queueLength: 3, plc: { reachable: true, lastReadAt: new Date().toISOString() }, session: { id: sessionId, cartons: 17 } }) }));
    assert.equal(beat.status, 200);
    const { status, body } = await read(lab);
    assert.equal(status, 200, 'laboratorio can read the live count');
    assert.equal(body.live?.sessionId, sessionId); assert.equal(body.live?.cartons, 17); assert.equal(body.live?.plcReachable, true);
    assert.equal(body.live?.queueLength, 3, 'eventi in coda del ponte esposti per la pagina Linea');
    const text = JSON.stringify(body);
    assert.ok(!text.includes(created.device.id) && !text.includes('PC prova') && !text.includes('pcd_'), 'no device id, name or token');
    assert.equal(liveView(body.live as never, body.serverTime, sessionId).state, 'live');
    const after = await read(admin);
    assert.equal(after.body.live?.cartons, 17);
    // A revoked device is no longer shown.
    await devices.POST(new Request(origin + '/api/devices', { method: 'POST', headers: { ...admin, origin }, body: JSON.stringify({ op: 'revoke', id: created.device.id }) }));
    assert.equal((await read(lab)).body.live, null);
  } finally { await t.close(); }
});

test('liveView: agganciato, in attesa, fermo, nessun dato', () => {
  const now = '2026-11-20T10:00:30.000Z';
  const fresh = { lastSeenAt: '2026-11-20T10:00:24.000Z', at: null, plcReachable: true, sessionId: 'S1', cartons: 21 };
  assert.deepEqual(liveView(fresh, now, 'S1'), { state: 'live', cartons: 21, ageS: 6, plcReachable: true });
  assert.equal(liveView(fresh, now, 'S2').state, 'waiting', 'another run: not hooked, no number');
  assert.equal(liveView(fresh, now, 'S2').cartons, null);
  assert.match(liveMessage(liveView(fresh, now, 'S2')), /non avviare la linea/);
  const old = { ...fresh, lastSeenAt: new Date(Date.parse(now) - LIVE_STALE_MS - 1000).toISOString() };
  assert.equal(liveView(old, now, 'S1').state, 'stale'); assert.match(liveMessage(liveView(old, now, 'S1')), /non si aggiorna/);
  assert.equal(liveView(null, now, 'S1').state, 'unknown');
  assert.equal(liveView(null, null, 'S1').state, 'loading');
  assert.match(liveMessage(liveView({ ...fresh, plcReachable: false }, now, 'S1')), /LOGO! non raggiungibile/);
});

test('bridgeStatus (pagina Linea): agganciato, LOGO!, ultimo segnale, coda, «Ponte non risponde» oltre 30 s', () => {
  assert.equal(LIVE_STALE_MS, 30_000);
  const now = '2026-11-27T10:00:30.000Z';
  const fresh = { lastSeenAt: '2026-11-27T10:00:26.000Z', at: null, plcReachable: false, sessionId: 'S1', cartons: 5, queueLength: 2 };
  assert.deepEqual(bridgeStatus(fresh, now, 'S1'), { known: true, silent: false, ageS: 4, lastSeenAt: fresh.lastSeenAt, hooked: true, plcReachable: false, queueLength: 2 });
  assert.equal(bridgeStatus(fresh, now, 'S2').hooked, false, 'il ponte segue un’altra lavorazione: non agganciato');
  assert.equal(bridgeStatus(fresh, now, null).hooked, null, 'nessuna lavorazione da fotocellule aperta');
  assert.equal(bridgeStatus({ ...fresh, queueLength: undefined }, now, 'S1').queueLength, null, 'heartbeat vecchio senza coda');
  const at29 = { ...fresh, lastSeenAt: '2026-11-27T10:00:01.000Z' };
  assert.equal(bridgeStatus(at29, now, 'S1').silent, false, '29 s: ancora vivo');
  const at31 = { ...fresh, lastSeenAt: '2026-11-27T09:59:59.000Z' };
  const silent = bridgeStatus(at31, now, 'S1');
  assert.equal(silent.silent, true); assert.equal(silent.ageS, 31); assert.equal(silent.hooked, false, 'ponte muto: non agganciato');
  assert.equal(silent.plcReachable, null, 'ponte muto: stato del LOGO! non noto');
  assert.deepEqual(bridgeStatus(null, now, 'S1'), { known: false, silent: true, ageS: null, lastSeenAt: null, hooked: false, plcReachable: null, queueLength: null }, 'nessun segnale mai ricevuto');
  assert.equal(bridgeStatus(null, null, 'S1').silent, false, 'prima lettura in corso: nessun allarme');
});

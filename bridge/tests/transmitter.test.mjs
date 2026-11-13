import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BridgeStore } from '../core/store.mjs';
import { Transmitter, classifyResponse, backoffMs } from '../core/transmitter.mjs';
import { FakeGestionale } from '../core/sim-gestionale.mjs';
import { createCounterState } from '../core/counter.mjs';

const TOKEN = 'pcd_TEST_TOKEN_SOLO_PER_PROVA_0001';

async function fixture(t, { token = TOKEN, timeoutMs = 2000 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ponte-tx-test-'));
  const store = new BridgeStore(join(dir, 'ponte.sqlite'), { mode: 'simulazione', line: 'linea-test' });
  const server = new FakeGestionale({ token: TOKEN, line: 'linea-test' });
  const baseUrl = await server.listen();
  const clock = { t: 1_000_000 };
  const logs = [];
  const tx = new Transmitter({ store, baseUrl, token, timeoutMs, retry: { baseMs: 1000, maxMs: 8000 }, now: () => clock.t, log: (l, m) => logs.push([l, m]) });
  t.after(async () => { store.close(); await server.close(); rmSync(dir, { recursive: true, force: true }); });
  return { store, server, tx, clock, logs };
}

function queueClose(store, server, { sessionId = 's-1', cartons = 200 } = {}) {
  server.openSession({ id: sessionId, productCode: 'SIM-A' });
  store.followSession({ id: sessionId }, { baseline: 1000, at: 'x', counterState: createCounterState({ baseline: 1000, at: 0 }) });
  return store.closeSession({ sessionId, closeRequestId: `linea-test-1-1000`, requestValue: 1, counterStart: 1000, counterEnd: 1000 + cartons,
    cartons, closedAt: '2026-11-13T09:00:00.000Z', anomalies: [], modulo: 2 ** 32, newCounterState: createCounterState({ baseline: 1000 + cartons, at: 1 }) }).event;
}

test('tabella delle risposte del contratto', () => {
  assert.deepEqual(classifyResponse(200, { ok: true }), { outcome: 'confermato', duplicate: false });
  assert.deepEqual(classifyResponse(200, { ok: true, duplicate: true }), { outcome: 'confermato', duplicate: true });
  assert.equal(classifyResponse(200, null).outcome, 'ritenta');
  assert.equal(classifyResponse(401, {}).outcome, 'auth');
  for (const status of [400, 409, 413, 422]) assert.equal(classifyResponse(status, {}).outcome, 'da-verificare');
  for (const status of [500, 502, 503]) assert.equal(classifyResponse(status, {}).outcome, 'ritenta');
  assert.equal(classifyResponse(403, {}).outcome, 'ritenta');
  assert.deepEqual([0, 1, 2, 3, 4, 10].map(a => backoffMs(a, { baseMs: 1000, maxMs: 8000 })), [1000, 2000, 4000, 8000, 8000, 8000]);
});

test('successo: evento confermato e conservato in archivio', async t => {
  const { store, server, tx } = await fixture(t);
  const event = queueClose(store, server);
  assert.deepEqual(await tx.flush(), { confirmed: 1, review: 0, retry: 0, paused: false });
  assert.equal(store.events()[0].status, 'confermato');
  assert.equal(server.closures.length, 1);
  assert.equal(server.closures[0].eventId, event.eventId);
  assert.deepEqual(await tx.flush(), { confirmed: 0, review: 0, retry: 0, paused: false }, 'un evento confermato non viene rinviato');
});

test('risposta persa dopo il commit: il ritentativo con lo stesso eventId riceve duplicate', async t => {
  const { store, server, tx, clock } = await fixture(t);
  const event = queueClose(store, server);
  server.faults.push('lose-response');
  assert.equal((await tx.flush()).retry, 1);
  assert.equal(server.closures.length, 1, 'il server ha già registrato');
  assert.equal(store.events()[0].status, 'in-coda');
  assert.equal((await tx.flush()).retry, 0, 'nessun invio prima dell’attesa');
  clock.t += 1000;
  assert.equal((await tx.flush()).confirmed, 1);
  const saved = store.events()[0];
  assert.equal(saved.status, 'confermato');
  assert.equal(saved.duplicate, true);
  assert.deepEqual(server.requests.filter(r => r.method === 'POST').map(r => r.eventId), [event.eventId, event.eventId]);
  assert.equal(server.closures.length, 1, 'nessuna seconda chiusura');
});

test('500 e timeout: ritenta lo stesso evento con attesa crescente', async t => {
  const { store, server, tx, clock } = await fixture(t, { timeoutMs: 300 });
  queueClose(store, server);
  server.faults.push('error500', 'timeout', 'html200');
  await tx.flush();
  let saved = store.events()[0];
  assert.equal(saved.lastHttpStatus, 500);
  assert.equal(saved.nextAttemptAt, clock.t + 1000);
  clock.t += 1000;
  const before = Date.now();
  await tx.flush();
  assert.ok(Date.now() - before < 2000, 'timeout limitato');
  saved = store.events()[0];
  assert.match(saved.lastError, /timeout/);
  assert.equal(saved.nextAttemptAt, clock.t + 2000);
  clock.t += 2000;
  await tx.flush();
  assert.match(store.events()[0].lastError, /non riconosciuta/, 'una pagina HTML con 200 non è una conferma');
  clock.t += 4000;
  await tx.flush();
  assert.equal(store.events()[0].status, 'confermato');
  assert.equal(server.closures.length, 1);
});

test('401: invii fermati, allarme, evento non scartato', async t => {
  const { store, server, tx, logs } = await fixture(t, { token: 'pcd_TOKEN_ERRATO_SOLO_PROVA_00000' });
  queueClose(store, server);
  const result = await tx.flush();
  assert.equal(result.paused, true);
  assert.equal(tx.authPaused, true);
  assert.equal(store.events()[0].status, 'in-coda');
  assert.equal(store.events()[0].attempts, 0);
  assert.ok(logs.some(([level, message]) => level === 'ALLARME' && /401/.test(message)));
  assert.ok(!logs.some(([, message]) => message.includes('pcd_')), 'il token non finisce nei log');
  const requests = server.requests.length;
  await tx.flush();
  assert.equal(server.requests.length, requests, 'nessun nuovo invio dopo il 401');
  assert.equal((await tx.getActiveSession()).reason, 'auth');
});

test('409: evento in «da verificare», non ritentato all’infinito', async t => {
  const { store, server, tx, clock } = await fixture(t);
  queueClose(store, server);
  server.activeSession = null; // chiusa in altro modo sul gestionale
  assert.equal((await tx.flush()).review, 1);
  const saved = store.events()[0];
  assert.equal(saved.status, 'da-verificare');
  assert.match(saved.lastError, /409 session-closed/);
  clock.t += 1e9;
  assert.equal((await tx.flush()).review, 0);
  assert.equal(server.requests.filter(r => r.method === 'POST').length, 1);
});

test('rete assente: GET restituisce un esito senza eccezioni; heartbeat solo l’ultimo', async t => {
  const { store, server, tx } = await fixture(t);
  server.offline = true;
  const result = await tx.getActiveSession();
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'rete');
  store.setHeartbeat({ eventId: 'hb_aaaaaaaa', type: 'heartbeat', at: 'x' }, 'x');
  assert.equal(await tx.sendHeartbeat(), false);
  store.setHeartbeat({ eventId: 'hb_bbbbbbbb', type: 'heartbeat', at: 'y' }, 'y');
  server.offline = false;
  assert.equal(await tx.sendHeartbeat(), true);
  assert.deepEqual(server.heartbeats.map(h => h.eventId), ['hb_bbbbbbbb']);
  assert.equal(store.heartbeat(), null);
  server.openSession({ id: 's-9', productCode: 'X' });
  assert.equal((await tx.getActiveSession()).activeSession.id, 's-9');
  server.activeSession = { id: 's-10', source: 'manual' };
  assert.equal((await tx.getActiveSession()).activeSession, null, 'nessun conteggio per lavorazioni manuali');
});

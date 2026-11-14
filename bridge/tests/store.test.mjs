import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BridgeStore } from '../core/store.mjs';
import { createCounterState } from '../core/counter.mjs';

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'ponte-store-test-'));
  const file = join(dir, 'ponte.sqlite');
  const opened = [];
  const open = (options = { mode: 'simulazione', line: 'linea-test' }) => { const s = new BridgeStore(file, options); opened.push(s); return s; };
  t.after(() => { opened.forEach(s => s.close()); rmSync(dir, { recursive: true, force: true }); });
  return { open, file };
}

const remote = { id: 'sess-1', productCode: 'SIM-A', lotCode: 'L1', startedAt: '2026-11-13T08:00:00.000Z' };
function follow(store, baseline = 1000) {
  return store.followSession(remote, { baseline, at: '2026-11-13T08:00:01.000Z', counterState: createCounterState({ baseline, at: 0 }) });
}
function close(store, extra = {}) {
  return store.closeSession({ sessionId: remote.id, closeRequestId: 'linea-test-1-1000', requestValue: 1, counterStart: 1000, counterEnd: 1200,
    cartons: 200, closedAt: '2026-11-13T09:00:00.000Z', anomalies: [], modulo: 2 ** 32,
    newCounterState: createCounterState({ baseline: 1200, at: 5 }), ...extra });
}

test('archivio marcato per modalità e linea: simulazione e impianto non si mescolano', t => {
  const { open } = fixture(t);
  open().close();
  assert.throws(() => open({ mode: 'impianto', line: 'linea-test' }), /Archivio di simulazione/);
  assert.throws(() => open({ mode: 'simulazione', line: 'altra' }), /linea linea-test/);
});

test('una sola lavorazione aperta; la stessa lavorazione non viene riaperta dopo la chiusura', t => {
  const { open } = fixture(t);
  const store = open();
  follow(store);
  assert.throws(() => store.followSession({ ...remote, id: 'sess-2' }, { baseline: 1, at: 'x', counterState: {} }), /già una lavorazione/);
  close(store);
  assert.throws(() => follow(store), /già seguita/);
});

test('chiusura atomica: sessione chiusa, evento in coda, baseline e richiesta gestita nella stessa transazione', t => {
  const { open } = fixture(t);
  const store = open();
  follow(store);
  const { event } = close(store);
  assert.equal(store.session(remote.id).status, 'chiusa');
  assert.equal(store.session(remote.id).cartons, 200);
  assert.deepEqual(store.events().map(e => [e.eventId, e.status]), [[event.eventId, 'in-coda']]);
  assert.match(event.eventId, /^[A-Za-z0-9_-]{8,128}$/);
  assert.equal(event.cartons, event.counterEnd - event.counterStart);
  assert.equal(store.getState('counter').baseline, 1200);
  assert.deepEqual(store.getState('closeRef'), { value: 1 });
});

test('se una parte della chiusura fallisce non resta nulla a metà (ROLLBACK)', t => {
  const { open } = fixture(t);
  const store = open();
  follow(store);
  const { event } = close(store);
  // Seconda lavorazione; la chiusura riusa un eventId esistente → violazione UNIQUE sull'evento.
  store.followSession({ ...remote, id: 'sess-2' }, { baseline: 1200, at: '2026-11-13T09:10:00.000Z', counterState: createCounterState({ baseline: 1200, at: 6 }) });
  assert.throws(() => store.closeSession({ sessionId: 'sess-2', closeRequestId: 'linea-test-2-1200', requestValue: 2, counterStart: 1200,
    counterEnd: 1350, cartons: 150, closedAt: '2026-11-13T10:00:00.000Z', anomalies: [], modulo: 2 ** 32,
    newCounterState: createCounterState({ baseline: 1350, at: 7 }), eventId: event.eventId }), /UNIQUE/);
  assert.equal(store.session('sess-2').status, 'attiva');
  assert.equal(store.session('sess-2').cartons, null);
  assert.equal(store.getState('counter').baseline, 1200);
  assert.deepEqual(store.getState('closeRef'), { value: 1 });
  assert.equal(store.events().length, 1);
});

test('riapertura dopo riavvio del PC: lavorazione, baseline e coda conservate', t => {
  const { open } = fixture(t);
  const first = open();
  follow(first, 5000);
  first.saveCounter({ ...createCounterState({ baseline: 5000, at: 0 }), last: 5040, lastAt: 9 }, { sessionId: remote.id, anomalies: ['salto-eccessivo'] });
  first.close();
  const second = open();
  assert.equal(second.openSession().baseline, 5000);
  assert.deepEqual(second.openSession().anomalies, ['salto-eccessivo']);
  assert.equal(second.getState('counter').last, 5040);
});

test('stati della coda: confermato resta in archivio, da-verificare non torna in coda; heartbeat solo l’ultimo', t => {
  const { open } = fixture(t);
  const store = open();
  follow(store);
  const { event } = close(store);
  store.markRetry(event.eventId, { at: 'a', nextAttemptAt: 10_000, error: 'rete' });
  assert.equal(store.dueEvents(5_000).length, 0);
  assert.equal(store.dueEvents(10_000).length, 1);
  store.markConfirmed(event.eventId, { at: 'b', duplicate: true, httpStatus: 200 });
  store.markReview(event.eventId, { at: 'c', error: 'x', httpStatus: 409 });
  const [saved] = store.events();
  assert.equal(saved.status, 'confermato', 'un evento confermato non cambia più stato');
  assert.equal(saved.duplicate, true);
  assert.equal(saved.attempts, 2);
  store.setHeartbeat({ eventId: 'hb_00000001', type: 'heartbeat' }, 't1');
  store.setHeartbeat({ eventId: 'hb_00000002', type: 'heartbeat' }, 't2');
  assert.equal(store.heartbeat().eventId, 'hb_00000002');
  store.clearHeartbeat('hb_00000001');
  assert.equal(store.heartbeat().eventId, 'hb_00000002', 'non cancella un heartbeat più recente');
  store.clearHeartbeat('hb_00000002');
  assert.equal(store.heartbeat(), null);
});

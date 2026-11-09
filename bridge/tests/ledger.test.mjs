import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { Ledger } from '../core/ledger.mjs';

const base = { id: 'SIM-001', code: '0001', name: 'Prodotto di prova', lot: 'SIM-LOTTO', operator: 'Prova', cumulative: 1000, now: '2026-11-10T08:00:00Z' };
const reading = (cumulative, now = '2026-11-10T08:10:00Z') => ({ sessionId: base.id, cumulative, now });
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'logo-ledger-test-'));
  const dbPath = join(directory, 'sim.sqlite');
  const ledger = new Ledger(dbPath);
  t.after(() => { ledger.dispose(); rmSync(directory, { recursive: true, force: true }); });
  return { ledger, dbPath };
}

test('absolute readings count only their difference, repeated close and start are idempotent', t => {
  const { ledger } = fixture(t);
  ledger.start(base);
  ledger.observe(reading(1200));
  ledger.observe(reading(1200));
  ledger.observe(reading(1200, '2026-11-10T08:11:00Z'));
  const closed = ledger.close(reading(1200, '2026-11-10T08:12:00Z'));
  const events = ledger.outbox();
  assert.equal(closed.cartons, 200);
  assert.deepEqual(ledger.close(reading(1200, '2026-11-10T08:12:00Z')), closed);
  assert.deepEqual(ledger.close(reading(1200, '2026-11-10T08:13:00Z')), closed);
  assert.deepEqual(ledger.start(base), closed);
  assert.deepEqual(ledger.outbox(), events);
  assert.equal(events.filter(e => e.kind === 'session.closed').length, 1);
  assert.equal(events.length, 3);
  assert.ok(events.every(e => e.payload.simulation && e.payload.session.simulation && e.status === 'pending'));
});

test('a new product starts from zero without deleting the first session', t => {
  const { ledger } = fixture(t);
  ledger.start(base);
  ledger.close(reading(1200));
  const next = ledger.start({ ...base, id: 'SIM-002', code: '0002', cumulative: 1200, now: '2026-11-10T09:00:00Z' });
  assert.equal(next.cartons, 0);
  ledger.close({ sessionId: next.id, cumulative: 1350, now: '2026-11-10T09:10:00Z' });
  assert.deepEqual(ledger.list().map(s => s.cartons), [200, 150]);
  assert.equal(ledger.list().reduce((sum, s) => sum + s.cartons, 0), 350);
});

test('unknown session, missing fields, duplicate IDs and parallel starts are refused', t => {
  const { ledger } = fixture(t);
  for (const field of ['id', 'code', 'name', 'lot', 'operator']) assert.throws(() => ledger.start({ ...base, [field]: '' }));
  for (const value of [-1, 1.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => ledger.start({ ...base, cumulative: value }));
  for (const value of ['2026-02-30T08:00:00Z', '2026-11-10 08:00:00', '2026-11-10T08:00:00']) assert.throws(() => ledger.start({ ...base, now: value }));
  assert.equal(ledger.list().length, 0);
  ledger.start(base);
  assert.throws(() => ledger.start({ ...base, code: '0002' }), /Identificativo/);
  assert.throws(() => ledger.start({ ...base, id: 'SIM-002' }), /già una lavorazione/);
  assert.throws(() => ledger.observe({ ...reading(1200), sessionId: 'absent' }), /sconosciuta/);
  assert.equal(ledger.list().length, 1);
});

test('counter reset, rollover and stale timestamps never change the session or outbox', t => {
  const { ledger } = fixture(t);
  ledger.start(base);
  ledger.observe(reading(1200));
  const before = ledger.list();
  const events = ledger.outbox();
  for (const method of ['observe', 'close']) {
    assert.throws(() => ledger[method](reading(0, '2026-11-10T08:11:00Z')), /Cumulativo diminuito/);
    assert.throws(() => ledger[method](reading(1201, '2026-11-10T08:09:00Z')), /fuori ordine/);
    assert.throws(() => ledger[method](reading(1201)), /Stesso istante/);
  }
  assert.deepEqual(ledger.list(), before);
  assert.deepEqual(ledger.outbox(), events);
});

test('closed sessions cannot be modified and counter resets cannot hide between sessions', t => {
  const { ledger } = fixture(t);
  ledger.start(base);
  ledger.close(reading(1200));
  const before = ledger.list();
  const events = ledger.outbox();
  assert.throws(() => ledger.observe(reading(1300, '2026-11-10T08:20:00Z')), /chiusa/);
  assert.throws(() => ledger.close(reading(1300, '2026-11-10T08:20:00Z')), /dati diversi/);
  assert.throws(() => ledger.close(reading(1200, '2026-11-10T08:09:00Z')), /precedenti/);
  assert.throws(() => ledger.start({ ...base, id: 'SIM-002', cumulative: 0, now: '2026-11-10T09:00:00Z' }), /Cumulativo diminuito/);
  assert.throws(() => ledger.start({ ...base, id: 'SIM-002', cumulative: 1200, now: '2026-11-10T07:59:00Z' }), /Avvio precedente/);
  assert.deepEqual(ledger.list(), before);
  assert.deepEqual(ledger.outbox(), events);
});

test('production day follows start in Europe/Rome even when a session crosses midnight', t => {
  const { ledger } = fixture(t);
  ledger.start({ ...base, now: '2026-11-10T22:59:00Z' });
  const closed = ledger.close(reading(1200, '2026-11-10T23:10:00Z'));
  assert.equal(closed.productionDay, '2026-11-10');
  const next = ledger.start({ ...base, id: 'SIM-002', cumulative: 1200, now: '2026-11-10T23:11:00Z' });
  assert.equal(next.productionDay, '2026-11-11');
});

test('committed sessions and event IDs survive process exit without dispose', t => {
  const { ledger, dbPath } = fixture(t);
  ledger.dispose();
  const moduleUrl = new URL('../core/ledger.mjs', import.meta.url).href;
  const code = `import { Ledger } from ${JSON.stringify(moduleUrl)};
    const ledger = new Ledger(process.argv[1]);
    ledger.start(${JSON.stringify(base)});
    ledger.observe(${JSON.stringify(reading(1200))});
    process.exit(0);`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', code, dbPath], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  const reopened = new Ledger(dbPath);
  try {
    assert.equal(reopened.list()[0].cartons, 200);
    const ids = reopened.outbox().map(e => e.id);
    assert.equal(new Set(ids).size, 2);
    reopened.observe(reading(1200));
    assert.deepEqual(reopened.outbox().map(e => e.id), ids);
  } finally {
    reopened.dispose();
  }
});

test('another database is refused rather than repurposed for the simulation', t => {
  const directory = mkdtempSync(join(tmpdir(), 'logo-foreign-db-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'other.sqlite');
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE operational_data(id INTEGER); INSERT INTO operational_data VALUES (7);');
  db.close();
  assert.throws(() => new Ledger(file), /Archivio diverso/);
  const verify = new DatabaseSync(file);
  assert.equal(verify.prepare('SELECT id FROM operational_data').get().id, 7);
  assert.equal(verify.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name LIKE 'bridge_sim_%'").get().n, 0);
  verify.close();
});

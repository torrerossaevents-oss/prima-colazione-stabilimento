import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { BridgeStore } from '../core/store.mjs';
import { createCounterState } from '../core/counter.mjs';
import { backupArchive, restoreArchive, inspectArchive } from '../backup.mjs';

const options = { mode: 'impianto', line: 'linea-test' };

function populate(store) {
  store.followSession({ id: 's-1' }, { baseline: 1000, at: 't0', counterState: createCounterState({ baseline: 1000, at: 0 }) });
  store.closeSession({ sessionId: 's-1', closeRequestId: 'linea-test-1-1000', requestValue: 1, counterStart: 1000, counterEnd: 1200, cartons: 200,
    closedAt: '2026-11-13T09:00:00.000Z', anomalies: [], modulo: 2 ** 32, newCounterState: createCounterState({ baseline: 1200, at: 1 }) });
  store.followSession({ id: 's-2' }, { baseline: 1200, at: 't1', counterState: { ...createCounterState({ baseline: 1200, at: 1 }), last: 1250, lastAt: 2 } });
}

test('il ripristino da backup restituisce gli stessi eventi e la stessa baseline', t => {
  const dir = mkdtempSync(join(tmpdir(), 'ponte-backup-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dbFile = join(dir, 'ponte.sqlite');
  const backupDir = join(dir, 'backup');
  let store = new BridgeStore(dbFile, options);
  populate(store);
  const expected = { events: store.events(), sessions: store.sessions(), counter: store.getState('counter'), closeRef: store.getState('closeRef') };
  // Backup con l'archivio ancora aperto (servizio in funzione).
  const backup = backupArchive(dbFile, backupDir);
  assert.equal(inspectArchive(backup).events, 1);
  // Modifiche successive al backup.
  store.markConfirmed(expected.events[0].eventId, { at: 'x', duplicate: false, httpStatus: 200 });
  store.saveCounter({ ...expected.counter, last: 1300 }, { sessionId: 's-2' });
  store.close();
  restoreArchive(backup, dbFile, backupDir);
  store = new BridgeStore(dbFile, options);
  try {
    assert.deepEqual(store.events(), expected.events);
    assert.deepEqual(store.sessions(), expected.sessions);
    assert.deepEqual(store.getState('counter'), expected.counter);
    assert.deepEqual(store.getState('closeRef'), expected.closeRef);
  } finally { store.close(); }
});

test('ripristino rifiutato per file non validi o di altra modalità; copia di sicurezza prima del ripristino', t => {
  const dir = mkdtempSync(join(tmpdir(), 'ponte-backup-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dbFile = join(dir, 'ponte.sqlite');
  new BridgeStore(dbFile, options).close();
  const fake = join(dir, 'falso.sqlite');
  writeFileSync(fake, 'non è un database');
  assert.throws(() => restoreArchive(fake, dbFile, join(dir, 'backup')));
  const simFile = join(dir, 'sim.sqlite');
  new BridgeStore(simFile, { mode: 'simulazione', line: 'linea-test' }).close();
  assert.throws(() => restoreArchive(simFile, dbFile, join(dir, 'backup')), /ripristino rifiutato/);
  const backup = backupArchive(dbFile, join(dir, 'backup'));
  restoreArchive(backup, dbFile, join(dir, 'backup'));
  const cli = fileURLToPath(new URL('../backup.mjs', import.meta.url));
  const listed = spawnSync(process.execPath, [cli, 'elenco', '--dati', dir], { encoding: 'utf8' });
  assert.equal(listed.status, 0);
  assert.match(listed.stdout, /prima-del-ripristino-/);
});

test('interruzione brusca del processo dopo il commit: i dati restano (PC spento)', t => {
  const dir = mkdtempSync(join(tmpdir(), 'ponte-crash-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dbFile = join(dir, 'ponte.sqlite');
  const store = new URL('../core/store.mjs', import.meta.url).href;
  const counter = new URL('../core/counter.mjs', import.meta.url).href;
  const code = `
    import { BridgeStore } from ${JSON.stringify(store)};
    import { createCounterState } from ${JSON.stringify(counter)};
    const s = new BridgeStore(process.argv[1], { mode: 'impianto', line: 'linea-test' });
    s.followSession({ id: 's-1' }, { baseline: 1000, at: 't0', counterState: createCounterState({ baseline: 1000, at: 0 }) });
    s.closeSession({ sessionId: 's-1', closeRequestId: 'r-1', requestValue: 1, counterStart: 1000, counterEnd: 1200, cartons: 200,
      closedAt: '2026-11-13T09:00:00.000Z', anomalies: [], modulo: 2 ** 32, newCounterState: createCounterState({ baseline: 1200, at: 1 }) });
    process.kill(process.pid, 'SIGKILL');`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', code, dbFile], { encoding: 'utf8' });
  assert.equal(child.signal, 'SIGKILL');
  const reopened = new BridgeStore(dbFile, options);
  try {
    assert.equal(reopened.session('s-1').cartons, 200);
    assert.equal(reopened.events().length, 1);
    assert.equal(reopened.getState('counter').baseline, 1200);
  } finally { reopened.close(); }
});

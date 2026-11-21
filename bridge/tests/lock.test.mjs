import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BOOT_TOLERANCE_MS, bootTime, lockHeldByLiveProcess, lockIsLive, lockText, parseLock } from '../core/lock.mjs';
import { acquireLock } from '../core/service.mjs';

test('blocco: formato nuovo e vecchio leggibili', () => {
  assert.deepEqual(parseLock(lockText(4321, 1000)), { pid: 4321, boot: 1000 });
  assert.deepEqual(parseLock('4321'), { pid: 4321, boot: null }, 'vecchio formato: solo il numero');
  assert.equal(parseLock('rotto'), null);
  assert.equal(bootTime(10_000, 4), 6000);
});

test('blocco scritto prima di un riavvio: scaduto anche se il numero di processo è di nuovo in uso', () => {
  const alive = () => true;
  assert.equal(lockIsLive({ pid: 99, boot: 1_000_000 }, { currentBoot: 1_000_000 + BOOT_TOLERANCE_MS + 1, alive, self: 1 }), false, 'altra accensione del PC');
  assert.equal(lockIsLive({ pid: 99, boot: 1_000_000 }, { currentBoot: 1_000_500, alive, self: 1 }), true, 'stessa accensione e processo vivo');
  assert.equal(lockIsLive({ pid: 99, boot: 1_000_000 }, { currentBoot: 1_000_500, alive: () => false, self: 1 }), false, 'processo terminato');
  assert.equal(lockIsLive({ pid: 99, boot: null }, { currentBoot: 5, alive, self: 1 }), true, 'vecchio formato: decide il processo');
  assert.equal(lockIsLive({ pid: 1, boot: null }, { alive, self: 1 }), false, 'il proprio processo non blocca');
});

test('acquireLock sostituisce un blocco scaduto e rifiuta un secondo servizio vivo', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ponte-lock-'));
  try {
    writeFileSync(join(dir, 'ponte.lock'), JSON.stringify({ pid: process.pid + 100000, boot: 1 }));
    const release = acquireLock(dir);
    assert.equal(parseLock(readFileSync(join(dir, 'ponte.lock'), 'utf8')).pid, process.pid);
    assert.equal(lockHeldByLiveProcess(dir), false, 'il proprio blocco non è «un altro servizio»');
    assert.throws(() => acquireLock(dir), /già in esecuzione/);
    release();
    writeFileSync(join(dir, 'ponte.lock'), lockText(process.ppid));
    assert.equal(lockHeldByLiveProcess(dir), true, 'processo vivo nella stessa accensione');
    assert.throws(() => acquireLock(dir), /già in esecuzione/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

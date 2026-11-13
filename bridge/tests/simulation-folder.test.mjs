import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const service = fileURLToPath(new URL('../service.mjs', import.meta.url));
const run = dir => spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', service, '--dati', dir, '--durata', '1', '--silenzioso'], { encoding: 'utf8', timeout: 30000 });

test('la simulazione non cancella una cartella che non è un suo archivio', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cartella utente '));
  try {
    writeFileSync(join(dir, 'importante.txt'), 'non cancellare');
    const result = run(dir);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /non è un archivio di simulazione/);
    assert.ok(existsSync(join(dir, 'importante.txt')));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('la simulazione può ripartire sulla propria cartella', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'sim ')), 'dati');
  try {
    assert.equal(run(dir).status, 0);
    assert.equal(run(dir).status, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

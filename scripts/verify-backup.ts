/**
 * Offline restore test of a downloaded backup: restores it into a fresh in-memory
 * database built from drizzle/ migrations, re-reads it, compares the digest and
 * validates the state. Nothing is sent anywhere.
 * Usage: node --experimental-strip-types --no-warnings scripts/verify-backup.ts <backup.json>
 */
import { readFile } from 'node:fs/promises';
import { restoreBackup } from '../lib/server/backup.ts';
import { readWorkspace } from '../lib/server/workspace.ts';
import { stockIndex } from '../lib/domain.ts';
import { sqliteDb } from '../tests/helpers/d1.ts';

const file = process.argv[2];
if (!file) { console.error('Indica il file di backup: node --experimental-strip-types scripts/verify-backup.ts <file.json>'); process.exit(2); }
const t = await sqliteDb();
try {
  const result = await restoreBackup(t.db, JSON.parse(await readFile(file, 'utf8')));
  const { state, archive } = await readWorkspace(t.db);
  const index = stockIndex(state);
  const totals = [...index.products.entries()].map(([id, x]) => ({ code: state.products.find(p => p.id === id)?.code, ...x }));
  console.log(JSON.stringify({ esito: 'RIPRISTINO VERIFICATO', impronta: result.digest, conteggi: result.counts, archivio: archive, articoli: state.products.length, lotti: state.lots.length, ordiniAperti: state.orders.filter(o => !['dispatched', 'cancelled'].includes(o.status)).length, totaliPerArticolo: totals.slice(0, 20) }, null, 2));
} catch (error) {
  console.error('RIPRISTINO NON VERIFICATO:', error instanceof Error ? error.message : error); process.exitCode = 1;
} finally { await t.close(); }

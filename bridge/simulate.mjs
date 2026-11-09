import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strict as assert } from 'node:assert';
import { Ledger } from './core/ledger.mjs';

// Ogni avvio crea una prova separata. Nessun IP, PLC o indirizzo CRM viene usato.
const directory = mkdtempSync(join(tmpdir(), 'prima-colazione-logo-SIMULAZIONE-'));
const database = join(directory, 'simulazione.sqlite');
let ledger;
try {
  console.log('PRIMA COLAZIONE — PROVA LOCALE CON DATI SIMULATI');
  console.log('Nessun collegamento alla macchina e nessuna modifica al magazzino reale.\n');
  ledger = new Ledger(database);
  const first = { id: 'SIM-A', code: 'SIM-ARTICOLO-A', name: 'Articolo A — simulazione', lot: 'SIM-LOTTO-A', operator: 'OPERATORE DI PROVA', cumulative: 1000, now: '2026-11-10T08:00:00.000Z' };
  ledger.start(first);
  ledger.observe({ sessionId: first.id, cumulative: 1100, now: '2026-11-10T08:05:00.000Z' });
  ledger.observe({ sessionId: first.id, cumulative: 1200, now: '2026-11-10T08:10:00.000Z' });
  // Rileggere lo stesso valore non aggiunge altri cartoni.
  ledger.observe({ sessionId: first.id, cumulative: 1200, now: '2026-11-10T08:11:00.000Z' });
  const closeA = { sessionId: first.id, cumulative: 1200, now: '2026-11-10T08:12:00.000Z' };
  ledger.close(closeA);
  ledger.close(closeA);

  ledger.start({ id: 'SIM-B', code: 'SIM-ARTICOLO-B', name: 'Articolo B — simulazione', lot: 'SIM-LOTTO-B', operator: 'OPERATORE DI PROVA', cumulative: 1200, now: '2026-11-10T09:00:00.000Z' });
  ledger.observe({ sessionId: 'SIM-B', cumulative: 1350, now: '2026-11-10T09:15:00.000Z' });
  const beforeRestart = ledger.list();
  const beforeEvents = ledger.outbox();
  ledger.dispose();
  ledger = new Ledger(database);
  assert.deepEqual(ledger.list(), beforeRestart);
  assert.deepEqual(ledger.outbox(), beforeEvents);
  ledger.close({ sessionId: 'SIM-B', cumulative: 1350, now: '2026-11-10T09:16:00.000Z' });
  const sessions = ledger.list();
  assert.deepEqual(sessions.map(s => s.cartons), [200, 150]);
  const total = sessions.reduce((sum, s) => sum + s.cartons, 0);
  assert.equal(total, 350);
  assert.equal(ledger.outbox().filter(e => e.kind === 'session.closed').length, 2);
  const report = {
    schemaVersion: 1, simulation: true, productionDay: '2026-11-10', totalCartons: total,
    checks: { duplicateReading: true, duplicateClose: true, persistenceAfterReopen: true },
    sessions, pendingEvents: ledger.outbox(),
    note: 'Prova software locale. Non certifica il conteggio hardware, lo spegnimento improvviso o la sincronizzazione cloud.',
  };
  const reportPath = join(directory, 'RISULTATO-SIMULAZIONE.json');
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log('Articolo A: 200 cartoni simulati');
  console.log('Articolo B: 150 cartoni simulati');
  console.log('Totale della prova: 350 cartoni simulati');
  console.log('OK: riletture e doppia chiusura non duplicano il conteggio.');
  console.log('OK: sessioni e coda locale conservate dopo chiusura e riapertura del database.');
  console.log('Coda locale predisposta; invio al gestionale non attivato.');
  console.log(`\nRapporto della prova: ${reportPath}`);
} catch (error) {
  console.error('PROVA NON SUPERATA:', error.message);
  process.exitCode = 1;
} finally {
  ledger?.dispose();
}

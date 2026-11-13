/**
 * Usage: node --experimental-strip-types --no-warnings scripts/sites-export-to-backup.ts <export.json> <backup.json>
 * Reads the «Esporta archivio» file downloaded from Sites and writes a restorable backup.
 * Then verify it with scripts/verify-backup.ts and restore it in Configurazione → Backup completo.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { sitesExportToBackup } from '../lib/server/sites-export.ts';

const [source, target] = process.argv.slice(2);
if (!source || !target) { console.error('Uso: node --experimental-strip-types scripts/sites-export-to-backup.ts <esportazione.json> <backup.json>'); process.exit(2); }
try {
  const backup = await sitesExportToBackup(JSON.parse(await readFile(source, 'utf8')));
  const state = JSON.parse(backup.data.workspace!.payload);
  await writeFile(target, JSON.stringify(backup));
  console.log(JSON.stringify({ esito: 'BACKUP CREATO', file: target, versione: backup.counts.version, articoli: state.products.length, lotti: state.lots.length, ordini: state.orders.length, lavorazioni: state.sessions.length, operazioniStorico: state.audit.length, impronta: backup.digest }, null, 2));
} catch (error) { console.error('CONVERSIONE NON RIUSCITA:', error instanceof Error ? error.message : error); process.exitCode = 1; }

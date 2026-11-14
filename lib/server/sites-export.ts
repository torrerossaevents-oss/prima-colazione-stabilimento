/**
 * Converts the «Esporta archivio» file of the version published on Sites
 * ({ exportedAt, version, state }) into a complete backup that can be restored into an
 * empty archive (e.g. the new Cloudflare database). The full log is still inside the
 * state: the first save after the restore moves it to the indexed table, as for any
 * legacy archive. Request receipts did not exist in that file: stop using Sites before
 * exporting, so no operation is left half-sent.
 */
import { BACKUP_FORMAT, digestOf, type Backup } from './backup.ts';
import { parseState } from './workspace.ts';

export async function sitesExportToBackup(input: unknown): Promise<Backup> {
  const file = input as { exportedAt?: unknown; version?: unknown; state?: unknown };
  if (!file || typeof file !== 'object' || !file.state || typeof file.state !== 'object') throw new Error('File non riconosciuto: serve l’esportazione «Esporta archivio» del gestionale.');
  if (!Number.isSafeInteger(file.version) || (file.version as number) < 0) throw new Error('Versione dell’archivio non valida nel file.');
  const exportedAt = typeof file.exportedAt === 'string' && Number.isFinite(Date.parse(file.exportedAt)) ? file.exportedAt : new Date().toISOString();
  const payload = JSON.stringify(file.state);
  parseState(payload); // refuses a state that does not validate
  const data: Backup['data'] = { workspace: { version: file.version as number, payload, updated_at: exportedAt, last_request_id: null }, receipts: [], audit: [], archive: [], snapshots: [] };
  return { format: BACKUP_FORMAT, formatVersion: 1, createdAt: new Date().toISOString(), digest: await digestOf(data), counts: { version: file.version as number, receipts: 0, audit: 0, archive: 0, snapshots: 0 }, devices: [], data };
}

import { env } from 'cloudflare:workers';
import { exportBackup, restoreBackup, RestoreError } from '../../../../lib/server/backup.ts';
import { DomainError } from '../../../../lib/domain.ts';
import { json, readLimited, requireDb, sameOrigin, serverError } from '../../../../lib/server/http.ts';
import { identify } from '../../../../lib/server/auth.ts';
import { canUse } from '../../../../lib/permissions.ts';
export const dynamic = 'force-dynamic';
/** Measured budget for the Worker memory (text + parse + digest + verification ≈ 5× the file). */
const MAX_RESTORE_BYTES = 20_000_000;
/** Owner-only full backup download. Contains operational data: keep it private, never in Git. */
export async function GET(request: Request) {
 const who = await identify(request, env, import.meta.env.DEV);
 if (!who) return json({ error: 'Accedi per scaricare il backup.' }, 401);
 if (!canUse(who.role, 'backup')) return json({ error: 'Riservato all’amministrazione.', code: 'forbidden' }, 403);
 try {
  const backup = await exportBackup(requireDb(env.DB));
  const name = `prima-colazione-backup-${backup.createdAt.slice(0, 19).replaceAll(':', '-')}.json`;
  return new Response(JSON.stringify(backup), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' } });
 } catch (error) { return serverError(error, 'Backup non riuscito.'); }
}
/** Restore into an EMPTY archive only; verified by reading back and comparing the digest. */
export async function POST(request: Request) {
 const who = await identify(request, env, import.meta.env.DEV);
 if (!who) return json({ error: 'Accedi per ripristinare.' }, 401);
 if (!canUse(who.role, 'backup')) return json({ error: 'Riservato all’amministrazione.', code: 'forbidden' }, 403);
 if (!sameOrigin(request)) return json({ error: 'Origine della richiesta non autorizzata.' }, 403);
 const raw = await readLimited(request, MAX_RESTORE_BYTES); if (raw === null) return json({ error: 'Backup troppo grande per il ripristino via web.' }, 413);
 let backup: unknown; try { backup = JSON.parse(raw); } catch { return json({ error: 'File di backup non leggibile.' }, 400); }
 try { return json({ ok: true, ...(await restoreBackup(requireDb(env.DB), backup)) }); }
 catch (error) { if (error instanceof RestoreError || error instanceof DomainError) return json({ error: error.message }, 422); return serverError(error, 'Ripristino non riuscito. Ricarica la pagina e controlla se l’archivio è ancora vuoto prima di riprovare.'); }
}

import { env } from 'cloudflare:workers';
import type { Action } from '../../../lib/domain.ts';
import { commit, domainStatus, MAX_REQUEST_BYTES, readWorkspace, REQUEST_ID } from '../../../lib/server/workspace.ts';
import { activeDeviceCount } from '../../../lib/server/devices.ts';
import { json, readLimited, sameOrigin, serverError } from '../../../lib/server/http.ts';
import { ownerOf } from '../../../lib/server/auth.ts';
export const dynamic = 'force-dynamic';
function database() { if (!env.DB) throw new Error('Archivio non disponibile.'); return env.DB; }
export async function GET(request: Request) {
 if (!(await ownerOf(request, env, import.meta.env.DEV))) return json({ error: 'Accedi per consultare lo stabilimento.' }, 401);
 try { const db = database(); return json({ ...(await readWorkspace(db)), devicesEnabled: (await activeDeviceCount(db)) > 0 }); }
 catch (error) { const known = domainStatus(error); return known ? json(known, known.status) : serverError(error, 'Impossibile leggere l’archivio.'); }
}
export async function POST(request: Request) {
 const actor = await ownerOf(request, env, import.meta.env.DEV);
 if (!actor) return json({ error: 'Accedi prima di salvare.' }, 401);
 if (!sameOrigin(request)) return json({ error: 'Origine della richiesta non autorizzata.' }, 403);
 try {
  const raw = await readLimited(request, MAX_REQUEST_BYTES); if (raw === null) return json({ error: 'Richiesta troppo grande.' }, 413);
  let input: { action: Action; expectedVersion: number; requestId: string }; try { input = JSON.parse(raw); } catch { return json({ error: 'Richiesta non valida.' }, 400); }
  if (!input || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0 || typeof input.requestId !== 'string' || !REQUEST_ID.test(input.requestId) || !input.action) return json({ error: 'Richiesta incompleta o versione non valida.' }, 400);
  const db = database();
  const result = await commit(db, { action: input.action, expectedVersion: input.expectedVersion, requestId: input.requestId, actor, devicesEnabled: (await activeDeviceCount(db)) > 0 });
  if (!result.ok) { const { status, ...body } = result; return json({ ...body, ok: undefined }, status); }
  return json({ ...result, ok: undefined });
 } catch (error) { const known = domainStatus(error); return known ? json(known, known.status) : serverError(error); }
}

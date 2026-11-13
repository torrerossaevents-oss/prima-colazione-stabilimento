import { env } from 'cloudflare:workers';
import { ABANDONED, abandonRequest, REQUEST_ID, WORKSPACE_ID } from '../../../../lib/server/workspace.ts';
import { json, ownerId, readLimited, requireDb, sameOrigin, serverError } from '../../../../lib/server/http.ts';
export const dynamic = 'force-dynamic';
/** GET ?id= — read-only check: was this request id committed? Used to resolve an uncertain save. */
export async function GET(request: Request) {
 if (!ownerId(request, import.meta.env.DEV, env.OWNER_USER_IDS)) return json({ error: 'Accedi per verificare.' }, 401);
 const id = new URL(request.url).searchParams.get('id') ?? '';
 if (!REQUEST_ID.test(id)) return json({ error: 'Identificativo non valido.' }, 400);
 try {
  const row = await requireDb(env.DB).prepare('SELECT version, created_at, digest FROM workspace_requests WHERE id = ? AND workspace_id = ?').bind(id, WORKSPACE_ID).first<{ version: number; created_at: string; digest: string }>();
  return json(row && row.digest !== ABANDONED ? { committed: true, version: row.version, at: row.created_at } : { committed: false, abandoned: Boolean(row) });
 } catch (error) { return serverError(error, 'Verifica non riuscita.'); }
}
/** POST {id} — abandon an uncertain request: a late arrival of it will be refused. */
export async function POST(request: Request) {
 if (!ownerId(request, import.meta.env.DEV, env.OWNER_USER_IDS)) return json({ error: 'Accedi per verificare.' }, 401);
 if (!sameOrigin(request)) return json({ error: 'Origine della richiesta non autorizzata.' }, 403);
 const raw = await readLimited(request, 1_000); if (raw === null) return json({ error: 'Richiesta troppo grande.' }, 413);
 let id = ''; try { id = String(JSON.parse(raw).id ?? ''); } catch { return json({ error: 'Richiesta non valida.' }, 400); }
 if (!REQUEST_ID.test(id)) return json({ error: 'Identificativo non valido.' }, 400);
 try { return json(await abandonRequest(requireDb(env.DB), id)); } catch (error) { return serverError(error, 'Operazione non riuscita: riprova.'); }
}

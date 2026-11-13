import { env } from 'cloudflare:workers';
import { REQUEST_ID, WORKSPACE_ID } from '../../../../lib/server/workspace.ts';
import { json, ownerId, requireDb, serverError } from '../../../../lib/server/http.ts';
export const dynamic = 'force-dynamic';
/** GET ?id= — read-only check: was this request id committed? Used to resolve an uncertain save. */
export async function GET(request: Request) {
 if (!ownerId(request, import.meta.env.DEV)) return json({ error: 'Accedi per verificare.' }, 401);
 const id = new URL(request.url).searchParams.get('id') ?? '';
 if (!REQUEST_ID.test(id)) return json({ error: 'Identificativo non valido.' }, 400);
 try {
  const row = await requireDb(env.DB).prepare('SELECT version, created_at FROM workspace_requests WHERE id = ? AND workspace_id = ?').bind(id, WORKSPACE_ID).first<{ version: number; created_at: string }>();
  return json(row ? { committed: true, version: row.version, at: row.created_at } : { committed: false });
 } catch (error) { return serverError(error, 'Verifica non riuscita.'); }
}

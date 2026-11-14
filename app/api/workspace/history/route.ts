import { env } from 'cloudflare:workers';
import { auditPage, parseState, WORKSPACE_ID } from '../../../../lib/server/workspace.ts';
import { json, serverError, requireDb } from '../../../../lib/server/http.ts';
import { ownerOf } from '../../../../lib/server/auth.ts';
export const dynamic = 'force-dynamic';
/** GET ?q=&before=<at>|<id>&limit=50 — activity log, newest first. */
export async function GET(request: Request) {
 if (!(await ownerOf(request, env, import.meta.env.DEV))) return json({ error: 'Accedi per consultare lo storico.' }, 401);
 try {
  const url = new URL(request.url); const before = url.searchParams.get('before'); const [at, id] = before ? before.split('|') : [];
  const row = await requireDb(env.DB).prepare('SELECT payload FROM workspaces WHERE id = ?').bind(WORKSPACE_ID).first<{ payload: string }>();
  const legacy = row ? parseState(row.payload).audit : [];
  return json(await auditPage(requireDb(env.DB), { before: at && id ? { at, id } : undefined, limit: Number(url.searchParams.get('limit')) || 50, q: url.searchParams.get('q') ?? undefined, legacy }));
 } catch (error) { return serverError(error, 'Impossibile leggere lo storico.'); }
}

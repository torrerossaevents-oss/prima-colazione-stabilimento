import { env } from 'cloudflare:workers';
import { auditPage, parseState, WORKSPACE_ID } from '../../../../lib/server/workspace.ts';
import { json, serverError, requireDb } from '../../../../lib/server/http.ts';
import { AUDIT_GROUP_PREFIX, DomainError, type AuditGroup } from '../../../../lib/domain.ts';
import { ownerOf } from '../../../../lib/server/auth.ts';
export const dynamic = 'force-dynamic';
/** GET ?q=&from=YYYY-MM-DD&to=YYYY-MM-DD&group=production|inventory|orders|catalog&before=<at>|<id>&limit=50 — activity log, newest first (Rome days, both included). */
export async function GET(request: Request) {
 if (!(await ownerOf(request, env, import.meta.env.DEV))) return json({ error: 'Accedi per consultare lo storico.' }, 401);
 try {
  const url = new URL(request.url); const before = url.searchParams.get('before'); const [at, id] = before ? before.split('|') : [];
  const row = await requireDb(env.DB).prepare('SELECT payload FROM workspaces WHERE id = ?').bind(WORKSPACE_ID).first<{ payload: string }>();
  const legacy = row ? parseState(row.payload).audit : [];
  const group = url.searchParams.get('group') || undefined;
  if (group && !Object.hasOwn(AUDIT_GROUP_PREFIX, group)) return json({ error: 'Tipo di operazione non valido.' }, 400);
  return json(await auditPage(requireDb(env.DB), { before: at && id ? { at, id } : undefined, limit: Number(url.searchParams.get('limit')) || 50, q: url.searchParams.get('q') ?? undefined, from: url.searchParams.get('from') || undefined, to: url.searchParams.get('to') || undefined, group: group as AuditGroup | undefined, legacy }));
 } catch (error) {
  if (error instanceof DomainError) return json({ error: error.message }, 400);
  return serverError(error, 'Impossibile leggere lo storico.'); }
}

import { env } from 'cloudflare:workers';
import { archivePage } from '../../../../lib/server/workspace.ts';
import { json, ownerId, serverError, requireDb } from '../../../../lib/server/http.ts';
export const dynamic = 'force-dynamic';
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** GET ?kind=order|session|lot&from=&to=&q=&before=<day>|<id>&limit= — archived rows, newest first. */
export async function GET(request: Request) {
 if (!ownerId(request, import.meta.env.DEV)) return json({ error: 'Accedi per consultare l’archivio.' }, 401);
 const url = new URL(request.url); const kind = url.searchParams.get('kind');
 if (kind !== 'order' && kind !== 'session' && kind !== 'lot') return json({ error: 'Tipo di archivio non valido.' }, 400);
 const from = url.searchParams.get('from') || undefined; const to = url.searchParams.get('to') || undefined;
 if ((from && !DAY.test(from)) || (to && !DAY.test(to))) return json({ error: 'Intervallo di date non valido.' }, 400);
 const before = url.searchParams.get('before'); const [day, id] = before ? before.split('|') : [];
 try { return json(await archivePage(requireDb(env.DB), { kind, from, to, q: url.searchParams.get('q') ?? undefined, before: day && id ? { day, id } : undefined, limit: Number(url.searchParams.get('limit')) || 50 })); }
 catch (error) { return serverError(error, 'Impossibile leggere l’archivio.'); }
}

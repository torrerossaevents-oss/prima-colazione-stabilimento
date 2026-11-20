import { env } from 'cloudflare:workers';
import { liveStatus } from '../../../../lib/server/devices.ts';
import { json, serverError } from '../../../../lib/server/http.ts';
import { identify } from '../../../../lib/server/auth.ts';
export const dynamic = 'force-dynamic';
/** Conteggio dal vivo del ponte: una sola riga di stato, leggibile da amministrazione e laboratorio. */
export async function GET(request: Request) {
 const who = await identify(request, env, import.meta.env.DEV);
 if (!who) return json({ error: 'Accedi per consultare lo stabilimento.' }, 401);
 try { if (!env.DB) throw new Error('Archivio non disponibile.'); return json({ serverTime: new Date().toISOString(), live: await liveStatus(env.DB) }); }
 catch (error) { return serverError(error, 'Impossibile leggere il conteggio dal vivo.'); }
}

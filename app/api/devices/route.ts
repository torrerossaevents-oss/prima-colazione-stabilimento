import { env } from 'cloudflare:workers';
import { createDevice, listDevices, revokeDevice } from '../../../lib/server/devices.ts';
import { json, ownerId, readLimited, sameOrigin, serverError, requireDb } from '../../../lib/server/http.ts';
export const dynamic = 'force-dynamic';
/** Owner-only management of bridge credentials. */
export async function GET(request: Request) {
 if (!ownerId(request, import.meta.env.DEV)) return json({ error: 'Accedi per gestire i dispositivi.' }, 401);
 try { return json({ devices: await listDevices(requireDb(env.DB)), serverTime: new Date().toISOString() }); } catch (error) { return serverError(error, 'Impossibile leggere i dispositivi.'); }
}
export async function POST(request: Request) {
 const actor = ownerId(request, import.meta.env.DEV);
 if (!actor) return json({ error: 'Accedi per gestire i dispositivi.' }, 401);
 if (!sameOrigin(request)) return json({ error: 'Origine della richiesta non autorizzata.' }, 403);
 const raw = await readLimited(request, 4_000); if (raw === null) return json({ error: 'Richiesta troppo grande.' }, 413);
 let input: { op?: string; name?: unknown; id?: unknown }; try { input = JSON.parse(raw); } catch { return json({ error: 'Richiesta non valida.' }, 400); }
 try {
  if (input?.op === 'create' && typeof input.name === 'string') { const created = await createDevice(requireDb(env.DB), input.name, actor); return json(created); }
  if (input?.op === 'revoke' && typeof input.id === 'string') return (await revokeDevice(requireDb(env.DB), input.id)) ? json({ ok: true }) : json({ error: 'Dispositivo non trovato o già revocato.' }, 404);
  return json({ error: 'Operazione non valida.' }, 400);
 } catch (error) { if (error instanceof RangeError) return json({ error: error.message }, 422); return serverError(error, 'Operazione sul dispositivo non riuscita.'); }
}

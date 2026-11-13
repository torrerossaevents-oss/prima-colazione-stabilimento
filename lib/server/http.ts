/** Shared HTTP helpers for API routes. Identity headers are trusted only behind the hosting platform that sets them. */
export function json(body: unknown, status = 200) { return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } }); }
/**
 * Owner identity. When OWNER_USER_IDS is configured only those platform users are accepted;
 * when it is not, any user authenticated by the platform is accepted (behaviour before 13/11/2026).
 * In development without the platform header the local preview is open: never expose it on a network.
 */
export function ownerId(request: Request, dev: boolean, allowed?: string): string | null {
  const id = request.headers.get('oai-authenticated-user-id');
  const list = (allowed ?? '').split(',').map(s => s.trim()).filter(Boolean);
  if (id) return !list.length || list.includes(id) ? id : null;
  return dev ? 'anteprima-locale' : null;
}
export function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  return Boolean(origin && origin === new URL(request.url).origin);
}
export function serverError(error: unknown, message = 'Il salvataggio non è riuscito. Riprova: non verranno duplicate le operazioni già salvate.') {
  console.error('Workspace operation failed:', error instanceof Error ? error.message : 'unknown');
  return json({ error: message }, 500);
}
/** Reads the body as a stream and stops as soon as it exceeds `max` bytes (also without Content-Length). */
export async function readLimited(request: Request, max: number): Promise<string | null> {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > max) return null;
  if (!request.body) return '';
  const reader = request.body.getReader(); const parts: Uint8Array[] = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel().catch(() => {}); return null; }
    parts.push(value);
  }
  const all = new Uint8Array(size); let offset = 0; for (const p of parts) { all.set(p, offset); offset += p.byteLength; }
  return new TextDecoder().decode(all);
}
export function requireDb(db: D1Database | undefined): D1Database { if (!db) throw new Error('Archivio non disponibile.'); return db; }

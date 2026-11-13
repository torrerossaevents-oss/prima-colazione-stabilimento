/** Shared HTTP helpers for API routes. Identity headers are trusted only behind the hosting platform that sets them. */
export function json(body: unknown, status = 200) { return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } }); }
export function ownerId(request: Request, dev: boolean): string | null {
  return request.headers.get('oai-authenticated-user-id') || (dev ? 'anteprima-locale' : null);
}
export function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  return Boolean(origin && origin === new URL(request.url).origin);
}
export function serverError(error: unknown, message = 'Il salvataggio non è riuscito. Riprova: non verranno duplicate le operazioni già salvate.') {
  console.error('Workspace operation failed:', error instanceof Error ? error.message : 'unknown');
  return json({ error: message }, 500);
}
export async function readLimited(request: Request, max: number): Promise<string | null> {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > max) return null;
  const raw = await request.text();
  return new TextEncoder().encode(raw).length > max ? null : raw;
}
export function requireDb(db: D1Database | undefined): D1Database { if (!db) throw new Error('Archivio non disponibile.'); return db; }

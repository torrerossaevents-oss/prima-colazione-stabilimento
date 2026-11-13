/**
 * Browser helpers: fetch with an application timeout, readable errors and the record
 * of uncertain requests. The record only remembers WHAT to verify; the server receipt
 * (/api/workspace/receipt) is the authority on whether it was saved.
 */
export type Pending = { key: string; id: string; version: number; label: string; at: string; status?: 'sending' | 'uncertain' };
const KEY = 'prima-colazione-pending-v3'; // map id → Pending, shared by the tabs of this browser
const OLD_KEYS = ['prima-colazione-pending-v2']; // localStorage, single record
const LEGACY_KEY = 'prima-colazione-pending-v1'; // sessionStorage, versions before 13/11/2026
/** A «sending» record older than this belongs to a tab that never got an answer (closed or timed out). */
export const SENDING_GRACE_MS = 30_000;

export class TimeoutError extends Error {}
export class UncertainResponseError extends Error {}

export async function request(url: string, init: RequestInit = {}, timeoutMs = 15_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { cache: 'no-store', ...init, signal: controller.signal }); }
  catch (error) {
    if (controller.signal.aborted) throw new TimeoutError(`Nessuna risposta dal server entro ${Math.round(timeoutMs / 1000)} secondi.`);
    throw error;
  } finally { clearTimeout(timer); }
}

/**
 * Reads a workspace response. Anything that is not a JSON object with state and version
 * (e.g. a login page returned with 200 after a redirect) is an UNCERTAIN outcome, never a success.
 */
export async function readWorkspaceResponse<T extends { state?: unknown; version?: unknown; error?: string }>(res: Response): Promise<T> {
  const type = res.headers.get('content-type') || '';
  if (res.redirected || !type.includes('application/json')) throw new UncertainResponseError('Risposta inattesa dal server (forse l’accesso è scaduto): l’esito non è confermato.');
  let data: T;
  try { data = await res.json() as T; } catch { throw new UncertainResponseError('Risposta del server non leggibile: l’esito non è confermato.'); }
  if (res.ok && (!data || typeof data.state !== 'object' || data.state === null || !Number.isSafeInteger(data.version))) throw new UncertainResponseError('Risposta del server incompleta: l’esito non è confermato.');
  return data;
}

export function describeError(error: unknown, fallback: string): string {
  if (error instanceof TimeoutError || error instanceof UncertainResponseError) return error.message;
  if (error instanceof TypeError) return 'Connessione al server non riuscita.';
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function valid(value: unknown): value is Pending {
  const v = value as Pending | null;
  return Boolean(v && typeof v.key === 'string' && typeof v.id === 'string' && Number.isSafeInteger(v.version));
}
function normalize(v: Pending): Pending { return { key: v.key, id: v.id, version: v.version, label: v.label || 'Operazione precedente', at: v.at || new Date().toISOString(), status: v.status ?? 'uncertain' }; }
function readMap(): Record<string, Pending> {
  const map: Record<string, Pending> = {};
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) || '{}');
    if (stored && typeof stored === 'object') for (const v of Object.values(stored)) if (valid(v)) map[v.id] = normalize(v);
    for (const raw of [...OLD_KEYS.map(k => localStorage.getItem(k)), sessionStorage.getItem(LEGACY_KEY)]) { const v = raw ? JSON.parse(raw) : null; if (valid(v)) map[v.id] = normalize(v); }
  } catch { /* storage unavailable or corrupted: nothing to recover locally */ }
  return map;
}
/**
 * Requests to verify in this browser. `foreignOnly` (other tabs) hides requests that
 * another tab is still sending, unless they are older than the grace period.
 */
export function listPending(options: { now?: number; foreignOnly?: boolean } = {}): Pending[] {
  const now = options.now ?? Date.now();
  return Object.values(readMap()).filter(p => !options.foreignOnly || p.status === 'uncertain' || now - Date.parse(p.at) > SENDING_GRACE_MS).sort((a, b) => a.at.localeCompare(b.at));
}
export function readPending(): Pending | null { return listPending()[0] ?? null; }
export function writePending(value: Pending) {
  try { const map = readMap(); map[value.id] = value; localStorage.setItem(KEY, JSON.stringify(map)); for (const k of OLD_KEYS) localStorage.removeItem(k); sessionStorage.removeItem(LEGACY_KEY); } catch { /* private mode: the banner still works for this tab */ }
}
export function removePending(id?: string) {
  try {
    const map = readMap(); if (id) delete map[id]; else for (const k of Object.keys(map)) delete map[k];
    localStorage.setItem(KEY, JSON.stringify(map)); for (const k of OLD_KEYS) localStorage.removeItem(k); sessionStorage.removeItem(LEGACY_KEY);
  } catch { /* ignore */ }
}
export const PENDING_STORAGE_KEY = KEY;

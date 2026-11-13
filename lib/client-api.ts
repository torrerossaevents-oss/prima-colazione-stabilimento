/**
 * Browser helpers: fetch with an application timeout, readable errors and the record
 * of an uncertain request. The record only remembers WHAT to verify; the server
 * receipt (/api/workspace/receipt) is the authority on whether it was saved.
 */
export type Pending = { key: string; id: string; version: number; label: string; at: string };
const KEY = 'prima-colazione-pending-v2';
const LEGACY_KEY = 'prima-colazione-pending-v1'; // sessionStorage, versions before 13/11/2026

export class TimeoutError extends Error {}

export async function request(url: string, init: RequestInit = {}, timeoutMs = 15_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { cache: 'no-store', ...init, signal: controller.signal }); }
  catch (error) {
    if (controller.signal.aborted) throw new TimeoutError(`Nessuna risposta dal server entro ${Math.round(timeoutMs / 1000)} secondi.`);
    throw error;
  } finally { clearTimeout(timer); }
}

export function describeError(error: unknown, fallback: string): string {
  if (error instanceof TimeoutError) return error.message;
  if (error instanceof TypeError) return 'Connessione al server non riuscita.';
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function valid(value: unknown): value is Omit<Pending, 'label' | 'at'> & Partial<Pending> {
  const v = value as Pending | null;
  return Boolean(v && typeof v.key === 'string' && typeof v.id === 'string' && Number.isSafeInteger(v.version));
}
export function readPending(): Pending | null {
  try {
    for (const raw of [localStorage.getItem(KEY), sessionStorage.getItem(LEGACY_KEY)]) {
      const value = raw ? JSON.parse(raw) : null;
      if (valid(value)) return { key: value.key, id: value.id, version: value.version, label: value.label || 'Operazione precedente', at: value.at || new Date().toISOString() };
    }
  } catch { /* storage unavailable or corrupted: nothing to recover locally */ }
  return null;
}
export function writePending(value: Pending) { try { localStorage.setItem(KEY, JSON.stringify(value)); } catch { /* private mode: the banner still works for this tab */ } }
export function removePending() { try { localStorage.removeItem(KEY); sessionStorage.removeItem(LEGACY_KEY); } catch { /* ignore */ } }
export const PENDING_STORAGE_KEY = KEY;

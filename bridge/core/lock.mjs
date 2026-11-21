/**
 * Blocco «un solo servizio per archivio» (bridge/data/<modalità>/ponte.lock).
 * Il file contiene { pid, boot }: boot = istante di accensione del PC. Un blocco scritto prima di un
 * riavvio (mancanza di corrente, arresto forzato) è scaduto anche se, dopo il riavvio, un altro programma
 * ha ricevuto lo stesso numero di processo: così l'avvio automatico non resta bloccato.
 * I blocchi vecchi (solo il numero) restano leggibili.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { uptime } from 'node:os';

/** Scarto ammesso tra due calcoli dell'istante di accensione (orologio, arrotondamenti). */
export const BOOT_TOLERANCE_MS = 120_000;

export function bootTime(now = Date.now(), up = uptime()) { return Math.round(now - up * 1000); }

export function lockText(pid = process.pid, boot = bootTime()) { return JSON.stringify({ pid, boot }); }

export function parseLock(text) {
  const raw = String(text ?? '').trim();
  try {
    const value = JSON.parse(raw);
    if (Number.isSafeInteger(value)) return { pid: value, boot: null };
    if (value && Number.isSafeInteger(value.pid)) return { pid: value.pid, boot: Number.isFinite(value.boot) ? value.boot : null };
  } catch { /* formato non JSON */ }
  return null;
}

export function processAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}

/** Vero se il blocco appartiene a un altro processo ancora vivo in questa accensione del PC. */
export function lockIsLive(lock, { currentBoot = bootTime(), alive = processAlive, self = process.pid } = {}) {
  if (!lock || lock.pid === self) return false;
  if (lock.boot !== null && Math.abs(lock.boot - currentBoot) > BOOT_TOLERANCE_MS) return false;
  return alive(lock.pid);
}

export function lockHeldByLiveProcess(dataDir, options) {
  let text;
  try { text = readFileSync(join(dataDir, 'ponte.lock'), 'utf8'); } catch { return false; }
  return lockIsLive(parseLock(text), options);
}

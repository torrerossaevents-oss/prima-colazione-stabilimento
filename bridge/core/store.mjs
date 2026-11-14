/**
 * Archivio locale del servizio ponte (SQLite, node:sqlite).
 * - Ogni archivio è marcato con la modalità ("simulazione" o "impianto") e la linea:
 *   un archivio di simulazione non può essere aperto come impianto e viceversa.
 * - Una risposta riuscita arriva solo dopo il COMMIT; la chiusura salva sessione chiusa,
 *   evento in coda, nuova baseline e richiesta gestita in un'unica transazione.
 * - Gli eventi confermati restano nell'archivio (nessuna lista troncata in memoria).
 * - Il heartbeat non si accumula: esiste al massimo l'ultimo.
 */
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export const STORE_MARKER = 'prima-colazione-ponte-v1';
const OPEN_STATUSES = ['attiva', 'da-verificare'];
const MAX_ANOMALIES = 20;

export function newEventId(prefix = 'evt') {
  return `${prefix}_${randomUUID().replaceAll('-', '')}`;
}

export function mergeAnomalies(current, added) {
  const out = [...current];
  for (const item of added) if (item && !out.includes(item) && out.length < MAX_ANOMALIES) out.push(item);
  return out;
}

function sessionRow(row) {
  if (!row) return null;
  return {
    id: row.id, productCode: row.product_code, lotCode: row.lot_code, startedAt: row.started_at,
    followedAt: row.followed_at, baseline: row.baseline, status: row.status,
    anomalies: JSON.parse(row.anomalies), closeRequestId: row.close_request_id,
    counterEnd: row.counter_end, cartons: row.cartons, closedAt: row.closed_at,
  };
}

function eventRow(row) {
  return {
    sequence: row.sequence, eventId: row.event_id, type: row.type, sessionId: row.session_id,
    payload: JSON.parse(row.payload), status: row.status, attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at, lastError: row.last_error, lastHttpStatus: row.last_http_status,
    createdAt: row.created_at, updatedAt: row.updated_at, confirmedAt: row.confirmed_at, duplicate: row.duplicate === 1,
  };
}

export class BridgeStore {
  #db;

  /** Apre (o crea) l'archivio; rifiuta archivi di altra modalità, linea o formato. */
  constructor(file, { mode, line }) {
    if (!['simulazione', 'impianto'].includes(mode)) throw new Error('Modalità archivio non valida.');
    this.mode = mode;
    this.line = line;
    this.#db = new DatabaseSync(file);
    try {
      const tables = this.#db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
      if (tables.length && !tables.some(t => t.name === 'ponte_meta')) throw new Error('Archivio non riconosciuto: apertura rifiutata.');
      this.#db.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;');
      this.#db.exec(`
        CREATE TABLE IF NOT EXISTS ponte_meta (id INTEGER PRIMARY KEY CHECK (id = 1), marker TEXT NOT NULL,
          mode TEXT NOT NULL, line TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS ponte_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS ponte_sessions (
          id TEXT PRIMARY KEY, line TEXT NOT NULL, product_code TEXT, lot_code TEXT, started_at TEXT,
          followed_at TEXT NOT NULL, baseline INTEGER NOT NULL CHECK (baseline >= 0),
          status TEXT NOT NULL CHECK (status IN ('attiva', 'da-verificare', 'chiusa', 'non-seguita')),
          anomalies TEXT NOT NULL DEFAULT '[]', close_request_id TEXT,
          counter_end INTEGER, cartons INTEGER CHECK (cartons IS NULL OR cartons >= 0), closed_at TEXT);
        CREATE UNIQUE INDEX IF NOT EXISTS ponte_one_open ON ponte_sessions(line) WHERE status IN ('attiva', 'da-verificare');
        CREATE TABLE IF NOT EXISTS ponte_events (
          sequence INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL UNIQUE, type TEXT NOT NULL,
          session_id TEXT, payload TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('in-coda', 'confermato', 'da-verificare')),
          attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL DEFAULT 0,
          last_error TEXT, last_http_status INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
          confirmed_at TEXT, duplicate INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS ponte_heartbeat (id INTEGER PRIMARY KEY CHECK (id = 1), event_id TEXT NOT NULL,
          payload TEXT NOT NULL, created_at TEXT NOT NULL);
      `);
      this.#db.prepare('INSERT OR IGNORE INTO ponte_meta (id, marker, mode, line, created_at) VALUES (1, ?, ?, ?, ?)')
        .run(STORE_MARKER, mode, line, new Date().toISOString());
      const meta = this.#db.prepare('SELECT * FROM ponte_meta WHERE id = 1').get();
      if (meta.marker !== STORE_MARKER) throw new Error('Versione archivio non riconosciuta.');
      if (meta.mode !== mode) throw new Error(`Archivio di ${meta.mode}: non può essere usato in modalità ${mode}.`);
      if (meta.line !== line) throw new Error(`Archivio della linea ${meta.line}: la configurazione indica ${line}.`);
    } catch (error) {
      this.#db.close();
      this.#db = undefined;
      throw error;
    }
  }

  #tx(fn) {
    if (!this.#db) throw new Error('Archivio chiuso.');
    this.#db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.#db.exec('COMMIT'); return result; }
    catch (error) { this.#db.exec('ROLLBACK'); throw error; }
  }

  #setState(key, value) {
    this.#db.prepare('INSERT INTO ponte_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, JSON.stringify(value));
  }

  getState(key) {
    const row = this.#db.prepare('SELECT value FROM ponte_state WHERE key = ?').get(key);
    return row ? JSON.parse(row.value) : null;
  }

  setState(key, value) { this.#tx(() => this.#setState(key, value)); }

  #insertEvent({ eventId, type, sessionId = null, payload, createdAt }) {
    this.#db.prepare(`INSERT INTO ponte_events (event_id, type, session_id, payload, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'in-coda', ?, ?)`).run(eventId, type, sessionId, JSON.stringify(payload), createdAt, createdAt);
  }

  openSession() { return sessionRow(this.#db.prepare("SELECT * FROM ponte_sessions WHERE status IN ('attiva', 'da-verificare')").get()); }
  session(id) { return sessionRow(this.#db.prepare('SELECT * FROM ponte_sessions WHERE id = ?').get(id)); }
  sessions() { return this.#db.prepare('SELECT * FROM ponte_sessions ORDER BY followed_at, rowid').all().map(sessionRow); }

  /** Inizia a seguire una lavorazione del gestionale con la baseline indicata. */
  followSession(remote, { baseline, at, counterState }) {
    return this.#tx(() => {
      if (this.openSession()) throw new Error('Esiste già una lavorazione seguita: nessuna seconda sessione sulla stessa linea.');
      if (this.session(remote.id)) throw new Error('Lavorazione già seguita in passato: non viene riaperta.');
      this.#db.prepare(`INSERT INTO ponte_sessions (id, line, product_code, lot_code, started_at, followed_at, baseline, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'attiva')`).run(remote.id, this.line, remote.productCode ?? null, remote.lotCode ?? null,
        remote.startedAt ?? null, at, baseline);
      this.#setState('counter', counterState);
      return this.session(remote.id);
    });
  }

  /** Salva lo stato del contatore e, se serve, stato/anomalie della sessione aperta. */
  saveCounter(counterState, { sessionId = null, status = null, anomalies = [] } = {}) {
    this.#tx(() => {
      this.#setState('counter', counterState);
      if (!sessionId) return;
      const current = this.session(sessionId);
      if (!current || !OPEN_STATUSES.includes(current.status)) throw new Error('Sessione non aperta.');
      this.#db.prepare('UPDATE ponte_sessions SET status = ?, anomalies = ? WHERE id = ?')
        .run(status ?? current.status, JSON.stringify(mergeAnomalies(current.anomalies, anomalies)), sessionId);
    });
  }

  /** Lavorazione non più attiva sul gestionale: conservata localmente, non più contata. */
  stopFollowing(sessionId, anomaly) {
    this.#tx(() => {
      const current = this.session(sessionId);
      this.#db.prepare("UPDATE ponte_sessions SET status = 'non-seguita', anomalies = ? WHERE id = ?")
        .run(JSON.stringify(mergeAnomalies(current.anomalies, [anomaly])), sessionId);
    });
  }

  /**
   * Chiusura atomica: sessione chiusa + evento session.close in coda + nuova baseline
   * + richiesta segnata come gestita + riscontro da inviare, in una sola transazione.
   */
  closeSession({ sessionId, closeRequestId, requestValue, counterStart, counterEnd, cartons, closedAt, anomalies, modulo, newCounterState, eventId = newEventId() }) {
    return this.#tx(() => {
      const current = this.session(sessionId);
      if (!current || !OPEN_STATUSES.includes(current.status)) throw new Error('Nessuna lavorazione aperta da chiudere.');
      if (!Number.isSafeInteger(cartons) || cartons < 0) throw new Error('Quantità di chiusura non valida.');
      const allAnomalies = mergeAnomalies(current.anomalies, anomalies);
      this.#db.prepare(`UPDATE ponte_sessions SET status = 'chiusa', close_request_id = ?, counter_end = ?, cartons = ?,
        closed_at = ?, anomalies = ? WHERE id = ?`).run(closeRequestId, counterEnd, cartons, closedAt, JSON.stringify(allAnomalies), sessionId);
      const payload = { eventId, type: 'session.close', sessionId, closeRequestId, counterStart, counterEnd, cartons, closedAt, anomalies: allAnomalies };
      if (counterEnd < counterStart) payload.counterModulo = modulo;
      this.#insertEvent({ eventId, type: 'session.close', sessionId, payload, createdAt: closedAt });
      this.#setState('counter', newCounterState);
      this.#setState('closeRef', { value: requestValue });
      this.#setState('ackPending', { value: requestValue, closeRequestId });
      return { session: this.session(sessionId), event: payload };
    });
  }

  // --- Coda eventi -------------------------------------------------------------------

  dueEvents(nowMs) {
    return this.#db.prepare("SELECT * FROM ponte_events WHERE status = 'in-coda' AND next_attempt_at <= ? ORDER BY sequence").all(nowMs).map(eventRow);
  }

  events() { return this.#db.prepare('SELECT * FROM ponte_events ORDER BY sequence').all().map(eventRow); }

  markConfirmed(eventId, { at, duplicate, httpStatus }) {
    this.#tx(() => this.#db.prepare(`UPDATE ponte_events SET status = 'confermato', confirmed_at = ?, updated_at = ?, duplicate = ?,
      last_http_status = ?, last_error = NULL, attempts = attempts + 1 WHERE event_id = ? AND status = 'in-coda'`)
      .run(at, at, duplicate ? 1 : 0, httpStatus, eventId));
  }

  markRetry(eventId, { at, nextAttemptAt, error, httpStatus = null }) {
    this.#tx(() => this.#db.prepare(`UPDATE ponte_events SET attempts = attempts + 1, next_attempt_at = ?, last_error = ?,
      last_http_status = ?, updated_at = ? WHERE event_id = ? AND status = 'in-coda'`).run(nextAttemptAt, error, httpStatus, at, eventId));
  }

  /** 401: l'evento resta in coda senza consumare un tentativo. */
  markAuthPaused(eventId, { at, error }) {
    this.#tx(() => this.#db.prepare(`UPDATE ponte_events SET last_error = ?, last_http_status = 401, updated_at = ?
      WHERE event_id = ? AND status = 'in-coda'`).run(error, at, eventId));
  }

  markReview(eventId, { at, error, httpStatus }) {
    this.#tx(() => this.#db.prepare(`UPDATE ponte_events SET status = 'da-verificare', attempts = attempts + 1, last_error = ?,
      last_http_status = ?, updated_at = ? WHERE event_id = ? AND status = 'in-coda'`).run(error, httpStatus, at, eventId));
  }

  counts() {
    const rows = this.#db.prepare('SELECT status, COUNT(*) AS n FROM ponte_events GROUP BY status').all();
    const out = { 'in-coda': 0, confermato: 0, 'da-verificare': 0 };
    for (const row of rows) out[row.status] = row.n;
    return out;
  }

  // --- Heartbeat: solo l'ultimo --------------------------------------------------------

  setHeartbeat(payload, at) {
    this.#tx(() => this.#db.prepare(`INSERT INTO ponte_heartbeat (id, event_id, payload, created_at) VALUES (1, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET event_id = excluded.event_id, payload = excluded.payload, created_at = excluded.created_at`)
      .run(payload.eventId, JSON.stringify(payload), at));
  }

  heartbeat() {
    const row = this.#db.prepare('SELECT payload FROM ponte_heartbeat WHERE id = 1').get();
    return row ? JSON.parse(row.payload) : null;
  }

  clearHeartbeat(eventId) {
    this.#tx(() => this.#db.prepare('DELETE FROM ponte_heartbeat WHERE id = 1 AND event_id = ?').run(eventId));
  }

  close() {
    if (this.#db) { this.#db.close(); this.#db = undefined; }
  }
}

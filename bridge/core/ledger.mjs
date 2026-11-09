import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

const MARKER = 'prima-colazione-logo-simulation-v1';
const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit',
});

function text(value, label, max = 160) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max || /[\u0000-\u001f]/.test(value)) {
    throw new Error(`${label}: inserisci un testo valido (massimo ${max} caratteri).`);
  }
  return value.trim();
}

function counter(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Cumulativo non valido: serve un intero positivo o zero.');
  return value;
}

function instant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
    throw new Error('Data non valida: usa un istante UTC ISO, per esempio 2026-11-10T08:00:00.000Z.');
  }
  const ms = Date.parse(value);
  const normalized = value.includes('.') ? value : value.replace('Z', '.000Z');
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== normalized) throw new Error('Data non valida.');
  return normalized;
}

function productionDay(value) {
  const parts = Object.fromEntries(dayFormatter.formatToParts(new Date(value)).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function snapshot(row) {
  if (!row) return undefined;
  return {
    id: row.id, code: row.code, name: row.name, lot: row.lot, operator: row.operator,
    baseline: row.baseline, cumulative: row.cumulative, cartons: row.cumulative - row.baseline,
    startedAt: row.started_at, updatedAt: row.updated_at, closedAt: row.closed_at,
    productionDay: row.production_day, status: row.status, simulation: true,
  };
}

/**
 * Registro di preparazione e simulazione; non comanda LOGO! e non invia dati al CRM.
 * Il cumulativo viene sempre acquisito come valore assoluto, mai sommato al parziale.
 * API sincrona: una risposta riuscita arriva soltanto dopo il commit SQLite.
 */
export class Ledger {
  #db;

  constructor(dbPath) {
    if (typeof dbPath !== 'string' || !dbPath.trim()) throw new Error('Indica il file SQLite della simulazione.');
    this.#db = new DatabaseSync(dbPath);
    try {
      const tables = this.#db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
      if (tables.length) {
        if (!tables.some(t => t.name === 'bridge_sim_meta')) throw new Error('Archivio diverso dalla simulazione: apertura rifiutata.');
        const meta = this.#db.prepare('SELECT marker FROM bridge_sim_meta WHERE id = 1').get();
        if (meta?.marker !== MARKER) throw new Error('Versione archivio simulazione non riconosciuta.');
      }
      this.#db.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;');
      this.#db.exec(`
        CREATE TABLE IF NOT EXISTS bridge_sim_meta (id INTEGER PRIMARY KEY CHECK (id = 1), marker TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS bridge_sim_sessions (
          id TEXT PRIMARY KEY, code TEXT NOT NULL, name TEXT NOT NULL, lot TEXT NOT NULL, operator TEXT NOT NULL,
          baseline INTEGER NOT NULL CHECK (baseline >= 0), cumulative INTEGER NOT NULL CHECK (cumulative >= baseline),
          started_at TEXT NOT NULL, updated_at TEXT NOT NULL, closed_at TEXT,
          production_day TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('active', 'closed'))
        );
        CREATE UNIQUE INDEX IF NOT EXISTS bridge_sim_one_active ON bridge_sim_sessions(status) WHERE status = 'active';
        CREATE TABLE IF NOT EXISTS bridge_sim_outbox (
          sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
          session_id TEXT NOT NULL REFERENCES bridge_sim_sessions(id), kind TEXT NOT NULL,
          created_at TEXT NOT NULL, payload TEXT NOT NULL
        );
      `);
      this.#db.prepare('INSERT OR IGNORE INTO bridge_sim_meta (id, marker) VALUES (1, ?)').run(MARKER);
    } catch (error) {
      this.#db.close();
      this.#db = undefined;
      throw error;
    }
  }

  #transaction(fn) {
    if (!this.#db) throw new Error('Archivio chiuso.');
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.#db.exec('COMMIT');
      return result;
    } catch (error) {
      this.#db.exec('ROLLBACK');
      throw error;
    }
  }

  #get(id) { return snapshot(this.#db.prepare('SELECT * FROM bridge_sim_sessions WHERE id = ?').get(id)); }

  #enqueue(kind, session, now) {
    const id = randomUUID();
    this.#db.prepare('INSERT INTO bridge_sim_outbox (id, session_id, kind, created_at, payload) VALUES (?, ?, ?, ?, ?)')
      .run(id, session.id, kind, now, JSON.stringify({ schemaVersion: 1, simulation: true, session }));
  }

  start(input) {
    const p = {
      id: text(input?.id, 'Identificativo lavorazione', 100), code: text(input?.code, 'Codice articolo', 80),
      name: text(input?.name, 'Descrizione', 250), lot: text(input?.lot, 'Lotto', 100),
      operator: text(input?.operator, 'Operatore', 100), cumulative: counter(input?.cumulative), now: instant(input?.now),
    };
    return this.#transaction(() => {
      const existing = this.#get(p.id);
      if (existing) {
        if (existing.code !== p.code || existing.name !== p.name || existing.lot !== p.lot || existing.operator !== p.operator ||
            existing.baseline !== p.cumulative || existing.startedAt !== p.now) throw new Error('Identificativo già usato con dati diversi.');
        return existing;
      }
      if (this.#db.prepare("SELECT id FROM bridge_sim_sessions WHERE status = 'active'").get()) {
        throw new Error('Esiste già una lavorazione aperta: chiudila prima del nuovo avvio.');
      }
      const previous = this.#db.prepare('SELECT cumulative, updated_at FROM bridge_sim_sessions ORDER BY updated_at DESC, rowid DESC LIMIT 1').get();
      if (previous && p.now < previous.updated_at) throw new Error('Avvio precedente all’ultima registrazione: controlla l’orologio.');
      if (previous && p.cumulative < previous.cumulative) throw new Error('Cumulativo diminuito: reset o riavvio da verificare, nessun nuovo avvio.');
      this.#db.prepare(`INSERT INTO bridge_sim_sessions
        (id, code, name, lot, operator, baseline, cumulative, started_at, updated_at, closed_at, production_day, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 'active')`)
        .run(p.id, p.code, p.name, p.lot, p.operator, p.cumulative, p.cumulative, p.now, p.now, productionDay(p.now));
      const saved = this.#get(p.id);
      this.#enqueue('session.started', saved, p.now);
      return saved;
    });
  }

  #reading(input) {
    return { sessionId: text(input?.sessionId, 'Identificativo lavorazione', 100), cumulative: counter(input?.cumulative), now: instant(input?.now) };
  }

  #checkReading(current, p) {
    if (p.now < current.updatedAt) throw new Error('Lettura fuori ordine: l’archivio conserva una registrazione più recente.');
    if (p.cumulative < current.cumulative) throw new Error('Cumulativo diminuito: reset, riavvio o limite contatore da verificare.');
    if (p.now === current.updatedAt && p.cumulative !== current.cumulative) throw new Error('Stesso istante con conteggi diversi: lettura da verificare.');
  }

  observe(input) {
    const p = this.#reading(input);
    return this.#transaction(() => {
      const current = this.#get(p.sessionId);
      if (!current) throw new Error('Lavorazione sconosciuta.');
      if (current.status !== 'active') throw new Error('Lavorazione già chiusa: lo storico non è modificabile.');
      this.#checkReading(current, p);
      if (p.now === current.updatedAt) return current;
      this.#db.prepare('UPDATE bridge_sim_sessions SET cumulative = ?, updated_at = ? WHERE id = ?')
        .run(p.cumulative, p.now, p.sessionId);
      const saved = this.#get(p.sessionId);
      if (p.cumulative !== current.cumulative) this.#enqueue('session.counted', saved, p.now);
      return saved;
    });
  }

  close(input) {
    const p = this.#reading(input);
    return this.#transaction(() => {
      const current = this.#get(p.sessionId);
      if (!current) throw new Error('Lavorazione sconosciuta.');
      if (current.status === 'closed') {
        if (p.cumulative !== current.cumulative || p.now < current.closedAt) throw new Error('Chiusura ripetuta con dati diversi o precedenti: storico invariato.');
        return current;
      }
      this.#checkReading(current, p);
      this.#db.prepare("UPDATE bridge_sim_sessions SET cumulative = ?, updated_at = ?, closed_at = ?, status = 'closed' WHERE id = ?")
        .run(p.cumulative, p.now, p.now, p.sessionId);
      const saved = this.#get(p.sessionId);
      this.#enqueue('session.closed', saved, p.now);
      return saved;
    });
  }

  list() {
    if (!this.#db) throw new Error('Archivio chiuso.');
    return this.#db.prepare('SELECT * FROM bridge_sim_sessions ORDER BY started_at, rowid').all().map(snapshot);
  }

  outbox() {
    if (!this.#db) throw new Error('Archivio chiuso.');
    return this.#db.prepare('SELECT * FROM bridge_sim_outbox ORDER BY sequence').all().map(row => ({
      sequence: row.sequence, id: row.id, sessionId: row.session_id, kind: row.kind,
      createdAt: row.created_at, payload: JSON.parse(row.payload), status: 'pending',
    }));
  }

  dispose() {
    if (this.#db) { this.#db.close(); this.#db = undefined; }
  }
}

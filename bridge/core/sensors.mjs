/**
 * Macchina a stati delle due fotocellule (A = prima, B = seconda), modulo puro.
 *
 * IMPORTANTE: sull'impianto il conteggio reale avviene nel programma LOGO!.
 * Questo modulo serve al simulatore di protocollo e come riferimento verificabile
 * della logica che il programma LOGO! dovrà implementare. Il ponte sul PC non conta
 * i cartoni dai sensori: legge il contatore cumulativo del PLC.
 *
 * Stato = due cifre "AB" (1 = fascio interrotto). Sequenza valida di un cartone:
 *   00 → 10 → 11 → 01 → 00  = +1 cartone
 * - Stesso stato ripetuto (sosta): nessun effetto.
 * - Arretramento (10→00, 11→10, 01→11): anomalia «arretramento», il passaggio non conta.
 * - Salto (00→11, 00→01, 10→01, 01→10, 11→00): anomalia «sequenza-incompleta», non conta.
 * Un passaggio con un'anomalia non conta nemmeno se poi termina in 01→00; ogni passaggio
 * produce al massimo un'anomalia. Per contare deve ripartire pulito da 00.
 * Filtro rimbalzi: un nuovo stato è accettato solo dopo essere rimasto uguale per
 * almeno `minStableMs` (valore da misurare sulla linea; nessun valore predefinito reale).
 */

export const SENSOR_STATES = Object.freeze(['00', '10', '11', '01']);
const NEXT = { '00': '10', '10': '11', '11': '01', '01': '00' };
const PREVIOUS = { '10': '00', '11': '10', '01': '11' };

export function classifyTransition(from, to) {
  if (from === to) return 'sosta';
  if (NEXT[from] === to) return 'avanti';
  if (PREVIOUS[from] === to) return 'arretramento';
  return 'sequenza-incompleta';
}

export class SensorTracker {
  constructor({ minStableMs } = {}) {
    if (!Number.isSafeInteger(minStableMs) || minStableMs < 0) {
      throw new Error('minStableMs: indicare un intero >= 0 (tempo minimo misurato sulla linea).');
    }
    this.minStableMs = minStableMs;
    this.accepted = null;      // ultimo stato accettato dopo il filtro
    this.candidate = null;     // stato grezzo in attesa di conferma
    this.candidateSince = null;
    this.lastAt = null;
    this.passage = 'none';     // none | clean (iniziato da 00, senza anomalie) | flagged | unknown
    this.count = 0;
    this.anomalies = { arretramento: 0, 'sequenza-incompleta': 0, 'stato-non-valido': 0, total: 0 };
  }

  /** Un campione grezzo dei sensori. Restituisce { counted, anomaly, accepted }. */
  feed(state, atMs) {
    if (!Number.isFinite(atMs) || (this.lastAt !== null && atMs < this.lastAt)) {
      throw new Error('Campione sensori fuori ordine temporale.');
    }
    this.lastAt = atMs;
    if (!SENSOR_STATES.includes(state)) return this.#anomaly('stato-non-valido');
    if (state !== this.candidate) { this.candidate = state; this.candidateSince = atMs; }
    if (state === this.accepted) return { counted: false, anomaly: null, accepted: null };
    if (atMs - this.candidateSince < this.minStableMs) return { counted: false, anomaly: null, accepted: null };
    return this.#accept(state);
  }

  /** Il tempo passa senza nuovi campioni: equivale a ripetere l'ultimo campione. */
  tick(atMs) {
    return this.candidate === null ? { counted: false, anomaly: null, accepted: null } : this.feed(this.candidate, atMs);
  }

  /** Sensori liberi (00) accettati e grezzi stabili da almeno holdMs. */
  isClearAndStable(atMs, holdMs) {
    return this.accepted === '00' && this.candidate === '00' && atMs - this.candidateSince >= holdMs;
  }

  #accept(state) {
    const from = this.accepted;
    this.accepted = state;
    if (from === null) {
      // Primo stato osservato: un passaggio già iniziato non è verificabile.
      this.passage = state === '00' ? 'none' : 'unknown';
      return { counted: false, anomaly: null, accepted: state };
    }
    const kind = classifyTransition(from, state);
    if (kind !== 'avanti') {
      // Una sola anomalia per passaggio: altri movimenti dello stesso cartone non si sommano.
      const alreadyFlagged = this.passage === 'flagged';
      this.passage = state === '00' ? 'none' : 'flagged';
      if (alreadyFlagged) return { counted: false, anomaly: null, accepted: state };
      return { ...this.#anomaly(kind), accepted: state };
    }
    if (from === '00') this.passage = 'clean';
    if (state !== '00') return { counted: false, anomaly: null, accepted: state };
    const passage = this.passage;
    this.passage = 'none';
    if (passage === 'clean') { this.count += 1; return { counted: true, anomaly: null, accepted: state }; }
    // Passaggio iniziato prima dell'osservazione: non contato, segnalato una volta.
    // Un passaggio già segnalato (flagged) non genera una seconda anomalia.
    if (passage === 'unknown') return { ...this.#anomaly('sequenza-incompleta'), accepted: state };
    return { counted: false, anomaly: null, accepted: state };
  }

  #anomaly(kind) {
    this.anomalies[kind] += 1;
    this.anomalies.total += 1;
    return { counted: false, anomaly: kind, accepted: null };
  }
}

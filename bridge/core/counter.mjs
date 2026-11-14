/**
 * Contatore cumulativo del PLC e baseline della lavorazione, modulo puro.
 *
 * partial = cumulativo − baseline (con superamento del limite gestito modulo `modulo`).
 * Il ponte non somma mai le letture: confronta valori assoluti.
 * - Superamento del limite (rollover): ammesso solo se il passo risultante è plausibile.
 * - Diminuzione inattesa (riavvio PLC senza ritenzione, reset esterno): anomalia
 *   «contatore-diminuito», conteggio sospeso («da-verificare»), parziale congelato.
 *   Nessuna quantità ricostruita o negativa.
 * - Lettura fuori intervallo o salto oltre `maxStepPerSecond` × tempo trascorso:
 *   anomalia, lettura scartata (l'ultimo valore valido resta il riferimento).
 * I limiti (`modulo`, `maxStepPerSecond`) dipendono dal programma LOGO! e dalla
 * velocità della linea: vanno confermati con il tecnico.
 */

export const DEFAULT_MODULO = 2 ** 32;

function positiveInteger(value, field) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${field}: indicare un intero positivo.`);
  return value;
}

/** Passo in avanti da `from` a `to` modulo `modulo` (il chiamante decide se è plausibile). */
export function forwardStep(from, to, modulo) {
  return to >= from ? to - from : modulo - from + to;
}

/**
 * Stato serializzabile: { baseline, last, lastAt, suspended, anomalies }.
 * `observe` non modifica l'oggetto ricevuto: restituisce il nuovo stato e l'esito.
 */
export function createCounterState({ baseline, at }) {
  return { baseline, last: baseline, lastAt: at, suspended: false, anomalies: [] };
}

export function partialOf(state, modulo = DEFAULT_MODULO) {
  return (state.last - state.baseline + modulo) % modulo;
}

export function observeCounter(state, reading, { modulo = DEFAULT_MODULO, maxStepPerSecond } = {}) {
  positiveInteger(modulo, 'modulo');
  positiveInteger(maxStepPerSecond, 'maxStepPerSecond');
  const { value, at } = reading;
  const result = (patch, outcome) => ({ state: { ...state, ...patch }, ...outcome });
  if (!Number.isSafeInteger(value) || value < 0 || value >= modulo) {
    return result({}, { accepted: false, anomaly: 'lettura-non-valida' });
  }
  if (!Number.isFinite(at) || at < state.lastAt) return result({}, { accepted: false, anomaly: 'lettura-fuori-ordine' });
  if (state.suspended) return result({}, { accepted: false, anomaly: null, suspended: true });
  if (value === state.last) return result({ lastAt: at }, { accepted: true, step: 0, anomaly: null });

  const elapsedSeconds = Math.max(1, Math.ceil((at - state.lastAt) / 1000));
  const allowed = maxStepPerSecond * elapsedSeconds;
  if (value > state.last) {
    const step = value - state.last;
    if (step > allowed) return result({}, { accepted: false, anomaly: 'salto-eccessivo', step });
    return result({ last: value, lastAt: at }, { accepted: true, step, anomaly: null });
  }
  // value < last: rollover plausibile oppure diminuzione.
  const wrapped = forwardStep(state.last, value, modulo);
  if (wrapped <= allowed) return result({ last: value, lastAt: at }, { accepted: true, step: wrapped, anomaly: null, rollover: true });
  const anomalies = state.anomalies.includes('contatore-diminuito') ? state.anomalies : [...state.anomalies, 'contatore-diminuito'];
  return result({ suspended: true, anomalies, observedAfterDecrease: value }, { accepted: false, anomaly: 'contatore-diminuito', suspended: true });
}

/**
 * Lettura a 32 bit su due registri: due letture consecutive.
 * Accettata se coincidono, oppure se la parola alta non è cambiata e il valore non è
 * diminuito (si usa la seconda). È una MITIGAZIONE contro letture «strappate» durante
 * il riporto tra le due parole, non una prova di atomicità: va verificata sull'impianto
 * (meglio se il programma LOGO! fornisce una copia congelata o un numero di sequenza).
 */
export function acceptDoubleRead(first, second) {
  for (const value of [first, second]) {
    if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) return { ok: false, reason: 'lettura-non-valida' };
  }
  if (first === second) return { ok: true, value: second };
  const highFirst = Math.floor(first / 65536);
  const highSecond = Math.floor(second / 65536);
  if (highFirst === highSecond && second > first) return { ok: true, value: second };
  return { ok: false, reason: 'letture-discordanti' };
}

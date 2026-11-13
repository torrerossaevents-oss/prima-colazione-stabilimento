/**
 * Trasmettitore verso il gestionale (docs/CONTRATTO-PONTE.md, versione 1).
 * - Coda persistente in SQLite (BridgeStore): un evento esiste prima del primo invio,
 *   i ritentativi riusano lo stesso eventId, un evento confermato non viene rinviato.
 * - fetch con timeout (AbortController) e attesa crescente con tetto tra i tentativi.
 * - Classificazione delle risposte secondo la tabella del contratto.
 * - Heartbeat: si invia solo l'ultimo; se fallisce viene sostituito dal successivo.
 * Il token non viene mai scritto nei log o nel file di stato.
 */

export const PATH = '/api/devices/production';

/** Esito di una risposta HTTP secondo la tabella del contratto. */
export function classifyResponse(status, json) {
  if (status === 200) {
    if (json && json.ok === true) return { outcome: 'confermato', duplicate: json.duplicate === true };
    // Esempio: pagina HTML di accesso della piattaforma restituita con 200.
    return { outcome: 'ritenta', warning: 'risposta 200 non riconosciuta (non è {ok:true})' };
  }
  if (status === 401) return { outcome: 'auth' };
  if ([400, 409, 413, 422].includes(status)) return { outcome: 'da-verificare' };
  if (status >= 500) return { outcome: 'ritenta' };
  // 3xx, 403, 404, 429…: non previsti dal contratto. Esito incerto: nessuno scarto, si ritenta.
  return { outcome: 'ritenta', warning: `risposta ${status} non prevista dal contratto` };
}

export function backoffMs(attempts, { baseMs, maxMs }) {
  return Math.min(maxMs, baseMs * 2 ** Math.min(attempts, 20));
}

/** Una richiesta JSON con timeout. Lancia un errore per rete/timeout (esito incerto). */
export async function requestJson({ fetchImpl = globalThis.fetch, url, method, token, body, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method,
      headers: { authorization: `Bearer ${token}`, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'manual',
      signal: controller.signal,
    });
    const raw = await response.text();
    let json = null;
    try { json = raw ? JSON.parse(raw) : null; } catch { json = null; }
    return { status: response.status, json };
  } catch (error) {
    const timeout = controller.signal.aborted;
    const wrapped = new Error(timeout ? `timeout dopo ${timeoutMs} ms, esito incerto` : `rete assente o connessione interrotta (${error.cause?.code ?? error.code ?? error.name}), esito incerto`);
    wrapped.kind = timeout ? 'timeout' : 'rete';
    throw wrapped;
  } finally {
    clearTimeout(timer);
  }
}

export class Transmitter {
  constructor({ store, baseUrl, token, timeoutMs, retry, now = Date.now, fetchImpl = globalThis.fetch, log = () => {} }) {
    Object.assign(this, { store, token, timeoutMs, retry, now, fetchImpl, log });
    this.url = baseUrl.replace(/\/$/, '') + PATH;
    this.authPaused = false;
    this.lastContactAt = null;
    this.lastError = null;
  }

  #request(method, body) {
    return requestJson({ fetchImpl: this.fetchImpl, url: this.url, method, token: this.token, body, timeoutMs: this.timeoutMs });
  }

  #pauseForAuth() {
    if (!this.authPaused) this.log('ALLARME', 'Gestionale: token del dispositivo rifiutato (401). Invii fermati; gli eventi restano in coda. Verificare il token in Configurazione e riavviare il servizio.');
    this.authPaused = true;
  }

  /** GET della lavorazione attiva. Non lancia: restituisce { ok, activeSession } oppure { ok:false, reason }. */
  async getActiveSession() {
    if (this.authPaused) return { ok: false, reason: 'auth' };
    try {
      const { status, json } = await this.#request('GET');
      if (status === 401) { this.#pauseForAuth(); return { ok: false, reason: 'auth', status }; }
      if (status !== 200 || !json || typeof json !== 'object' || !('activeSession' in json)) {
        this.lastError = `GET: risposta ${status} non riconosciuta`;
        return { ok: false, reason: 'risposta', status };
      }
      this.lastContactAt = new Date(this.now()).toISOString();
      const active = json.activeSession;
      // Il ponte non conta per lavorazioni manuali (il server dovrebbe già inviare null).
      const activeSession = active && active.source !== 'manual' && typeof active.id === 'string' ? active : null;
      return { ok: true, activeSession, line: json.line, serverTime: json.serverTime };
    } catch (error) {
      this.lastError = `GET: ${error.message}`;
      return { ok: false, reason: error.kind ?? 'rete', error: error.message };
    }
  }

  /** Invia gli eventi in coda già scaduti, in ordine. Si ferma al primo esito incerto. */
  async flush() {
    const summary = { confirmed: 0, review: 0, retry: 0, paused: this.authPaused };
    if (this.authPaused) return summary;
    for (const event of this.store.dueEvents(this.now())) {
      const at = new Date(this.now()).toISOString();
      let result;
      try {
        const { status, json } = await this.#request('POST', event.payload);
        result = { status, json, ...classifyResponse(status, json) };
      } catch (error) {
        result = { status: null, outcome: 'ritenta', error: error.message };
      }
      if (result.outcome === 'confermato') {
        this.lastContactAt = at;
        this.store.markConfirmed(event.eventId, { at, duplicate: result.duplicate, httpStatus: result.status });
        this.log('INFO', `Evento ${event.eventId} confermato dal gestionale${result.duplicate ? ' (già registrato: duplicato riconosciuto)' : ''}.`);
        summary.confirmed++;
      } else if (result.outcome === 'auth') {
        this.store.markAuthPaused(event.eventId, { at, error: '401 token rifiutato' });
        this.#pauseForAuth();
        summary.paused = true;
        break;
      } else if (result.outcome === 'da-verificare') {
        const code = result.json?.code ? ` ${result.json.code}` : '';
        this.store.markReview(event.eventId, { at, error: `HTTP ${result.status}${code}`, httpStatus: result.status });
        this.log('ALLARME', `Evento ${event.eventId} rifiutato (HTTP ${result.status}${code}): spostato in «da verificare», non viene ritentato.`);
        summary.review++;
      } else {
        const next = this.now() + backoffMs(event.attempts, this.retry);
        const reason = result.error ?? result.warning ?? `HTTP ${result.status}`;
        this.lastError = reason;
        this.store.markRetry(event.eventId, { at, nextAttemptAt: next, error: reason, httpStatus: result.status });
        this.log('AVVISO', `Invio ${event.eventId} non confermato (${reason}): nuovo tentativo con lo stesso identificativo dopo ${Math.round((next - this.now()) / 1000)} s.`);
        summary.retry++;
        break;
      }
    }
    return summary;
  }

  /** Invia l'ultimo heartbeat salvato. In caso di errore resta, finché non è sostituito. */
  async sendHeartbeat() {
    const heartbeat = this.store.heartbeat();
    if (!heartbeat || this.authPaused) return false;
    try {
      const { status, json } = await this.#request('POST', heartbeat);
      const { outcome } = classifyResponse(status, json);
      if (outcome === 'auth') { this.#pauseForAuth(); return false; }
      if (outcome !== 'confermato') { this.lastError = `heartbeat: HTTP ${status}`; return false; }
      this.lastContactAt = new Date(this.now()).toISOString();
      this.store.clearHeartbeat(heartbeat.eventId);
      return true;
    } catch (error) {
      this.lastError = `heartbeat: ${error.message}`;
      return false;
    }
  }
}

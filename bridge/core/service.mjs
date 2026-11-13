/**
 * Servizio ponte: un ciclo che legge il PLC, segue la lavorazione attiva del gestionale,
 * gestisce la chiusura e trasmette gli eventi. Lo stesso codice gira in simulazione
 * (PLC simulato su 127.0.0.1) e sull'impianto (LOGO! via Modbus TCP).
 *
 * Regole:
 * - Il conteggio reale è nel PLC: il ponte legge il cumulativo assoluto (mai somme).
 * - Il ponte non apre lavorazioni: segue quella attiva del gestionale (GET). Senza Internet
 *   continua la sessione già identificata, ma non ne inizia di nuove.
 * - Chiusura: richiesta nuova del pulsante → sensori liberi e stabili → transazione SQLite
 *   (sessione chiusa + evento in coda + nuova baseline) → riscontro al PLC solo se
 *   writesEnabled === true → invio con ritentativi.
 * Il conteggio non sostituisce arresti o dispositivi di sicurezza della macchina.
 */
import { mkdirSync, writeFileSync, renameSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { BridgeStore, newEventId } from './store.mjs';
import { Transmitter } from './transmitter.mjs';
import { createCounterState, observeCounter, partialOf } from './counter.mjs';
import { RotatingLog } from './log.mjs';

export const BRIDGE_VERSION = '1.0.0';

function processAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}

const heldLocks = new Set();

/** Impedisce due servizi sullo stesso archivio. Un blocco lasciato da un processo terminato viene sostituito. */
export function acquireLock(dataDir) {
  const file = join(dataDir, 'ponte.lock');
  if (heldLocks.has(file)) throw new Error('Servizio già in esecuzione su questo archivio (stesso processo).');
  try {
    writeFileSync(file, String(process.pid), { flag: 'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const pid = Number(readFileSync(file, 'utf8'));
    if (Number.isSafeInteger(pid) && pid !== process.pid && processAlive(pid)) {
      throw new Error(`Servizio già in esecuzione su questo archivio (processo ${pid}).`);
    }
    writeFileSync(file, String(process.pid));
  }
  heldLocks.add(file);
  return () => { heldLocks.delete(file); rmSync(file, { force: true }); };
}

export class BridgeService {
  constructor({ config, token, dataDir, plc, now = Date.now, fetchImpl = globalThis.fetch, echo = false }) {
    this.config = config;
    this.plc = plc;
    this.now = now;
    this.dataDir = dataDir;
    mkdirSync(dataDir, { recursive: true });
    this.releaseLock = acquireLock(dataDir);
    this.logger = new RotatingLog({ dir: join(dataDir, 'log'), maxBytes: config.log.maxBytes, files: config.log.files, now, echo });
    try {
      this.store = new BridgeStore(join(dataDir, 'ponte.sqlite'), { mode: config.mode, line: config.line });
    } catch (error) {
      this.releaseLock();
      throw error;
    }
    this.transmitter = new Transmitter({
      store: this.store, baseUrl: config.server.baseUrl, token, timeoutMs: config.server.timeoutMs,
      retry: config.retry, now, fetchImpl, log: (level, message) => this.log(level, message),
    });
    this.counter = this.store.getState('counter');
    this.closeRef = this.store.getState('closeRef');
    this.pendingClose = null;
    this.sensorsFreeSince = null;
    this.lastReading = null;
    this.lastReadAt = null;
    this.lastSyncAt = -Infinity;
    this.lastHeartbeatAt = -Infinity;
    this.lastHeartbeatSentAt = null;
    this.conditions = { plc: null, internet: null };
    this.lastErrors = { plc: null, internet: null };
    this.writesNoticeShown = false;
    this.stopping = false;
    this.#logResume();
  }

  log(level, message) { this.logger.write(level, message); }

  #logResume() {
    const tag = this.config.mode === 'simulazione' ? 'SIMULAZIONE' : 'IMPIANTO';
    this.log('INFO', `Avvio servizio ponte ${BRIDGE_VERSION} — modalità ${tag}, linea ${this.config.line}. Scritture sul PLC: ${this.config.plc.writesEnabled ? 'abilitate' : 'disabilitate'}.`);
    const session = this.store.openSession();
    const queue = this.store.counts()['in-coda'];
    if (this.counter || session || queue) {
      this.log('INFO', `Ripresa dall'archivio locale (riavvio del PC o del servizio): ${session ? `lavorazione ${session.id} (${session.status}), baseline ${session.baseline}` : 'nessuna lavorazione seguita'}, ultimo cumulativo ${this.counter?.last ?? 'n.d.'}, ${queue} eventi in coda.`);
    }
  }

  /** Registra solo i cambi di condizione (es. Internet assente → tornato). */
  #condition(name, ok, downMessage, upMessage) {
    const previous = this.conditions[name];
    this.conditions[name] = ok;
    if (ok && previous === false) this.log('INFO', upMessage);
    if (!ok && previous !== false) this.log('ALLARME', downMessage);
  }

  get modulo() { return this.config.plc.counter.modulo; }

  // --- Lettura PLC e contatore ---------------------------------------------------------

  async #readPlc() {
    try {
      const reading = await this.plc.read();
      this.lastReading = reading;
      this.lastReadAt = this.now();
      this.lastErrors.plc = null;
      this.#condition('plc', true, '', 'PLC di nuovo raggiungibile sulla LAN: letture riprese.');
      return reading;
    } catch (error) {
      this.lastErrors.plc = error.message;
      if (error.code === 'PLC_DATA') {
        this.log('AVVISO', `Dato PLC scartato: ${error.message}`);
        return null;
      }
      this.#condition('plc', false, `LAN/PLC non raggiungibile: ${error.message} Il PLC continua a contare; nessuna quantità viene stimata. La lavorazione resta aperta.`, '');
      return null;
    }
  }

  #processCounter(reading, now) {
    const session = this.store.openSession();
    if (!this.counter) {
      this.counter = createCounterState({ baseline: reading.cumulative, at: now });
      this.store.saveCounter(this.counter);
      this.log('INFO', `Primo riferimento del contatore PLC: ${reading.cumulative}.`);
      return;
    }
    const before = this.counter;
    const clockBack = now < before.lastAt - 1000;
    if (clockBack && !this.clockBackLogged) this.log('AVVISO', 'Orologio del PC tornato indietro: le letture usano l’ultimo istante valido.');
    this.clockBackLogged = clockBack;
    const at = Math.max(now, before.lastAt); // un orologio che torna indietro non deve bloccare le letture
    const result = observeCounter(before, { value: reading.cumulative, at }, { modulo: this.modulo, maxStepPerSecond: this.config.plc.counter.maxStepPerSecond });
    if (!session) {
      if (result.anomaly === 'contatore-diminuito' || before.suspended) {
        this.log('AVVISO', `Contatore PLC diminuito da ${before.last} a ${reading.cumulative} senza lavorazione seguita (PLC riavviato o azzerato): nuovo riferimento.`);
        this.counter = createCounterState({ baseline: reading.cumulative, at: now });
      } else {
        if (result.accepted && result.step > 0) this.log('AVVISO', `${result.step} cartoni contati dal PLC senza lavorazione seguita: non attribuiti a nessuna lavorazione.`);
        if (result.anomaly) this.log('AVVISO', `Lettura del contatore scartata (${result.anomaly}): ${reading.cumulative}.`);
        this.counter = result.accepted ? createCounterState({ baseline: result.state.last, at: now }) : result.state;
      }
      this.store.saveCounter(this.counter);
      return;
    }
    this.counter = result.state;
    let status = null;
    const anomalies = [];
    if (result.anomaly === 'contatore-diminuito') {
      status = 'da-verificare';
      anomalies.push('contatore-diminuito');
      this.log('ALLARME', `PLC riavviato senza ritenzione o contatore azzerato: cumulativo da ${before.last} a ${reading.cumulative}. Lavorazione ${session.id} «da verificare»: conteggio sospeso a ${partialOf(this.counter, this.modulo)} cartoni, nessuna quantità ricostruita.`);
    } else if (result.anomaly) {
      anomalies.push(result.anomaly);
      this.log('AVVISO', `Lettura del contatore scartata (${result.anomaly}): ${reading.cumulative}, ultimo valido ${before.last}.`);
    }
    if (result.rollover) this.log('INFO', `Superamento del limite del contatore (modulo ${this.modulo}) gestito.`);
    this.store.saveCounter(this.counter, { sessionId: session.id, status, anomalies });
  }

  // --- Lavorazione attiva dal gestionale -----------------------------------------------

  async #sync(now) {
    if (now - this.lastSyncAt < this.config.intervals.syncMs) return;
    this.lastSyncAt = now;
    const result = await this.transmitter.getActiveSession();
    if (!result.ok) {
      this.lastErrors.internet = result.error ?? result.reason;
      if (result.reason !== 'auth') {
        this.#condition('internet', false, `Internet o gestionale non raggiungibile (${result.error ?? `risposta ${result.status ?? ''}`.trim()}): la lavorazione già seguita continua in locale, nessuna nuova lavorazione viene aperta.`, '');
      }
      return;
    }
    this.lastErrors.internet = null;
    this.#condition('internet', true, '', 'Gestionale di nuovo raggiungibile: invio della coda ripreso.');
    if (result.line && result.line !== this.config.line) {
      this.log('ALLARME', `Il gestionale associa il token alla linea ${result.line}, la configurazione indica ${this.config.line}: nessuna lavorazione seguita.`);
      return;
    }
    const local = this.store.openSession();
    const remote = result.activeSession;
    if (local && remote?.id !== local.id) {
      this.store.stopFollowing(local.id, 'lavorazione-non-attiva-sul-gestionale');
      this.log('ALLARME', `La lavorazione ${local.id} non è più attiva sul gestionale: conservata in locale come «non seguita» (${partialOf(this.counter, this.modulo)} cartoni da verificare), non più contata.`);
    }
    if (!remote || this.store.session(remote.id)) return; // già seguita o chiusa in attesa di conferma
    if (!this.counter || this.conditions.plc !== true) {
      this.log('AVVISO', `Lavorazione ${remote.id} attiva sul gestionale, ma manca una lettura PLC valida: attendo prima di seguirla.`);
      this.lastSyncAt = -Infinity;
      return;
    }
    if (this.counter.suspended) this.counter = createCounterState({ baseline: this.lastReading.cumulative, at: now });
    const baseline = this.counter.last;
    this.counter = createCounterState({ baseline, at: this.counter.lastAt });
    this.store.followSession({ id: remote.id, productCode: remote.productCode, lotCode: remote.lotCode, startedAt: remote.startedAt },
      { baseline, at: new Date(now).toISOString(), counterState: this.counter });
    this.log('INFO', `Lavorazione ${remote.id} seguita (articolo ${remote.productCode ?? 'n.d.'}, lotto ${remote.lotCode ?? 'n.d.'}): baseline ${baseline}, parziale 0.`);
  }

  // --- Chiusura ------------------------------------------------------------------------

  #trackSensors(reading, now) {
    if (reading.sensors === '00') { if (this.sensorsFreeSince === null || now < this.sensorsFreeSince) this.sensorsFreeSince = now; }
    else this.sensorsFreeSince = null;
  }

  #handleClose(reading, now) {
    const value = reading.closeRequest;
    if (!this.closeRef) {
      this.closeRef = { value };
      this.store.setState('closeRef', this.closeRef);
      return;
    }
    const diff = (value - this.closeRef.value + 65536) % 65536;
    if (diff >= 32768) {
      this.log('AVVISO', `Contatore delle richieste di chiusura diminuito (${this.closeRef.value} → ${value}): probabile riavvio PLC, nessuna chiusura.`);
      this.closeRef = { value };
      this.pendingClose = null;
      this.store.setState('closeRef', this.closeRef);
      return;
    }
    if (diff > 0 && this.pendingClose?.value !== value) {
      this.pendingClose = { value, since: now };
      this.log('INFO', `Richiesta di chiusura n. ${value} ricevuta: attendo sensori liberi e stabili per ${this.config.close.sensorsFreeStableMs} ms.`);
    }
    if (!this.pendingClose) return;
    const session = this.store.openSession();
    if (!session) {
      this.log('AVVISO', `Richiesta di chiusura n. ${value} senza lavorazione seguita: ignorata, nessun riscontro al PLC.`);
      this.closeRef = { value };
      this.pendingClose = null;
      this.store.setState('closeRef', this.closeRef);
      return;
    }
    const stable = this.sensorsFreeSince !== null && now - this.sensorsFreeSince >= this.config.close.sensorsFreeStableMs;
    if (!stable) return;
    const counter = this.counter;
    const cartons = partialOf(counter, this.modulo);
    const newBaseline = counter.suspended ? reading.cumulative : counter.last;
    const closeRequestId = `${this.config.line}-${value}-${session.baseline}`;
    const { event } = this.store.closeSession({
      sessionId: session.id, closeRequestId, requestValue: value, counterStart: session.baseline, counterEnd: counter.last,
      cartons, closedAt: new Date(now).toISOString(), anomalies: counter.anomalies, modulo: this.modulo,
      newCounterState: createCounterState({ baseline: newBaseline, at: now }),
    });
    this.counter = createCounterState({ baseline: newBaseline, at: now });
    this.closeRef = { value };
    this.pendingClose = null;
    this.log('INFO', `Lavorazione ${session.id} chiusa: ${cartons} cartoni (${counter.last} − ${session.baseline}${event.anomalies.length ? `, anomalie: ${event.anomalies.join(', ')}` : ''}). Salvata in locale; evento ${event.eventId} in coda. Nuova baseline ${newBaseline}.`);
  }

  async #acknowledge() {
    const pending = this.store.getState('ackPending');
    if (!pending) return;
    if (this.config.plc.writesEnabled !== true) {
      if (!this.writesNoticeShown) this.log('AVVISO', 'Scritture disabilitate (writesEnabled=false): il riscontro della chiusura NON viene scritto sul LOGO!.');
      this.writesNoticeShown = true;
      this.store.setState('ackPending', null);
      return;
    }
    try {
      await this.plc.acknowledge(pending.value);
      this.store.setState('ackPending', null);
      this.log('INFO', `Riscontro della richiesta n. ${pending.value} scritto sul PLC dopo il salvataggio locale.`);
    } catch (error) {
      this.log('AVVISO', `Riscontro della richiesta n. ${pending.value} non scritto (${error.message}): nuovo tentativo al prossimo ciclo.`);
    }
  }

  // --- Trasmissione e stato ------------------------------------------------------------

  async #transmit(now) {
    if (now - this.lastHeartbeatAt >= this.config.intervals.heartbeatMs) {
      this.lastHeartbeatAt = now;
      const session = this.store.openSession();
      const at = new Date(now).toISOString();
      this.store.setHeartbeat({
        eventId: newEventId('hb'), type: 'heartbeat', at, bridgeVersion: BRIDGE_VERSION,
        plc: { reachable: this.conditions.plc === true, lastReadAt: this.lastReadAt === null ? null : new Date(this.lastReadAt).toISOString() },
        queueLength: this.store.counts()['in-coda'],
        session: session ? { id: session.id, cartons: partialOf(this.counter, this.modulo) } : null,
      }, at);
      if (await this.transmitter.sendHeartbeat()) this.lastHeartbeatSentAt = at;
    }
    await this.transmitter.flush();
  }

  status() {
    const session = this.store.openSession();
    return {
      tipo: this.config.mode === 'simulazione' ? 'SIMULAZIONE' : 'IMPIANTO',
      aggiornato: new Date(this.now()).toISOString(),
      versione: BRIDGE_VERSION,
      linea: this.config.line,
      scrittureAbilitate: this.config.plc.writesEnabled === true,
      plc: { raggiungibile: this.conditions.plc === true, ultimaLettura: this.lastReadAt === null ? null : new Date(this.lastReadAt).toISOString(),
        cumulativo: this.lastReading?.cumulative ?? null, sensori: this.lastReading?.sensors ?? null, errore: this.lastErrors.plc },
      gestionale: { raggiungibile: this.conditions.internet === true, ultimoContatto: this.transmitter.lastContactAt,
        tokenRifiutato: this.transmitter.authPaused, errore: this.lastErrors.internet ?? this.transmitter.lastError },
      lavorazione: session ? { id: session.id, stato: session.status, baseline: session.baseline,
        cartoni: partialOf(this.counter, this.modulo), anomalie: session.anomalies } : null,
      chiusuraInAttesa: this.pendingClose,
      coda: this.store.counts(),
      ultimoHeartbeatInviato: this.lastHeartbeatSentAt,
    };
  }

  #writeStatus() {
    const file = join(this.dataDir, 'stato.json');
    writeFileSync(file + '.tmp', JSON.stringify(this.status(), null, 2) + '\n');
    renameSync(file + '.tmp', file);
  }

  /** Un ciclo completo. Non lancia per errori di rete o PLC: li registra. */
  async cycle() {
    const now = this.now();
    const reading = await this.#readPlc();
    if (reading) {
      this.#trackSensors(reading, now);
      this.#processCounter(reading, now);
    }
    await this.#sync(now);
    if (reading) this.#handleClose(reading, now);
    await this.#acknowledge();
    await this.#transmit(now);
    this.#writeStatus();
  }

  /** Ciclo continuo fino a stop(). */
  async run() {
    while (!this.stopping) {
      try { await this.cycle(); }
      catch (error) { this.log('ERRORE', `Ciclo non completato: ${error.message}`); }
      if (this.stopping) break;
      await new Promise(resolve => { this.wake = resolve; this.timer = setTimeout(resolve, this.config.plc.pollIntervalMs); });
    }
  }

  /** Arresto pulito: termina il ciclo in corso, salva lo stato e chiude l'archivio. */
  async stop(runPromise) {
    this.stopping = true;
    clearTimeout(this.timer);
    this.wake?.();
    await runPromise;
    this.dispose('Arresto pulito: stato salvato, archivio chiuso.');
  }

  dispose(message = 'Servizio chiuso.') {
    if (!this.store) return;
    try { this.#writeStatus(); } catch { /* stato non essenziale */ }
    this.log('INFO', message);
    this.store.close();
    this.store = null;
    this.releaseLock();
  }
}

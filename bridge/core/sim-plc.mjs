/**
 * PLC SIMULATO, SOLO per simulazione e test: imita la logica che il programma LOGO!
 * dovrà implementare (conteggio dai sensori, contatore cumulativo, contatore delle
 * richieste di chiusura) ed espone i dati con un server Modbus finto su 127.0.0.1.
 * La mappa qui sotto è di comodo e NON è la mappa del LOGO! reale.
 */
import { FakeModbusServer } from './modbus-sim-server.mjs';
import { SensorTracker } from './sensors.mjs';

export const SIM_MAP = Object.freeze({ counterHigh: 0, counterLow: 1, sensors: 2, closeRequest: 3, closeAck: 4, anomalies: 5 });

// Tempi di comodo della simulazione (millisecondi virtuali), non misure della linea reale.
export const SIM_TIMING = Object.freeze({ minStableMs: 20, sampleMs: 5, stepMs: 60 });

export class SimulatedPlc {
  constructor({ cumulative = 0, minStableMs = SIM_TIMING.minStableMs, clock }) {
    this.server = new FakeModbusServer({ unitId: 1 });
    this.clock = clock;                 // { t } in millisecondi virtuali, condiviso con il servizio
    this.minStableMs = minStableMs;
    this.cumulative = cumulative;
    this.closeRequest = 0;
    this.#resetSensors();
  }

  /** Sensori liberi e accettati dal filtro, come all'accensione del PLC. */
  #resetSensors() {
    this.tracker = new SensorTracker({ minStableMs: this.minStableMs });
    this.tracker.feed('00', this.clock.t);
    this.hold('00', this.minStableMs + SIM_TIMING.sampleMs);
  }

  async listen() { return this.server.listen(); }
  async close() { return this.server.close(); }

  set online(value) { this.server.online = value; }
  get online() { return this.server.online; }
  get ack() { return this.server.get(SIM_MAP.closeAck); }
  get anomalies() { return this.tracker.anomalies; }

  #publish(sensorState) {
    this.server.set(SIM_MAP.counterHigh, Math.floor(this.cumulative / 65536));
    this.server.set(SIM_MAP.counterLow, this.cumulative % 65536);
    this.server.set(SIM_MAP.sensors, sensorState === '00' ? 0 : (sensorState[0] === '1' ? 1 : 0) | (sensorState[1] === '1' ? 2 : 0));
    this.server.set(SIM_MAP.closeRequest, this.closeRequest);
    this.server.set(SIM_MAP.anomalies, Math.min(this.tracker.anomalies.total, 65535));
  }

  /** Mantiene uno stato grezzo per `durationMs`, campionato ogni sampleMs. */
  hold(state, durationMs) {
    const end = this.clock.t + durationMs;
    while (this.clock.t < end) {
      this.clock.t += SIM_TIMING.sampleMs;
      const result = this.tracker.feed(state, this.clock.t);
      if (result.counted) this.cumulative = (this.cumulative + 1) % 2 ** 32;
    }
    this.#publish(this.tracker.accepted ?? '00');
  }

  /** Sequenza di [stato, durata]. */
  sequence(steps) { for (const [state, duration] of steps) this.hold(state, duration); }

  /** Un cartone che passa normalmente: 00 → 10 → 11 → 01 → 00. */
  passCarton({ stepMs = SIM_TIMING.stepMs } = {}) {
    this.sequence([['10', stepMs], ['11', stepMs], ['01', stepMs], ['00', stepMs]]);
  }

  /** Cartone con rimbalzi brevi (sotto minStableMs) su ogni fronte: deve contare una volta. */
  passCartonWithBounce() {
    const glitch = Math.max(SIM_TIMING.sampleMs, this.minStableMs - 2 * SIM_TIMING.sampleMs);
    this.sequence([['10', glitch], ['00', SIM_TIMING.sampleMs], ['10', 60], ['11', glitch], ['10', SIM_TIMING.sampleMs], ['11', 60],
      ['01', 60], ['11', SIM_TIMING.sampleMs], ['01', 30], ['00', glitch], ['01', SIM_TIMING.sampleMs], ['00', 60]]);
  }

  /** Cartone che si ferma a lungo tra i sensori (sosta), poi esce: conta una volta. */
  passCartonWithStop(stopMs = 5_000) {
    this.sequence([['10', 60], ['11', stopMs], ['01', 60], ['00', 60]]);
  }

  /** Cartone che arretra (10 → 00): anomalia, nessun conteggio. */
  backOff() { this.sequence([['10', 60], ['11', 60], ['10', 60], ['00', 60]]); }

  /** Salto di stato (00 → 11): anomalia, nessun conteggio. */
  skip() { this.sequence([['11', 60], ['01', 60], ['00', 60]]); }

  pressClose() { this.closeRequest = (this.closeRequest + 1) % 65536; this.#publish(this.tracker.accepted ?? '00'); }

  /** Riavvio del PLC: con ritenzione conserva i contatori, senza li azzera. */
  reboot({ retentive }) {
    if (!retentive) { this.cumulative = 0; this.closeRequest = 0; }
    this.#resetSensors();
  }

  /** Configurazione plc per il servizio, SOLO simulazione (loopback e mappa di comodo). */
  serviceConfig() {
    return {
      host: '127.0.0.1', port: this.server.port, unitId: 1, timeoutMs: 1000, pollIntervalMs: 200, writesEnabled: true,
      counter: { functionCode: 3, address: SIM_MAP.counterHigh, wordOrder: 'BE', modulo: 2 ** 32, maxStepPerSecond: 50 },
      sensors: { functionCode: 3, address: SIM_MAP.sensors },
      closeRequest: { functionCode: 3, address: SIM_MAP.closeRequest },
      closeAck: { functionCode: 6, address: SIM_MAP.closeAck },
    };
  }
}

/** Configurazione completa del servizio in simulazione. */
export function simulationServiceConfig({ plc, baseUrl, line = 'linea-simulazione' }) {
  return {
    schemaVersion: 1, mode: 'simulazione', mapConfirmed: true, line,
    server: { baseUrl, timeoutMs: 2000 },
    plc: plc.serviceConfig(),
    close: { sensorsFreeStableMs: 500 },
    intervals: { syncMs: 1000, heartbeatMs: 30_000 },
    retry: { baseMs: 1000, maxMs: 30_000 },
    log: { maxBytes: 1024 * 1024, files: 5 },
  };
}

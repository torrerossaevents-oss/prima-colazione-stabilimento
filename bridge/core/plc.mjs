/**
 * Lettura del LOGO! tramite Modbus TCP per il servizio (una connessione per ciclo).
 * Sensori: con la funzione 02 si leggono due ingressi consecutivi del LOGO! (A all'indirizzo
 * indicato, B al successivo: sul LOGO! 24CE del progetto I3 = 2 e I4 = 3, base zero).
 * Con le funzioni 03/04 un registro con bit 0 = A e bit 1 = B. In entrambi i casi 1 = fascio interrotto.
 */
import { ModbusConnection, readRegisters, readDiscreteInputs, writeSingleRegister, writeMultipleRegisters, decodeUnsignedCounter } from './modbus.mjs';
import { acceptDoubleRead } from './counter.mjs';

export function decodeSensors(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 3) return 'non-valido';
  return `${value & 1}${(value >> 1) & 1}`;
}

export class ModbusPlc {
  constructor(plc) { this.plc = plc; }

  async #withConnection(fn) {
    const { host, port, timeoutMs } = this.plc;
    const connection = await ModbusConnection.open({ host, port, timeoutMs });
    try { return await fn(connection); } finally { connection.close(); }
  }

  async #readCounter(connection) {
    const { unitId, counter } = this.plc;
    const count = counter.modulo === 65536 ? 1 : 2;
    const once = async () => decodeUnsignedCounter(
      await readRegisters(connection, { unitId, functionCode: counter.functionCode, address: counter.address, count }), counter.wordOrder);
    if (count === 1) return once();
    // Due registri: accetta solo letture consecutive coerenti (mitigazione, vedi counter.mjs).
    let previous = await once();
    for (let attempt = 0; attempt < 2; attempt++) {
      const next = await once();
      const verdict = acceptDoubleRead(previous, next);
      if (verdict.ok) return verdict.value;
      previous = next;
    }
    throw Object.assign(new Error('Letture del contatore a 32 bit discordanti: dato scartato.'), { code: 'PLC_DATA' });
  }

  /** { cumulative, sensors, closeRequest } oppure errore con code PLC_UNREACHABLE / PLC_DATA. */
  async read() {
    try {
      return await this.#withConnection(async connection => {
        const { unitId, sensors, closeRequest } = this.plc;
        const cumulative = await this.#readCounter(connection);
        let sensorWord;
        if (sensors.functionCode === 2) {
          const [a, b] = await readDiscreteInputs(connection, { unitId, address: sensors.address, count: 2 });
          sensorWord = a | (b << 1);
        } else [sensorWord] = await readRegisters(connection, { unitId, functionCode: sensors.functionCode, address: sensors.address, count: 1 });
        const [request] = await readRegisters(connection, { unitId, functionCode: closeRequest.functionCode, address: closeRequest.address, count: 1 });
        return { cumulative, sensors: decodeSensors(sensorWord), closeRequest: request };
      });
    } catch (error) {
      if (!error.code) error.code = /Timeout|Collegamento|interrotta|chiusa/.test(error.message) ? 'PLC_UNREACHABLE' : 'PLC_DATA';
      throw error;
    }
  }

  /** Riscontro della richiesta di chiusura salvata. Solo con writesEnabled === true. */
  async acknowledge(value) {
    const options = { writesEnabled: this.plc.writesEnabled === true };
    const { unitId, closeAck } = this.plc;
    await this.#withConnection(connection => closeAck.functionCode === 16
      ? writeMultipleRegisters(connection, { unitId, address: closeAck.address, values: [value] }, options)
      : writeSingleRegister(connection, { unitId, address: closeAck.address, value }, options));
  }
}

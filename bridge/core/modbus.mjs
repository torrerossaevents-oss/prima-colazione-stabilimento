/**
 * Client Modbus TCP minimo, senza dipendenze esterne.
 * Riferimenti: https://www.modbus.org/modbus-specifications
 * Funzioni: 03 (holding registers), 04 (input registers), 06 e 16 (scritture).
 * Gli indirizzi sono quelli del PDU (base zero), non etichette 40001/30001.
 *
 * Le scritture (06/16) sono rifiutate se il chiamante non passa `writesEnabled: true`,
 * che il servizio prende soltanto da `config.plc.writesEnabled === true` (default false).
 * La diagnostica `read-logo.mjs` usa solo le letture.
 */
import net from 'node:net';
import { randomInt } from 'node:crypto';

function integer(value, min, max, field) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${field}: inserire un intero tra ${min} e ${max}.`);
  }
  return value;
}

export function isPrivateIPv4(host) {
  if (typeof host !== 'string' || net.isIP(host) !== 4) return false;
  const [a, b] = host.split('.').map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/** Configurazione della lettura diagnostica. allowLoopbackForTests is not exposed by the diagnostic CLI. */
export function validateConfig(input, { allowLoopbackForTests = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Configurazione LOGO! non valida.');
  if (input.schemaVersion !== 1) throw new Error('schemaVersion deve essere 1.');
  if (input.mapConfirmed !== true) throw new Error('Mappa LOGO! non confermata: completarla con il tecnico prima della lettura.');
  const host = input.host;
  if (!isPrivateIPv4(host) && !(allowLoopbackForTests && host === '127.0.0.1')) {
    throw new Error('host: usare solo l’indirizzo IPv4 privato della LAN concordato con il tecnico.');
  }
  const port = integer(input.port, 1, 65535, 'port');
  const unitId = integer(input.unitId, 0, 255, 'unitId');
  if (input.functionCode !== 3 && input.functionCode !== 4) throw new Error('functionCode: sono ammesse soltanto le letture 3 o 4.');
  const address = integer(input.address, 0, 65535, 'address (base zero)');
  const wordCount = integer(input.wordCount, 1, 2, 'wordCount');
  if (address + wordCount > 65536) throw new Error('La lettura supera l’ultimo registro Modbus.');
  if (!['BE', 'LE'].includes(input.wordOrder) || (wordCount === 1 && input.wordOrder !== 'BE')) {
    throw new Error('wordOrder: BE per un registro; BE o LE per due registri, secondo la mappa confermata.');
  }
  const timeoutMs = integer(input.timeoutMs, 100, 10000, 'timeoutMs');
  return { schemaVersion: 1, mapConfirmed: true, host, port, unitId,
    functionCode: input.functionCode, address, wordCount, wordOrder: input.wordOrder, timeoutMs };
}

export function decodeUnsignedCounter(registers, wordOrder) {
  if (!Array.isArray(registers) || ![1, 2].includes(registers.length)) throw new Error('Servono uno o due registri.');
  registers.forEach(value => integer(value, 0, 65535, 'registro'));
  if (!['BE', 'LE'].includes(wordOrder) || (registers.length === 1 && wordOrder !== 'BE')) throw new Error('Ordine delle parole non valido.');
  if (registers.length === 1) return registers[0];
  const words = wordOrder === 'BE' ? registers : [...registers].reverse();
  // Arithmetic avoids signed 32-bit coercion by JavaScript bitwise operators.
  return words[0] * 65536 + words[1];
}

const TIMEOUT_MESSAGE = 'Timeout Modbus: nessuna risposta completa entro il tempo previsto.';

function connectionError(error) {
  const code = ['ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'ECONNRESET', 'ETIMEDOUT'].includes(error?.code) ? ` (${error.code})` : '';
  const result = new Error(`Collegamento LOGO! non riuscito${code}. Verificare rete e configurazione.`);
  result.code = 'PLC_UNREACHABLE';
  return result;
}

/**
 * Una connessione TCP con una sola richiesta alla volta. Qualsiasi errore di protocollo
 * o timeout chiude la connessione: lo stato del dialogo non è più affidabile.
 */
export class ModbusConnection {
  #socket; #timeoutMs; #pending = null; #buffer = Buffer.alloc(0); #closed = null;

  constructor(socket, timeoutMs) {
    this.#socket = socket;
    this.#timeoutMs = timeoutMs;
    socket.on('error', error => this.#fail(connectionError(error)));
    socket.on('end', () => this.#fail(new Error('Connessione Modbus chiusa prima della risposta completa.')));
    socket.on('close', () => this.#fail(new Error('Connessione Modbus interrotta.')));
    socket.on('data', chunk => this.#onData(chunk));
  }

  static open({ host, port, timeoutMs }) {
    return new Promise((resolve, reject) => {
      const socket = new net.Socket();
      const timer = setTimeout(() => { socket.destroy(); reject(Object.assign(new Error(TIMEOUT_MESSAGE), { code: 'PLC_UNREACHABLE' })); }, timeoutMs);
      const onError = error => { clearTimeout(timer); socket.destroy(); reject(connectionError(error)); };
      socket.once('error', onError);
      socket.once('connect', () => {
        clearTimeout(timer);
        socket.off('error', onError);
        resolve(new ModbusConnection(socket, timeoutMs));
      });
      socket.connect({ host, port });
    });
  }

  /** Invia un PDU e restituisce il PDU di risposta (codice funzione + dati). */
  request(unitId, pdu) {
    if (this.#closed) return Promise.reject(this.#closed);
    if (this.#pending) return Promise.reject(new Error('Richiesta Modbus già in corso su questa connessione.'));
    const transactionId = randomInt(0, 65536);
    const adu = Buffer.alloc(7 + pdu.length);
    adu.writeUInt16BE(transactionId, 0);
    adu.writeUInt16BE(0, 2);
    adu.writeUInt16BE(1 + pdu.length, 4);
    adu[6] = unitId;
    pdu.copy(adu, 7);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.#fail(new Error(TIMEOUT_MESSAGE)), this.#timeoutMs);
      this.#pending = { transactionId, unitId, resolve, reject, timer };
      this.#buffer = Buffer.alloc(0);
      this.#socket.write(adu);
    });
  }

  close() {
    if (!this.#closed) this.#closed = new Error('Connessione Modbus chiusa.');
    this.#socket.destroy();
  }

  #fail(error) {
    const pending = this.#pending;
    this.#pending = null;
    if (!this.#closed) this.#closed = error;
    this.#socket.destroy();
    if (pending) { clearTimeout(pending.timer); pending.reject(error); }
  }

  #onData(chunk) {
    const pending = this.#pending;
    if (!pending) return this.#fail(new Error('Dati Modbus inattesi senza richiesta.'));
    // A Modbus TCP ADU cannot exceed 260 bytes.
    if (this.#buffer.length + chunk.length > 260) return this.#fail(new Error('Risposta Modbus troppo lunga.'));
    const response = this.#buffer = Buffer.concat([this.#buffer, chunk]);
    if (response.length < 7) return;
    const length = response.readUInt16BE(4);
    if (length < 3 || length > 254) return this.#fail(new Error('Lunghezza MBAP non valida.'));
    if (response.readUInt16BE(0) !== pending.transactionId) return this.#fail(new Error('Identificativo della risposta Modbus non corrispondente.'));
    if (response.readUInt16BE(2) !== 0) return this.#fail(new Error('Protocollo MBAP non valido.'));
    if (response[6] !== pending.unitId) return this.#fail(new Error('Unità Modbus della risposta non corrispondente.'));
    const frameSize = 6 + length;
    if (response.length < frameSize) return;
    if (response.length !== frameSize) return this.#fail(new Error('Risposta Modbus con dati aggiuntivi inattesi.'));
    this.#pending = null;
    clearTimeout(pending.timer);
    pending.resolve(response.subarray(7, frameSize));
  }
}

function checkFunction(pdu, functionCode, action) {
  if (pdu[0] === (functionCode | 0x80)) {
    if (pdu.length !== 2) throw new Error('Eccezione Modbus malformata.');
    throw new Error(`LOGO! ha rifiutato la ${action}: eccezione Modbus ${pdu[1]}. Verificare la mappa.`);
  }
  if (pdu[0] !== functionCode) throw new Error('Funzione Modbus della risposta non corrispondente.');
}

/** Funzioni 03/04: restituisce `count` registri senza segno a 16 bit. */
export async function readRegisters(connection, { unitId, functionCode, address, count }) {
  if (functionCode !== 3 && functionCode !== 4) throw new Error('functionCode: sono ammesse soltanto le letture 3 o 4.');
  integer(address, 0, 65535, 'address (base zero)');
  integer(count, 1, 125, 'count');
  if (address + count > 65536) throw new Error('La lettura supera l’ultimo registro Modbus.');
  const request = Buffer.alloc(5);
  request[0] = functionCode;
  request.writeUInt16BE(address, 1);
  request.writeUInt16BE(count, 3);
  const pdu = await connection.request(unitId, request);
  checkFunction(pdu, functionCode, 'lettura');
  const byteCount = count * 2;
  if (pdu.length !== 2 + byteCount || pdu[1] !== byteCount) throw new Error('Numero di byte o registri Modbus non corrispondente.');
  return Array.from({ length: count }, (_, i) => pdu.readUInt16BE(2 + i * 2));
}

function requireWrites(options) {
  if (options?.writesEnabled !== true) throw new Error('Scritture Modbus disabilitate: impostare writesEnabled a true solo dopo il collaudo della mappa.');
}

/** Funzione 06: scrive un registro; la risposta deve ripetere indirizzo e valore. */
export async function writeSingleRegister(connection, { unitId, address, value }, options) {
  requireWrites(options);
  integer(address, 0, 65535, 'address (base zero)');
  integer(value, 0, 65535, 'valore');
  const request = Buffer.alloc(5);
  request[0] = 6;
  request.writeUInt16BE(address, 1);
  request.writeUInt16BE(value, 3);
  const pdu = await connection.request(unitId, request);
  checkFunction(pdu, 6, 'scrittura');
  if (!pdu.equals(request)) throw new Error('Riscontro della scrittura Modbus non corrispondente.');
}

/** Funzione 16: scrive registri consecutivi; la risposta deve indicare indirizzo e quantità. */
export async function writeMultipleRegisters(connection, { unitId, address, values }, options) {
  requireWrites(options);
  integer(address, 0, 65535, 'address (base zero)');
  if (!Array.isArray(values) || values.length < 1 || values.length > 123) throw new Error('values: da 1 a 123 registri.');
  if (address + values.length > 65536) throw new Error('La scrittura supera l’ultimo registro Modbus.');
  values.forEach(value => integer(value, 0, 65535, 'valore'));
  const request = Buffer.alloc(6 + values.length * 2);
  request[0] = 16;
  request.writeUInt16BE(address, 1);
  request.writeUInt16BE(values.length, 3);
  request[5] = values.length * 2;
  values.forEach((value, i) => request.writeUInt16BE(value, 6 + i * 2));
  const pdu = await connection.request(unitId, request);
  checkFunction(pdu, 16, 'scrittura');
  if (pdu.length !== 5 || pdu.readUInt16BE(1) !== address || pdu.readUInt16BE(3) !== values.length) {
    throw new Error('Riscontro della scrittura Modbus non corrispondente.');
  }
}

/** Diagnostica: una connessione e una lettura del cumulativo. */
export async function readCounterOnce(input, options = {}) {
  const config = validateConfig(input, options);
  const connection = await ModbusConnection.open(config);
  try {
    const registers = await readRegisters(connection, { unitId: config.unitId, functionCode: config.functionCode, address: config.address, count: config.wordCount });
    return { cumulative: decodeUnsignedCounter(registers, config.wordOrder), registers, readAt: new Date().toISOString() };
  } finally {
    connection.close();
  }
}

/** A paused-line diagnostic only: agreement does not prove live snapshot atomicity. */
export async function readStableCounter(input, options = {}) {
  const config = validateConfig(input, options);
  const first = await readCounterOnce(config, options);
  const second = await readCounterOnce(config, options);
  if (first.cumulative !== second.cumulative) {
    throw new Error('Le due letture non coincidono: dato non confermato. Ripetere a linea in pausa e verificare la mappa.');
  }
  return { ...second, firstReadAt: first.readAt, diagnosticOnly: true, readings: 2 };
}

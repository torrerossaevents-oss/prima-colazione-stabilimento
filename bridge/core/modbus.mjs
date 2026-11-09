/**
 * Diagnostica Modbus TCP in sola lettura, senza dipendenze esterne.
 * Riferimenti: https://www.modbus.org/modbus-specifications
 * Funzioni ammesse: 03 (holding registers), 04 (input registers).
 * Gli indirizzi sono quelli del PDU (base zero), non etichette 40001/30001.
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

/** allowLoopbackForTests is not exposed by the diagnostic CLI. */
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

/** One connection and one read request. No write API exists in this module. */
export async function readCounterOnce(input, options = {}) {
  const config = validateConfig(input, options);
  const transactionId = randomInt(0, 65536);
  const request = Buffer.alloc(12);
  request.writeUInt16BE(transactionId, 0);
  request.writeUInt16BE(0, 2);
  request.writeUInt16BE(6, 4);
  request[6] = config.unitId;
  request[7] = config.functionCode;
  request.writeUInt16BE(config.address, 8);
  request.writeUInt16BE(config.wordCount, 10);

  return new Promise((resolve, reject) => {
    let finished = false;
    let response = Buffer.alloc(0);
    const socket = new net.Socket();
    const deadline = setTimeout(() => finish(new Error('Timeout Modbus: nessuna risposta completa entro il tempo previsto.')), config.timeoutMs);
    function finish(error, result) {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      socket.destroy();
      if (error) reject(error); else resolve(result);
    }
    socket.on('error', error => {
      const code = ['ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'ECONNRESET', 'ETIMEDOUT'].includes(error.code) ? ` (${error.code})` : '';
      finish(new Error(`Collegamento LOGO! non riuscito${code}. Verificare rete e configurazione.`));
    });
    socket.on('end', () => finish(new Error('Connessione Modbus chiusa prima della risposta completa.')));
    socket.on('close', () => { if (!finished) finish(new Error('Connessione Modbus interrotta.')); });
    socket.on('connect', () => socket.write(request));
    socket.on('data', chunk => {
      if (finished) return;
      // A Modbus TCP ADU cannot exceed 260 bytes. This client expects <=13.
      if (response.length + chunk.length > 260) return finish(new Error('Risposta Modbus troppo lunga.'));
      response = Buffer.concat([response, chunk]);
      if (response.length < 7) return;
      const length = response.readUInt16BE(4);
      if (length < 3 || length > 254) return finish(new Error('Lunghezza MBAP non valida.'));
      if (response.readUInt16BE(0) !== transactionId) return finish(new Error('Identificativo della risposta Modbus non corrispondente.'));
      if (response.readUInt16BE(2) !== 0) return finish(new Error('Protocollo MBAP non valido.'));
      if (response[6] !== config.unitId) return finish(new Error('Unità Modbus della risposta non corrispondente.'));
      const frameSize = 6 + length;
      if (response.length < frameSize) return;
      if (response.length !== frameSize) return finish(new Error('Risposta Modbus con dati aggiuntivi inattesi.'));
      const fn = response[7];
      if (fn === (config.functionCode | 0x80)) {
        if (length !== 3) return finish(new Error('Eccezione Modbus malformata.'));
        return finish(new Error(`LOGO! ha rifiutato la lettura: eccezione Modbus ${response[8]}. Verificare la mappa.`));
      }
      if (fn !== config.functionCode) return finish(new Error('Funzione Modbus della risposta non corrispondente.'));
      const byteCount = config.wordCount * 2;
      if (length !== 3 + byteCount || response[8] !== byteCount) return finish(new Error('Numero di byte o registri Modbus non corrispondente.'));
      const registers = Array.from({ length: config.wordCount }, (_, i) => response.readUInt16BE(9 + i * 2));
      finish(null, { cumulative: decodeUnsignedCounter(registers, config.wordOrder), registers, readAt: new Date().toISOString() });
    });
    socket.connect({ host: config.host, port: config.port });
  });
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

/**
 * Configurazione del servizio ponte.
 * - "simulazione" (default): PLC simulato e gestionale finto su 127.0.0.1, nessun dato reale.
 * - "impianto": richiede una configurazione locale completa (ponte.local.json) e il token
 *   del dispositivo in un file locale (token.local.json). Entrambi sono esclusi da Git
 *   (`/bridge/*.local.json`). Se manca un campo, il servizio non parte.
 * Nessun valore dell'impianto (IP, unitId, indirizzi, ordine parole, tempi) ha un default.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { isPrivateIPv4 } from './modbus.mjs';

export const MODES = Object.freeze(['simulazione', 'impianto']);

// Parametri software (non dell'impianto): modificabili, con valori prudenti.
export const SOFTWARE_DEFAULTS = Object.freeze({
  syncMs: 10_000,          // ogni quanto chiedere la lavorazione attiva al gestionale
  heartbeatMs: 30_000,     // il sito segnala «dato non aggiornato» oltre 90 s (CONTRATTO-PONTE.md)
  httpTimeoutMs: 10_000,
  retryBaseMs: 5_000,
  retryMaxMs: 300_000,
  logMaxBytes: 1024 * 1024,
  logFiles: 5,
});

function fail(field, hint = 'da confermare con il tecnico') {
  throw new Error(`Configurazione incompleta: ${field} (${hint}). Il servizio in modalità impianto non parte.`);
}

function int(value, min, max, field) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(field, `intero tra ${min} e ${max}`);
  return value;
}

function text(value, field, pattern = /^[A-Za-z0-9_.:-]{1,64}$/) {
  if (typeof value !== 'string' || !pattern.test(value)) fail(field);
  return value;
}

function register(section, field, { read = true } = {}) {
  if (!section || typeof section !== 'object') fail(field);
  const out = { address: int(section.address, 0, 65535, `${field}.address`) };
  if (read) {
    if (section.functionCode !== 3 && section.functionCode !== 4) fail(`${field}.functionCode`, '3 oppure 4 secondo la mappa');
    out.functionCode = section.functionCode;
  } else {
    if (section.functionCode !== 6 && section.functionCode !== 16) fail(`${field}.functionCode`, '6 oppure 16 secondo la mappa');
    out.functionCode = section.functionCode;
  }
  return out;
}

/**
 * Valida la configurazione. `allowLoopback` è usato solo dalla simulazione e dai test:
 * in modalità impianto il PLC deve avere un IPv4 privato e il gestionale un URL https.
 */
export function validateServiceConfig(input, { allowLoopback = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('file JSON');
  if (input.schemaVersion !== 1) fail('schemaVersion', 'deve essere 1');
  if (!MODES.includes(input.mode)) fail('mode', '"simulazione" oppure "impianto"');
  if (input.mapConfirmed !== true) fail('mapConfirmed', 'impostare true solo dopo la verifica della mappa con il tecnico');
  const line = text(input.line, 'line', /^[A-Za-z0-9_-]{1,40}$/);

  const server = input.server ?? {};
  let url;
  try { url = new URL(server.baseUrl); } catch { fail('server.baseUrl', 'indirizzo del gestionale'); }
  const loopbackHttp = allowLoopback && url.protocol === 'http:' && url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !loopbackHttp) fail('server.baseUrl', 'serve https://');

  const plc = input.plc ?? {};
  if (!isPrivateIPv4(plc.host) && !(allowLoopback && plc.host === '127.0.0.1')) fail('plc.host', 'IPv4 privato della LAN');
  const counter = { ...register(plc.counter, 'plc.counter') };
  if (!['BE', 'LE'].includes(plc.counter.wordOrder)) fail('plc.counter.wordOrder', 'BE oppure LE');
  counter.wordOrder = plc.counter.wordOrder;
  counter.modulo = plc.counter.modulo;
  if (counter.modulo !== 65536 && counter.modulo !== 2 ** 32) fail('plc.counter.modulo', '65536 oppure 4294967296 secondo il contatore LOGO!');
  counter.maxStepPerSecond = int(plc.counter.maxStepPerSecond, 1, 10_000, 'plc.counter.maxStepPerSecond');
  if (plc.writesEnabled !== true && plc.writesEnabled !== false) fail('plc.writesEnabled', 'true oppure false; default false');

  const intervals = input.intervals ?? {};
  const retry = input.retry ?? {};
  const log = input.log ?? {};
  const config = {
    schemaVersion: 1,
    mode: input.mode,
    line,
    server: { baseUrl: url.href.replace(/\/$/, ''), timeoutMs: int(server.timeoutMs ?? SOFTWARE_DEFAULTS.httpTimeoutMs, 1000, 60_000, 'server.timeoutMs') },
    plc: {
      host: plc.host,
      port: int(plc.port, 1, 65535, 'plc.port'),
      unitId: int(plc.unitId, 0, 255, 'plc.unitId'),
      timeoutMs: int(plc.timeoutMs, 100, 10_000, 'plc.timeoutMs'),
      pollIntervalMs: int(plc.pollIntervalMs, 100, 60_000, 'plc.pollIntervalMs'),
      writesEnabled: plc.writesEnabled,
      counter,
      sensors: register(plc.sensors, 'plc.sensors'),
      closeRequest: register(plc.closeRequest, 'plc.closeRequest'),
      closeAck: register(plc.closeAck, 'plc.closeAck', { read: false }),
    },
    close: { sensorsFreeStableMs: int(input.close?.sensorsFreeStableMs, 0, 600_000, 'close.sensorsFreeStableMs') },
    intervals: {
      syncMs: int(intervals.syncMs ?? SOFTWARE_DEFAULTS.syncMs, 1000, 600_000, 'intervals.syncMs'),
      heartbeatMs: int(intervals.heartbeatMs ?? SOFTWARE_DEFAULTS.heartbeatMs, 1000, 85_000, 'intervals.heartbeatMs'),
    },
    retry: {
      baseMs: int(retry.baseMs ?? SOFTWARE_DEFAULTS.retryBaseMs, 100, 600_000, 'retry.baseMs'),
      maxMs: int(retry.maxMs ?? SOFTWARE_DEFAULTS.retryMaxMs, 100, 3_600_000, 'retry.maxMs'),
    },
    log: {
      maxBytes: int(log.maxBytes ?? SOFTWARE_DEFAULTS.logMaxBytes, 10_000, 100 * 1024 * 1024, 'log.maxBytes'),
      files: int(log.files ?? SOFTWARE_DEFAULTS.logFiles, 2, 20, 'log.files'),
    },
  };
  if (config.retry.maxMs < config.retry.baseMs) fail('retry.maxMs', 'deve essere >= retry.baseMs');
  return config;
}

export function validateToken(value) {
  if (typeof value !== 'string' || !/^pcd_[A-Za-z0-9_-]{20,200}$/.test(value)) {
    throw new Error('Token del dispositivo assente o non valido: crearlo in Configurazione e salvarlo in token.local.json.');
  }
  return value;
}

function readJson(file, missingMessage) {
  let raw;
  try { raw = readFileSync(file, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') throw new Error(missingMessage); throw error; }
  try { return JSON.parse(raw); } catch { throw new Error(`File JSON non leggibile: ${file}`); }
}

// Campi senza valore predefinito: vanno tutti confermati con il tecnico.
export const PLANT_REQUIRED = Object.freeze(['line', 'server.baseUrl', 'plc.host', 'plc.port', 'plc.unitId', 'plc.timeoutMs', 'plc.pollIntervalMs',
  'plc.counter.functionCode', 'plc.counter.address', 'plc.counter.wordOrder', 'plc.counter.modulo', 'plc.counter.maxStepPerSecond',
  'plc.sensors.functionCode', 'plc.sensors.address', 'plc.closeRequest.functionCode', 'plc.closeRequest.address',
  'plc.closeAck.functionCode', 'plc.closeAck.address', 'close.sensorsFreeStableMs']);

/** Elenco completo dei campi mancanti (null o assenti), per mostrarli tutti insieme. */
export function missingPlantFields(input) {
  const missing = PLANT_REQUIRED.filter(path => path.split('.').reduce((node, key) => node?.[key], input) == null);
  if (input?.mapConfirmed !== true) missing.push('mapConfirmed (true solo dopo la verifica della mappa)');
  return missing;
}

/** Carica configurazione e token per la modalità impianto; rifiuta valori mancanti. */
export function loadPlantConfig(configFile) {
  const input = readJson(configFile, `Configurazione assente: copiare ponte.config.example.json in ${configFile} e farla compilare dal tecnico.`);
  if (input.mode !== 'impianto') fail('mode', 'deve essere "impianto" in ponte.local.json');
  const missing = missingPlantFields(input);
  if (missing.length) {
    throw new Error(`Configurazione incompleta, da confermare con il tecnico: ${missing.join(', ')}. Il servizio in modalità impianto non parte.`);
  }
  const config = validateServiceConfig(input);
  const tokenFile = resolve(dirname(configFile), 'token.local.json');
  const tokenJson = readJson(tokenFile, `Token del dispositivo assente: creare ${tokenFile} con {"token": "pcd_…"}.`);
  return { config, token: validateToken(tokenJson?.token) };
}

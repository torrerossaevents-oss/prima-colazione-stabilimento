#!/usr/bin/env node
/**
 * Prova degli ingressi del LOGO! — SOLA LETTURA (funzione Modbus 02), nessuna scrittura.
 * Mostra dal vivo pulsante (I1) e fotocellule A (I3) e B (I4) del LOGO! 24CE del progetto:
 * coprire una fotocellula alla volta e premere il pulsante, poi chiudere con Ctrl+C.
 * Serve il programma LOGO! con l'accesso Modbus attivo (docs/PROGRAMMA-LOGO-24CE.md).
 * Uso: node bridge/prova-ingressi.mjs --host 192.168.x.y [--unit 1] [--port 502] [--volte N]
 */
import { pathToFileURL } from 'node:url';
import { ModbusConnection, readDiscreteInputs, isPrivateIPv4 } from './core/modbus.mjs';

const NAMES = [[0, 'I1 pulsante CHIUDI'], [2, 'I3 fotocellula A'], [3, 'I4 fotocellula B']];

export function parseArguments(args) {
  const out = { host: null, unitId: 1, port: 502, times: Infinity };
  for (let i = 0; i < args.length; i++) {
    const value = args[i + 1];
    if (args[i] === '--host' && value) { out.host = value; i++; }
    else if (args[i] === '--unit' && /^\d{1,3}$/.test(value ?? '')) { out.unitId = Number(value); i++; }
    else if (args[i] === '--port' && /^\d{1,5}$/.test(value ?? '')) { out.port = Number(value); i++; }
    else if (args[i] === '--volte' && /^\d{1,6}$/.test(value ?? '')) { out.times = Number(value); i++; }
    else if (args[i] === '--test-loopback') out.loopback = true;
    else throw new Error('Uso: node bridge/prova-ingressi.mjs --host 192.168.x.y [--unit 1] [--port 502]');
  }
  if (!isPrivateIPv4(out.host) && !(out.loopback && out.host === '127.0.0.1')) throw new Error('Indicare con --host l’indirizzo IPv4 privato del LOGO! (es. 192.168.x.y, quello assegnato al LOGO!).');
  if (out.unitId > 255 || out.port < 1 || out.port > 65535) throw new Error('unit tra 0 e 255, porta tra 1 e 65535.');
  return out;
}

export function describe(bits) {
  return NAMES.map(([i, name]) => `${name}: ${bits[i] ? (i === 0 ? 'PREMUTO' : 'COPERTA (1)') : (i === 0 ? 'rilasciato' : 'libera (0)')}`).join('   ');
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  console.log('PROVA INGRESSI LOGO! — SOLA LETTURA. Nessun dato va al gestionale o al magazzino.');
  console.log('Copri prima solo A, poi solo B, poi premi il pulsante. Ctrl+C per uscire.\n');
  const connection = await ModbusConnection.open({ host: options.host, port: options.port, timeoutMs: 2000 });
  let last = null;
  try {
    for (let n = 0; n < options.times; n++) {
      const bits = await readDiscreteInputs(connection, { unitId: options.unitId, address: 0, count: 8 });
      const line = describe(bits);
      if (line !== last) { console.log(`${new Date().toLocaleTimeString('it-IT')}  ${line}`); last = line; }
      if (n + 1 < options.times) await new Promise(resolve => setTimeout(resolve, 200));
    }
  } finally { connection.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(`PROVA NON COMPLETATA: ${error.message}`); process.exitCode = 1; });
}

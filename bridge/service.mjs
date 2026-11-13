#!/usr/bin/env node
/**
 * Servizio ponte LOGO! ↔ gestionale.
 *   node bridge/service.mjs                    simulazione (default): PLC e gestionale finti su 127.0.0.1
 *   node bridge/service.mjs --impianto         impianto: richiede bridge/ponte.local.json e bridge/token.local.json
 * Opzioni: --config <file>  --dati <cartella>  --durata <secondi> (solo per prove)
 *          --silenzioso (nessuna riga a schermo: usato dall'avvio automatico, il log su file resta)
 * Arresto pulito con Ctrl+C.
 */
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { STORE_MARKER } from './core/store.mjs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { loadPlantConfig } from './core/config.mjs';
import { ModbusPlc } from './core/plc.mjs';
import { BridgeService } from './core/service.mjs';
import { createSimulation } from './core/sim-harness.mjs';

const here = path => fileURLToPath(new URL(path, import.meta.url));
const USAGE = 'Uso: node bridge/service.mjs [--simulazione | --impianto] [--config file] [--dati cartella] [--durata secondi] [--silenzioso]';

function parse(args) {
  const options = { mode: 'simulazione', config: here('./ponte.local.json'), dataDir: null, durationS: null, echo: true };
  let modeSet = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if ((arg === '--simulazione' || arg === '--impianto') && !modeSet) { options.mode = arg.slice(2); modeSet = true; }
    else if (arg === '--config' && args[i + 1]) options.config = resolve(args[++i]);
    else if (arg === '--dati' && args[i + 1]) options.dataDir = resolve(args[++i]);
    else if (arg === '--durata' && Number(args[i + 1]) > 0) options.durationS = Number(args[++i]);
    else if (arg === '--silenzioso') options.echo = false;
    else throw new Error(USAGE);
  }
  options.dataDir ??= here(`./data/${options.mode}`);
  return options;
}

function lockedByLiveProcess(dataDir) {
  try {
    const pid = Number(readFileSync(resolve(dataDir, 'ponte.lock'), 'utf8'));
    process.kill(pid, 0);
    return true;
  } catch (error) { return error.code === 'EPERM'; }
}

/**
 * La simulazione svuota la propria cartella a ogni avvio. Per non cancellare mai un archivio
 * d'impianto o una cartella qualsiasi (es. --dati sbagliato), accetta solo una cartella vuota
 * oppure che contiene un archivio del ponte marcato come simulazione.
 */
function assertSimulationFolder(dataDir) {
  const entries = readdirSync(dataDir);
  if (!entries.length) return;
  const file = resolve(dataDir, 'ponte.sqlite');
  let mode = null;
  if (existsSync(file)) {
    let db;
    try { db = new DatabaseSync(file, { readOnly: true }); mode = db.prepare('SELECT marker, mode FROM ponte_meta WHERE id = 1').get(); }
    catch { mode = null; } finally { db?.close(); }
  }
  if (!mode || mode.marker !== STORE_MARKER || mode.mode !== 'simulazione') {
    throw new Error(`La cartella ${dataDir} non è un archivio di simulazione: non viene cancellata. Usa una cartella vuota o quella predefinita (bridge/data/simulazione).`);
  }
}

async function startSimulation(options) {
  // Ogni avvio della simulazione riparte da un archivio vuoto: il gestionale finto non ricorda nulla.
  if (lockedByLiveProcess(options.dataDir)) throw new Error('Una simulazione è già in esecuzione su questa cartella.');
  if (existsSync(options.dataDir)) { assertSimulationFolder(options.dataDir); rmSync(options.dataDir, { recursive: true, force: true }); }
  const sim = await createSimulation({ dataDir: options.dataDir, realTime: true, echo: options.echo });
  console.log('SIMULAZIONE — PLC e gestionale finti su questo PC. Nessun dato reale, nessun collegamento al LOGO!.');
  console.log(`Archivio di simulazione: ${options.dataDir}`);
  const service = sim.start();
  let n = 0; let produced = 0;
  const open = () => sim.gestionale.openSession({ id: `SIM-${++n}`, productCode: `SIM-ARTICOLO-${n}`, lotCode: `SIM-LOTTO-${n}`, startedAt: new Date().toISOString() });
  open();
  const producer = setInterval(() => {
    if (!service.store?.openSession()) return; // il PLC simulato produce solo con lavorazione seguita
    sim.plc.passCarton();
    if (++produced % 20 === 0) {
      sim.plc.pressClose();
      setTimeout(() => { if (!sim.gestionale.activeSession) open(); }, 3000);
    }
  }, 300);
  return { service, cleanup: async () => { clearInterval(producer); await sim.plc.close(); await sim.gestionale.close(); } };
}

function startPlant(options) {
  const { config, token, access } = loadPlantConfig(options.config);
  console.log('IMPIANTO — lettura del LOGO! configurato e invio al gestionale.');
  console.log(`Archivio: ${options.dataDir}. Scritture sul LOGO!: ${config.plc.writesEnabled ? 'ABILITATE' : 'disabilitate'}.`);
  const service = new BridgeService({ config, token, access, dataDir: options.dataDir, plc: new ModbusPlc(config.plc), echo: options.echo });
  return { service, cleanup: async () => {} };
}

try {
  const options = parse(process.argv.slice(2));
  const { service, cleanup } = options.mode === 'impianto' ? startPlant(options) : await startSimulation(options);
  const running = service.run();
  let stopping = null;
  const stop = () => {
    stopping ??= service.stop(running).then(cleanup).then(() => console.log('Servizio fermato.'));
    return stopping;
  };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) process.on(signal, stop);
  if (options.durationS) setTimeout(stop, options.durationS * 1000);
  console.log('Servizio avviato. Per fermarlo premere Ctrl+C.');
  await running;
  await stop();
} catch (error) {
  console.error(`SERVIZIO NON AVVIATO: ${error.message}`);
  process.exitCode = 1;
}

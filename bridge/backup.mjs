#!/usr/bin/env node
/**
 * Backup e ripristino LOCALE dell'archivio SQLite del ponte.
 *   node bridge/backup.mjs backup     [--impianto | --simulazione] [--dati cartella]
 *   node bridge/backup.mjs elenco     [--impianto | --simulazione] [--dati cartella]
 *   node bridge/backup.mjs ripristina <file.sqlite> [--impianto | --simulazione] [--dati cartella]
 * Il backup usa `VACUUM INTO`: copia coerente anche con il servizio in funzione.
 * Il ripristino richiede il servizio fermo e salva prima una copia dell'archivio attuale.
 * I backup restano sul PC (bridge/data/backup, escluso da Git): copiarli anche altrove.
 */
import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STORE_MARKER } from './core/store.mjs';

function stamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
}

/** Verifica che il file sia un archivio integro del ponte e ne restituisce modalità e linea. */
export function inspectArchive(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const integrity = db.prepare('PRAGMA integrity_check').get();
    if (Object.values(integrity)[0] !== 'ok') throw new Error('Archivio danneggiato: controllo di integrità non superato.');
    let meta;
    try { meta = db.prepare('SELECT marker, mode, line FROM ponte_meta WHERE id = 1').get(); } catch { meta = null; }
    if (meta?.marker !== STORE_MARKER) throw new Error('Il file non è un archivio del ponte riconosciuto.');
    const events = db.prepare('SELECT COUNT(*) AS n FROM ponte_events').get().n;
    return { mode: meta.mode, line: meta.line, events };
  } finally {
    db.close();
  }
}

/** Copia coerente con VACUUM INTO; restituisce il percorso del backup verificato. */
export function backupArchive(dbFile, backupDir, label = 'ponte') {
  if (!existsSync(dbFile)) throw new Error(`Archivio non trovato: ${dbFile}`);
  mkdirSync(backupDir, { recursive: true });
  let target = join(backupDir, `${label}-${stamp()}.sqlite`);
  for (let i = 1; existsSync(target); i++) target = join(backupDir, `${label}-${stamp()}-${i}.sqlite`);
  const db = new DatabaseSync(dbFile);
  try { db.prepare('VACUUM INTO ?').run(target); } finally { db.close(); }
  inspectArchive(target);
  return target;
}

/** Sostituisce l'archivio con un backup verificato, dopo averne salvato una copia. */
export function restoreArchive(backupFile, dbFile, backupDir) {
  const source = inspectArchive(backupFile);
  if (existsSync(dbFile)) {
    const current = inspectArchive(dbFile);
    if (current.mode !== source.mode || current.line !== source.line) {
      throw new Error(`Backup di ${source.mode}/${source.line}, archivio attuale di ${current.mode}/${current.line}: ripristino rifiutato.`);
    }
    backupArchive(dbFile, backupDir, 'prima-del-ripristino');
  }
  const temporary = `${dbFile}.ripristino`;
  copyFileSync(backupFile, temporary);
  for (const suffix of ['', '-wal', '-shm']) rmSync(dbFile + suffix, { force: true });
  renameSync(temporary, dbFile);
  return inspectArchive(dbFile);
}

function serviceRunning(dataDir) {
  try { process.kill(Number(readFileSync(join(dataDir, 'ponte.lock'), 'utf8')), 0); return true; }
  catch (error) { return error.code === 'EPERM'; }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const args = process.argv.slice(2);
    const command = args.shift();
    let mode = 'impianto'; let dataDir = null; let file = null;
    while (args.length) {
      const arg = args.shift();
      if (arg === '--impianto' || arg === '--simulazione') mode = arg.slice(2);
      else if (arg === '--dati' && args.length) dataDir = resolve(args.shift());
      else if (command === 'ripristina' && !file) file = resolve(arg);
      else throw new Error('Uso: node bridge/backup.mjs backup|elenco|ripristina <file> [--impianto|--simulazione] [--dati cartella]');
    }
    dataDir ??= fileURLToPath(new URL(`./data/${mode}`, import.meta.url));
    const dbFile = join(dataDir, 'ponte.sqlite');
    const backupDir = join(dataDir, 'backup');
    if (command === 'backup') {
      const target = backupArchive(dbFile, backupDir, `ponte-${mode}`);
      console.log(`Backup creato e verificato: ${target}`);
      console.log('Copiare il file anche su un supporto esterno o in un archivio riservato.');
    } else if (command === 'elenco') {
      const files = existsSync(backupDir) ? readdirSync(backupDir).filter(f => f.endsWith('.sqlite')).sort() : [];
      if (!files.length) console.log('Nessun backup trovato.');
      for (const name of files) console.log(join(backupDir, name));
    } else if (command === 'ripristina') {
      if (!file) throw new Error('Indicare il file di backup da ripristinare.');
      if (serviceRunning(dataDir)) throw new Error('Il servizio ponte è in funzione: fermarlo (Ctrl+C) prima del ripristino.');
      const result = restoreArchive(file, dbFile, backupDir);
      console.log(`Ripristinato ${basename(file)}: ${result.events} eventi, linea ${result.line}. Copia precedente salvata in ${backupDir}.`);
    } else {
      throw new Error('Comando sconosciuto. Usare backup, elenco o ripristina.');
    }
  } catch (error) {
    console.error(`OPERAZIONE NON COMPLETATA: ${error.message}`);
    process.exitCode = 1;
  }
}

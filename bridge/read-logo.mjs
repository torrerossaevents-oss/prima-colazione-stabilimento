#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { readStableCounter, validateConfig } from './core/modbus.mjs';

function parseArguments(args) {
  let file = fileURLToPath(new URL('./logo.config.local.json', import.meta.url));
  let paused = false;
  let hasPath = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--linea-ferma' && !paused) paused = true;
    else if (args[i] === '--config' && !hasPath && args[i + 1] && !args[i + 1].startsWith('--')) {
      file = resolve(args[++i]); hasPath = true;
    } else throw new Error('Uso: node bridge/read-logo.mjs --linea-ferma [--config percorso.json]');
  }
  if (!paused) throw new Error('Questa prova richiede la linea in pausa secondo la procedura di reparto. Poi aggiungere --linea-ferma; il programma non arresta la macchina.');
  return file;
}

try {
  const file = parseArguments(process.argv.slice(2));
  let config;
  try { config = JSON.parse(await readFile(file, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') throw new Error('Configurazione locale assente. Copiare logo.config.example.json in logo.config.local.json e far compilare i valori reali al tecnico.');
    throw new Error('Impossibile leggere la configurazione locale: verificare il file JSON.');
  }
  validateConfig(config);
  console.log('DIAGNOSTICA LOGO! — SOLA LETTURA');
  console.log('Due letture del cumulativo a linea in pausa. Nessun comando di avvio, reset o scrittura.');
  const result = await readStableCounter(config);
  console.log(`Cumulativo letto: ${result.cumulative}`);
  console.log(`Registri grezzi: ${result.registers.join(', ')}`);
  console.log(`Ultima lettura: ${result.readAt}`);
  console.log('Le due letture coincidono. Il significato e la coerenza del dato devono essere verificati sul LOGO! reale.');
  console.log('Questo dato NON è produzione registrata e NON viene inviato al gestionale o al magazzino.');
} catch (error) {
  console.error(`PROVA NON COMPLETATA: ${error.message}`);
  process.exitCode = 1;
}

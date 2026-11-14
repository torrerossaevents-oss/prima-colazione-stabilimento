#!/usr/bin/env node
/**
 * Mostra lo stato del ponte dal file stato.json (scritto dal servizio a ogni ciclo).
 *   node bridge/status.mjs [--impianto | --simulazione] [--dati cartella]
 * Non apre l'archivio e non contatta PLC o gestionale.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
let mode = 'impianto'; let dataDir = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--impianto' || args[i] === '--simulazione') mode = args[i].slice(2);
  else if (args[i] === '--dati' && args[i + 1]) dataDir = resolve(args[++i]);
}
dataDir ??= fileURLToPath(new URL(`./data/${mode}`, import.meta.url));

try {
  const s = JSON.parse(readFileSync(join(dataDir, 'stato.json'), 'utf8'));
  const ageS = Math.round((Date.now() - Date.parse(s.aggiornato)) / 1000);
  const yes = value => (value ? 'sì' : 'NO');
  console.log(`PONTE — ${s.tipo} — linea ${s.linea} — versione ${s.versione}`);
  console.log(`Ultimo aggiornamento: ${s.aggiornato} (${ageS} s fa)${ageS > 90 ? '  ATTENZIONE: il servizio potrebbe essere fermo' : ''}`);
  console.log(`PLC raggiungibile: ${yes(s.plc.raggiungibile)}; ultima lettura ${s.plc.ultimaLettura ?? 'n.d.'}; cumulativo ${s.plc.cumulativo ?? 'n.d.'}${s.plc.errore ? `; errore: ${s.plc.errore}` : ''}`);
  console.log(`Gestionale raggiungibile: ${yes(s.gestionale.raggiungibile)}; ultimo contatto ${s.gestionale.ultimoContatto ?? 'n.d.'}${s.gestionale.tokenRifiutato ? '; TOKEN RIFIUTATO (401)' : ''}${s.gestionale.errore ? `; errore: ${s.gestionale.errore}` : ''}`);
  console.log(s.lavorazione ? `Lavorazione seguita: ${s.lavorazione.id} (${s.lavorazione.stato}), ${s.lavorazione.cartoni} cartoni${s.lavorazione.anomalie.length ? `, anomalie: ${s.lavorazione.anomalie.join(', ')}` : ''}` : 'Nessuna lavorazione seguita.');
  console.log(`Eventi: ${s.coda['in-coda']} in coda, ${s.coda.confermato} confermati, ${s.coda['da-verificare']} da verificare.`);
  console.log(`Scritture sul LOGO!: ${s.scrittureAbilitate ? 'abilitate' : 'disabilitate'}. Ultimo heartbeat inviato: ${s.ultimoHeartbeatInviato ?? 'n.d.'}`);
  console.log(`Log: ${join(dataDir, 'log', 'ponte.log')}`);
} catch (error) {
  console.error(error.code === 'ENOENT' ? `Nessuno stato in ${dataDir}: il servizio non è mai stato avviato in questa modalità.` : `Stato non leggibile: ${error.message}`);
  process.exitCode = 1;
}

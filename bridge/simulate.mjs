#!/usr/bin/env node
/**
 * SIMULATORE DI PROTOCOLLO. Nessun LOGO!, nessun Internet, nessun dato reale.
 * PLC simulato (Modbus TCP su 127.0.0.1) + gestionale finto (HTTP su 127.0.0.1) +
 * servizio ponte reale con orologio virtuale. Il conteggio dai sensori del PLC simulato
 * imita la logica che dovrà avere il programma LOGO!: sull'impianto conta il PLC.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strict as assert } from 'node:assert';
import { createSimulation } from './core/sim-harness.mjs';

const directory = mkdtempSync(join(tmpdir(), 'prima-colazione-logo-SIMULAZIONE-'));
const checks = {};
function check(name, condition, detail) {
  assert.ok(condition, `${name}: ${detail}`);
  checks[name] = { esito: 'superato', dettaglio: detail };
  console.log(`OK  ${detail}`);
}

let sim;
try {
  console.log('PRIMA COLAZIONE — SIMULAZIONE DI PROTOCOLLO (dati simulati)');
  console.log('Nessun collegamento al LOGO! reale, a Internet o al magazzino.\n');
  // 65.450: durante la lavorazione A il contatore supera 65.535 (cambio della parola alta a 32 bit).
  sim = await createSimulation({ dataDir: join(directory, 'archivio'), cumulative: 65_450 });
  sim.start();
  await sim.cycle();
  const store = () => sim.service.store;
  const partial = () => sim.service.status().lavorazione?.cartoni;
  const closeWithButton = async () => { sim.plc.pressClose(); await sim.cycle(1, 100); await sim.cycle(1, 600); };
  const openRemote = async (id, productCode) => {
    sim.gestionale.openSession({ id, productCode, lotCode: `${productCode}-LOTTO`, operator: 'OPERATORE DI PROVA', startedAt: new Date(sim.clock.t).toISOString() });
    await sim.cycle(1, 1100);
    assert.equal(store().openSession()?.id, id);
  };

  // --- Scenario A: 200 cartoni con sosta, arretramenti, salto, rimbalzi, Internet perso ---
  console.log('Scenario A — SIM-ARTICOLO-A, attesi 200 cartoni');
  await openRemote('SIM-A', 'SIM-ARTICOLO-A');
  sim.cartons(60); await sim.cycle();
  sim.cartons(10, 'passCartonWithBounce'); await sim.cycle();
  sim.plc.passCartonWithStop(8_000); await sim.cycle();
  const beforeFaults = sim.plc.cumulative;
  sim.plc.backOff(); sim.plc.backOff(); sim.plc.skip(); await sim.cycle();
  check('sostaRimbalziAnomalie', sim.plc.cumulative === beforeFaults && partial() === 71 && sim.plc.anomalies.arretramento === 2 && sim.plc.anomalies['sequenza-incompleta'] === 1,
    'sosta e rimbalzi contano una volta; 2 arretramenti e 1 salto segnalati senza conteggio');
  sim.cartons(29); await sim.cycle();
  check('paroleA32bit', sim.plc.cumulative > 65_535, 'lettura del contatore oltre 65.535 (due registri) coerente');
  sim.gestionale.offline = true;
  for (let i = 0; i < 4; i++) { sim.cartons(25); await sim.cycle(1, 1100); }
  check('internetAssente', partial() === 200 && sim.service.status().gestionale.raggiungibile === false,
    'Internet assente a metà: la lavorazione già identificata continua (200 cartoni)');
  await closeWithButton();
  await sim.cycle(4, 600); // stessa richiesta letta di nuovo
  check('chiusuraInCoda', store().session('SIM-A').status === 'chiusa' && store().counts()['in-coda'] === 1 && sim.gestionale.closures.length === 0,
    'chiusura salvata in locale e in coda mentre Internet manca; pressione ripetuta senza seconda chiusura');
  sim.gestionale.offline = false;
  sim.gestionale.faults.push('lose-response');
  sim.advance(60_000); await sim.cycle(1, 1100);   // il server registra, la risposta va persa
  sim.advance(60_000); await sim.cycle(1, 1100);   // ritentativo con lo stesso eventId
  const eventA = store().events().find(e => e.sessionId === 'SIM-A');
  check('rispostaPersa', eventA.status === 'confermato' && eventA.duplicate && sim.gestionale.closures.length === 1,
    'Internet ripristinato; risposta persa dopo il salvataggio sul server: ritentativo riconosciuto come duplicato');

  // --- Scenario B: 150 cartoni con riavvio del processo e riavvio PLC con ritenzione ---
  console.log('\nScenario B — SIM-ARTICOLO-B, attesi 150 cartoni');
  await openRemote('SIM-B', 'SIM-ARTICOLO-B');
  check('nuovaBaseline', store().openSession().baseline === store().session('SIM-A').counterEnd, 'nuova lavorazione dalla baseline della chiusura precedente, parziale 0');
  sim.cartons(70); await sim.cycle();
  sim.restart();
  sim.cartons(10); // prodotti mentre il ponte era fermo: il PLC li conta
  await sim.cycle();
  check('riavvioProcesso', partial() === 80 && store().openSession().id === 'SIM-B', 'riavvio del ponte: lavorazione, baseline e coda riprese da SQLite (80 cartoni)');
  sim.plc.reboot({ retentive: true });
  sim.cartons(70); await sim.cycle();
  check('riavvioPlcConRitenzione', store().openSession().status === 'attiva' && partial() === 150, 'riavvio PLC con ritenzione: nessuna anomalia, conteggio proseguito');
  await closeWithButton();
  await sim.cycle(1, 1100);

  const sessions = store().sessions().filter(s => ['SIM-A', 'SIM-B'].includes(s.id));
  const total = sessions.reduce((sum, s) => sum + s.cartons, 0);
  check('totali', sessions.map(s => s.cartons).join(',') === '200,150' && total === 350
    && sim.gestionale.closures.map(c => c.cartons).join(',') === '200,150',
    'A 200 + B 150 = 350 cartoni, in locale e sul gestionale finto');

  // --- Scenario C: riavvio PLC senza ritenzione → da verificare ---
  console.log('\nScenario C — anomalia: riavvio PLC senza ritenzione');
  await openRemote('SIM-C', 'SIM-ARTICOLO-C');
  sim.cartons(30); await sim.cycle();
  sim.plc.reboot({ retentive: false });
  sim.cartons(10); await sim.cycle();
  check('contatoreDiminuito', store().openSession().status === 'da-verificare' && partial() === 30,
    'contatore diminuito: lavorazione «da verificare», parziale fermo a 30, nessuna quantità ricostruita');
  await closeWithButton();
  await sim.cycle(1, 1100);
  const closureC = sim.gestionale.closures.find(c => c.sessionId === 'SIM-C');
  check('chiusuraConAnomalia', closureC?.cartons === 30 && closureC.anomalies.includes('contatore-diminuito'),
    'chiusura inviata con anomalia «contatore-diminuito» per il controllo');
  const events = store().events();
  check('nessunDoppione', new Set(events.map(e => e.sessionId)).size === events.length && events.every(e => e.status === 'confermato')
    && sim.gestionale.closures.length === 3 && store().sessions().every(s => s.cartons === null || s.cartons >= 0),
    'un evento per lavorazione, tutti confermati, nessuna quantità negativa');

  const report = {
    tipo: 'SIMULAZIONE', simulation: true, schemaVersion: 2,
    avvertenza: 'Prova software con PLC e gestionale simulati. Non certifica il programma LOGO!, i sensori, la rete o il server reale.',
    totaleCartoniAB: total,
    verifiche: checks,
    anomalieSensoriPlcSimulato: sim.plc.anomalies,
    lavorazioni: store().sessions(),
    eventi: events.map(({ eventId, type, sessionId, status, attempts, duplicate, payload }) => ({ eventId, type, sessionId, status, attempts, duplicate, cartons: payload.cartons })),
    chiusureRicevuteDalGestionaleFinto: sim.gestionale.closures.map(({ sessionId, cartons, anomalies }) => ({ sessionId, cartons, anomalies })),
  };
  const reportPath = join(directory, 'RISULTATO-SIMULAZIONE.json');
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(`\nSIMULAZIONE SUPERATA: ${Object.keys(checks).length} verifiche. Totale A+B: ${total} cartoni simulati.`);
  console.log('Il conteggio reale avverrà nel LOGO!: questa prova non sostituisce il collaudo sull’impianto.');
  console.log(`Rapporto: ${reportPath}`);
  console.log(`Log del ponte simulato: ${join(directory, 'archivio', 'log', 'ponte.log')}`);
} catch (error) {
  console.error('PROVA NON SUPERATA:', error.message);
  process.exitCode = 1;
} finally {
  await sim?.close();
}

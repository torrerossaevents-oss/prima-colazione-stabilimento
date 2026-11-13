import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, copyFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createSimulation } from '../core/sim-harness.mjs';
import { loadPlantConfig, validateServiceConfig } from '../core/config.mjs';
import { RotatingLog } from '../core/log.mjs';

async function setup(t, options = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'ponte-service-test-'));
  const sim = await createSimulation({ dataDir, ...options });
  sim.start();
  t.after(async () => { await sim.close(); rmSync(dataDir, { recursive: true, force: true }); });
  return { sim, dataDir, log: () => readFileSync(join(dataDir, 'log', 'ponte.log'), 'utf8'), status: () => JSON.parse(readFileSync(join(dataDir, 'stato.json'), 'utf8')) };
}

async function openRemote(sim, id, productCode = `SIM-${id}`) {
  sim.gestionale.openSession({ id, productCode, lotCode: `LOTTO-${id}`, startedAt: new Date(sim.clock.t).toISOString() });
  await sim.cycle(1, 1100); // oltre syncMs
  assert.equal(sim.service.store.openSession()?.id, id, `lavorazione ${id} seguita`);
}

async function closeWithButton(sim) {
  sim.plc.pressClose();
  await sim.cycle(1, 100);
  await sim.cycle(1, 600); // sensori liberi e stabili oltre 500 ms
}

test('protocollo di chiusura: attesa sensori liberi, transazione locale, riscontro, nuova baseline, pressione ripetuta ignorata', async t => {
  const { sim, log } = await setup(t);
  await sim.cycle();
  await openRemote(sim, 'A');
  const baseline = sim.service.store.openSession().baseline;
  sim.cartons(199);
  await sim.cycle();
  // Ultimo cartone fermo tra i sensori mentre si preme il pulsante.
  sim.plc.sequence([['10', 60], ['11', 60]]);
  sim.plc.pressClose();
  await sim.cycle(3, 400);
  assert.equal(sim.service.store.openSession().id, 'A', 'nessuna chiusura con sensori occupati');
  assert.equal(sim.plc.ack, 0, 'nessun riscontro prima del salvataggio');
  sim.plc.sequence([['01', 60], ['00', 60]]);
  await sim.cycle(1, 100);
  assert.equal(sim.service.store.openSession().id, 'A', 'sensori liberi ma non ancora stabili');
  await sim.cycle(1, 600);
  const closed = sim.service.store.session('A');
  assert.equal(closed.status, 'chiusa');
  assert.equal(closed.cartons, 200);
  assert.equal(closed.closeRequestId, `linea-simulazione-1-${baseline}`);
  assert.equal(sim.plc.ack, 1, 'riscontro della stessa richiesta scritto dopo il salvataggio');
  assert.equal(sim.gestionale.closures.length, 1);
  assert.equal(sim.gestionale.closures[0].cartons, 200);
  // Stesso valore del pulsante letto di nuovo: nessuna seconda chiusura.
  await sim.cycle(5, 600);
  assert.equal(sim.service.store.events().filter(e => e.type === 'session.close').length, 1);
  // Nuova lavorazione: parte dalla nuova baseline con parziale 0.
  await openRemote(sim, 'B');
  assert.equal(sim.service.store.openSession().baseline, baseline + 200);
  // Pressione senza lavorazione seguita: ignorata e senza riscontro.
  sim.cartons(150);
  await closeWithButton(sim);
  assert.equal(sim.service.store.session('B').cartons, 150);
  sim.plc.pressClose();
  await sim.cycle(2, 600);
  assert.equal(sim.plc.ack, 2, 'la terza pressione (senza lavorazione) non riceve riscontro');
  assert.match(log(), /senza lavorazione seguita: ignorata/);
});

test('writesEnabled false: chiusura salvata e trasmessa, nessuna scrittura Modbus', async t => {
  const { sim, log } = await setup(t, { patch: c => ({ ...c, plc: { ...c.plc, writesEnabled: false } }) });
  await sim.cycle();
  await openRemote(sim, 'A');
  sim.cartons(10);
  await closeWithButton(sim);
  assert.equal(sim.service.store.session('A').cartons, 10);
  assert.equal(sim.plc.server.requests.filter(r => r.fn === 6 || r.fn === 16).length, 0);
  assert.match(log(), /Scritture disabilitate/);
});

test('Internet assente: nessuna nuova lavorazione offline; quella identificata continua e la chiusura va in coda', async t => {
  const { sim, log, status } = await setup(t);
  await sim.cycle();
  // Il gestionale apre A mentre il ponte non lo raggiunge: il ponte non apre nulla offline.
  sim.gestionale.offline = true;
  sim.gestionale.openSession({ id: 'A', productCode: 'SIM-A', lotCode: 'L-A' });
  await sim.cycle(3, 1100);
  assert.equal(sim.service.store.openSession(), null);
  sim.cartons(5);
  await sim.cycle();
  assert.match(log(), /5 cartoni contati dal PLC senza lavorazione seguita/);
  sim.gestionale.offline = false;
  await sim.cycle(1, 1100);
  assert.equal(sim.service.store.openSession().id, 'A');
  sim.cartons(100);
  await sim.cycle();
  sim.gestionale.offline = true;
  sim.cartons(100);
  await sim.cycle(2, 1100);
  assert.equal(status().gestionale.raggiungibile, false);
  assert.equal(status().lavorazione.cartoni, 200, 'la lavorazione già identificata continua');
  await closeWithButton(sim);
  assert.equal(sim.service.store.session('A').status, 'chiusa');
  assert.equal(sim.service.store.counts()['in-coda'], 1);
  assert.equal(sim.gestionale.closures.length, 0);
  sim.gestionale.offline = false;
  sim.advance(60_000); // oltre l'attesa dei ritentativi
  await sim.cycle(1, 1100);
  assert.equal(sim.service.store.counts().confermato, 1);
  assert.equal(sim.gestionale.closures[0].cartons, 200);
  assert.match(log(), /Internet o gestionale non raggiungibile/);
  assert.match(log(), /Gestionale di nuovo raggiungibile/);
});

test('LAN/PLC non raggiungibile: nessuna stima; alla ripresa il cumulativo assoluto include i cartoni contati dal PLC', async t => {
  const { sim, log, status } = await setup(t);
  await sim.cycle();
  await openRemote(sim, 'A');
  sim.cartons(20);
  await sim.cycle();
  sim.plc.online = false;
  sim.cartons(30); // il PLC continua a contare
  await sim.cycle(2);
  assert.equal(status().plc.raggiungibile, false);
  assert.equal(status().lavorazione.cartoni, 20, 'nessuna quantità stimata durante l’interruzione');
  sim.plc.online = true;
  await sim.cycle();
  assert.equal(status().lavorazione.cartoni, 50);
  assert.match(log(), /LAN\/PLC non raggiungibile/);
  assert.match(log(), /PLC di nuovo raggiungibile/);
});

test('PLC riavviato: con ritenzione nessuna anomalia; senza ritenzione «da verificare», nessuna quantità fabbricata', async t => {
  const { sim, log } = await setup(t);
  await sim.cycle();
  await openRemote(sim, 'A');
  sim.cartons(30);
  await sim.cycle();
  sim.plc.reboot({ retentive: true });
  sim.cartons(5);
  await sim.cycle();
  assert.equal(sim.service.store.openSession().status, 'attiva');
  sim.plc.reboot({ retentive: false });
  sim.cartons(10);
  await sim.cycle(2);
  const open = sim.service.store.openSession();
  assert.equal(open.status, 'da-verificare');
  assert.deepEqual(open.anomalies, ['contatore-diminuito']);
  assert.equal(sim.service.status().lavorazione.cartoni, 35);
  // Il contatore richieste è ripartito da 0: la prima pressione dopo il riavvio vale 1.
  await closeWithButton(sim);
  const closed = sim.service.store.session('A');
  assert.equal(closed.cartons, 35);
  assert.ok(closed.anomalies.includes('contatore-diminuito'));
  assert.equal(sim.gestionale.closures[0].cartons, 35);
  assert.deepEqual(sim.gestionale.closures[0].anomalies, ['contatore-diminuito']);
  assert.equal(sim.service.counter.baseline, sim.plc.cumulative, 'nuova baseline dal valore attuale del PLC');
  assert.match(log(), /PLC riavviato senza ritenzione/);
});

test('PC riavviato: ripresa da SQLite di lavorazione, baseline e coda; nessun doppio conteggio', async t => {
  const { sim, log } = await setup(t);
  await sim.cycle();
  await openRemote(sim, 'A');
  sim.cartons(70);
  await sim.cycle();
  sim.gestionale.offline = true;
  sim.cartons(10);
  await sim.cycle();
  sim.restart();
  sim.cartons(20); // prodotti mentre il PC era spento
  await sim.cycle();
  assert.equal(sim.service.status().lavorazione.cartoni, 100);
  await closeWithButton(sim);
  sim.restart();
  assert.equal(sim.service.store.counts()['in-coda'], 1, 'evento ancora in coda dopo il riavvio');
  sim.gestionale.offline = false;
  sim.advance(60_000);
  await sim.cycle(1, 1100);
  assert.equal(sim.gestionale.closures.length, 1);
  assert.equal(sim.gestionale.closures[0].cartons, 100);
  assert.match(log(), /Ripresa dall'archivio locale/);
});

test('orologio del PC che torna indietro: le letture del contatore non si bloccano', async t => {
  const { sim, log } = await setup(t);
  await sim.cycle();
  await openRemote(sim, 'A');
  sim.cartons(10);
  await sim.cycle();
  const realNow = sim.service.now;
  sim.service.now = () => realNow() - 3_600_000;
  sim.cartons(5);
  await sim.cycle(3);
  assert.equal(sim.service.status().lavorazione.cartoni, 15);
  assert.equal(log().match(/Orologio del PC tornato indietro/g).length, 1, 'avviso registrato una sola volta');
});

test('un solo servizio per archivio; stato JSON scritto per la diagnosi', async t => {
  const { sim, dataDir, status } = await setup(t);
  assert.throws(() => sim.start(), /già in esecuzione/);
  await sim.cycle();
  const s = status();
  assert.equal(s.tipo, 'SIMULAZIONE');
  assert.equal(s.plc.raggiungibile, true);
  assert.ok(s.ultimoHeartbeatInviato);
  assert.ok(!JSON.stringify(s).includes('pcd_'), 'nessun token nel file di stato');
  assert.ok(readdirSync(dataDir).includes('ponte.lock'));
});

test('modalità impianto: rifiuta configurazione incompleta, mappa non confermata o token assente', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ponte-config-test-'));
  try {
    const example = fileURLToPath(new URL('../ponte.config.example.json', import.meta.url));
    const local = join(dir, 'ponte.local.json');
    copyFileSync(example, local);
    assert.throws(() => loadPlantConfig(local), /mapConfirmed/);
    const parsed = JSON.parse(readFileSync(example, 'utf8'));
    for (const path of ['line', 'server.baseUrl', 'plc.host', 'plc.unitId', 'plc.pollIntervalMs', 'plc.counter.address', 'plc.counter.wordOrder',
      'plc.counter.modulo', 'plc.counter.maxStepPerSecond', 'plc.sensors.address', 'plc.closeRequest.address', 'plc.closeAck.address', 'close.sensorsFreeStableMs']) {
      const keys = path.split('.');
      let node = parsed; for (const key of keys.slice(0, -1)) node = node[key];
      assert.equal(node[keys.at(-1)], null, `${path} deve essere null nel modello`);
    }
    assert.equal(parsed.plc.writesEnabled, false);
    const complete = { ...parsed, mapConfirmed: true, line: 'linea-1', server: { baseUrl: 'https://gestionale.example' },
      plc: { ...parsed.plc, host: '192.168.0.50', unitId: 1, pollIntervalMs: 1000,
        counter: { functionCode: 3, address: 0, wordOrder: 'BE', modulo: 2 ** 32, maxStepPerSecond: 5 },
        sensors: { functionCode: 3, address: 2 }, closeRequest: { functionCode: 3, address: 3 }, closeAck: { functionCode: 6, address: 4 } },
      close: { sensorsFreeStableMs: 2000 } };
    writeFileSync(local, JSON.stringify(complete));
    assert.throws(() => loadPlantConfig(local), /Token del dispositivo assente/);
    writeFileSync(join(dir, 'token.local.json'), JSON.stringify({ token: 'non-valido' }));
    assert.throws(() => loadPlantConfig(local), /non valido/);
    writeFileSync(join(dir, 'token.local.json'), JSON.stringify({ token: 'pcd_' + 'x'.repeat(43) }));
    assert.equal(loadPlantConfig(local).config.plc.writesEnabled, false);
    for (const bad of [{ plc: { ...complete.plc, host: '127.0.0.1' } }, { plc: { ...complete.plc, host: '8.8.8.8' } },
      { server: { baseUrl: 'http://gestionale.example' } }, { plc: { ...complete.plc, writesEnabled: 'true' } }, { mode: 'simulazione' }]) {
      writeFileSync(local, JSON.stringify({ ...complete, ...bad }));
      assert.throws(() => loadPlantConfig(local), /Configurazione incompleta/);
    }
    assert.throws(() => validateServiceConfig({ ...complete, plc: { ...complete.plc, host: '127.0.0.1' } }), /plc.host/);
    const cli = fileURLToPath(new URL('../service.mjs', import.meta.url));
    const result = spawnSync(process.execPath, [cli, '--impianto', '--config', example], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /non parte/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('log con rotazione per dimensione: al massimo N file, ciascuno entro il limite', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ponte-log-test-'));
  try {
    const log = new RotatingLog({ dir, maxBytes: 10_000, files: 5, now: () => 0 });
    for (let i = 0; i < 2000; i++) log.write('INFO', `riga ${i} ${'x'.repeat(40)}`);
    const files = readdirSync(dir).sort();
    assert.deepEqual(files, ['ponte.1.log', 'ponte.2.log', 'ponte.3.log', 'ponte.4.log', 'ponte.log']);
    for (const file of files) assert.ok(statSync(join(dir, file)).size <= 10_000);
    assert.match(readFileSync(join(dir, 'ponte.log'), 'utf8'), /riga 1999/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

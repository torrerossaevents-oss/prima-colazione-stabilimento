import test from 'node:test';
import assert from 'node:assert/strict';
import { ModbusConnection, readRegisters, readDiscreteInputs, writeSingleRegister, writeMultipleRegisters } from '../core/modbus.mjs';
import { FakeModbusServer } from '../core/modbus-sim-server.mjs';
import { ModbusPlc, decodeSensors } from '../core/plc.mjs';

async function withFake(run) {
  const server = new FakeModbusServer({ unitId: 1 });
  const port = await server.listen();
  try { await run(server, { host: '127.0.0.1', port, timeoutMs: 500 }); } finally { await server.close(); }
}

test('funzione 06 e 16 contro un server finto: registri scritti e riscontro verificato', async () => {
  await withFake(async (server, target) => {
    const connection = await ModbusConnection.open(target);
    try {
      await writeSingleRegister(connection, { unitId: 1, address: 4, value: 7 }, { writesEnabled: true });
      await writeMultipleRegisters(connection, { unitId: 1, address: 10, values: [1, 65535, 3] }, { writesEnabled: true });
      assert.deepEqual(await readRegisters(connection, { unitId: 1, functionCode: 3, address: 10, count: 3 }), [1, 65535, 3]);
      assert.equal(server.get(4), 7);
    } finally { connection.close(); }
    assert.deepEqual(server.requests.map(r => r.fn), [6, 16, 3]);
  });
});

test('senza writesEnabled === true nessuna scrittura parte', async () => {
  await withFake(async (server, target) => {
    const connection = await ModbusConnection.open(target);
    try {
      for (const options of [undefined, {}, { writesEnabled: 'true' }, { writesEnabled: 1 }]) {
        await assert.rejects(writeSingleRegister(connection, { unitId: 1, address: 4, value: 7 }, options), /Scritture Modbus disabilitate/);
        await assert.rejects(writeMultipleRegisters(connection, { unitId: 1, address: 4, values: [7] }, options), /Scritture Modbus disabilitate/);
      }
    } finally { connection.close(); }
    assert.equal(server.requests.length, 0);
    assert.equal(server.get(4), 0);
  });
});

test('eccezione Modbus su scrittura e valori fuori intervallo sono rifiutati', async () => {
  await withFake(async (server, target) => {
    const connection = await ModbusConnection.open(target);
    try {
      await assert.rejects(writeSingleRegister(connection, { unitId: 9, address: 4, value: 1 }, { writesEnabled: true }), /rifiutato la scrittura: eccezione Modbus 11/);
    } finally { connection.close(); }
    const second = await ModbusConnection.open(target);
    try {
      await assert.rejects(writeSingleRegister(second, { unitId: 1, address: 4, value: 65536 }, { writesEnabled: true }), /valore/);
      await assert.rejects(writeMultipleRegisters(second, { unitId: 1, address: 65535, values: [1, 2] }, { writesEnabled: true }), /supera/);
    } finally { second.close(); }
  });
});

test('PLC non raggiungibile: errore classificato come PLC_UNREACHABLE', async () => {
  await withFake(async (server, target) => {
    server.online = false;
    const plc = new ModbusPlc({ ...target, unitId: 1, writesEnabled: false,
      counter: { functionCode: 3, address: 0, wordOrder: 'BE', modulo: 2 ** 32 },
      sensors: { functionCode: 3, address: 2 }, closeRequest: { functionCode: 3, address: 3 }, closeAck: { functionCode: 6, address: 4 } });
    await assert.rejects(plc.read(), error => error.code === 'PLC_UNREACHABLE');
  });
});

test('lettura del contatore a 32 bit: lettura strappata scartata, coerente accettata', async () => {
  await withFake(async (server, target) => {
    const plc = new ModbusPlc({ ...target, unitId: 1, writesEnabled: false,
      counter: { functionCode: 3, address: 0, wordOrder: 'BE', modulo: 2 ** 32 },
      sensors: { functionCode: 3, address: 2 }, closeRequest: { functionCode: 3, address: 3 }, closeAck: { functionCode: 6, address: 4 } });
    server.set(0, 1); server.set(1, 5); server.set(2, 3); server.set(3, 9);
    assert.deepEqual(await plc.read(), { cumulative: 65541, sensors: '11', closeRequest: 9 });
    // Ogni lettura del contatore restituisce un valore diverso con parola alta diversa: dato scartato.
    let flip = 0;
    server.beforeReply = request => { if (request.address === 0) server.set(0, (flip++ % 2) + 1); };
    await assert.rejects(plc.read(), error => error.code === 'PLC_DATA' && /discordanti/.test(error.message));
    // Con writesEnabled false il riscontro è rifiutato senza toccare il PLC.
    server.beforeReply = null;
    await assert.rejects(plc.acknowledge(9), /disabilitate/);
    assert.equal(server.requests.filter(r => r.fn === 6).length, 0);
  });
  assert.equal(decodeSensors(0), '00');
  assert.equal(decodeSensors(1), '10');
  assert.equal(decodeSensors(2), '01');
  assert.equal(decodeSensors(4), 'non-valido');
});

test('funzione 02: fotocellule lette come ingressi I3/I4 del LOGO!, codifica A = bit 0, B = bit 1', async () => {
  await withFake(async (server, target) => {
    const plc = new ModbusPlc({ ...target, unitId: 1, writesEnabled: false,
      counter: { functionCode: 3, address: 1, wordOrder: 'BE', modulo: 65536 },
      sensors: { functionCode: 2, address: 2 }, closeRequest: { functionCode: 3, address: 3 }, closeAck: { functionCode: 6, address: 10 } });
    server.set(1, 42); server.set(3, 2);
    assert.deepEqual(await plc.read(), { cumulative: 42, sensors: '00', closeRequest: 2 });
    server.setInput(2, 1);
    assert.equal((await plc.read()).sensors, '10', 'solo A coperta (I3)');
    server.setInput(3, 1);
    assert.equal((await plc.read()).sensors, '11');
    server.setInput(2, 0);
    assert.equal((await plc.read()).sensors, '01', 'solo B coperta (I4)');
    server.setInput(0, 1); // I1, pulsante: non cambia lo stato dei sensori
    assert.equal((await plc.read()).sensors, '01');
    assert.deepEqual(server.requests.filter(r => r.fn === 2).map(r => [r.address, r.count]).at(-1), [2, 2]);
    const connection = await ModbusConnection.open(target);
    try {
      assert.deepEqual(await readDiscreteInputs(connection, { unitId: 1, address: 0, count: 10 }), [1, 0, 0, 1, 0, 0, 0, 0, 0, 0]);
      await assert.rejects(readDiscreteInputs(connection, { unitId: 1, address: 65535, count: 2 }), /supera/);
    } finally { connection.close(); }
  });
});

test('prova ingressi: argomenti e descrizione leggibile', async () => {
  const { parseArguments, describe } = await import('../prova-ingressi.mjs');
  assert.throws(() => parseArguments([]), /--host/);
  assert.throws(() => parseArguments(['--host', '8.8.8.8']), /privato/);
  assert.deepEqual(parseArguments(['--host', '192.168.10.15']), { host: '192.168.10.15', unitId: 1, port: 502, times: Infinity });
  assert.equal(parseArguments(['--host', '192.168.10.15', '--port', '510']).port, 510);
  assert.throws(() => parseArguments(['--host', '192.168.10.15', '--port', '70000']), /porta/);
  assert.equal(describe([1, 0, 1, 0, 0, 0, 0, 0]), 'I1 pulsante CHIUDI: PREMUTO   I3 fotocellula A: COPERTA (1)   I4 fotocellula B: libera (0)');
});

test('configurazione: la funzione 02 è ammessa solo per le fotocellule', async () => {
  const { validateServiceConfig } = await import('../core/config.mjs');
  const base = { schemaVersion: 1, mode: 'impianto', mapConfirmed: true, line: 'linea-1', server: { baseUrl: 'https://gestionale.example' },
    plc: { host: '192.168.10.15', port: 502, unitId: 1, timeoutMs: 2000, pollIntervalMs: 250, writesEnabled: false,
      counter: { functionCode: 3, address: 1, wordOrder: 'BE', modulo: 65536, maxStepPerSecond: 5 },
      sensors: { functionCode: 2, address: 2 }, closeRequest: { functionCode: 3, address: 3 }, closeAck: { functionCode: 6, address: 10 } },
    close: { sensorsFreeStableMs: 2000 } };
  assert.equal(validateServiceConfig(base).plc.sensors.functionCode, 2);
  assert.throws(() => validateServiceConfig({ ...base, plc: { ...base.plc, closeRequest: { functionCode: 2, address: 0 } } }), /closeRequest\.functionCode/);
  assert.throws(() => validateServiceConfig({ ...base, plc: { ...base.plc, counter: { ...base.plc.counter, functionCode: 2 } } }), /counter\.functionCode/);
});

test('modello per il LOGO! 24CE: senza i dati del posto non parte, completato è valido', async () => {
  const { readFileSync } = await import('node:fs');
  const { validateServiceConfig, missingPlantFields } = await import('../core/config.mjs');
  const { validateConfig } = await import('../core/modbus.mjs');
  const model = JSON.parse(readFileSync(new URL('../ponte.config.24ce.json', import.meta.url), 'utf8'));
  assert.equal(model.plc.host, null); assert.equal(model.mapConfirmed, false); assert.equal(model.plc.writesEnabled, false);
  assert.deepEqual(missingPlantFields(model).map(f => f.split(' ')[0]).sort(),
    ['close.sensorsFreeStableMs', 'line', 'mapConfirmed', 'plc.counter.maxStepPerSecond', 'plc.host', 'server.baseUrl']);
  const done = { ...model, mapConfirmed: true, line: 'linea-1', server: { baseUrl: 'https://gestionale.example' },
    plc: { ...model.plc, host: '192.168.10.15', counter: { ...model.plc.counter, maxStepPerSecond: 5 } }, close: { sensorsFreeStableMs: 2000 } };
  assert.deepEqual(validateServiceConfig(done).plc.sensors, { address: 2, functionCode: 2 });
  const read = JSON.parse(readFileSync(new URL('../logo.config.24ce.json', import.meta.url), 'utf8'));
  assert.throws(() => validateConfig(read), /non confermata/);
  assert.equal(validateConfig({ ...read, mapConfirmed: true, host: '192.168.10.15' }).wordCount, 2);
});

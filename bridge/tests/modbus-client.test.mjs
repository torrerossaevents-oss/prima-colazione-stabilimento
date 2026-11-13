import test from 'node:test';
import assert from 'node:assert/strict';
import { ModbusConnection, readRegisters, writeSingleRegister, writeMultipleRegisters } from '../core/modbus.mjs';
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

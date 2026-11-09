import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateConfig, isPrivateIPv4, decodeUnsignedCounter, readCounterOnce, readStableCounter } from '../core/modbus.mjs';

const base = { schemaVersion: 1, mapConfirmed: true, host: '192.168.10.15', port: 502, unitId: 1, functionCode: 3, address: 100, wordCount: 2, wordOrder: 'BE', timeoutMs: 500 };
const testing = { allowLoopbackForTests: true };
function reply(request, registers = [0, 200]) {
  const frame = Buffer.alloc(9 + registers.length * 2);
  request.copy(frame, 0, 0, 4);
  frame.writeUInt16BE(3 + registers.length * 2, 4);
  frame[6] = request[6]; frame[7] = request[7]; frame[8] = registers.length * 2;
  registers.forEach((word, i) => frame.writeUInt16BE(word, 9 + i * 2));
  return frame;
}
async function withServer(handler, run, overrides = {}) {
  const sockets = new Set(); let requests = 0;
  const server = net.createServer(socket => {
    sockets.add(socket); socket.on('error', () => {}); socket.on('close', () => sockets.delete(socket));
    let received = Buffer.alloc(0);
    socket.on('data', chunk => {
      received = Buffer.concat([received, chunk]);
      if (received.length >= 12) handler(socket, received, ++requests);
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  try { await run({ ...base, ...overrides, host: '127.0.0.1', port: server.address().port }); }
  finally { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); }
}

test('unknown PLC map is disabled; no implicit host, register or ordering', async () => {
  const example = JSON.parse(await readFile(new URL('../logo.config.example.json', import.meta.url), 'utf8'));
  assert.equal(example.mapConfirmed, false);
  for (const field of ['host','unitId','functionCode','address','wordCount','wordOrder']) assert.equal(example[field], null);
  assert.throws(() => validateConfig(example), /non confermata/);
  for (const field of ['host','port','unitId','functionCode','address','wordCount','wordOrder','timeoutMs']) assert.throws(() => validateConfig({ ...base, [field]: null }));
  assert.deepEqual(validateConfig(base), base);
});

test('CLI production configuration accepts only RFC1918 literal IPv4, never public addresses or localhost', () => {
  for (const host of ['10.1.2.3','172.16.0.1','172.31.255.254','192.168.0.20']) assert.equal(isPrivateIPv4(host), true);
  for (const host of ['127.0.0.1','0.0.0.0','169.254.1.2','172.15.0.1','172.32.0.1','192.169.0.1','8.8.8.8','224.1.1.1','255.255.255.255','localhost','logo.local','::1','192.168.001.1']) {
    assert.equal(isPrivateIPv4(host), false, host);
    assert.throws(() => validateConfig({ ...base, host }), /IPv4 privato/);
  }
});

test('strict integer ranges reject writes and invalid counter maps before any connection', () => {
  for (const patch of [{functionCode:6},{functionCode:16},{functionCode:1},{wordCount:0},{wordCount:3},{wordCount:1.5},{address:-1},{address:65535},{address:'100'},{unitId:256},{unitId:-1},{port:0},{port:65536},{timeoutMs:99},{timeoutMs:10001},{wordOrder:'ABCD'},{wordCount:1,wordOrder:'LE'}]) {
    assert.throws(() => validateConfig({ ...base, ...patch }));
  }
  assert.equal(validateConfig({...base,functionCode:4,wordCount:1,address:65535}).address,65535);
});

test('unsigned word decoding retains full uint32 range and explicit word order', () => {
  assert.equal(decodeUnsignedCounter([65535], 'BE'),65535);
  assert.equal(decodeUnsignedCounter([65535,65535], 'BE'),4294967295);
  assert.equal(decodeUnsignedCounter([1,2], 'BE'),65538);
  assert.equal(decodeUnsignedCounter([1,2], 'LE'),131073);
  assert.throws(()=>decodeUnsignedCounter([65536], 'BE'));
  assert.throws(()=>decodeUnsignedCounter([1], 'LE'));
  assert.throws(()=>decodeUnsignedCounter([], 'BE'));
});

test('read-only request encodes exact zero-based map and parses fragmented TCP response', async () => {
  await withServer((socket,request) => {
    assert.equal(request.length,12);
    assert.equal(request.readUInt16BE(2),0);
    assert.equal(request.readUInt16BE(4),6);
    assert.equal(request[6],1); assert.equal(request[7],3);
    assert.equal(request.readUInt16BE(8),100); assert.equal(request.readUInt16BE(10),2);
    const frame=reply(request,[65535,65535]);
    socket.write(frame.subarray(0,3));
    setTimeout(()=>{socket.write(frame.subarray(3,8));setTimeout(()=>socket.write(frame.subarray(8)),5);},5);
  },async config => {
    const result=await readCounterOnce(config,testing);
    assert.equal(result.cumulative,4294967295); assert.deepEqual(result.registers,[65535,65535]);
    assert.ok(Number.isFinite(Date.parse(result.readAt)));
  });
});

test('function 04 and low-word-first counters are read without writes', async () => {
  await withServer((socket,request)=>{assert.equal(request[7],4);socket.end(reply(request,[2,1]));},async config=>{
    assert.equal((await readCounterOnce(config,testing)).cumulative,65538);
  },{functionCode:4,wordOrder:'LE'});
});

test('paused-line diagnostic makes exactly two reads and requires matching values', async () => {
  let requestCount=0;
  await withServer((socket,request,count)=>{requestCount=count;socket.end(reply(request,[0,350]));},async config=>{
    const result=await readStableCounter(config,testing);assert.equal(result.cumulative,350);assert.equal(result.readings,2);assert.equal(result.diagnosticOnly,true);
  });
  assert.equal(requestCount,2);
  await withServer((socket,request,count)=>socket.end(reply(request,[0,count])),async config=>{
    await assert.rejects(readStableCounter(config,testing), /non coincidono/);
  });
});

test('invalid transaction, protocol, unit, function, lengths, trailing bytes and exceptions are rejected', async () => {
  const mutations=[
    [frame=>frame.writeUInt16BE((frame.readUInt16BE(0)+1)%65536,0),/Identificativo/],
    [frame=>frame.writeUInt16BE(1,2),/Protocollo/],
    [frame=>{frame[6]=2;},/Unità/],
    [frame=>{frame[7]=6;},/Funzione/],
    [frame=>frame.writeUInt16BE(2,4),/Lunghezza/],
    [frame=>{frame[8]=2;},/Numero di byte/]
  ];
  for (const [mutate,pattern] of mutations) {
    await withServer((socket,request)=>{const frame=reply(request);mutate(frame);socket.end(frame);},async config=>{
      await assert.rejects(readCounterOnce(config,testing),pattern);
    });
  }
  await withServer((socket,request)=>socket.end(Buffer.concat([reply(request),Buffer.from([0])])),async config=>{
    await assert.rejects(readCounterOnce(config,testing), /aggiuntivi/);
  });
  await withServer((socket,request)=>{const frame=reply(request).subarray(0,9);frame.writeUInt16BE(3,4);frame[7]|=0x80;frame[8]=2;socket.end(frame);},async config=>{
    await assert.rejects(readCounterOnce(config,testing), /eccezione Modbus 2/);
  });
  await withServer((socket,request)=>{const frame=reply(request);frame[7]|=0x80;socket.end(frame);},async config=>{
    await assert.rejects(readCounterOnce(config,testing), /malformata/);
  });
});

test('partial replies and stalled sockets have bounded failures', async () => {
  await withServer((socket,request)=>socket.end(reply(request).subarray(0,8)),async config=>{
    await assert.rejects(readCounterOnce(config,testing), /prima della risposta completa/);
  });
  await withServer(()=>{},async config=>{
    const before=Date.now();await assert.rejects(readCounterOnce(config,testing),/Timeout/);assert.ok(Date.now()-before<2000);
  },{timeoutMs:100});
  await withServer(socket=>socket.end(Buffer.alloc(261)),async config=>{
    await assert.rejects(readCounterOnce(config,testing),/troppo lunga/);
  });
});

test('CLI refuses unacknowledged pause, absent config and disabled example without touching PLC', () => {
  const cli=fileURLToPath(new URL('../read-logo.mjs',import.meta.url));
  const example=fileURLToPath(new URL('../logo.config.example.json',import.meta.url));
  for (const [args,expected] of [[[],/linea in pausa/],[['--linea-ferma','--config',example+'.missing'],/Configurazione locale assente/],[['--linea-ferma','--config',example],/Mappa LOGO! non confermata/],[['--linea-ferma','--write'],/Uso:/]]) {
    const result=spawnSync(process.execPath,[cli,...args],{encoding:'utf8'});
    assert.equal(result.status,1);assert.match(result.stderr,expected);assert.doesNotMatch(result.stdout,/Cumulativo letto/);
  }
});

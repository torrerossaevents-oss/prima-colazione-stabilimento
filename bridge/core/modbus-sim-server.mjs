/**
 * Server Modbus TCP finto, SOLO per test e simulazione su 127.0.0.1.
 * Non rappresenta la mappa reale del LOGO!: gli indirizzi usati in simulazione
 * sono di comodo e non vanno copiati nella configurazione dell'impianto.
 */
import net from 'node:net';

export class FakeModbusServer {
  constructor({ unitId = 1 } = {}) {
    this.unitId = unitId;
    this.registers = new Map();
    this.online = true;
    this.requests = [];      // { fn, address, count, values }
    this.beforeReply = null; // hook facoltativo (request) => void, per alterare i registri
    this.#server = net.createServer(socket => this.#handle(socket));
  }

  #server; #sockets = new Set();

  async listen() {
    await new Promise((resolve, reject) => { this.#server.once('error', reject); this.#server.listen(0, '127.0.0.1', resolve); });
    return this.#server.address().port;
  }

  get port() { return this.#server.address().port; }

  get(address) { return this.registers.get(address) ?? 0; }
  set(address, value) { this.registers.set(address, value & 0xffff); }

  async close() {
    for (const socket of this.#sockets) socket.destroy();
    await new Promise(resolve => this.#server.close(resolve));
  }

  #handle(socket) {
    this.#sockets.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => this.#sockets.delete(socket));
    if (!this.online) { socket.destroy(); return; }
    let buffer = Buffer.alloc(0);
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 7) {
        const size = 6 + buffer.readUInt16BE(4);
        if (buffer.length < size) return;
        const adu = buffer.subarray(0, size);
        buffer = buffer.subarray(size);
        if (!this.online) { socket.destroy(); return; }
        socket.write(this.#reply(adu));
      }
    });
  }

  #reply(adu) {
    const header = Buffer.from(adu.subarray(0, 7));
    const fn = adu[7];
    const address = adu.readUInt16BE(8);
    const exception = code => frame(header, Buffer.from([fn | 0x80, code]));
    if (adu[6] !== this.unitId) return exception(11);
    if (fn === 3 || fn === 4) {
      const count = adu.readUInt16BE(10);
      const request = { fn, address, count };
      this.requests.push(request);
      this.beforeReply?.(request);
      const data = Buffer.alloc(2 + count * 2);
      data[0] = fn; data[1] = count * 2;
      for (let i = 0; i < count; i++) data.writeUInt16BE(this.get(address + i), 2 + i * 2);
      return frame(header, data);
    }
    if (fn === 6) {
      const value = adu.readUInt16BE(10);
      this.requests.push({ fn, address, count: 1, values: [value] });
      this.set(address, value);
      return frame(header, adu.subarray(7, 12));
    }
    if (fn === 16) {
      const count = adu.readUInt16BE(10);
      const values = Array.from({ length: count }, (_, i) => adu.readUInt16BE(13 + i * 2));
      this.requests.push({ fn, address, count, values });
      values.forEach((value, i) => this.set(address + i, value));
      return frame(header, adu.subarray(7, 12));
    }
    return exception(1);
  }
}

function frame(header, pdu) {
  const out = Buffer.alloc(7 + pdu.length);
  header.copy(out, 0, 0, 7);
  out.writeUInt16BE(1 + pdu.length, 4);
  pdu.copy(out, 7);
  return out;
}

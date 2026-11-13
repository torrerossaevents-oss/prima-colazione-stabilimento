/**
 * Gestionale FINTO su 127.0.0.1, SOLO per test e simulazione.
 * Implementa la parte di docs/CONTRATTO-PONTE.md che serve al ponte: GET/POST
 * /api/devices/production, token Bearer, ricevute per eventId, verifica dei cartoni.
 * Non è il server reale e non ne prova il comportamento.
 */
import http from 'node:http';

const EVENT_ID = /^[A-Za-z0-9_-]{8,128}$/;

export class FakeGestionale {
  constructor({ token, line }) {
    this.token = token;
    this.line = line;
    this.activeSession = null;
    this.receipts = new Map();   // eventId → corpo JSON registrato
    this.closures = [];          // chiusure registrate
    this.heartbeats = [];
    this.requests = [];          // { method, eventId, outcome }
    this.offline = false;        // tutte le richieste: connessione chiusa senza risposta
    this.faults = [];            // per i prossimi eventi (non heartbeat): 'lose-response' | 'error500' | 'timeout' | 'html200'
    this.#server = http.createServer((req, res) => this.#handle(req, res));
  }

  #server; #sockets = new Set();

  async listen() {
    this.#server.on('connection', socket => { this.#sockets.add(socket); socket.on('close', () => this.#sockets.delete(socket)); });
    await new Promise((resolve, reject) => { this.#server.once('error', reject); this.#server.listen(0, '127.0.0.1', resolve); });
    return `http://127.0.0.1:${this.#server.address().port}`;
  }

  async close() {
    for (const socket of this.#sockets) socket.destroy();
    await new Promise(resolve => this.#server.close(resolve));
  }

  openSession(session) {
    if (this.activeSession) throw new Error('Gestionale finto: lavorazione già attiva.');
    this.activeSession = { source: 'device', unitsPerBox: 1, ...session };
  }

  #send(res, status, body, type = 'application/json') {
    res.writeHead(status, { 'content-type': type });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  }

  #handle(req, res) {
    if (this.offline) { req.socket.destroy(); return; }
    if (req.url !== '/api/devices/production') return this.#send(res, 404, { error: 'not-found' });
    if (req.headers.authorization !== `Bearer ${this.token}`) { this.requests.push({ method: req.method, outcome: 401 }); return this.#send(res, 401, { error: 'unauthorized' }); }
    if (req.method === 'GET') {
      return this.#send(res, 200, { serverTime: new Date().toISOString(), line: this.line, deviceId: 'dev_SIMULAZIONE', activeSession: this.activeSession });
    }
    if (req.method !== 'POST') return this.#send(res, 405, { error: 'method' });
    const chunks = []; let size = 0;
    req.on('data', chunk => { size += chunk.length; if (size <= 16 * 1024) chunks.push(chunk); });
    req.on('end', () => this.#post(req, res, size, Buffer.concat(chunks).toString('utf8')));
  }

  #post(req, res, size, raw) {
    if (size > 16 * 1024) return this.#send(res, 413, { code: 'too-large' });
    let body;
    try { body = JSON.parse(raw); } catch { return this.#send(res, 400, { code: 'bad-json' }); }
    // I guasti programmati si applicano agli eventi, non ai heartbeat.
    const fault = body?.type === 'heartbeat' ? undefined : this.faults.shift();
    if (fault === 'timeout') { this.requests.push({ method: 'POST', outcome: 'timeout' }); return; } // nessuna risposta
    if (fault === 'error500') { this.requests.push({ method: 'POST', outcome: 500 }); return this.#send(res, 500, { error: 'internal' }); }
    if (fault === 'html200') { this.requests.push({ method: 'POST', outcome: 'html200' }); return this.#send(res, 200, '<html>Accesso</html>', 'text/html'); }
    if (!body || !EVENT_ID.test(body.eventId ?? '')) return this.#send(res, 422, { code: 'invalid-event-id' });
    const outcome = this.#apply(body);
    this.requests.push({ method: 'POST', eventId: body.eventId, type: body.type, outcome: outcome.status });
    if (fault === 'lose-response') { req.socket.destroy(); return; } // registrato, risposta persa
    this.#send(res, outcome.status, outcome.body);
  }

  #apply(body) {
    const serialized = JSON.stringify(body);
    const previous = this.receipts.get(body.eventId);
    if (previous !== undefined) {
      return previous === serialized ? { status: 200, body: { ok: true, duplicate: true } } : { status: 409, body: { code: 'event-id-reused' } };
    }
    if (body.type === 'heartbeat') {
      this.receipts.set(body.eventId, serialized);
      this.heartbeats.push(body);
      return { status: 200, body: { ok: true } };
    }
    if (body.type !== 'session.close') return { status: 422, body: { code: 'unknown-type' } };
    const expected = body.counterEnd >= body.counterStart ? body.counterEnd - body.counterStart
      : (Number.isSafeInteger(body.counterModulo) ? body.counterModulo - body.counterStart + body.counterEnd : NaN);
    if (!Number.isSafeInteger(body.cartons) || body.cartons < 0 || body.cartons !== expected) return { status: 422, body: { code: 'cartons-mismatch' } };
    if (!this.activeSession || this.activeSession.id !== body.sessionId) return { status: 409, body: { code: 'session-closed' } };
    this.receipts.set(body.eventId, serialized);
    this.closures.push({ ...body, productCode: this.activeSession.productCode });
    this.activeSession = null;
    return { status: 200, body: { ok: true } };
  }
}

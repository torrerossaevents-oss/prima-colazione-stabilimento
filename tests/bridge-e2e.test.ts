/**
 * End-to-end on one machine: the real bridge modules (SQLite queue + transmitter)
 * talk over HTTP to the real gestionale routes backed by a test database.
 * Simulated plant only: this does not certify the LOGO! or the line.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Action, State } from '../lib/domain.ts';
import { loadRoute, setEnv, sqliteDb } from './helpers/d1.ts';
import { BridgeStore } from '../bridge/core/store.mjs';
import { Transmitter, requestJson } from '../bridge/core/transmitter.mjs';

type Route = { GET: (r: Request) => Promise<Response>; POST: (r: Request) => Promise<Response> };
const owner = { 'oai-authenticated-user-id': 'test-owner', 'content-type': 'application/json' };

test('bridge transmitter ↔ /api/devices/production: close once, lost response deduplicated, heartbeat, revoked token pauses', async () => {
  const t = await sqliteDb(); setEnv(t.db);
  const workspace = await loadRoute<Route>('app/api/workspace/route.ts');
  const devices = await loadRoute<Route>('app/api/devices/route.ts');
  const production = await loadRoute<Route>('app/api/devices/production/route.ts');
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
    const request = new Request('http://127.0.0.1' + req.url, { method: req.method, headers: req.headers as Record<string, string>, ...(req.method === 'POST' ? { body: Buffer.concat(chunks) } : {}) });
    const response = req.url === '/api/devices/production' ? await (req.method === 'GET' ? production.GET : production.POST)(request) : new Response('not found', { status: 404 });
    res.writeHead(response.status, { 'content-type': 'application/json' }); res.end(await response.text());
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const origin = `http://127.0.0.1:${port}`;
  const dir = await mkdtemp(join(tmpdir(), 'ponte e2e '));
  let version = 0;
  const post = async (action: Action) => { const res = await workspace.POST(new Request(origin + '/api/workspace', { method: 'POST', headers: { ...owner, origin }, body: JSON.stringify({ action, expectedVersion: version, requestId: 'req-' + crypto.randomUUID() }) })); const body = await res.json() as { state: State; version: number; error?: string }; assert.equal(res.status, 200, body.error); version = body.version; return body.state; };
  const store = new BridgeStore(join(dir, 'ponte.sqlite'), { mode: 'simulazione', line: 'linea-1' });
  try {
    await post({ type: 'product.add', product: { code: '00123', name: 'Articolo fittizio', kind: 'finished', unit: 'CRT', unitsPerBox: 1, minStock: 0 } });
    const created = await (await devices.POST(new Request(origin + '/api/devices', { method: 'POST', headers: { ...owner, origin }, body: '{"op":"create","name":"PC prova"}' }))).json() as { token: string; device: { id: string } };
    const state = await post({ type: 'production.start', code: '00123', operator: 'Operatore prova', lotCode: 'LP1', expiry: '2099-12-31', counting: 'device' });
    const tx = new Transmitter({ store, baseUrl: origin, token: created.token, timeoutMs: 5000, retry: { baseMs: 10, maxMs: 50 } });
    const active = await tx.getActiveSession();
    assert.equal(active.ok, true); assert.equal(active.activeSession.id, state.sessions[0].id);

    store.followSession(active.activeSession, { baseline: 5000, at: new Date().toISOString(), counterState: { value: 5000 } });
    const { event } = store.closeSession({ sessionId: active.activeSession.id, closeRequestId: 'linea-1-1-5000', requestValue: 1, counterStart: 5000, counterEnd: 5200, cartons: 200, closedAt: new Date().toISOString(), anomalies: [], modulo: 4294967296, newCounterState: { value: 5200 } });
    const summary = await tx.flush();
    assert.equal(summary.confirmed, 1);
    // The response is lost after commit: the same event is sent again with the same id.
    const again = await requestJson({ url: origin + '/api/devices/production', method: 'POST', token: created.token, body: event, timeoutMs: 5000 });
    assert.equal(again.status, 200); assert.equal(again.json.duplicate, true);
    const read = await (await workspace.GET(new Request(origin + '/api/workspace', { headers: owner }))).json() as { state: State };
    assert.equal(read.state.sessions[0].cartons, 200); assert.equal(read.state.sessions[0].status, 'closed'); assert.equal(read.state.lots.length, 0, 'no automatic stock load');

    store.setHeartbeat({ eventId: 'hb_' + Date.now(), type: 'heartbeat', at: new Date().toISOString(), bridgeVersion: '1.0.0', plc: { reachable: true, lastReadAt: new Date().toISOString() }, queueLength: 0, session: null }, new Date().toISOString());
    assert.equal(await tx.sendHeartbeat(), true);
    assert.equal(Number((await t.raw('SELECT count(*) AS n FROM device_status'))[0].n), 1);
    assert.equal(Number((await t.raw("SELECT count(*) AS n FROM workspace_requests WHERE id LIKE 'd%'"))[0].n), 1, 'heartbeats create no receipts');

    await devices.POST(new Request(origin + '/api/devices', { method: 'POST', headers: { ...owner, origin }, body: JSON.stringify({ op: 'revoke', id: created.device.id }) }));
    const after = await tx.getActiveSession();
    assert.equal(after.ok, false); assert.equal(after.reason, 'auth');
  } finally {
    store.close(); server.close(); await t.close(); await rm(dir, { recursive: true, force: true });
  }
});

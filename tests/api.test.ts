import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, type Action, type State } from '../lib/domain.ts';
import { loadRoute, miniflareDb, setEnv, sqliteDb, type TestDb } from './helpers/d1.ts';

type Route = { GET: (r: Request) => Promise<Response>; POST: (r: Request) => Promise<Response> };
type Body = { state: State; version: number; duplicate?: boolean; error?: string; code?: string; recentAudit: State['audit']; archive: Record<string, number>; token?: string; device?: { id: string }; items?: unknown[]; next?: unknown; ok?: boolean };
const origin = 'https://stabilimento.example';
const owner = { 'origin': origin, 'oai-authenticated-user-id': 'test-owner', 'content-type': 'application/json' };
const product = (code: string): Action => ({ type: 'product.add', product: { code, name: 'Articolo fittizio ' + code, kind: 'finished', unit: 'CRT', unitsPerBox: 1, minStock: 0 } });

async function routes() {
  return {
    workspace: await loadRoute<Route>('app/api/workspace/route.ts'),
    history: await loadRoute<Route>('app/api/workspace/history/route.ts'),
    archive: await loadRoute<Route>('app/api/workspace/archive/route.ts'),
    devices: await loadRoute<Route>('app/api/devices/route.ts'),
    production: await loadRoute<Route>('app/api/devices/production/route.ts'),
  };
}
function client(r: Awaited<ReturnType<typeof routes>>) {
  const post = async (action: Action, expectedVersion: number, requestId: string, headers: Record<string, string> = {}) => {
    const res = await r.workspace.POST(new Request(origin + '/api/workspace', { method: 'POST', headers: { ...owner, ...headers }, body: JSON.stringify({ action, expectedVersion, requestId }) }));
    return { status: res.status, body: await res.json() as Body };
  };
  const get = async () => (await r.workspace.GET(new Request(origin + '/api/workspace', { headers: owner }))).json() as Promise<Body>;
  return { post, get };
}
async function seed(t: TestDb, state: State, version: number) {
  await t.db.prepare('INSERT INTO workspaces (id, payload, version, request_ids, updated_at) VALUES (?, ?, ?, ?, ?)').bind('prima-colazione', JSON.stringify(state), version, '[]', '2026-01-01T00:00:00.000Z').run();
}
const count = async (t: TestDb, table: string) => Number((await t.raw(`SELECT count(*) AS n FROM ${table}`))[0].n);

for (const engine of ['sqlite', 'd1'] as const) {
  const open = engine === 'sqlite' ? sqliteDb : miniflareDb;

  test(`[${engine}] authentication, origin, CAS conflicts, permanent receipts and old retries`, async () => {
    const t = await open(); setEnv(t.db); const r = await routes(); const { post, get } = client(r);
    try {
      assert.equal((await r.workspace.GET(new Request(origin + '/api/workspace'))).status, 401);
      assert.equal((await post(product('TEST-API'), 0, 'request-one', { origin: 'https://other.example' })).status, 403);
      const first = await post(product('TEST-API'), 0, 'request-one'); assert.equal(first.status, 200); assert.equal(first.body.version, 1);
      const repeated = await post(product('TEST-API'), 0, 'request-one'); assert.equal(repeated.status, 200); assert.equal(repeated.body.duplicate, true); assert.equal(repeated.body.state.products.length, 1);
      assert.equal((await post(product('DIFFERENT'), 1, 'request-one')).body.code, 'event-id-reused');
      const stale = await post(product('SECOND'), 0, 'request-two'); assert.equal(stale.status, 409); assert.equal(stale.body.version, 1, 'conflict returns fresh data to recover');
      const started = await post({ type: 'production.start', code: 'TEST-API', operator: 'Test', lotCode: 'TEST', expiry: '2099-12-31' }, 1, 'request-start');
      const sessionId = started.body.state.sessions[0].id;
      for (let n = 0; n < 205; n++) assert.equal((await post({ type: 'production.count', sessionId, cartons: 1 }, n + 2, `request-count-${n}`)).status, 200);
      const old = await post({ type: 'production.start', code: 'TEST-API', operator: 'Test', lotCode: 'TEST', expiry: '2099-12-31' }, 1, 'request-start');
      assert.equal(old.status, 200); assert.equal(old.body.duplicate, true); assert.equal(old.body.state.sessions.length, 1); assert.equal(old.body.state.sessions[0].cartons, 205); assert.equal(old.body.version, 207);
      assert.equal(await count(t, 'workspace_requests'), 207); assert.equal(await count(t, 'workspace_audit'), 207);
      const snapshot = await get(); assert.equal(snapshot.state.audit.length, 0, 'audit lives in its table'); assert.equal(snapshot.recentAudit.length, 20); assert.match(snapshot.recentAudit[0].detail, /parziale 205/);
    } finally { await t.close(); }
  });

  test(`[${engine}] scenario 6: two clients from the same version, double click and lost response`, async () => {
    const t = await open(); setEnv(t.db); const { post } = client(await routes());
    try {
      await post(product('BASE'), 0, 'request-base');
      const [a, b] = await Promise.all([post(product('CLIENT-A'), 1, 'request-a'), post(product('CLIENT-B'), 1, 'request-b')]);
      assert.deepEqual([a.status, b.status].sort(), [200, 409]);
      // Double click: the same request id sent twice in parallel produces one effect.
      const loser = a.status === 409 ? 'A' : 'B';
      const clicks = await Promise.all([post(product('CLIENT-' + loser), 2, 'request-retry'), post(product('CLIENT-' + loser), 2, 'request-retry')]);
      assert.ok(clicks.every(c => c.status === 200 || c.status === 409), JSON.stringify(clicks.map(c => c.status)));
      // Response lost after commit: the client retries with the same id and old version.
      const retry = await post(product('CLIENT-' + loser), 2, 'request-retry');
      assert.equal(retry.status, 200); assert.equal(retry.body.duplicate, true);
      assert.deepEqual(retry.body.state.products.map(p => p.code).sort(), ['BASE', 'CLIENT-A', 'CLIENT-B']);
      assert.equal(await count(t, 'workspace_requests'), 3);
    } finally { await t.close(); }
  });

  test(`[${engine}] legacy payload: full log moved once to the audit table with a recovery snapshot`, async () => {
    const t = await open(); setEnv(t.db); const r = await routes(); const { post, get } = client(r);
    try {
      const legacy = initialState();
      legacy.audit = Array.from({ length: 3000 }, (_, i) => ({ id: `legacy-${String(i).padStart(5, '0')}`, at: `2026-03-01T08:${String(Math.floor(i / 60) % 60).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}.000Z`, action: 'lot.receive', detail: `Evento storico fittizio ${i}` }));
      await seed(t, legacy, 12);
      const before = await get(); assert.equal(before.recentAudit.length, 20, 'legacy entries readable before migration');
      const res = await post(product('NEW'), 12, 'request-after-legacy'); assert.equal(res.status, 200);
      assert.equal(await count(t, 'workspace_audit'), 3001); assert.equal(await count(t, 'workspace_snapshots'), 1);
      const stored = JSON.parse(String((await t.raw('SELECT payload FROM workspaces'))[0].payload)) as State; assert.equal(stored.audit.length, 0);
      const snap = JSON.parse(String((await t.raw('SELECT payload FROM workspace_snapshots'))[0].payload)) as State; assert.equal(snap.audit.length, 3000);
      // Pagination over the archived log, newest first, with search.
      const page1 = await (await r.history.GET(new Request(origin + '/api/workspace/history?limit=50', { headers: owner }))).json() as { items: { id: string; at: string }[]; next: { at: string; id: string } };
      assert.equal(page1.items.length, 50); assert.ok(page1.next);
      const page2 = await (await r.history.GET(new Request(origin + `/api/workspace/history?limit=50&before=${encodeURIComponent(page1.next.at + '|' + page1.next.id)}`, { headers: owner }))).json() as { items: { id: string }[] };
      assert.equal(new Set([...page1.items, ...page2.items].map(i => i.id)).size, 100);
      const found = await (await r.history.GET(new Request(origin + '/api/workspace/history?q=' + encodeURIComponent('fittizio 2999'), { headers: owner }))).json() as { items: unknown[] };
      assert.equal(found.items.length, 1);
      await post(product('AGAIN'), 13, 'request-again'); assert.equal(await count(t, 'workspace_snapshots'), 1, 'snapshot taken only once');
    } finally { await t.close(); }
  });

  test(`[${engine}] archive: old closed orders and empty lots leave the hot state; a late invoice brings the order back without a new deduction`, async () => {
    const t = await open(); setEnv(t.db); const r = await routes(); const { post, get } = client(r);
    try {
      const state = initialState();
      state.products.push({ id: 'p1', code: '00123', name: 'Articolo fittizio', kind: 'finished', unit: 'CRT', unitsPerBox: 1, minStock: 0, inUse: true });
      state.areas = ['Area A'];
      for (let i = 0; i < 40; i++) {
        state.lots.push({ id: `lot-${i}`, productId: 'p1', code: `L${i}`, expiry: '2099-12-31', area: 'Area A', quantity: i === 0 ? 5 : 0, blocked: 0 });
        state.orders.push({ id: `order-${String(i).padStart(2, '0')}`, customer: 'Cliente fittizio', destination: 'Destinazione', date: '2026-01-10', status: 'dispatched', lines: [{ lotId: `lot-${i}`, quantity: 10, shipped: 10 }], documentRef: 'DDT-' + i, documents: [{ reference: 'DDT-' + i, at: '2026-01-10T09:00:00.000Z', quantities: [{ lotId: `lot-${i}`, quantity: 10 }] }], closedAt: '2026-01-10T09:00:00.000Z' });
      }
      await seed(t, state, 3);
      const res = await post({ type: 'lot.block', lotId: 'lot-0', blocked: 0 }, 3, 'request-trigger-archive'); assert.equal(res.status, 200, res.body.error);
      assert.equal(res.body.state.orders.length, 0); assert.deepEqual(res.body.state.lots.map(l => l.id), ['lot-0']);
      assert.deepEqual((await get()).archive, { order: 40, session: 0, lot: 39, audit: 1 });
      const page = await (await r.archive.GET(new Request(origin + '/api/workspace/archive?kind=order&limit=25', { headers: owner }))).json() as { items: { id: string }[]; next: { day: string; id: string } };
      assert.equal(page.items.length, 25); assert.ok(page.next);
      const rest = await (await r.archive.GET(new Request(origin + `/api/workspace/archive?kind=order&limit=25&before=${page.next.day}|${page.next.id}`, { headers: owner }))).json() as { items: { id: string }[] };
      assert.equal(new Set([...page.items, ...rest.items].map(o => o.id)).size, 40);
      const linked = await post({ type: 'order.document', orderId: 'order-07', documentRef: 'FATTURA-7' }, 4, 'request-invoice');
      assert.equal(linked.status, 200, linked.body.error);
      const order = linked.body.state.orders.find(o => o.id === 'order-07')!; assert.equal(order.documents.at(-1)!.reference, 'FATTURA-7');
      assert.equal(linked.body.state.lots.find(l => l.id === 'lot-7')!.quantity, 0, 'no second deduction');
      assert.deepEqual((await get()).archive, { order: 39, session: 0, lot: 38, audit: 2 });
      // A new receipt of an archived lot code merges with the same lot (expiry check kept).
      const conflict = await post({ type: 'lot.receive', lot: { productId: 'p1', code: 'L9', expiry: '2098-01-01', area: 'Area A', quantity: 1 } }, 5, 'request-conflict');
      assert.equal(conflict.status, 422); assert.match(conflict.body.error!, /scadenza diversa/);
      const received = await post({ type: 'lot.receive', lot: { productId: 'p1', code: 'L9', expiry: '2099-12-31', area: 'Area A', quantity: 3 } }, 5, 'request-receive');
      assert.equal(received.body.state.lots.find(l => l.code === 'L9')!.id, 'lot-9');
    } finally { await t.close(); }
  });

  test(`[${engine}] state over 2 MB is refused and nothing changes`, async () => {
    const t = await open(); setEnv(t.db); const { post } = client(await routes());
    try {
      const state = initialState();
      state.products.push({ id: 'p1', code: 'BIG', name: 'Imballo fittizio', kind: 'packaging', unit: 'pezzi', unitsPerBox: 1, minStock: 0, inUse: true });
      state.areas = ['Area A'];
      let size = JSON.stringify(state).length;
      for (let i = 0; size < 1_999_900; i++) { const lot = { id: `l-${i}`, productId: 'p1', code: `LOTTO-FITTIZIO-${i}`, expiry: '', area: 'Area A', quantity: 1, blocked: 0 }; state.lots.push(lot); size += JSON.stringify(lot).length + 1; }
      assert.ok(JSON.stringify(state).length <= 2_000_000);
      await seed(t, state, 1);
      const before = String((await t.raw('SELECT payload FROM workspaces'))[0].payload);
      const res = await post({ type: 'lot.receive', lot: { productId: 'p1', code: 'LOTTO-NUOVO-CHE-SUPERA-IL-LIMITE', expiry: '', area: 'Area A', quantity: 1 } }, 1, 'request-too-big');
      assert.equal(res.status, 413);
      assert.equal(String((await t.raw('SELECT payload FROM workspaces'))[0].payload), before); assert.equal(await count(t, 'workspace_requests'), 0);
    } finally { await t.close(); }
  });

  test(`[${engine}] bridge device: dedicated token, one close per event, revocation`, async () => {
    const t = await open(); setEnv(t.db); const r = await routes(); const { post } = client(r);
    try {
      const deviceCall = (method: 'GET' | 'POST', token: string, body?: unknown) => (method === 'GET' ? r.production.GET : r.production.POST)(new Request(origin + '/api/devices/production', { method, headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }));
      assert.equal((await r.devices.POST(new Request(origin + '/api/devices', { method: 'POST', headers: { ...owner, origin: 'https://evil.example' }, body: '{"op":"create","name":"PC linea"}' }))).status, 403);
      assert.equal((await r.devices.POST(new Request(origin + '/api/devices', { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: '{"op":"create","name":"PC linea"}' }))).status, 401);
      await post(product('A1'), 0, 'request-product');
      assert.equal((await post({ type: 'production.start', code: 'A1', operator: 'O', lotCode: 'L', expiry: '2099-12-31', counting: 'device' }, 1, 'request-no-device')).status, 422);
      const created = await (await r.devices.POST(new Request(origin + '/api/devices', { method: 'POST', headers: owner, body: '{"op":"create","name":"PC linea"}' }))).json() as Body;
      const token = created.token!; assert.match(token, /^pcd_/);
      assert.equal(String((await t.raw('SELECT token_hash FROM devices'))[0].token_hash).includes(token), false, 'only the hash is stored');
      assert.equal((await deviceCall('GET', 'pcd_' + 'x'.repeat(43))).status, 401);
      assert.equal(((await (await deviceCall('GET', token)).json()) as { activeSession: unknown }).activeSession, null);
      const started = await post({ type: 'production.start', code: 'A1', operator: 'O', lotCode: 'L', expiry: '2099-12-31', counting: 'device' }, 1, 'request-device-start');
      assert.equal(started.status, 200, started.body.error); const sessionId = started.body.state.sessions[0].id;
      assert.equal(((await (await deviceCall('GET', token)).json()) as { activeSession: { id: string } }).activeSession.id, sessionId);
      assert.equal((await deviceCall('POST', token, { eventId: 'hb_0000001', type: 'heartbeat', at: '2026-11-13T08:00:00.000Z', plc: { reachable: true }, queueLength: 0, session: { id: sessionId, cartons: 57 }, extra: 'x'.repeat(100) })).status, 200);
      const close = { eventId: 'evt_0000001', type: 'session.close', sessionId, closeRequestId: 'req_1', counterStart: 1000, counterEnd: 1200, cartons: 200, closedAt: '2026-11-13T09:00:00.000Z' };
      const results = await Promise.all([deviceCall('POST', token, close), deviceCall('POST', token, close)]);
      const bodies = await Promise.all(results.map(x => x.json() as Promise<Body>));
      assert.deepEqual(results.map(x => x.status), [200, 200]); assert.equal(bodies.filter(b => b.duplicate).length, 1);
      const after = await client(r).get(); assert.equal(after.state.sessions[0].cartons, 200); assert.equal(after.state.sessions[0].closedBy, 'device'); assert.equal(after.state.lots.length, 0);
      assert.equal(((await (await deviceCall('POST', token, { ...close, cartons: 199, counterEnd: 1199 })).json()) as Body).code, 'event-id-reused');
      const late = await deviceCall('POST', token, { ...close, eventId: 'evt_0000002' }); assert.equal(late.status, 409); assert.equal(((await late.json()) as Body).code, 'session-closed');
      assert.equal((await deviceCall('POST', token, { eventId: 'evt_0000003', type: 'lot.adjust' })).status, 400);
      const list = await (await r.devices.GET(new Request(origin + '/api/devices', { headers: owner }))).json() as { devices: { id: string; status: { session: { cartons: number } }; lastSeenAt: string }[] };
      assert.equal(list.devices[0].status.session.cartons, 57); assert.ok(list.devices[0].lastSeenAt); assert.equal(JSON.stringify(list).includes('token_hash'), false);
      assert.equal((await r.devices.POST(new Request(origin + '/api/devices', { method: 'POST', headers: owner, body: JSON.stringify({ op: 'revoke', id: list.devices[0].id }) }))).status, 200);
      assert.equal((await deviceCall('GET', token)).status, 401);
    } finally { await t.close(); }
  });
}

test('[sqlite] a failing statement inside the batch rolls back state, receipt and audit together', async () => {
  const t = await sqliteDb(); setEnv(t.db); const { post, get } = client(await routes());
  try {
    await post(product('FIRST'), 0, 'request-first');
    t.failOn = q => q.startsWith('INSERT OR IGNORE INTO workspace_audit');
    const original = console.error; console.error = () => {};
    try { assert.equal((await post(product('SECOND'), 1, 'request-failure')).status, 500); } finally { console.error = original; }
    t.failOn = undefined;
    const unchanged = await get(); assert.equal(unchanged.version, 1); assert.equal(unchanged.state.products.length, 1);
    assert.equal(await count(t, 'workspace_requests'), 1); assert.equal(await count(t, 'workspace_audit'), 1);
    const retried = await post(product('SECOND'), 1, 'request-failure'); assert.equal(retried.status, 200); assert.equal(retried.body.duplicate, undefined, 'the uncertain request is applied exactly once on retry');
  } finally { await t.close(); }
});

for (const engine of ['sqlite', 'd1'] as const) {
  test(`[${engine}] scenario 14: backup → restore into an empty database → identical digest; never over existing data`, async () => {
    const source = await (engine === 'sqlite' ? sqliteDb : miniflareDb)(); setEnv(source.db); const r = await routes(); const { post, get } = client(r);
    const backupRoute = await loadRoute<Route>('app/api/workspace/backup/route.ts');
    const target = await (engine === 'sqlite' ? sqliteDb : miniflareDb)();
    try {
      await post(product('00123'), 0, 'request-b1');
      const pid = (await get()).state.products[0].id;
      await post({ type: 'lot.receive', lot: { productId: pid, code: 'L1', expiry: '2099-01-01', area: 'Area A', quantity: 150 } }, 1, 'request-b2');
      assert.equal((await backupRoute.GET(new Request(origin + '/api/workspace/backup'))).status, 401);
      const res = await backupRoute.GET(new Request(origin + '/api/workspace/backup', { headers: owner }));
      assert.match(res.headers.get('content-disposition')!, /attachment/);
      const text = await res.text(); const backup = JSON.parse(text);
      assert.deepEqual(backup.counts, { version: 2, receipts: 2, audit: 2, archive: 0, snapshots: 0 });
      // Restoring over existing data is refused.
      assert.equal((await backupRoute.POST(new Request(origin + '/api/workspace/backup', { method: 'POST', headers: owner, body: text }))).status, 422);
      // A tampered backup is refused.
      setEnv(target.db);
      const tampered = JSON.parse(text); tampered.data.receipts.pop();
      assert.match(((await (await backupRoute.POST(new Request(origin + '/api/workspace/backup', { method: 'POST', headers: owner, body: JSON.stringify(tampered) }))).json()) as Body).error!, /impronta/);
      const restored = await backupRoute.POST(new Request(origin + '/api/workspace/backup', { method: 'POST', headers: owner, body: text }));
      const out = await restored.json() as { ok: boolean; digest: string }; assert.equal(restored.status, 200); assert.equal(out.digest, backup.digest);
      // The restored archive keeps receipts: an old retry stays a duplicate, balances are unchanged.
      const retry = await post({ type: 'lot.receive', lot: { productId: pid, code: 'L1', expiry: '2099-01-01', area: 'Area A', quantity: 150 } }, 1, 'request-b2');
      assert.equal(retry.body.duplicate, true); assert.equal(retry.body.state.lots[0].quantity, 150);
    } finally { await source.close(); await target.close(); }
  });
}

test('[sqlite] receipt check tells whether an uncertain request was committed', async () => {
  const t = await sqliteDb(); setEnv(t.db); const { post } = client(await routes());
  const receipt = await loadRoute<Route>('app/api/workspace/receipt/route.ts');
  try {
    const check = async (id: string) => (await receipt.GET(new Request(origin + '/api/workspace/receipt?id=' + id, { headers: owner }))).json() as Promise<{ committed: boolean }>;
    assert.equal((await check('request-x1')).committed, false);
    await post(product('X1'), 0, 'request-x1');
    assert.equal((await check('request-x1')).committed, true);
    assert.equal((await receipt.GET(new Request(origin + '/api/workspace/receipt?id=request-x1'))).status, 401);
  } finally { await t.close(); }
});

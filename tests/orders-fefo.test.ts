/**
 * Ordini per prodotto (decisione di Teo, 16/11/2026): si indica prodotto e quantità, il gestionale
 * assegna i lotti che scadono prima (FEFO), anche più di uno, escludendo merce scaduta, bloccata o
 * già prenotata, e dice quali lotti ha usato.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { allocateFefo, applyAction, initialState, type Action, type State } from '../lib/domain.ts';

let n = 0; const ctx = { now: '2026-11-16T09:00:00.000Z', id: () => 'id-' + (++n) };
const act = (s: State, a: Action) => applyAction(s, a, ctx);
function stock() {
  let s = act(initialState(), { type: 'product.add', product: { code: '024', name: 'Fagottino prova', kind: 'finished', unit: 'CRT', unitsPerBox: 1, minStock: 0 } });
  const p = s.products[0].id;
  const lot = (code: string, expiry: string, quantity: number, area = 'Cella') => { s = act(s, { type: 'lot.receive', lot: { productId: p, code, expiry, area, quantity } }); };
  lot('261110', '2027-11-10', 40); lot('261002', '2027-10-02', 30); lot('261105', '2027-11-05', 20); lot('251001', '2026-10-01', 99); // the last is expired
  return { s, p };
}

test('assegnazione FEFO: prima i lotti che scadono prima, anche su più lotti; scaduti esclusi', () => {
  const { s, p } = stock();
  const plan = allocateFefo(s, p, 45, '2026-11-16');
  assert.equal(plan.available, 90, 'il lotto scaduto non conta');
  assert.deepEqual(plan.lines.map(l => [s.lots.find(x => x.id === l.lotId)!.code, l.quantity]), [['261002', 30], ['261105', 15]]);
  assert.equal(plan.missing, 0);
  assert.equal(allocateFefo(s, p, 100, '2026-11-16').missing, 10);
});

test('ordine per prodotto: lotti assegnati in automatico e scritti nello storico', () => {
  const { s, p } = stock();
  const o = act(s, { type: 'order.create', order: { customer: 'Bar prova', destination: 'Via di prova', date: '2026-11-17', lines: [{ productId: p, quantity: 45 }] } });
  const order = o.orders[0];
  assert.deepEqual(order.lines.map(l => [o.lots.find(x => x.id === l.lotId)!.code, l.quantity]), [['261002', 30], ['261105', 15]]);
  assert.match(o.audit.at(-1)!.detail, /scadenza più vicina.*261002 × 30.*261105 × 15/);
  // A second order continues from what is still free: 261105 (5 left), then 261110.
  const o2 = act(o, { type: 'order.create', order: { customer: 'Bar due', destination: 'Via due', date: '2026-11-17', lines: [{ productId: p, quantity: 10 }] } });
  assert.deepEqual(o2.orders[1].lines.map(l => [o2.lots.find(x => x.id === l.lotId)!.code, l.quantity]), [['261105', 5], ['261110', 5]]);
  assert.throws(() => act(o2, { type: 'order.create', order: { customer: 'X', destination: 'Y', date: '2026-11-17', lines: [{ productId: p, quantity: 36 }] } }), /disponibili solo 35/);
});

test('merce bloccata non viene assegnata; ordine a lotti espliciti ancora possibile', () => {
  const { s, p } = stock(); const first = s.lots.find(l => l.code === '261002')!;
  const blocked = act(s, { type: 'lot.block', lotId: first.id, blocked: 30 });
  assert.equal(allocateFefo(blocked, p, 10, '2026-11-16').lines[0].lotId, s.lots.find(l => l.code === '261105')!.id);
  const explicit = act(s, { type: 'order.create', order: { customer: 'X', destination: 'Y', date: '2026-11-17', lines: [{ lotId: s.lots.find(l => l.code === '261110')!.id, quantity: 5 }] } });
  assert.equal(explicit.orders[0].lines[0].quantity, 5);
  assert.throws(() => act(s, { type: 'order.create', order: { customer: 'X', destination: 'Y', date: '2026-11-17', lines: [{ productId: p, quantity: 1 }, { productId: p, quantity: 2 }] } }), /una sola volta/);
});

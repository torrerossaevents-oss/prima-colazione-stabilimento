/**
 * Etichetta e produzione (decisione di Teo, 14/11/2026, sull'etichetta reale del Fagottino COD.024):
 * lotto = data di produzione AAMMGG, scadenza = +N mesi (12 di norma); il codice si legge anche
 * dall'EAN; alla chiusura i cartoni buoni (letti − scarti) vengono caricati nell'area di produzione
 * con un movimento esplicito; l'amministrazione corregge i cartoni solo con causale e responsabile.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { activeSession, applyAction, eanValid, initialState, productionExpiry, productionLot, type Action, type Context, type State } from '../lib/domain.ts';
import { canRecord } from '../lib/permissions.ts';

let seq = 0;
const ctx = (now = '2026-10-02T06:00:00.000Z', extra: Context = {}): Context => ({ now, id: () => 'id-' + (++seq), ...extra });
const act = (s: State, a: Action, c = ctx()) => applyAction(s, a, c);
const fagottino = { code: '024', name: 'Fagottino PF cioccolato 90 g (prova)', kind: 'finished' as const, unit: 'CRT', unitsPerBox: 1, minStock: 0, ean: '8000000004642', piecesPerCarton: 50, pieceWeightG: 90, shelfLifeMonths: 12, labelDescription: 'Prodotto da forno crudo congelato' };
const base = () => act(initialState(), { type: 'product.add', product: fagottino });

test('lotto AAMMGG e scadenza a +N mesi, anche a fine mese e negli anni bisestili', () => {
  assert.equal(productionLot('2026-10-02'), '261002', 'come sull’etichetta: Lotto 261002');
  assert.equal(productionExpiry('2026-10-02', 12), '2027-10-02', 'come sull’etichetta: entro il 02/10/2027');
  assert.equal(productionExpiry('2028-02-29', 12), '2029-02-28');
  assert.equal(productionExpiry('2026-01-31', 1), '2026-02-28');
  assert.equal(productionExpiry('2026-11-30', 3), '2027-02-28');
});

test('EAN: cifra di controllo verificata; codice letto dall’EAN o dal codice articolo', () => {
  assert.ok(eanValid('8000000004642')); assert.ok(!eanValid('8000000004643')); assert.ok(!eanValid('80000000046'));
  assert.throws(() => act(initialState(), { type: 'product.add', product: { ...fagottino, ean: '8000000004643' } }), /EAN/);
  const byEan = act(base(), { type: 'production.start', code: '8000000004642', operator: 'Operatore prova' });
  const s = activeSession(byEan)!;
  assert.equal(s.productCode, '024'); assert.equal(s.lotCode, '261002'); assert.equal(s.expiry, '2027-10-02');
  assert.equal(s.piecesPerCarton, 50, 'confezionamento dell’etichetta salvato all’avvio');
  const byCode = act(base(), { type: 'production.start', code: '024', operator: 'Operatore prova' });
  assert.equal(activeSession(byCode)!.lotCode, '261002');
});

test('chiusura: carico automatico dei cartoni buoni nell’area di produzione, stesso lotto nello stesso giorno', () => {
  let s = act(base(), { type: 'settings.update', settings: { productionArea: 'Cella congelati' } });
  s = act(s, { type: 'production.start', code: '024', operator: 'Operatore prova' });
  const first = activeSession(s)!.id;
  s = act(s, { type: 'production.count', sessionId: first, cartons: 54 });
  s = act(s, { type: 'production.close', sessionId: first, scrapCartons: 2, note: 'Cartoni schiacciati' }, ctx('2026-10-02T08:00:00.000Z'));
  assert.equal(s.lots.length, 1); assert.deepEqual([s.lots[0].code, s.lots[0].expiry, s.lots[0].area, s.lots[0].quantity], ['261002', '2027-10-02', 'Cella congelati', 52]);
  const closed = s.sessions[0]; assert.equal(closed.stockLoaded, true); assert.equal(closed.loadedQuantity, 52); assert.equal(closed.loadedLotId, s.lots[0].id);
  assert.deepEqual(s.audit.at(-1)!.moves, [{ lotId: s.lots[0].id, delta: 52, kind: 'produce' }], 'il carico è un movimento esplicito');
  assert.match(s.audit.at(-1)!.detail, /caricati 52 CRT/);
  s = act(s, { type: 'production.start', code: '024', operator: 'Operatore prova' }, ctx('2026-10-02T09:00:00.000Z'));
  const second = activeSession(s)!.id; s = act(s, { type: 'production.count', sessionId: second, cartons: 10 });
  s = act(s, { type: 'production.close', sessionId: second }, ctx('2026-10-02T10:00:00.000Z'));
  assert.equal(s.lots.length, 1, 'stesso prodotto, stesso giorno: stesso lotto'); assert.equal(s.lots[0].quantity, 62);
});

test('carico automatico disattivabile; chiusura dal ponte con carico', () => {
  let s = act(base(), { type: 'settings.update', settings: { autoLoad: false } });
  s = act(s, { type: 'production.start', code: '024', operator: 'Operatore prova' }); const id = activeSession(s)!.id;
  s = act(s, { type: 'production.count', sessionId: id, cartons: 5 }); s = act(s, { type: 'production.close', sessionId: id });
  assert.equal(s.lots.length, 0); assert.equal(s.sessions[0].stockLoaded, false);
  let d = act(base(), { type: 'production.start', code: '024', operator: 'Operatore prova', counting: 'device' }, ctx(undefined, { devicesEnabled: true }));
  const dev = activeSession(d)!.id;
  d = act(d, { type: 'production.deviceClose', sessionId: dev, eventId: 'e1', cartons: 30, counterStart: 0, counterEnd: 30, closedAt: '2026-10-02T07:00:00.000Z' }, ctx(undefined, { device: { id: 'pc-linea', line: 'linea-1' } }));
  assert.equal(d.lots[0].quantity, 30); assert.equal(d.sessions[0].stockLoaded, true);
});

test('una scadenza diversa per un lotto già presente è rifiutata all’avvio, non alla chiusura', () => {
  let s = act(base(), { type: 'production.start', code: '024', operator: 'Operatore prova' }); const id = activeSession(s)!.id;
  s = act(s, { type: 'production.count', sessionId: id, cartons: 3 }); s = act(s, { type: 'production.close', sessionId: id });
  assert.throws(() => act(s, { type: 'production.start', code: '024', operator: 'Operatore prova', expiry: '2027-12-31' }), /scadenza/);
});

test('rettifica dei cartoni: solo amministrazione, con causale e responsabile, anche sul magazzino', () => {
  assert.equal(canRecord('laboratorio', 'production.adjust'), false); assert.equal(canRecord('amministrazione', 'production.adjust'), true);
  let s = act(base(), { type: 'production.start', code: '024', operator: 'Operatore prova' }); const id = activeSession(s)!.id;
  s = act(s, { type: 'production.count', sessionId: id, cartons: 54 }); s = act(s, { type: 'production.close', sessionId: id });
  assert.throws(() => act(s, { type: 'production.adjust', sessionId: id, delta: 2, reason: '', responsible: 'Ufficio' }), /Causale/);
  assert.throws(() => act(s, { type: 'production.adjust', sessionId: id, delta: 0, reason: 'x', responsible: 'Ufficio' }), /diverso da zero/);
  s = act(s, { type: 'production.adjust', sessionId: id, delta: 2, reason: 'Due cartoni non letti dalla fotocellula', responsible: 'Ufficio' }, ctx('2026-10-02T12:00:00.000Z', { actor: 'ufficio@esempio.it' }));
  assert.equal(s.sessions[0].cartons, 56); assert.equal(s.lots[0].quantity, 56);
  assert.deepEqual(s.audit.at(-1)!.moves, [{ lotId: s.lots[0].id, delta: 2, kind: 'production-adjust' }]);
  assert.match(s.audit.at(-1)!.detail, /54 → 56.*Due cartoni non letti/);
  const c = s.sessions[0].corrections![0]; assert.deepEqual([c.before, c.after, c.delta, c.reason, c.responsible, c.actor, c.stockDelta], [54, 56, 2, 'Due cartoni non letti dalla fotocellula', 'Ufficio', 'ufficio@esempio.it', 2]);
  s = act(s, { type: 'production.adjust', sessionId: id, delta: -6, reason: 'Riconteggio in cella', responsible: 'Ufficio' });
  assert.equal(s.sessions[0].cartons, 50); assert.equal(s.lots[0].quantity, 50); assert.equal(s.sessions[0].corrections!.length, 2);
  // Merce già prenotata non si può togliere con una rettifica di produzione.
  s = act(s, { type: 'order.create', order: { customer: 'Cliente prova', destination: 'Destinazione prova', date: '2026-10-03', lines: [{ lotId: s.lots[0].id, quantity: 48 }] } });
  assert.throws(() => act(s, { type: 'production.adjust', sessionId: id, delta: -5, reason: 'Errore', responsible: 'Ufficio' }), /disponibili/);
  assert.throws(() => act(s, { type: 'production.adjust', sessionId: id, delta: -51, reason: 'Errore', responsible: 'Ufficio' }), /sotto zero|disponibili/);
});

test('campi dell’etichetta: conservati se assenti (import), cancellati se vuoti', () => {
  const s = base(); const p = s.products[0];
  const kept = act(s, { type: 'product.update', productId: p.id, product: { code: p.code, name: 'Nuovo nome', kind: p.kind, unit: p.unit, unitsPerBox: 1, minStock: 0 } });
  assert.equal(kept.products[0].ean, '8000000004642'); assert.equal(kept.products[0].piecesPerCarton, 50);
  const cleared = act(s, { type: 'product.update', productId: p.id, product: { ...p, ean: '', piecesPerCarton: null as unknown as number, labelDescription: '' } });
  assert.equal(JSON.parse(JSON.stringify(cleared.products[0])).ean, undefined); assert.equal(cleared.products[0].piecesPerCarton, undefined); assert.equal(cleared.products[0].labelDescription, undefined);
  assert.throws(() => act(s, { type: 'product.update', productId: p.id, product: { ...p, shelfLifeMonths: 0 } }), /Durata/);
});

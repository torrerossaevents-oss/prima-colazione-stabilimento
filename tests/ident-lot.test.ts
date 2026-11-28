/**
 * Decisioni di Teo del 28/11/2026: IDENT. scritto all'avvio e modificabile durante la lavorazione;
 * «continua il lotto» dell'ultimo giorno di produzione del prodotto, entro 7 giorni, con la sua scadenza;
 * nello stesso giorno, per lo stesso prodotto, un solo lotto. Solo dati di prova.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { activeSession, applyAction, initialState, previousLotFor, todayLotFor, type Action, type Context, type State } from '../lib/domain.ts';
import { canRecord } from '../lib/permissions.ts';

let seq = 0;
const at = (day: string, hour = 8) => `${day}T${String(hour - 1).padStart(2, '0')}:00:00.000Z`; // ora di Roma in inverno = UTC+1
const act = (s: State, a: Action, now: string, extra: Context = {}) => applyAction(s, a, { now, id: () => 'id-' + (++seq), ...extra });
const base = () => act(initialState(), { type: 'product.add', product: { code: 'C1', name: 'Cornetto PROVA', kind: 'finished', unit: 'CRT', unitsPerBox: 1, minStock: 0 } }, at('2026-11-02'));
const start = (s: State, day: string, extra: Partial<Extract<Action, { type: 'production.start' }>> = {}, hour = 8) =>
  act(s, { type: 'production.start', code: 'C1', operator: 'Operatore prova', ident: 'I-PROVA', ...extra }, at(day, hour));
// Chiude dopo aver contato almeno un cartone (una lavorazione chiusa a 0 cartoni non fissa il lotto).
const close = (s: State, day: string, hour = 12) => {
  const run = activeSession(s)!;
  if (run.source === 'manual' && run.cartons === 0) s = act(s, { type: 'production.count', sessionId: run.id, cartons: 1 }, at(day, hour));
  return act(s, { type: 'production.close', sessionId: run.id }, at(day, hour));
};

test('IDENT. obbligatorio all’avvio, salvato nella lavorazione e nello storico', () => {
  assert.throws(() => act(base(), { type: 'production.start', code: 'C1', operator: 'Operatore prova' }, at('2026-11-27')), /IDENT\./);
  assert.throws(() => start(base(), '2026-11-27', { ident: '   ' }), /IDENT\./);
  for (const bad of ['X'.repeat(9), '1^FS^JUS', '63~JR', 'A\\B', '63\n1', 'é<>']) {
    assert.throws(() => start(base(), '2026-11-27', { ident: bad }), /al massimo 8 caratteri/, `avvio con ${JSON.stringify(bad)}`);
  }
  assert.equal(activeSession(start(base(), '2026-11-27', { ident: ' 66 PAST. ' }))!.ident, '66 PAST.', 'valori come quelli di oggi, spazi ai lati tolti');
  const s = start(base(), '2026-11-27', { ident: '63/1' });
  assert.equal(activeSession(s)!.ident, '63/1');
  assert.match(s.audit.at(-1)!.detail, /IDENT\. 63\/1/);
});

test('IDENT. cambiato durante la lavorazione: salvato, storico, conteggio intatto; anche dal laboratorio', () => {
  let s = start(base(), '2026-11-27', { ident: '63/1', counting: 'manual' });
  const id = activeSession(s)!.id;
  s = act(s, { type: 'production.count', sessionId: id, cartons: 12 }, at('2026-11-27', 9));
  s = act(s, { type: 'production.ident', sessionId: id, ident: '72' }, at('2026-11-27', 10));
  const run = activeSession(s)!;
  assert.equal(run.ident, '72'); assert.equal(run.cartons, 12, 'il conteggio non cambia'); assert.equal(run.status, 'active');
  assert.deepEqual(run.identChanges, [{ at: at('2026-11-27', 10), from: '63/1', to: '72' }]);
  assert.match(s.audit.at(-1)!.detail, /63\/1 → 72/);
  assert.throws(() => act(s, { type: 'production.ident', sessionId: id, ident: '72' }, at('2026-11-27', 11)), /già 72/);
  for (const bad of ['123456789', '7^2', '7~2']) assert.throws(() => act(s, { type: 'production.ident', sessionId: id, ident: bad }, at('2026-11-27', 11)), /al massimo 8 caratteri/);
  assert.ok(canRecord('laboratorio', 'production.ident'), 'l’operatore del laboratorio lo può cambiare');
  s = close(s, '2026-11-27');
  assert.throws(() => act(s, { type: 'production.ident', sessionId: id, ident: '80' }, at('2026-11-27', 13)), /chiusa/);
});

test('IDENT. cambiato anche in una lavorazione contata dal ponte', () => {
  const fresh = act(base(), { type: 'production.start', code: 'C1', operator: 'Operatore prova', ident: '01/F', counting: 'device' }, at('2026-11-27'), { devicesEnabled: true });
  const next = act(fresh, { type: 'production.ident', sessionId: activeSession(fresh)!.id, ident: '02/F' }, at('2026-11-27', 9), { devicesEnabled: true });
  assert.equal(activeSession(next)!.ident, '02/F'); assert.equal(activeSession(next)!.source, 'device');
});

test('continua il lotto: ultimo giorno di produzione entro 7 giorni (il venerdì visto dal lunedì), stessa scadenza', () => {
  let s = start(base(), '2026-11-20');                         // venerdì: lotto 261120
  s = close(s, '2026-11-20');
  assert.equal(previousLotFor(s, s.products[0].id, '2026-11-23')?.lotCode, '261120');
  s = start(s, '2026-11-23', { continueLot: true });            // lunedì
  const run = activeSession(s)!;
  assert.deepEqual([run.lotCode, run.expiry, run.continuedFrom?.day], ['261120', '2027-11-20', '2026-11-20']);
  assert.match(s.audit.at(-1)!.detail, /continuato dal 20\/11\/2026/);
  s = close(s, '2026-11-23');
  // Il giorno dopo il lotto da continuare è ancora 261120 (l'ultimo giorno di produzione è il 23, con quel lotto).
  assert.equal(previousLotFor(s, s.products[0].id, '2026-11-24')?.lotCode, '261120');
});

test('continua il lotto: niente oltre 7 giorni; lotto e scadenza non si mescolano a mano', () => {
  let s = close(start(base(), '2026-11-10'), '2026-11-10');
  assert.equal(previousLotFor(s, s.products[0].id, '2026-11-18'), undefined, '8 giorni dopo: niente da continuare');
  assert.throws(() => start(s, '2026-11-18', { continueLot: true }), /negli ultimi 7 giorni/);
  assert.equal(previousLotFor(s, s.products[0].id, '2026-11-17')?.lotCode, '261110', '7 giorni dopo: ancora valido');
  assert.throws(() => start(s, '2026-11-17', { continueLot: true, lotCode: '261117' }), /lotto continuato/);
  assert.throws(() => start(s, '2026-11-17', { continueLot: true, expiry: '2027-12-31' }), /lotto continuato/);
  s = start(s, '2026-11-17');
  assert.equal(activeSession(s)!.lotCode, '261117', 'senza scelta: lotto di oggi');
  assert.equal(activeSession(s)!.continuedFrom, undefined);
});

test('nello stesso giorno, per lo stesso prodotto, un solo lotto', () => {
  let s = close(start(base(), '2026-11-20'), '2026-11-20');
  s = close(start(s, '2026-11-23', { continueLot: true }), '2026-11-23', 10);
  assert.equal(todayLotFor(s, s.products[0].id, '2026-11-23')?.lotCode, '261120');
  // Seconda lavorazione dello stesso giorno: resta il lotto già usato oggi, anche senza sceglierlo.
  s = start(s, '2026-11-23', {}, 11);
  assert.equal(activeSession(s)!.lotCode, '261120');
  assert.equal(activeSession(s)!.expiry, '2027-11-20');
  s = close(s, '2026-11-23', 13);
  assert.throws(() => start(s, '2026-11-23', { lotCode: '261123' }, 14), /ha già il lotto 261120/);
  assert.throws(() => start(s, '2026-11-23', { expiry: '2027-11-23' }, 14), /ha già il lotto 261120/);
});

test('lotto scritto a mano di un altro giorno: la scadenza parte dalla data del lotto (pezzo 1b)', () => {
  const s = start(base(), '2026-11-27', { lotCode: '261126' });
  assert.deepEqual([activeSession(s)!.lotCode, activeSession(s)!.expiry], ['261126', '2027-11-26']);
  const explicit = start(base(), '2026-11-27', { lotCode: '261126', expiry: '2027-12-31' });
  assert.equal(activeSession(explicit)!.expiry, '2027-12-31', 'una scadenza scritta a mano vale sopra il calcolo');
});

test('stesso lotto con scadenza diversa rifiutato anche senza carico a magazzino', () => {
  let s = act(base(), { type: 'settings.update', settings: { autoLoad: false } }, at('2026-11-02'));
  s = close(start(s, '2026-11-26', { lotCode: '261126', expiry: '2027-12-31' }), '2026-11-26');
  assert.equal(s.lots.length, 0, 'carico spento: nessun lotto in magazzino');
  assert.throws(() => start(s, '2026-11-27', { lotCode: '261126' }), /esiste già con scadenza 2027-12-31/);
});

test('un avvio sbagliato chiuso con 0 cartoni non fissa il lotto del giorno', () => {
  let s = start(base(), '2026-11-27', { lotCode: '261126' });
  s = act(s, { type: 'production.close', sessionId: activeSession(s)!.id }, at('2026-11-27', 9));
  s = start(s, '2026-11-27', {}, 10);
  assert.equal(activeSession(s)!.lotCode, '261127', 'si riparte con il lotto giusto');
});

test('continua il lotto quando oggi c’è già il lotto: vale quello di oggi, senza errore', () => {
  let s = start(base(), '2026-11-27', { counting: 'manual' });
  s = act(s, { type: 'production.count', sessionId: activeSession(s)!.id, cartons: 5 }, at('2026-11-27', 9));
  s = close(s, '2026-11-27', 10);
  s = start(s, '2026-11-27', { continueLot: true }, 11);
  assert.equal(activeSession(s)!.lotCode, '261127');
});

test('entrata a mano con il lotto di una lavorazione chiusa e un’altra scadenza: rifiutata', () => {
  let s = act(base(), { type: 'settings.update', settings: { autoLoad: false } }, at('2026-11-02'));
  s = start(s, '2026-11-27', { counting: 'manual' });
  s = act(s, { type: 'production.count', sessionId: activeSession(s)!.id, cartons: 4 }, at('2026-11-27', 9));
  s = close(s, '2026-11-27', 10);
  const pid = s.products[0].id;
  assert.throws(() => act(s, { type: 'lot.receive', lot: { productId: pid, code: '261127', expiry: '2027-01-01', area: 'Area A', quantity: 4 } }, at('2026-11-27', 11)), /prodotto con scadenza 2027-11-27/);
  s = act(s, { type: 'lot.receive', lot: { productId: pid, code: '261127', expiry: '2027-11-27', area: 'Area A', quantity: 4 } }, at('2026-11-27', 11));
  s = start(s, '2026-11-27', {}, 12);
  assert.equal(activeSession(s)!.lotCode, '261127', 'la produzione del giorno continua');
});

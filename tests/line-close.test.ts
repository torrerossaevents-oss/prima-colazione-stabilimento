/**
 * Pagina Linea, riquadro «Ultima chiusura» (decisione di Teo del 27/11/2026): ora, cartoni, lotto ed esito
 * del carico dopo una chiusura dal pulsante della linea, fino all'avvio della lavorazione successiva.
 * Solo dati di prova.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, initialState, type Action, type Context, type State } from '../lib/domain.ts';
import { lastLineClose } from '../lib/line-close.ts';

let seq = 0;
const ctx = (extra: Context = {}): Context => ({ now: '2026-11-27T16:40:00.000Z', id: () => 'id-' + (++seq), devicesEnabled: true, ...extra });
const act = (s: State, a: Action, c: Context = ctx()) => applyAction(s, a, c);
const product = { code: 'A1', name: 'Cornetto PROVA', kind: 'finished' as const, unit: 'CRT', unitsPerBox: 1, minStock: 0 };

function closedByLine(settings: State['settings'], cartons = 37, anomalies: string[] = [], item: typeof product = product) {
  let s = act(initialState(), { type: 'product.add', product: item });
  if (settings) s = act(s, { type: 'settings.update', settings });
  s = act(s, { type: 'production.start', ident: 'P1', code: 'A1', operator: 'Operatore prova', counting: 'device' });
  const sessionId = s.sessions[0].id;
  return act(s, { type: 'production.deviceClose', sessionId, eventId: 'evt_prova_' + (++seq), cartons, counterStart: 1000, counterEnd: 1000 + cartons, closedAt: '2026-11-27T16:42:10.000Z', anomalies }, ctx({ device: { id: 'dev-prova', line: 'linea-1' } }));
}

test('chiusura dal ponte con carico fatto: ora del pulsante, cartoni, lotto, area', () => {
  const s = closedByLine({ productionArea: 'Cella' });
  const close = lastLineClose(s)!;
  assert.equal(close.at, '2026-11-27T16:42:10.000Z', 'ora della pressione di CHIUDI');
  assert.deepEqual([close.cartons, close.lotCode, close.productCode, close.loaded, close.problem], [37, '261127', 'A1', true, false]);
  assert.equal(close.load, 'Carico a magazzino fatto: 37 CRT nel lotto 261127 in Cella.');
  assert.equal(close.todo, undefined);
});

test('carico NON fatto: area di carico non impostata, con cosa fare', () => {
  const close = lastLineClose(closedByLine(undefined))!;
  assert.equal(close.problem, true); assert.equal(close.loaded, false);
  assert.equal(close.load, 'Carico a magazzino NON fatto: area di carico non impostata.');
  assert.match(close.todo!, /Configurazione → Produzione ed etichette/);
  assert.equal(close.todo, 'Avvisa l’amministrazione: scegliere l’area in Configurazione → Produzione ed etichette, poi registrare a mano l’entrata di 37 CRT nel lotto 261127, scadenza 27/11/2027 (Magazzino → Registra entrata).');
});

test('carico NON fatto: carico automatico disattivato', () => {
  const close = lastLineClose(closedByLine({ productionArea: 'Cella', autoLoad: false }))!;
  assert.equal(close.problem, true);
  assert.equal(close.load, 'Carico a magazzino NON fatto: carico automatico disattivato.');
  assert.match(close.todo!, /Registra entrata/);
});

test('zero cartoni: niente da caricare, non è un errore; anomalie mostrate', () => {
  const close = lastLineClose(closedByLine({ productionArea: 'Cella' }, 0, ['arretramento']))!;
  assert.equal(close.problem, false); assert.equal(close.loaded, false);
  assert.equal(close.load, 'Carico a magazzino NON fatto: nessun cartone buono da caricare.');
  assert.deepEqual(close.anomalies, ['arretramento']);
});

test('il riquadro sparisce quando parte la lavorazione successiva; niente per una chiusura manuale', () => {
  let s = closedByLine({ productionArea: 'Cella' });
  assert.ok(lastLineClose(s));
  s = act(s, { type: 'production.start', ident: 'P1', code: 'A1', operator: 'Operatore prova', counting: 'manual' }, ctx({ now: '2026-11-27T16:50:00.000Z' }));
  assert.equal(lastLineClose(s), null, 'lavorazione successiva avviata');
  s = act(s, { type: 'production.close', sessionId: s.sessions[1].id }, ctx({ now: '2026-11-27T17:00:00.000Z' }));
  assert.equal(lastLineClose(s), null, 'l’ultima chiusura è manuale: nessun riquadro del ponte');
  assert.equal(lastLineClose(initialState()), null);
});

test('cosa fare nell’unità dell’articolo: 12 confezioni per cartone', () => {
  const close = lastLineClose(closedByLine({ productionArea: 'Cella', autoLoad: false }, 10, [], { ...product, code: 'A1', unit: 'confezioni', unitsPerBox: 12 }))!;
  assert.equal(close.todo, 'Avvisa l’amministrazione: registrare a mano l’entrata di 120 confezioni (10 cartoni da 12) nel lotto 261127, scadenza 27/11/2027 (Magazzino → Registra entrata).');
  const loaded = lastLineClose(closedByLine({ productionArea: 'Cella' }, 10, [], { ...product, code: 'A1', unit: 'confezioni', unitsPerBox: 12 }))!;
  assert.equal(loaded.load, 'Carico a magazzino fatto: 120 confezioni nel lotto 261127 in Cella.');
});

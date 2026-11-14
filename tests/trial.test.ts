/**
 * Modalità prova: l'archivio di esempio è costruito con le regole vere, è riconoscibile
 * («PROVA» in ogni articolo, autore «modalità prova») e non contiene orari futuri.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { activeSession, addDays, applyAction, productionDay, todayRome, validateState } from '../lib/domain.ts';
import { buildTrialState, readTrialState, TRIAL_ACTOR } from '../lib/trial.ts';

const moments = ['2026-11-14T02:10:00Z', '2026-11-14T09:30:00Z', '2026-11-14T22:50:00Z', '2026-03-29T05:00:00Z', '2026-10-25T13:00:00Z'];

test('archivio di prova valido a qualsiasi ora, anche nei giorni del cambio d’ora', () => {
  for (const moment of moments) {
    const now = new Date(moment); const state = buildTrialState(now); const today = todayRome(now);
    validateState(state);
    assert.ok(state.products.every(p => p.name.includes('PROVA')), 'articoli riconoscibili');
    assert.ok(state.audit.every(a => a.actor === TRIAL_ACTOR), 'autore riconoscibile');
    assert.ok(state.audit.every(a => a.at <= now.toISOString()), `nessun orario futuro (${moment})`);
    assert.ok(state.lots.every(l => l.quantity >= 0 && l.blocked >= 0));
    const open = activeSession(state); assert.ok(open, 'una lavorazione aperta da far avanzare'); assert.equal(open.day, today);
    for (let d = 1; d <= 6; d++) assert.ok(productionDay(state.sessions, addDays(today, -d)).totals.runs >= 2, 'produzione nei giorni precedenti');
  }
});

test('giornata con lo stesso prodotto lavorato più volte, scarti e carico esplicito', () => {
  const now = new Date('2026-11-14T09:30:00Z'); const state = buildTrialState(now);
  const days = Array.from({ length: 6 }, (_, i) => productionDay(state.sessions, addDays(todayRome(now), -1 - i)));
  assert.ok(days.some(d => d.totals.repeated > 0), 'un prodotto ripetuto nello stesso giorno');
  assert.ok(state.sessions.some(s => (s.scrapCartons ?? 0) > 0), 'almeno uno scarto');
  assert.ok(state.audit.some(a => a.action === 'lot.receive' && a.moves?.length), 'carico a magazzino come operazione esplicita');
  assert.ok(state.orders.some(o => o.status === 'dispatched') && state.orders.some(o => o.status === 'reserved'));
});

test('nella prova la chiusura salva la lavorazione e non tocca il magazzino', () => {
  const now = new Date('2026-11-14T09:30:00Z'); const state = buildTrialState(now); const open = activeSession(state)!;
  const counted = applyAction(state, { type: 'production.count', sessionId: open.id, cartons: 5 }, { now: now.toISOString(), actor: TRIAL_ACTOR });
  const closed = applyAction(counted, { type: 'production.close', sessionId: open.id }, { now: now.toISOString(), actor: TRIAL_ACTOR });
  assert.deepEqual(closed.lots, state.lots);
  assert.equal(closed.sessions.find(s => s.id === open.id)!.status, 'closed');
  assert.equal(activeSession(closed), undefined, 'la nuova lavorazione ripartirà da zero');
});

test('lettura dell’archivio di prova salvato: valido ripreso, illeggibile ricostruito', () => {
  const now = new Date('2026-11-14T09:30:00Z'); const state = buildTrialState(now);
  assert.deepEqual(readTrialState(JSON.stringify(state), now), state);
  assert.equal(readTrialState('{non valido', now).products.length, state.products.length);
  assert.equal(readTrialState(JSON.stringify({ products: 'x' }), now).products.length, state.products.length);
  assert.equal(readTrialState(null, now).audit.length, state.audit.length);
  const tomorrow = new Date('2026-11-15T09:30:00Z');
  assert.notDeepEqual(readTrialState(JSON.stringify(state), tomorrow), state, 'una prova del giorno prima viene rigenerata con date attuali');
  assert.equal(activeSession(readTrialState(JSON.stringify(state), tomorrow))!.day, '2026-11-15');
});

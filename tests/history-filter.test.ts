/**
 * Storico per data e per tipo: i giorni sono quelli di Roma (anche nei cambi d'ora),
 * gli estremi sono inclusi, il tipo si ricava dal prefisso dell'operazione.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { auditBounds, auditGroupOf, auditMatches, romeDayStart, type Audit } from '../lib/domain.ts';

test('romeDayStart: mezzanotte di Roma in UTC, anche nei giorni del cambio d’ora', () => {
  assert.equal(romeDayStart('2026-01-15'), '2026-01-14T23:00:00.000Z');
  assert.equal(romeDayStart('2026-07-15'), '2026-07-14T22:00:00.000Z');
  assert.equal(romeDayStart('2026-03-29'), '2026-03-28T23:00:00.000Z', 'giorno del passaggio all’ora legale');
  assert.equal(romeDayStart('2026-03-30'), '2026-03-29T22:00:00.000Z');
  assert.equal(romeDayStart('2026-10-25'), '2026-10-24T22:00:00.000Z', 'giorno del ritorno all’ora solare');
  assert.equal(romeDayStart('2026-10-26'), '2026-10-25T23:00:00.000Z');
});

test('auditBounds: estremi inclusi, giorni non validi rifiutati', () => {
  assert.deepEqual(auditBounds({ from: '2026-11-14', to: '2026-11-14' }), { fromAt: '2026-11-13T23:00:00.000Z', toAt: '2026-11-14T23:00:00.000Z' });
  assert.deepEqual(auditBounds({}), {});
  assert.throws(() => auditBounds({ from: '2026-13-01' }), /data non valida/);
  assert.throws(() => auditBounds({ from: '2026-11-15', to: '2026-11-14' }), /precedente/);
});

test('auditGroupOf e auditMatches: tipo, giorno di Roma e testo', () => {
  assert.equal(auditGroupOf('production.close'), 'production');
  assert.equal(auditGroupOf('lot.receive'), 'inventory');
  assert.equal(auditGroupOf('order.dispatch'), 'orders');
  assert.equal(auditGroupOf('product.update'), 'catalog');
  assert.equal(auditGroupOf('altro'), undefined);
  const a: Audit = { id: 'a', at: '2026-11-13T23:30:00.000Z', action: 'production.start', detail: 'Lavorazione avviata: PROVA-01' };
  assert.ok(auditMatches(a, { from: '2026-11-14', to: '2026-11-14' }), '00:30 del 14 a Roma è il 14');
  assert.ok(!auditMatches(a, { from: '2026-11-13', to: '2026-11-13' }));
  assert.ok(auditMatches(a, { group: 'production', q: 'prova-01' }));
  assert.ok(!auditMatches(a, { group: 'orders' }));
  assert.ok(!auditMatches(a, { q: 'cliente' }));
});

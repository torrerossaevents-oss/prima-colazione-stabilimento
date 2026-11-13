import test from 'node:test';
import assert from 'node:assert/strict';
import { SensorTracker, classifyTransition } from '../core/sensors.mjs';

// Campioni [stato, istante ms]; con minStableMs 0 ogni cambio è accettato subito.
function run(states, { minStableMs = 0, step = 10 } = {}) {
  const tracker = new SensorTracker({ minStableMs });
  let t = 0;
  const results = states.map(state => tracker.feed(state, (t += step)));
  return { tracker, results };
}

test('sequenza valida 00→10→11→01→00 conta un cartone; ripetizioni (sosta) non contano', () => {
  const { tracker } = run(['00', '10', '11', '01', '00']);
  assert.equal(tracker.count, 1);
  assert.equal(tracker.anomalies.total, 0);
  const stop = run(['00', '10', '10', '11', '11', '11', '11', '01', '01', '00', '00', '00']);
  assert.equal(stop.tracker.count, 1);
  assert.equal(stop.tracker.anomalies.total, 0);
  const many = run(['00', ...Array(200).fill(['10', '11', '01', '00']).flat()]);
  assert.equal(many.tracker.count, 200);
});

test('arretramenti producono anomalia e nessun conteggio, anche se il passaggio poi termina', () => {
  for (const sequence of [['00', '10', '00'], ['00', '10', '11', '10', '11', '01', '00'], ['00', '10', '11', '01', '11', '01', '00'],
    ['00', '10', '11', '10', '00'], ['00', '10', '11', '10', '11', '10', '00']]) {
    const { tracker } = run(sequence);
    assert.equal(tracker.count, 0, sequence.join('→'));
    assert.equal(tracker.anomalies.arretramento, 1, sequence.join('→'));
    assert.equal(tracker.anomalies.total, 1, 'una sola anomalia per passaggio');
  }
  assert.equal(classifyTransition('10', '00'), 'arretramento');
  assert.equal(classifyTransition('11', '10'), 'arretramento');
  assert.equal(classifyTransition('01', '11'), 'arretramento');
});

test('salti e sequenze incomplete producono anomalia e nessun conteggio', () => {
  for (const sequence of [['00', '11', '01', '00'], ['00', '01', '00'], ['00', '10', '01', '00'], ['00', '10', '11', '00']]) {
    const { tracker } = run(sequence);
    assert.equal(tracker.count, 0, sequence.join('→'));
    assert.ok(tracker.anomalies['sequenza-incompleta'] >= 1, sequence.join('→'));
  }
  // Dopo un'anomalia, il cartone successivo pulito conta.
  const { tracker } = run(['00', '11', '01', '00', '10', '11', '01', '00']);
  assert.equal(tracker.count, 1);
});

test('osservazione iniziata a metà passaggio: non conta, una anomalia', () => {
  const { tracker } = run(['11', '01', '00', '10', '11', '01', '00']);
  assert.equal(tracker.count, 1);
  assert.equal(tracker.anomalies['sequenza-incompleta'], 1);
});

test('filtro rimbalzi: impulsi più brevi di minStableMs sono ignorati', () => {
  const tracker = new SensorTracker({ minStableMs: 20 });
  let t = 0;
  const hold = (state, ms) => { for (let end = t + ms; t < end;) tracker.feed(state, (t += 5)); };
  hold('00', 50);
  hold('10', 10); hold('00', 5); // rimbalzo
  hold('10', 40); hold('11', 10); hold('10', 5); hold('11', 40);
  hold('01', 40); hold('00', 10); hold('01', 5); hold('00', 40);
  assert.equal(tracker.count, 1);
  assert.equal(tracker.anomalies.total, 0);
  // Senza filtro gli stessi rimbalzi sarebbero arretramenti.
  const raw = run(['00', '10', '00', '10', '11', '10', '11', '01', '00', '01', '00']);
  assert.equal(raw.tracker.count, 0);
  assert.ok(raw.tracker.anomalies.total > 0);
});

test('isClearAndStable richiede 00 accettato e stabile per il tempo indicato', () => {
  const tracker = new SensorTracker({ minStableMs: 0 });
  tracker.feed('00', 0);
  assert.equal(tracker.isClearAndStable(100, 200), false);
  assert.equal(tracker.isClearAndStable(250, 200), true);
  tracker.feed('10', 260);
  assert.equal(tracker.isClearAndStable(1000, 200), false);
});

test('stati non validi e campioni fuori ordine', () => {
  const tracker = new SensorTracker({ minStableMs: 0 });
  tracker.feed('00', 10);
  assert.equal(tracker.feed('2', 20).anomaly, 'stato-non-valido');
  assert.equal(tracker.anomalies.total, 1);
  assert.throws(() => tracker.feed('00', 5), /fuori ordine/);
  assert.throws(() => new SensorTracker({}), /minStableMs/);
});

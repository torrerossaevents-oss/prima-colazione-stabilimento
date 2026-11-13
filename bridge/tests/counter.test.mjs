import test from 'node:test';
import assert from 'node:assert/strict';
import { createCounterState, observeCounter, partialOf, acceptDoubleRead } from '../core/counter.mjs';

const limits = { modulo: 2 ** 32, maxStepPerSecond: 10 };

function feed(state, readings, options = limits) {
  const outcomes = [];
  for (const [value, at] of readings) {
    const result = observeCounter(state, { value, at }, options);
    state = result.state;
    outcomes.push(result);
  }
  return { state, outcomes };
}

test('parziale = cumulativo − baseline, letture assolute ripetute non sommano', () => {
  const start = createCounterState({ baseline: 120034, at: 0 });
  const { state } = feed(start, [[120040, 1000], [120040, 2000], [120050, 3000], [120050, 4000]]);
  assert.equal(partialOf(state), 16);
  assert.equal(state.baseline, 120034);
  assert.equal(start.last, 120034, 'lo stato iniziale non viene modificato');
});

test('superamento del limite a 32 bit gestito; modulo configurabile a 16 bit', () => {
  const near = createCounterState({ baseline: 2 ** 32 - 3, at: 0 });
  const { state, outcomes } = feed(near, [[2 ** 32 - 1, 1000], [2, 2000]]);
  assert.equal(outcomes[1].rollover, true);
  assert.equal(partialOf(state), 5);
  const small = createCounterState({ baseline: 65530, at: 0 });
  const r16 = feed(small, [[4, 1000]], { modulo: 65536, maxStepPerSecond: 10 });
  assert.equal(partialOf(r16.state, 65536), 10);
  assert.equal(observeCounter(small, { value: 65536, at: 1000 }, { modulo: 65536, maxStepPerSecond: 10 }).anomaly, 'lettura-non-valida');
});

test('diminuzione inattesa: anomalia, sospensione, parziale congelato, mai negativo', () => {
  const start = createCounterState({ baseline: 1000, at: 0 });
  const { state, outcomes } = feed(start, [[1005, 1000], [3, 2000], [8, 3000], [2000, 400000]]);
  assert.equal(outcomes[1].anomaly, 'contatore-diminuito');
  assert.equal(state.suspended, true);
  assert.deepEqual(state.anomalies, ['contatore-diminuito']);
  assert.equal(partialOf(state), 5, 'nessuna quantità ricostruita dopo la diminuzione');
  assert.equal(outcomes[2].accepted, false);
  assert.equal(outcomes[3].accepted, false, 'resta sospeso finché la lavorazione non viene chiusa');
  assert.ok(partialOf(state) >= 0);
});

test('letture corrotte: fuori intervallo e salto oltre la soglia per intervallo vengono scartate', () => {
  const start = createCounterState({ baseline: 100, at: 0 });
  for (const value of [-1, 1.5, 2 ** 32, NaN, '120']) {
    const result = observeCounter(start, { value, at: 1000 }, limits);
    assert.equal(result.anomaly, 'lettura-non-valida');
    assert.deepEqual(result.state, start);
  }
  // 10/s: in 1 s al massimo 10; un salto di 65536 (parola alta strappata) è scartato.
  const torn = observeCounter(start, { value: 100 + 65536, at: 1000 }, limits);
  assert.equal(torn.anomaly, 'salto-eccessivo');
  assert.equal(torn.state.last, 100);
  // Dopo un'interruzione lunga la soglia cresce con il tempo trascorso.
  const later = observeCounter(start, { value: 700, at: 60_000 }, limits);
  assert.equal(later.accepted, true);
  assert.equal(partialOf(later.state), 600);
  assert.equal(observeCounter(start, { value: 101, at: -5 }, limits).anomaly, 'lettura-fuori-ordine');
  assert.throws(() => observeCounter(start, { value: 101, at: 1 }, { modulo: 2 ** 32 }), /maxStepPerSecond/);
});

test('lettura doppia a 32 bit: accettata se coincide o se la parola alta non cambia e non diminuisce', () => {
  assert.deepEqual(acceptDoubleRead(70000, 70000), { ok: true, value: 70000 });
  assert.deepEqual(acceptDoubleRead(65540, 65545), { ok: true, value: 65545 });
  // Riporto tra le parole: 0x0000FFFF → 0x00010000 cambia la parola alta.
  assert.equal(acceptDoubleRead(0xffff, 0x10000).ok, false);
  // Lettura strappata (alta vecchia, bassa nuova): stessa parola alta ma valore diminuito.
  assert.equal(acceptDoubleRead(0xfffe, 0x0000).ok, false);
  assert.equal(acceptDoubleRead(-1, 3).ok, false);
});

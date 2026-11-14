/**
 * Modalità prova: un archivio di esempio costruito nel browser con le stesse regole del
 * gestionale (applyAction). Nulla viene inviato al server; tutti gli articoli contengono
 * «PROVA» nel nome. Copre una settimana: lavorazioni ripetute nello stesso giorno, scarti,
 * carichi espliciti a magazzino, consumi, un ordine consegnato e uno da preparare, una
 * lavorazione aperta oggi da far avanzare con il contatore simulato.
 */
import { addDays, applyAction, initialState, romeDayStart, todayRome, upgradeState, validateState, type Action, type ProductInput, type State } from './domain.ts';

export const TRIAL_STORAGE_KEY = 'prima-colazione-prova-v1';
export const TRIAL_ACTOR = 'modalità prova';

const products: ProductInput[] = ([
  ['00123', 'Cornetto vuoto PROVA 50 x 45 g', 'Croissanteria', 'finished', 'CRT', 40],
  ['00124', 'Cornetto albicocca PROVA 50 x 80 g', 'Croissanteria', 'finished', 'CRT', 30],
  ['00131', 'Treccia uvetta PROVA 40 x 90 g', 'Lievitati', 'finished', 'CRT', 20],
  ['00210', 'Plumcake yogurt PROVA 30 x 33 g', 'Merendine', 'finished', 'CRT', 25],
  ['00215', 'Saccottino cioccolato PROVA 60 x 50 g', 'Merendine', 'finished', 'CRT', 15],
  ['MP-FAR0', 'Farina tipo 0 PROVA sacco 25 kg', 'Materie prime', 'raw', 'sacchi', 20],
  ['MP-BUR', 'Burro PROVA blocco 10 kg', 'Materie prime', 'raw', 'blocchi', 5],
  ['IM-CRT40', 'Cartone ondulato PROVA 40x30', 'Imballaggi', 'packaging', 'pezzi', 500],
] as const).map(([code, name, category, kind, unit, minStock]) => ({ code, name, category, kind, unit, unitsPerBox: 1, minStock }));

/** [codice, inizio in minuti dalla mezzanotte, conteggi successivi, fine] */
type Run = [code: string, start: number, counts: number[], end: number];
const plans: Run[][] = [
  [['00123', 390, [22, 20, 18], 560], ['00210', 600, [30, 26], 720], ['00123', 780, [16, 14], 900]],
  [['00124', 380, [18, 16], 520], ['00131', 560, [12, 14, 10], 700]],
  [['00215', 400, [20, 22], 540], ['00123', 570, [25, 21, 19], 740], ['00210', 760, [28], 850]],
];
const operators = ['Operatore PROVA A', 'Operatore PROVA B'];

export function buildTrialState(now: Date = new Date()): State {
  const today = todayRome(now);
  const nowMinutes = Math.floor((now.getTime() - Date.parse(romeDayStart(today))) / 60_000);
  // A fresh prefix per archive: identifiers never collide with those of a previous trial.
  const prefix = 'prova-' + crypto.randomUUID().slice(0, 6) + '-'; let n = 0; const id = () => prefix + String(++n).padStart(5, '0');
  let state = initialState();
  const at = (day: string, minutes: number) => new Date(Date.parse(romeDayStart(day)) + minutes * 60_000).toISOString();
  const run = (action: Action, when: string) => { state = applyAction(state, action, { now: when, id, actor: TRIAL_ACTOR }); };
  const pid = (code: string) => state.products.find(p => p.code === code)!.id;
  const lotOf = (code: string, quantity: number) => state.lots.find(l => l.productId === pid(code) && l.quantity - l.blocked >= quantity)!;

  const first = addDays(today, -6);
  run({ type: 'product.import', mode: 'skip', products }, at(first, 330));
  run({ type: 'lot.receive', lot: { productId: pid('MP-FAR0'), code: 'F-PROVA-1', expiry: addDays(first, 120), area: 'Magazzino secco', quantity: 34 } }, at(first, 335));
  run({ type: 'lot.receive', lot: { productId: pid('MP-BUR'), code: 'B-PROVA-1', expiry: addDays(first, 30), area: 'Cella frigo', quantity: 12 } }, at(first, 336));
  run({ type: 'lot.receive', lot: { productId: pid('IM-CRT40'), code: 'C-PROVA-1', expiry: '', area: 'Area spedizioni', quantity: 1800 } }, at(first, 337));

  const produce = (day: string, [code, start, counts, end]: Run, index: number, closeIt: boolean, scrap = 0) => {
    run({ type: 'production.start', code, operator: operators[index % 2], lotCode: `P${day.slice(2).replaceAll('-', '')}${String.fromCharCode(65 + index)}`, expiry: addDays(day, 45) }, at(day, start));
    const session = state.sessions.at(-1)!;
    const step = closeIt ? Math.max(1, Math.floor((end - start) / (counts.length + 1))) : 10;
    counts.forEach((cartons, k) => { const when = start + step * (k + 1); if (closeIt || day !== today || when <= nowMinutes) run({ type: 'production.count', sessionId: session.id, cartons }, at(day, when)); });
    if (!closeIt) return;
    run({ type: 'production.close', sessionId: session.id, ...(scrap ? { scrapCartons: scrap, note: 'Cartoni schiacciati in uscita (prova)' } : {}) }, at(day, end));
    // The close never loads stock: the good quantity is loaded with its own explicit operation.
    const saved = state.sessions.find(s => s.id === session.id)!; // each operation returns a new state
    run({ type: 'lot.receive', lot: { productId: saved.productId, code: saved.lotCode, expiry: saved.expiry, area: 'Cella frigo', quantity: saved.cartons - scrap } }, at(day, end + 10));
  };

  for (let d = 0; d < 6; d++) {
    const day = addDays(first, d);
    run({ type: 'lot.consume', lotId: lotOf('MP-FAR0', 4).id, quantity: 4, reason: 'Impasti del giorno (prova)', responsible: operators[d % 2] }, at(day, 350));
    plans[d % plans.length].forEach((r, i) => produce(day, r, i, true, (d + i) % 4 === 1 ? 1 + (d % 2) : 0));
    if (d === 3) {
      run({ type: 'order.create', order: { customer: 'Bar Centrale PROVA', destination: 'Via Roma 1 (prova)', date: day, lines: [{ lotId: lotOf('00123', 30).id, quantity: 30 }, { lotId: lotOf('00210', 12).id, quantity: 12 }] } }, at(day, 930));
      const order = state.orders.at(-1)!;
      run({ type: 'order.prepare', orderId: order.id }, at(day, 960));
      run({ type: 'order.dispatch', orderId: order.id, documentRef: 'DDT PROVA 101' }, at(day, 1000));
    }
    if (d === 5) run({ type: 'order.create', order: { customer: 'Pasticceria Sole PROVA', destination: 'Piazza Garibaldi 3 (prova)', date: addDays(day, 1), lines: [{ lotId: lotOf('00124', 10).id, quantity: 10 }] } }, at(day, 950));
  }

  // Today: one closed run if the morning has passed, then an open one to advance with the simulated counter.
  if (nowMinutes >= 480) produce(today, ['00123', 360, [20, 18], 420], 0, true);
  const start = nowMinutes >= 480 ? Math.max(450, nowMinutes - 45) : Math.max(0, nowMinutes - 30);
  produce(today, ['00210', start, [12], nowMinutes + 60], nowMinutes >= 480 ? 1 : 0, false);
  return state;
}

/** Files exported while the trial is open say so in their name (the page sets data-prova on <html>). */
export function trialFileName(name: string): string {
  return typeof document !== 'undefined' && document.documentElement?.dataset?.prova === '1' ? name.replace(/^prima-colazione-(?!PROVA-)/, 'prima-colazione-PROVA-') : name;
}

/** Reads the saved trial archive; unreadable, invalid or from a previous day → a fresh one (dates stay current). */
export function readTrialState(raw: string | null, now = new Date()): State {
  if (raw) {
    try {
      const state = upgradeState(JSON.parse(raw) as State); validateState(state);
      const last = state.audit.at(-1)?.at;
      if (last && todayRome(last) === todayRome(now)) return state;
    } catch { /* rebuilt below */ }
  }
  return buildTrialState(now);
}

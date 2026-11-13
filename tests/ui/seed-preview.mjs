/**
 * Fills an EMPTY local preview with recognisably fictitious data, to review the
 * interface with realistic density. Refuses any non-local address or non-empty archive.
 * Usage: node tests/ui/seed-preview.mjs http://localhost:5173
 */
const base = process.argv[2] || 'http://localhost:5173';
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base)) throw new Error('Solo anteprima locale.');
let version = (await (await fetch(base + '/api/workspace')).json()).version;
if (version !== 0) throw new Error('L’archivio locale non è vuoto: nessun dato aggiunto.');
async function act(action) {
  const res = await fetch(base + '/api/workspace', { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ action, expectedVersion: version, requestId: 'seed-' + crypto.randomUUID() }) });
  const body = await res.json(); if (!res.ok) throw new Error(`${action.type}: ${body.error}`); version = body.version; return body.state;
}
const day = n => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const products = [
  ['00123', 'Cornetto vuoto PROVA 50 x 45 g', 'Croissanteria', 'finished', 'CRT', 1, 40, 18.5, 17.9, 21],
  ['00124', 'Cornetto albicocca PROVA 50 x 80 g', 'Croissanteria', 'finished', 'CRT', 1, 30, 22.4, null, 25.5],
  ['00131', 'Treccia uvetta PROVA 40 x 90 g', 'Lievitati', 'finished', 'CRT', 1, 20, 24.1, 23.5, null],
  ['00210', 'Plumcake yogurt PROVA 30 x 33 g', 'Merendine', 'finished', 'CRT', 1, 25, 9.9, 9.6, 11.2],
  ['00215', 'Saccottino cioccolato PROVA 60 x 50 g', 'Merendine', 'finished', 'CRT', 1, 15, 19.75, null, null],
  ['MP-FAR0', 'Farina tipo 0 PROVA sacco 25 kg', 'Materie prime', 'raw', 'sacchi', 1, 20, null, null, null],
  ['MP-BUR', 'Burro PROVA blocco 10 kg', 'Materie prime', 'raw', 'blocchi', 1, 10, null, null, null],
  ['MP-ZUC', 'Zucchero semolato PROVA 25 kg', 'Materie prime', 'raw', 'sacchi', 1, 8, null, null, null],
  ['IM-CRT40', 'Cartone ondulato PROVA 40x30', 'Imballaggi', 'packaging', 'pezzi', 1, 500, null, null, null],
  ['IM-FLOW', 'Film flowpack PROVA bobina', 'Imballaggi', 'packaging', 'bobine', 1, 6, null, null, null],
].map(([code, name, category, kind, unit, unitsPerBox, minStock, a, b, c]) => ({ code, name, category, kind, unit, unitsPerBox, minStock, priceGelCor: a, priceGelitria: b, priceDistribution: c }));
let state = await act({ type: 'product.import', mode: 'skip', products });
const id = code => state.products.find(p => p.code === code).id;
const receive = (code, lot, expiry, area, quantity) => act({ type: 'lot.receive', lot: { productId: id(code), code: lot, expiry, area, quantity } });
state = await receive('00123', 'L2611A', day(40), 'Cella frigo', 150);
state = await receive('00123', 'L2610C', day(3), 'Cella frigo', 24);
state = await receive('00124', 'L2611B', day(35), 'Cella frigo', 18);
state = await receive('00131', 'L2611D', day(28), 'Magazzino secco', 64);
state = await receive('00210', 'L2609F', day(-2), 'Magazzino secco', 12);
state = await receive('00210', 'L2611G', day(60), 'Magazzino secco', 210);
state = await receive('MP-FAR0', 'F-8841', day(120), 'Magazzino secco', 34);
state = await receive('MP-BUR', 'B-1203', day(6), 'Cella frigo', 7);
state = await receive('MP-ZUC', 'Z-5521', day(300), 'Magazzino secco', 22);
state = await receive('IM-CRT40', 'C-0099', '', 'Area spedizioni', 1800);
state = await receive('IM-FLOW', 'FL-77', '', 'Area spedizioni', 4);
const lot = code => state.lots.find(l => l.code === code).id;
state = await act({ type: 'lot.block', lotId: lot('L2611A'), blocked: 2 });
state = await act({ type: 'order.create', order: { customer: 'Bar Centrale (prova)', destination: 'Via di Prova 1, Velletri', date: day(1), lines: [{ lotId: lot('L2611A'), quantity: 30 }, { lotId: lot('L2611G'), quantity: 40 }] } });
state = await act({ type: 'order.create', order: { customer: 'Pasticceria Esempio', destination: 'Piazza Fittizia 3', date: day(0), lines: [{ lotId: lot('L2611D'), quantity: 20 }] } });
state = await act({ type: 'order.prepare', orderId: state.orders[1].id });
state = await act({ type: 'order.create', order: { customer: 'Distributore Test Sud', destination: 'Magazzino di prova, Latina', date: day(0), lines: [{ lotId: lot('L2611G'), quantity: 60 }] } });
state = await act({ type: 'order.prepare', orderId: state.orders[2].id });
state = await act({ type: 'order.dispatch', orderId: state.orders[2].id, documentRef: 'DDT 412/2026 (prova)', quantities: [{ lotId: lot('L2611G'), quantity: 40 }], note: 'Il resto al prossimo giro' });
for (const [code, lotCode, cartons] of [['00123', 'P-2611-1', 200], ['00124', 'P-2611-2', 150]]) {
  state = await act({ type: 'production.start', code, operator: 'Operatore prova', lotCode, expiry: day(30) });
  const s = state.sessions.at(-1).id;
  state = await act({ type: 'production.count', sessionId: s, cartons });
  state = await act({ type: 'production.close', sessionId: s });
}
state = await act({ type: 'production.start', code: '00210', operator: 'Operatore prova', lotCode: 'P-2611-3', expiry: day(45) });
state = await act({ type: 'production.count', sessionId: state.sessions.at(-1).id, cartons: 64 });
console.log(`Anteprima popolata con dati fittizi: versione ${version}, ${state.products.length} articoli, ${state.lots.length} lotti, ${state.orders.length} ordini.`);

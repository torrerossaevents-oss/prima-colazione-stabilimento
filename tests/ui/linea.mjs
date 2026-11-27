/**
 * App «Linea» (iPad) on a LOCAL preview with an EMPTY test database:
 * label image → barcode + text read in the browser → new article created from the label →
 * production started with automatic lot → cartons counted → close loads stock.
 * The label image is generated from the trial mode (fictitious PROVA article), no real data.
 * Usage: npm run dev (other terminal), then: node tests/ui/linea.mjs http://localhost:5173 [outDir]
 */
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const base = process.argv[2] || 'http://localhost:5173';
const out = process.argv[3] || 'ui-smoke-output';
mkdirSync(out, { recursive: true });
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base)) throw new Error('Solo anteprima locale.');
const log = (...a) => console.log('✓', ...a);
const api = async () => (await (await fetch(base + '/api/workspace')).json());
const post = async action => { const { version } = await api(); const res = await fetch(base + '/api/workspace', { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ action, expectedVersion: version, requestId: 'linea-' + crypto.randomUUID() }) }); assert.equal(res.status, 200, await res.text()); };
assert.equal((await api()).version, 0, 'test database must start empty');

const browser = await chromium.launch();
// deviceScaleFactor 2: the label image has the detail of an iPad photo (barcode modules of several pixels).
const context = await browser.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true, isMobile: false, deviceScaleFactor: 2 });
const page = await context.newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

// 1. A fictitious carton label: the trial mode renders one with EAN, COD, pieces, lot and expiry.
await page.goto(base + '/#settings'); await page.getByRole('button', { name: 'Attiva la modalità prova' }).click();
await page.goto(base + '/#production'); const label = page.locator('.carton-label').first(); await label.waitFor();
const labelText = await label.innerText(); const code = labelText.match(/COD\.(\S+)/)[1];
const image = await label.screenshot({ scale: 'device' });
await page.getByRole('button', { name: 'Esci dalla prova' }).first().click();
log(`etichetta di prova generata (COD.${code})`);

// 2. Production area chosen, then the iPad app.
await post({ type: 'settings.update', settings: { productionArea: 'Cella frigo' } });
await page.goto(base + '/linea'); await page.getByText('Etichetta del prodotto').waitFor();
await page.locator('input[type=file]:not([capture])').setInputFiles({ name: 'etichetta.png', mimeType: 'image/png', buffer: image });
await page.locator('.ipad-read').waitFor({ timeout: 120_000 });
const read = await page.locator('.ipad-read').innerText();
assert.match(read, new RegExp(`Codice\\s+${code}`)); assert.match(read, /codice a barre/, 'EAN read from the barcode image');
log('foto letta sul dispositivo: codice ' + code + ' ed EAN dal codice a barre');

// 3. Not in the catalog: the administration creates it from the label in one tap.
await page.getByRole('button', { name: 'Crea l’articolo' }).click();
await page.getByText('Avvio della produzione').waitFor();
let s = await api(); const product = s.state.products.find(p => p.code === code);
assert.ok(product?.ean && product.piecesPerCarton, 'article created with EAN and pieces from the label');
log('articolo creato dall’etichetta con EAN, pezzi e durata');

// 4. Start: lot = today AAMMGG, operator remembered.
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const lot = today.slice(2).replaceAll('-', '');
await page.locator('.ipad-facts').getByText(lot).waitFor();
await page.getByLabel('Operatore').fill('Operatore prova');
await page.getByRole('button', { name: 'Avvia produzione' }).click();
await page.locator('.ipad-count-n').waitFor();
await page.getByRole('button', { name: '+5' }).click(); await page.getByText('+5 cartoni').waitFor();
await page.getByRole('button', { name: '+10' }).click(); await page.locator('.ipad-count-n', { hasText: '15' }).waitFor();
await page.screenshot({ path: `${out}/linea-ipad.png` });
log('produzione avviata dall’iPad, lotto ' + lot + ', 15 cartoni contati con i pulsanti grandi');

// 5. Close: the good cartons enter stock in the chosen area.
await page.getByRole('button', { name: 'Chiudi e carica in magazzino' }).click();
await page.getByLabel('Ho verificato articolo e cartoni.').check();
await page.getByRole('button', { name: 'Conferma chiusura' }).click(); await page.getByText('Lavorazione chiusa e caricata in magazzino').waitFor();
s = await api(); const run = s.state.sessions[0]; const stock = s.state.lots.find(l => l.id === run.loadedLotId);
assert.equal(run.status, 'closed'); assert.equal(stock.code, lot); assert.equal(stock.quantity, 15); assert.equal(stock.area, 'Cella frigo');
log('chiusura dall’iPad: 15 cartoni caricati nel lotto ' + lot + ' in Cella frigo');

// Typography and touch size on the iPad screen.
const report = await page.evaluate(() => {
  const isDark = c => { const m = c.match(/\d+(\.\d+)?/g); if (!m) return false; const [r, g, b, a = 1] = m.map(Number); return a > 0.5 && (0.299 * r + 0.587 * g + 0.114 * b) < 128; };
  const bgOf = el => { for (let e = el; e; e = e.parentElement) { const bg = getComputedStyle(e).backgroundColor; if (bg && !bg.endsWith(', 0)') && bg !== 'transparent') return bg; } return 'rgb(255, 255, 255)'; };
  const bad = []; const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) { const el = walker.currentNode.parentElement; if (!el || !walker.currentNode.textContent.trim() || el.closest('svg')) continue; const st = getComputedStyle(el); if (st.display === 'none' || st.visibility === 'hidden') continue; const dark = isDark(bgOf(el)); if (st.fontWeight !== '400' || st.color !== (dark ? 'rgb(255, 255, 255)' : 'rgb(0, 0, 0)')) bad.push(walker.currentNode.textContent.trim().slice(0, 30)); }
  const small = [...document.querySelectorAll('button, input')].filter(b => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 44 && b.type !== 'checkbox'; }).map(b => b.getAttribute('aria-label') || b.textContent?.trim().slice(0, 20));
  return { bad: bad.slice(0, 6), small };
});
assert.deepEqual(report, { bad: [], small: [] }, 'typography and 44 px touch targets on the iPad screen');
// tesseract logs informational lines on the error console (a missing optional word list it does not need,
// «Estimating resolution as …»): not errors of the app.
assert.deepEqual(errors.filter(e => !/Failed to load resource|net::|special-words|Estimating resolution/.test(e)), [], 'no runtime errors');
log('tipografia (nero/bianco, peso 400) e pulsanti ≥ 44 px sull’iPad');
await browser.close();

// 6. Live scanner: a fake camera shows the same label; the barcode is recognised on its own, the camera
//    closes and the known article goes straight to the start step. Needs ffmpeg to make the video.
const png = resolve(join(out, 'etichetta-prova.png')); const y4m = resolve(join(out, 'etichetta-prova.y4m'));
writeFileSync(png, image);
const ff = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-loop', '1', '-i', png, '-vf', 'scale=1240:700:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:white,format=yuv420p', '-t', '3', '-r', '10', y4m]);
if (ff.status !== 0) console.log('! ffmpeg non disponibile: prova del lettore dal vivo saltata');
else {
  const camBrowser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${y4m}`] });
  const cam = await (await camBrowser.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true, permissions: ['camera'] })).newPage();
  await cam.goto(base + '/linea'); await cam.getByText('Etichetta del prodotto').waitFor();
  await cam.getByRole('button', { name: 'Inquadra l’etichetta' }).click();
  await cam.getByRole('dialog', { name: 'Lettore etichetta' }).waitFor();
  await cam.getByText('Riconosciuto dal codice a barre').waitFor({ timeout: 30_000 });
  assert.equal(await cam.getByRole('dialog', { name: 'Lettore etichetta' }).count(), 0, 'camera closed by itself');
  await cam.getByRole('button', { name: 'Avvia produzione' }).waitFor();
  assert.match(await cam.locator('.ipad-found').innerText(), new RegExp(code));
  await cam.screenshot({ path: `${out}/linea-lettore.png` });
  await camBrowser.close();
  log('lettore dal vivo: codice a barre riconosciuto, fotocamera chiusa da sola, articolo pronto da avviare');
}
// 7. PC del reparto (27/11/2026): stato del ponte sempre visibile e numeri grandi da lontano; resta usabile sull'iPad.
{
  const created = await (await fetch(base + '/api/devices', { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ op: 'create', name: 'PC reparto prova' }) })).json();
  assert.ok(created.token, 'dispositivo di prova creato');
  const toBridge = async body => { const r = await fetch(base + '/api/devices/production', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + created.token }, body: JSON.stringify(body) }); assert.equal(r.status, 200, await r.text()); };
  let lastBeat = 0;
  // Il server conserva al massimo un heartbeat ogni 5 s per dispositivo (il ponte vero ne manda uno ogni 6 s).
  const beat = async (session, extra = {}) => { const wait = 5_200 - (Date.now() - lastBeat); if (wait > 0) await new Promise(r => setTimeout(r, wait)); lastBeat = Date.now(); return toBridge({ eventId: 'hb_' + crypto.randomUUID(), type: 'heartbeat', at: new Date().toISOString(), bridgeVersion: '1.3.1', queueLength: 0, plc: { reachable: true, lastReadAt: new Date().toISOString() }, session, ...extra }); };
  const wide = await chromium.launch();
  const pc = await (await wide.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
  const pcErrors = []; pc.on('pageerror', e => pcErrors.push(e.message)); pc.on('console', m => { if (m.type() === 'error') pcErrors.push(m.text()); });
  await pc.goto(base + '/linea');
  const status = pc.getByRole('region', { name: 'Stato del ponte' });
  const chip = label => status.locator('.line-status-grid > div', { hasText: label });
  await pc.locator('.line-silent', { hasText: 'Ponte non risponde: nessun segnale ricevuto' }).waitFor();
  log('nessun segnale dal ponte: scritta rossa «Ponte non risponde»');
  await beat(null);
  await pc.locator('.line-silent').waitFor({ state: 'detached', timeout: 15_000 });
  await chip('Ponte agganciato').getByText('Nessuna lavorazione').waitFor();
  await chip('LOGO! raggiungibile').getByText('Sì').waitFor();
  assert.match(await chip('Ultimo segnale del ponte').innerText(), /\d{2}:\d{2}:\d{2}\s+\d+ s fa/);
  await post({ type: 'production.start', code, operator: 'Operatore prova', counting: 'device' });
  await pc.getByRole('button', { name: 'Aggiorna' }).click();
  await chip('Ponte agganciato').getByText('No').waitFor();
  const run = (await api()).state.sessions.find(s => s.status === 'active');
  const t0 = Date.now();
  await beat({ id: run.id, cartons: 37 }, { queueLength: 2, plc: { reachable: false, lastReadAt: new Date().toISOString() } });
  await pc.locator('.ipad-count-n', { hasText: '37' }).waitFor({ timeout: 8_000 });
  log(`conteggio dal vivo sul PC del reparto aggiornato in ${((Date.now() - t0) / 1000).toFixed(1)} s (lettura ogni 3 s con lavorazione aperta)`);
  await chip('Ponte agganciato').getByText('Sì').waitFor();
  await chip('LOGO! raggiungibile').getByText('No').waitFor();
  await chip('Eventi in coda').getByText('2').waitFor();
  const head = await pc.locator('.ipad-run-head').innerText();
  for (const v of [run.productCode, run.productName, run.lotCode, run.expiry.split('-').reverse().join('/')]) assert.ok(head.includes(v), `in grande: ${v}`);
  const sizes = await pc.evaluate(() => { const px = s => parseFloat(getComputedStyle(document.querySelector(s)).fontSize); return { count: px('.ipad-count-n'), name: px('.ipad-run-head h1'), lot: px('.ipad-facts dd'), chip: px('.line-status-grid dd') }; });
  assert.ok(sizes.count >= 150 && sizes.name >= 40 && sizes.lot >= 32 && sizes.chip >= 30, 'da leggere a distanza: ' + JSON.stringify(sizes));
  const ink = await pc.evaluate(() => [...document.querySelectorAll('.line-status *, .ipad-run-head *, .ipad-count *')].filter(e => e.childElementCount === 0 && e.textContent.trim() && !e.closest('svg')).map(e => { const s = getComputedStyle(e); return [e.textContent.trim().slice(0, 30), s.color, s.fontWeight]; }).filter(([, c, w]) => !['rgb(0, 0, 0)', 'rgb(255, 255, 255)'].includes(c) || w !== '400'));
  assert.deepEqual(ink, [], 'testo nero o bianco, peso 400');
  await pc.screenshot({ path: `${out}/linea-pc-reparto.png` });
  log('PC del reparto: prodotto, lotto, scadenza e cartoni in grande; agganciato sì, LOGO! no, 2 eventi in coda');
  // iPad: stessa pagina, dimensioni di prima.
  const tablet = await (await wide.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true })).newPage();
  await tablet.goto(base + '/linea'); await tablet.locator('.ipad-count-n', { hasText: '37' }).waitFor({ timeout: 8_000 });
  assert.equal(await tablet.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.ipad-count-n')).fontSize)), 96, 'iPad: numero come prima');
  const smallTablet = await tablet.evaluate(() => [...document.querySelectorAll('button, input')].filter(b => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 44 && b.type !== 'checkbox'; }).length);
  assert.equal(smallTablet, 0, 'iPad: pulsanti di almeno 44 px');
  log('iPad: stato del ponte visibile, numeri e pulsanti come prima');
  // Se è il PC del reparto a non raggiungere più il gestionale, lo stato non resta fermo su «Sì».
  await pc.route('**/api/workspace/live', r => r.abort());
  await pc.locator('.line-silent', { hasText: 'Ponte non risponde da' }).waitFor({ timeout: 45_000 });
  await pc.unroute('**/api/workspace/live');
  await beat({ id: run.id, cartons: 37 });
  await pc.locator('.line-silent').waitFor({ state: 'detached', timeout: 15_000 });
  log('PC senza collegamento al gestionale: dopo 30 s «Ponte non risponde», poi torna normale');
  // Chiusura dal pulsante: come il ponte vero, prima il segnale di stato senza lavorazione, poi la chiusura.
  // La pagina rilegge subito e di nuovo dopo 4 s, senza aspettare il giro di 15 s.
  await beat(null);
  const t1 = Date.now();
  await new Promise(r => setTimeout(r, 1_500));
  await toBridge({ eventId: 'evt_linea_reparto_1', type: 'session.close', sessionId: run.id, closeRequestId: 'req_linea_reparto_1', counterStart: 1000, counterEnd: 1037, cartons: 37, closedAt: new Date().toISOString(), anomalies: [] });
  await pc.getByText('Etichetta del prodotto').waitFor({ timeout: 9_000 });
  log(`chiusura dal ponte vista sul PC del reparto in ${((Date.now() - t1) / 1000).toFixed(1)} s`);
  // 8. «Chiusura ricevuta» fissa: ora, cartoni, lotto, carico; resta dopo un ricaricamento, sparisce al prossimo avvio.
  const card = pc.getByRole('region', { name: 'Ultima chiusura' });
  const hhmm = new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' });
  await card.getByText(new RegExp(`Ultima chiusura: ore \\d{2}:\\d{2} – 37 cartoni – lotto ${run.lotCode}`)).waitFor();
  await card.getByText(`Carico a magazzino fatto: 37 CRT nel lotto ${run.lotCode} in Cella frigo.`).waitFor();
  assert.equal(await pc.getByText('Chiusa dal contapezzi').count(), 0, 'nessun avviso che sparisce');
  await pc.waitForTimeout(4_500);
  await pc.reload(); await card.getByText('Carico a magazzino fatto').waitFor();
  const shown = (await card.locator('h2').innerText()).match(/ore (\d{2}:\d{2})/)[1];
  assert.ok([0, 1, 2].map(m => hhmm.format(new Date(Date.now() - m * 60_000))).includes(shown), 'ora della chiusura: ' + shown);
  await pc.screenshot({ path: `${out}/linea-ultima-chiusura.png` });
  log('ultima chiusura fissa: ore, 37 cartoni, lotto, carico fatto; resta dopo il ricaricamento');
  // Carico non eseguito: scritto in rosso (bianco su rosso pieno) con cosa fare.
  await post({ type: 'settings.update', settings: { autoLoad: false } });
  await post({ type: 'production.start', code, operator: 'Operatore prova', counting: 'device' });
  await pc.getByRole('button', { name: 'Aggiorna' }).click();
  await card.waitFor({ state: 'detached' });
  log('il riquadro sparisce quando parte la lavorazione successiva');
  const run2 = (await api()).state.sessions.find(s => s.status === 'active');
  await toBridge({ eventId: 'evt_linea_reparto_2', type: 'session.close', sessionId: run2.id, closeRequestId: 'req_linea_reparto_2', counterStart: 1037, counterEnd: 1049, cartons: 12, closedAt: new Date().toISOString(), anomalies: [] });
  await pc.getByRole('button', { name: 'Aggiorna' }).click();
  const bad = card.locator('.line-load.bad', { hasText: 'Carico a magazzino NON fatto: carico automatico disattivato.' });
  await bad.waitFor();
  await card.getByText(new RegExp(`Avvisa l’amministrazione: registrare a mano l’entrata di 12 CRT nel lotto ${run2.lotCode}, scadenza \\d{2}/\\d{2}/\\d{4}`)).waitFor();
  const badInk = await bad.evaluate(e => { const s = getComputedStyle(e); return [s.color, s.backgroundColor, s.fontWeight]; });
  assert.deepEqual(badInk, ['rgb(255, 255, 255)', 'rgb(138, 31, 18)', '400'], 'scritta bianca su rosso pieno, peso 400');
  const cardInk = await pc.evaluate(() => [...document.querySelectorAll('.line-last-close *')].filter(e => e.childElementCount === 0 && e.textContent.trim() && !e.closest('svg')).map(e => { const s = getComputedStyle(e); return [e.textContent.trim().slice(0, 30), s.color, s.fontWeight]; }).filter(([, c, w]) => !['rgb(0, 0, 0)', 'rgb(255, 255, 255)'].includes(c) || w !== '400'));
  assert.deepEqual(cardInk, [], 'riquadro: testo nero o bianco, peso 400');
  await pc.screenshot({ path: `${out}/linea-carico-non-fatto.png` });
  log('carico non eseguito: in rosso con cosa fare');
  await post({ type: 'settings.update', settings: { autoLoad: true } });
  assert.deepEqual(pcErrors.filter(e => !/Failed to load resource|net::/.test(e)), [], 'nessun errore nella pagina');
  await wide.close();
  await fetch(base + '/api/devices', { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ op: 'revoke', id: created.device.id }) });
}
console.log('APP LINEA SUPERATA');

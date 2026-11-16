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
// tesseract logs a missing optional word list («ita.special-words») it does not need: not an error of the app.
assert.deepEqual(errors.filter(e => !/Failed to load resource|net::|special-words/.test(e)), [], 'no runtime errors');
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
console.log('APP LINEA SUPERATA');

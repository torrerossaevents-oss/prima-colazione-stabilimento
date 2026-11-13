/**
 * Browser walk-through on a LOCAL preview with an empty test database (fictitious data only).
 * Usage: npm run dev (other terminal), then: node tests/ui/smoke.mjs http://localhost:5173 [outDir]
 * Requires Playwright with Chromium available to Node. Not part of `npm test`.
 */
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] || 'http://localhost:5173';
const out = process.argv[3] || 'ui-smoke-output';
mkdirSync(out, { recursive: true });
const log = (...a) => console.log('✓', ...a);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
const api = async () => (await (await fetch(base + '/api/workspace')).json());
const dialog = () => page.getByRole('dialog');

await page.goto(base + '/#overview'); await page.getByText('Archivio connesso').first().waitFor();
assert.equal((await api()).version, 0, 'test database must start empty');
log('panoramica vuota caricata');

// Scenario 1: create 00123, progressive search, edit.
await page.goto(base + '/#inventory'); await page.getByRole('button', { name: 'Nuovo prodotto' }).first().click();
await dialog().getByLabel('Codice articolo *').fill('00123');
await dialog().getByLabel('Descrizione *').fill('Cornetto fittizio di prova');
await dialog().getByLabel('Unità di misura *').fill('CRT');
const upb = dialog().getByLabel('Unità per cartone *'); if (await upb.isEditable()) await upb.fill('1');
await dialog().getByRole('button', { name: 'Crea prodotto' }).click();
await page.getByRole('status').filter({ hasText: /salvat|creat/i }).first().waitFor();
const search = page.getByLabel('Cerca prodotti per codice, descrizione o lotto');
await search.fill('001'); await page.getByText('Cornetto fittizio di prova').first().waitFor();
await search.fill('cornetto fitt'); await page.getByText('00123').first().waitFor();
log('prodotto 00123 creato e trovato con ricerca progressiva per codice e descrizione');
let s = await api(); assert.equal(s.state.products[0].code, '00123'); assert.equal(s.state.lots.length, 0);
const pid = s.state.products[0].id;

// Receive 150 via the lots tab.
await page.getByRole('tab', { name: /Giacenze e lotti/ }).click();
await page.getByRole('button', { name: 'Registra entrata' }).first().click();
await dialog().locator('select[name=productId]').selectOption(pid);
await dialog().getByLabel('Lotto').fill('LOT-PROVA-1'); await dialog().getByLabel('Scadenza').fill('2099-12-31');
await dialog().getByLabel('Ubicazione').fill('Area A'); await dialog().getByLabel('Quantità effettiva').fill('150');
await dialog().getByRole('button', { name: 'Conferma e salva' }).click(); await dialog().waitFor({ state: 'detached' });
await page.getByRole('button', { name: 'Blocco' }).first().click();
await dialog().getByLabel('Quantità totale da tenere bloccata').fill('2'); await dialog().getByRole('button', { name: 'Conferma e salva' }).click(); await dialog().waitFor({ state: 'detached' });
log('entrata 150 e blocco 2 registrati');

// Scenario 4 in the UI: order 30 → 118 available; prepare; partial 20 with reason; cancel; invoice.
await page.goto(base + '/#orders'); await page.getByRole('button', { name: 'Nuovo ordine' }).first().click();
await dialog().getByLabel('Cliente / destinatario').fill('Cliente fittizio'); await dialog().getByLabel('Destinazione').fill('Destinazione fittizia');
await dialog().locator('select').first().selectOption({ index: 1 }); await dialog().getByLabel('Quantità da prenotare').fill('30');
await dialog().getByRole('button', { name: 'Conferma e prenota' }).click(); await dialog().waitFor({ state: 'detached' });
s = await api(); const lotId = s.state.lots[0].id;
await page.getByRole('button', { name: 'Segna pronto' }).click(); await page.getByRole('button', { name: 'Registra partenza' }).waitFor();
await page.getByRole('button', { name: 'Registra partenza' }).click();
await dialog().locator(`input[name="qty-${lotId}"]`).fill('20'); await dialog().getByLabel('Riferimento DDT / documento di partenza').fill('DDT fittizio 1');
await dialog().getByRole('checkbox').check();
await dialog().getByRole('button', { name: 'Conferma e salva' }).click();
await dialog().getByRole('alert').filter({ hasText: /motivo/i }).waitFor();
assert.equal(await dialog().getByLabel('Riferimento DDT / documento di partenza').inputValue(), 'DDT fittizio 1', 'form data kept after a validation error');
log('consegna parziale senza motivo rifiutata dal server, dati del modulo conservati');
await dialog().getByLabel('Motivo della differenza').fill('Residuo al prossimo giro');
await dialog().getByRole('button', { name: 'Conferma e salva' }).click(); await dialog().waitFor({ state: 'detached' });
s = await api(); assert.equal(s.state.lots[0].quantity, 130);
await page.getByRole('button', { name: 'Annulla residuo' }).click(); await dialog().getByRole('button', { name: 'Conferma e salva' }).click(); await dialog().waitFor({ state: 'detached' });
await page.getByRole('tab', { name: 'Completati e annullati' }).click().catch(() => page.getByRole('button', { name: 'Completati e annullati' }).click());
await page.getByRole('button', { name: 'Collega documento' }).click(); await dialog().getByLabel('Riferimento del documento').fill('Fattura fittizia 9');
await dialog().getByRole('button', { name: 'Conferma e salva' }).click(); await dialog().waitFor({ state: 'detached' });
s = await api(); assert.equal(s.state.lots[0].quantity, 130);
await page.goto(base + '/#inventory'); await page.getByRole('tab', { name: /Giacenze e lotti/ }).click();
const row = page.locator('tr', { hasText: 'LOT-PROVA-1' }); await row.waitFor();
const cells = await row.locator('td').allInnerTexts();
assert.match(cells[3], /130/); assert.match(cells[6], /^128/);
log('scenario 4 nell’interfaccia: presenti 130, disponibili 128 dopo annullamento e fattura senza nuovo scarico');

// Network loss during a save: no false confirmation, uncertain state, same-id recovery.
await page.locator('summary[aria-label^="Altre operazioni sul lotto"]').first().click(); await page.getByRole('button', { name: 'Rettifica' }).first().click();
await dialog().getByLabel('Variazione di quantità').fill('-1'); await dialog().getByLabel('Responsabile della verifica').fill('Responsabile prova');
await dialog().getByLabel('Motivo della rettifica').fill('Riconto di prova'); await dialog().getByRole('checkbox').check();
await page.route('**/api/workspace', r => r.request().method() === 'POST' ? r.abort('connectionreset') : r.continue());
await dialog().getByRole('button', { name: 'Conferma e salva' }).click();
await page.getByText('Da verificare').first().waitFor();
assert.equal(await dialog().getByLabel('Motivo della rettifica').inputValue(), 'Riconto di prova');
await page.unroute('**/api/workspace');
await dialog().getByRole('button', { name: 'Conferma e salva' }).click(); await dialog().waitFor({ state: 'detached' });
s = await api(); assert.equal(s.state.lots[0].quantity, 129);
log('connessione persa: stato «Da verificare», modulo conservato, ripetizione con lo stesso id salvata una volta');
// Expired platform session: a 200 HTML login page must never count as «saved».
await page.locator('summary[aria-label^="Altre operazioni sul lotto"]').first().click(); await page.getByRole('button', { name: 'Rettifica' }).first().click();
await dialog().getByLabel('Variazione di quantità').fill('-1'); await dialog().getByLabel('Responsabile della verifica').fill('Responsabile prova');
await dialog().getByLabel('Motivo della rettifica').fill('Pagina di accesso'); await dialog().getByRole('checkbox').check();
await page.route('**/api/workspace', r => r.request().method() === 'POST' ? r.fulfill({ status: 200, contentType: 'text/html', body: '<html>Accedi</html>' }) : r.continue());
await dialog().getByRole('button', { name: 'Conferma e salva' }).click();
await page.getByText('Da verificare').first().waitFor();
assert.equal(await page.getByText(/^Salvato alle/).count(), 0, 'no false «saved»');
await page.unroute('**/api/workspace');
await dialog().getByRole('button', { name: 'Indietro' }).click();
page.once('dialog', d => d.accept());
await page.getByRole('button', { name: 'Scarta' }).click();
await page.getByText('Operazione scartata').waitFor();
s = await api(); assert.equal(s.state.lots[0].quantity, 129, 'nothing saved by the HTML answer nor after «Scarta»');
log('risposta 200 in HTML (accesso scaduto): nessun falso «Salvato»; «Scarta» annulla l’identificativo sul server');
// Lost response after commit: the server saves, the browser never sees the answer.
await page.locator('summary[aria-label^="Altre operazioni sul lotto"]').first().click(); await page.getByRole('button', { name: 'Rettifica' }).first().click();
await dialog().getByLabel('Variazione di quantità').fill('-1'); await dialog().getByLabel('Responsabile della verifica').fill('Responsabile prova');
await dialog().getByLabel('Motivo della rettifica').fill('Risposta persa'); await dialog().getByRole('checkbox').check();
await page.route('**/api/workspace', async r => { if (r.request().method() !== 'POST') return r.continue(); await r.fetch(); await r.abort('timedout'); });
await dialog().getByRole('button', { name: 'Conferma e salva' }).click(); await page.getByText('Da verificare').first().waitFor();
await page.unroute('**/api/workspace');
await page.reload(); await page.getByText('Un’operazione è da verificare').or(page.getByText('risulta già salvata')).first().waitFor();
await page.getByText('risulta già salvata').waitFor({ timeout: 10000 });
s = await api(); assert.equal(s.state.lots[0].quantity, 128, 'saved exactly once');
log('risposta persa dopo il salvataggio: dopo ricarica la ricevuta del server conferma, nessun doppione');

// Scrap from blocked stock.
await page.goto(base + '/#inventory'); await page.getByRole('tab', { name: /Giacenze e lotti/ }).click();
await page.locator('summary[aria-label^="Altre operazioni sul lotto"]').first().click(); await page.getByRole('button', { name: 'Scarto' }).first().click();
await dialog().getByLabel('Quantità scartata').fill('2'); await dialog().getByLabel('Responsabile').fill('Responsabile prova'); await dialog().getByLabel('Motivo').fill('Cartoni danneggiati');
await dialog().getByRole('button', { name: 'Conferma e salva' }).click(); await dialog().waitFor({ state: 'detached' });
s = await api(); assert.equal(s.state.lots[0].quantity, 126); assert.equal(s.state.lots[0].blocked, 0);
await page.getByLabel('Cerca in magazzino').fill('LOT-PROVA'); await row.waitFor();
log('scarto dalla quantità bloccata e ricerca per lotto');

// Scenario 7 in the UI: A 200 closes, unknown code refused, B starts from zero.
await page.goto(base + '/#production'); await page.getByRole('button', { name: 'Nuova lavorazione' }).first().click();
await dialog().getByRole('button', { name: 'Usa fotocamera' }).click();
await dialog().getByText(/non è supportata|Fotocamera non disponibile|Permission|denied/i).first().waitFor();
log('fotocamera non supportata o negata: messaggio chiaro, inserimento con lettore/tastiera disponibile');
await dialog().getByPlaceholder('Codice dell’etichetta').fill('99999');
await dialog().getByText('Codice non presente nel catalogo').waitFor();
assert.equal(await dialog().getByRole('button', { name: 'Conferma e avvia' }).isDisabled(), true);
await dialog().getByPlaceholder('Codice dell’etichetta').fill('00123');
await dialog().getByText('Codice esatto 00123').waitFor();
await dialog().getByLabel('Operatore').fill('Operatore prova'); await dialog().getByLabel('Lotto di produzione').fill('PROD-A'); await dialog().locator('input[name=expiry]').fill('2099-12-31');
await dialog().getByRole('button', { name: 'Conferma e avvia' }).click(); await dialog().waitFor({ state: 'detached' });
await page.getByRole('button', { name: 'Aggiungi cartoni' }).click(); await dialog().getByLabel('Cartoni da aggiungere').fill('200');
await dialog().getByRole('button', { name: 'Conferma e salva' }).click(); await dialog().waitFor({ state: 'detached' });
await page.getByRole('button', { name: 'Chiudi / salva lavorazione' }).click(); await dialog().getByRole('checkbox').check();
await dialog().getByRole('button', { name: 'Salva lavorazione' }).click(); await dialog().waitFor({ state: 'detached' });
await page.locator('tr', { hasText: 'PROD-A' }).first().waitFor();
const daySheet = page.locator('#produzione-del-giorno');
await daySheet.getByText('Confermata alle').first().waitFor();
const sheetText = await daySheet.innerText();
assert.match(sheetText, /Cartoni confermati\s+200/); assert.match(sheetText, /Totale giorno\s+1\s+200/);
s = await api(); assert.equal(s.state.sessions[0].cartons, 200); assert.equal(s.state.lots.length, 1, 'no stock created by production');
log('lavorazione 200 cartoni chiusa: scheda «Produzione del giorno» con orario di conferma e totale del giorno, nessun carico di magazzino');
await page.screenshot({ path: `${out}/produzione-desktop.png`, fullPage: true });

// Global search: Ctrl K, find the lot, open it in the stock list.
await page.keyboard.press('Control+k'); await page.locator('[cmdk-input]').fill('LOT-PROVA');
await page.keyboard.press('Enter'); await page.locator('tr', { hasText: 'LOT-PROVA-1' }).first().waitFor();
log('ricerca globale (Ctrl K): trova il lotto e apre la giacenza filtrata');

// History search and settings.
await page.goto(base + '/#history'); await page.getByLabel('Cerca nello storico').fill('Riconto di prova'); await page.getByText('Riconto di prova').first().waitFor();
await page.goto(base + '/#settings'); await page.getByRole('heading', { name: 'Backup completo' }).waitFor(); await page.getByRole('heading', { name: 'Dispositivi del conta-cartoni' }).waitFor();
log('storico con ricerca e pagina Configurazione con backup e dispositivi');

// Typography rule and layout at three widths.
const sizes = { telefono: { width: 390, height: 844 }, tablet: { width: 820, height: 1180 }, desktop: { width: 1440, height: 900 } };
for (const [label, viewport] of Object.entries(sizes)) {
  await page.setViewportSize(viewport);
  for (const view of ['overview', 'inventory', 'production', 'orders', 'history', 'settings']) {
    await page.goto(base + '/#' + view); await page.waitForTimeout(250);
    const report = await page.evaluate(() => {
      const bad = []; const overflow = document.documentElement.scrollWidth > window.innerWidth + 1;
      const isDark = c => { const m = c.match(/\d+(\.\d+)?/g); if (!m) return false; const [r, g, b, a = 1] = m.map(Number); return a > 0.5 && (0.299 * r + 0.587 * g + 0.114 * b) < 128; };
      const bgOf = el => { for (let e = el; e; e = e.parentElement) { const bg = getComputedStyle(e).backgroundColor; if (bg && !bg.endsWith(', 0)') && bg !== 'transparent') return bg; } return 'rgb(255, 255, 255)'; };
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const seen = new Set();
      while (walker.nextNode()) {
        const el = walker.currentNode.parentElement; if (!el || seen.has(el) || !walker.currentNode.textContent.trim()) continue; seen.add(el);
        const st = getComputedStyle(el); if (st.visibility === 'hidden' || st.display === 'none' || el.closest('svg')) continue;
        const dark = isDark(bgOf(el)); const color = st.color;
        const okColor = dark ? color === 'rgb(255, 255, 255)' : color === 'rgb(0, 0, 0)';
        if (st.fontWeight !== '400' || !okColor) bad.push(`${el.tagName.toLowerCase()}.${el.className} «${walker.currentNode.textContent.trim().slice(0, 30)}» ${color} w${st.fontWeight} su ${dark ? 'scuro' : 'chiaro'}`);
      }
      const small = [...document.querySelectorAll('button, a.button')].filter(b => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 34; }).map(b => (b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 30));
      return { overflow, bad: bad.slice(0, 8), badCount: bad.length, small: small.slice(0, 6) };
    });
    if (report.overflow || report.badCount || report.small.length) console.log('!', label, view, JSON.stringify(report));
  }
  await page.goto(base + '/#inventory'); await page.screenshot({ path: `${out}/magazzino-${label}.png`, fullPage: false });
}
log('controllo tipografia, larghezza e altezza pulsanti eseguito su telefono, tablet e desktop');
assert.deepEqual(errors.filter(e => !/Failed to load resource|ERR_CONNECTION_RESET|ERR_TIMED_OUT|net::/.test(e)), [], 'no runtime errors');
await browser.close();
console.log('UI SMOKE SUPERATO');

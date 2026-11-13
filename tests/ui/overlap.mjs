/**
 * Layout check on a local preview: finds visible text boxes that overlap each other
 * or are clipped by their container, on every view and several widths.
 * Usage: node tests/ui/overlap.mjs http://localhost:5173
 */
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const base = process.argv[2] || 'http://localhost:5173';
const widths = (process.argv[3] || '390,820,1024,1280,1440').split(',').map(Number);
const browser = await chromium.launch();
let problems = 0;
for (const width of widths) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  for (const view of ['overview', 'inventory', 'inventory-lots', 'production', 'orders', 'history', 'settings', 'edit-product']) {
    await page.goto(base + '/#' + (view.startsWith('inventory') || view === 'edit-product' ? 'inventory' : view));
    await page.locator('.site-status').filter({ hasText: 'Archivio connesso' }).first().waitFor({ state: 'attached' });
    if (view === 'inventory-lots') await page.getByRole('tab', { name: /Giacenze/ }).click();
    if (view === 'edit-product') { await page.getByRole('tab', { name: /Prodotti/ }).click(); await page.getByRole('button', { name: /^Modifica prodotto/ }).first().click(); }
    if (view === 'inventory') await page.getByRole('tab', { name: /Prodotti/ }).click();
    await page.waitForTimeout(350);
    const found = await page.evaluate(() => {
      const root = document.querySelector('[role=dialog]') ?? document.body;
      const nodes = []; const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const t = walker.currentNode; if (!t.textContent.trim()) continue;
        const el = t.parentElement; if (!el || el.closest('.sr-only, svg, option, datalist, [aria-hidden=true], details:not([open]) > div')) continue;
        const st = getComputedStyle(el); if (st.visibility === 'hidden' || st.display === 'none') continue;
        const range = document.createRange(); range.selectNodeContents(t);
        // Clip each text box to its scrolling/overflow ancestors: what is scrolled away is not painted.
        const clips = []; for (let e = el; e && e !== document.body; e = e.parentElement) { const o = getComputedStyle(e); if (o.overflowX !== 'visible' || o.overflowY !== 'visible') clips.push(e.getBoundingClientRect()); }
        for (const raw of range.getClientRects()) { let r = { left: raw.left, right: raw.right, top: raw.top, bottom: raw.bottom }; for (const c of clips) r = { left: Math.max(r.left, c.left), right: Math.min(r.right, c.right), top: Math.max(r.top, c.top), bottom: Math.min(r.bottom, c.bottom) }; if (r.right - r.left > 1 && r.bottom - r.top > 1) nodes.push({ el, r, text: t.textContent.trim().slice(0, 32) }); }
      }
      const out = [];
      for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j]; if (a.el === b.el) continue;
        const x = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left), y = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
        if (x > 2 && y > 3) out.push(`sovrapposti: «${a.text}» / «${b.text}»`);
      }
      for (const { el, text } of nodes) { const box = el.getBoundingClientRect(); if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow === 'hidden' && getComputedStyle(el).textOverflow !== 'ellipsis' && box.width > 0) out.push(`tagliato: «${text}»`); }
      return [...new Set(out)].slice(0, 12);
    });
    if (found.length) { problems += found.length; console.log(`! ${width}px ${view}:\n  ` + found.join('\n  ')); }
  }
  await page.close();
}
await browser.close();
console.log(problems ? `${problems} problemi di impaginazione` : 'Nessuna scritta sovrapposta o tagliata');
process.exitCode = problems ? 1 : 0;

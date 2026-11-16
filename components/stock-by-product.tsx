"use client";
/**
 * Giacenza per prodotto: un totale unico per articolo; un clic apre i suoi lotti in ordine di scadenza
 * (FEFO), con evidenziato quello che esce per primo negli ordini. Stessi filtri della vista per lotto.
 */
import { Fragment, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { Lot, Product } from '../lib/domain';

type LotInfo = { reserved: number; available: number };
const n = (v: number) => new Intl.NumberFormat('it-IT').format(v);
const itDate = (d: string) => d ? d.split('-').reverse().join('/') : '—';

export default function StockByProduct({ lots, product, lotInfo, today, soonDays = 7 }: { lots: Lot[]; product: (id: string) => Product | undefined; lotInfo: (lotId: string) => LotInfo; today: string; soonDays?: number }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const soon = (() => { const d = new Date(today + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + soonDays); return d.toISOString().slice(0, 10); })();
  const groups = new Map<string, Lot[]>();
  for (const l of lots) groups.set(l.productId, [...(groups.get(l.productId) ?? []), l]);
  const rows = [...groups.entries()].map(([productId, list]) => {
    const sorted = [...list].sort((a, b) => (a.expiry || '9999').localeCompare(b.expiry || '9999') || a.code.localeCompare(b.code));
    const sum = (k: keyof LotInfo) => sorted.reduce((t, l) => t + lotInfo(l.id)[k], 0);
    const first = sorted.find(l => lotInfo(l.id).available > 0 && !(l.expiry && l.expiry < today));
    return { p: product(productId), productId, sorted, present: sorted.reduce((t, l) => t + l.quantity, 0), reserved: sum('reserved'), blocked: sorted.reduce((t, l) => t + l.blocked, 0), available: sum('available'), first, next: sorted.find(l => l.expiry && l.expiry >= today)?.expiry };
  }).sort((a, b) => (a.p?.code ?? '').localeCompare(b.p?.code ?? ''));
  const toggle = (id: string) => setOpen(s => { const next = new Set(s); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  return <div className="table-wrap"><table className="data-table stock-table">
    <caption className="sr-only">Giacenza per prodotto, con i lotti in ordine di scadenza</caption>
    <thead><tr><th>Prodotto</th><th className="num">Presenti</th><th className="num">Prenotati</th><th className="num">Disponibili</th><th className="num">Lotti</th><th>Prossima scadenza</th></tr></thead>
    <tbody>{rows.map(r => { const isOpen = open.has(r.productId); const u = r.p?.unit ?? ''; return <Fragment key={r.productId}>
      <tr className={'stock-row' + (isOpen ? ' open' : '')}>
        <td><button className="stock-toggle" aria-expanded={isOpen} onClick={() => toggle(r.productId)}>{isOpen ? <ChevronDown size={18} aria-hidden="true"/> : <ChevronRight size={18} aria-hidden="true"/>}<span>{r.p?.code} · {r.p?.name}</span></button></td>
        <td className="num nowrap" data-label="Presenti">{n(r.present)} {u}</td>
        <td className="num nowrap" data-label="Prenotati">{n(r.reserved)} {u}</td>
        <td className="num nowrap" data-label="Disponibili">{n(r.available)} {u}</td>
        <td className="num" data-label="Lotti">{r.sorted.length}</td>
        <td className="nowrap" data-label="Prossima scadenza">{r.next ? itDate(r.next) : '—'}</td>
      </tr>
      {isOpen && <tr className="stock-lots"><td colSpan={6}><ol className="stock-lot-list" aria-label={`Lotti di ${r.p?.code}, prima quelli che scadono prima`}>{r.sorted.map(l => { const info = lotInfo(l.id); const expired = !!l.expiry && l.expiry < today; return <li key={l.id} className={l.id === r.first?.id ? 'first' : expired ? 'expired' : ''}>
        <span className="stock-lot-code">Lotto {l.code}{l.id === r.first?.id && <span className="chip green">esce per primo</span>}{expired && <span className="chip red">scaduto</span>}{!expired && l.expiry && l.expiry <= soon && <span className="chip amber">in scadenza</span>}</span>
        <span>Scadenza {itDate(l.expiry)}</span><span>{l.area}</span>
        <span>Presenti {n(l.quantity)} {u}</span><span>Prenotati {n(info.reserved)}</span>{l.blocked > 0 && <span>Bloccati {n(l.blocked)}</span>}<span>Disponibili {n(info.available)} {u}</span>
      </li>; })}</ol></td></tr>}
    </Fragment>; })}</tbody>
  </table></div>;
}

"use client";
/**
 * «Produzione del giorno»: what was produced on a chosen day, in which order and how much.
 * Flow = sessions by start time (Europe/Rome day of the start); the same article may appear
 * several times and is numbered (1ª, 2ª…); totals per article and for the whole day.
 */
import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Download, Printer, RefreshCw } from 'lucide-react';
import { addDays, productionDay, type Session } from '../lib/domain';
import { describeError, request } from '../lib/client-api';

const n = (v: number) => new Intl.NumberFormat('it-IT').format(v);
const time = (v: string) => new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' }).format(new Date(v));
const longDay = (d: string) => new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Rome' }).format(new Date(d + 'T12:00:00Z'));
const ordinal = (k: number) => `${k}ª`;
const csvCell = (v: unknown) => '"' + String(v ?? '').replaceAll('"', '""').replace(/^[=+\-@\t\r]/, "'$&") + '"';

export default function ProductionDay({ sessions, today, archivedCount, onExport }: { sessions: Session[]; today: string; archivedCount: number; onExport: (name: string, content: string, type: string) => void }) {
  const [day, setDay] = useState(today);
  const [archived, setArchived] = useState<Session[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // Closed sessions older than 30 days live in the archive: read that day only when needed.
  const needsArchive = archivedCount > 0 && day < addDays(today, -30);
  useEffect(() => {
    if (!needsArchive) return;
    let live = true;
    queueMicrotask(() => { if (live) { setLoading(true); setError(''); } });
    (async () => {
      const res = await request(`/api/workspace/archive?kind=session&from=${day}&to=${day}&limit=500`);
      const data = await res.json() as { items?: Session[]; error?: string };
      if (!res.ok) throw new Error(data.error || 'Archivio non disponibile.');
      if (live) setArchived(data.items ?? []);
    })().catch(e => { if (live) setError(describeError(e, 'Archivio non disponibile.')); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [needsArchive, day]);
  const sheet = useMemo(() => { const all = new Map([...(needsArchive ? archived : []), ...sessions].map(s => [s.id, s])); return productionDay([...all.values()], day); }, [archived, needsArchive, sessions, day]);
  const { flow, byProduct, totals } = sheet;

  function exportCsv() {
    const head = ['Giorno (avvio, Europe/Rome)', 'Avvio', 'Chiusura', 'Codice', 'Articolo', 'Lavorazione dell’articolo', 'Lotto', 'Operatore', 'Stato', 'Cartoni', 'Cartoni scartati', 'Unità per cartone', 'Unità', 'Unità di misura'];
    const rows = flow.map(r => [day, time(r.startedAt), r.closedAt ? time(r.closedAt) : '', r.productCode, r.productName, `${r.runOfProduct} di ${r.runsOfProduct}`, r.lotCode, r.operator, r.status === 'closed' ? 'Confermata' : 'In corso', r.cartons, r.scrapCartons, r.unitsPerBox, r.cartons * r.unitsPerBox, r.unit]);
    const sums = byProduct.map(p => ['Totale articolo', '', '', p.productCode, p.productName, `${p.runs} lavorazioni`, p.lots.join(' '), '', '', p.confirmedCartons, p.scrapCartons, p.unitsPerBox, p.confirmedCartons * p.unitsPerBox, p.unit]);
    const total = [['Totale giorno (cartoni confermati)', '', '', '', '', `${totals.runs} lavorazioni`, '', '', '', totals.confirmedCartons, totals.scrapCartons, '', '', 'cartoni']];
    onExport(`prima-colazione-produzione-${day}.csv`, '﻿' + [head, ...rows, [], ...sums, ...total].map(r => r.map(csvCell).join(';')).join('\r\n'), 'text/csv;charset=utf-8');
  }
  function print() {
    document.body.classList.add('printing-day');
    const done = () => { document.body.classList.remove('printing-day'); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    window.print();
  }

  return <section className="panel production-day" id="produzione-del-giorno" aria-labelledby="day-title">
    <div className="day-head">
      <div><h2 id="day-title">Produzione del giorno</h2><p className="day-date">{longDay(day)}{day === today ? ' (oggi)' : ''}</p></div>
      <div className="day-nav">
        <button className="icon-button" aria-label="Giorno precedente" onClick={() => setDay(addDays(day, -1))}><ChevronLeft size={18}/></button>
        <label className="day-picker"><CalendarDays size={16} aria-hidden="true"/><span className="sr-only">Scegli il giorno</span><input type="date" value={day} max={today} onChange={e => e.target.value && setDay(e.target.value)}/></label>
        <button className="icon-button" aria-label="Giorno successivo" disabled={day >= today} onClick={() => setDay(addDays(day, 1))}><ChevronRight size={18}/></button>
        {day !== today && <button className="button ghost small" onClick={() => setDay(today)}>Oggi</button>}
        <button className="button secondary small" disabled={!flow.length} onClick={print}><Printer size={15}/>Stampa</button>
        <button className="button secondary small" disabled={!flow.length} onClick={exportCsv}><Download size={15}/>Esporta CSV</button>
      </div>
    </div>
    <div className="day-totals" role="group" aria-label="Totali del giorno">
      <div><span>Cartoni confermati</span><b>{n(totals.confirmedCartons)}</b></div>
      <div><span>Lavorazioni</span><b>{n(totals.runs)}</b></div>
      <div><span>Articoli diversi</span><b>{n(totals.products)}</b>{totals.repeated > 0 && <small>{totals.repeated} {totals.repeated === 1 ? 'prodotto più volte' : 'prodotti più volte'}</small>}</div>
      <div><span>In corso, non definitivi</span><b>{n(totals.activeCartons)}</b></div>
      <div><span>Cartoni scartati</span><b>{n(totals.scrapCartons)}</b></div>
    </div>
    {loading && <p className="panel-body" role="status"><RefreshCw size={14} className="spin"/> Lettura dell’archivio…</p>}
    {error && <div role="alert" className="alert-error" style={{ margin: 16 }}>{error}</div>}
    {!loading && !flow.length ? <div className="empty-state"><h3>Nessuna lavorazione in questo giorno</h3><p>Scegli un altro giorno con le frecce o il calendario. Il giorno di una lavorazione è quello in cui è stata avviata.</p></div> : <div className="day-body">
      <div className="day-flow">
        <h3>Flusso della giornata</h3>
        <ol className="flow-list">
          {flow.map(r => <li key={r.id} className={'flow-run ' + (r.status === 'active' ? 'active' : r.toVerify ? 'verify' : 'done')}>
            <span className="flow-time"><b>{time(r.startedAt)}</b><small>{r.closedAt ? `→ ${time(r.closedAt)}` : 'in corso'}</small></span>
            <span className="flow-dot" aria-hidden="true"/>
            <span className="flow-main">
              <b><span className="flow-code">{r.productCode}</span>{r.productName}</b>
              <small>Lotto {r.lotCode}, operatore {r.operator}{r.source === 'device' ? ', conteggio da fotocellule' : ''}</small>
              <span className="flow-tags">
                {r.status === 'closed' ? <span className="chip green">{r.closedAt ? `Confermata alle ${time(r.closedAt)}` : 'Confermata'}</span> : <span className="chip blue">In corso</span>}
                {r.runsOfProduct > 1 && <span className="chip amber">{ordinal(r.runOfProduct)} lavorazione di {r.runsOfProduct} dello stesso articolo</span>}
                {r.toVerify && <span className="chip red">Da verificare</span>}
              </span>
            </span>
            <span className="flow-qty"><b>{n(r.cartons)}</b><small>cartoni</small>{r.scrapCartons > 0 && <small>{n(r.scrapCartons)} scartati</small>}</span>
          </li>)}
        </ol>
      </div>
      <div className="day-products">
        <h3>Totale per articolo</h3>
        <table className="data-table day-table">
          <caption className="sr-only">Cartoni confermati per articolo nel giorno scelto</caption>
          <thead><tr><th>Articolo</th><th className="num">Volte</th><th className="num">Cartoni</th><th className="num">Unità</th></tr></thead>
          <tbody>{byProduct.map(p => <tr key={p.productId}><td><b>{p.productName}</b><span className="cell-sub">{p.productCode}, lott{p.lots.length === 1 ? 'o' : 'i'} {p.lots.map((l, i) => <span key={l} className="nowrap">{l}{i < p.lots.length - 1 ? ', ' : ''}</span>)}</span><span className="cell-sub day-units-inline">{n(p.confirmedCartons * p.unitsPerBox)} {p.unit}</span></td><td className="num">{p.runs > 1 ? <span className="chip amber plain">{p.runs} volte</span> : '1'}</td><td className="num">{n(p.confirmedCartons)}{p.activeCartons > 0 && <small className="cell-sub">+{n(p.activeCartons)} in corso</small>}</td><td className="num">{n(p.confirmedCartons * p.unitsPerBox)} <small>{p.unit}</small></td></tr>)}</tbody>
          <tfoot><tr><td>Totale giorno</td><td className="num">{n(totals.runs)}</td><td className="num">{n(totals.confirmedCartons)}</td><td className="num"><small>per articolo</small></td></tr></tfoot>
        </table>
        <p className="form-help">I cartoni si sommano su tutti gli articoli. Le unità di misura sono diverse da articolo ad articolo: il loro totale resta per riga. Nessun carico automatico a magazzino.</p>
      </div>
    </div>}
  </section>;
}

"use client";
/**
 * Ordini: le fasi in alto (Da preparare → Pronti alla partenza → Consegne parziali → Completati),
 * ogni ordine con i passaggi, le righe (richiesto / partito / da consegnare) e il prossimo passo
 * con il pulsante giusto. Le regole restano quelle del dominio: prenotare non scarica, la partenza
 * con DDT scarica, collegare la fattura non scarica di nuovo.
 */
import type { ReactNode } from 'react';
import { Ban, CalendarDays, Check, CircleCheck, ClipboardList, FileText, MapPin, PackageCheck, Plus, Search, Truck } from 'lucide-react';
import { addDays, type Action, type Lot, type Order, type Product } from '../lib/domain';

export type OrderFilter = 'open' | 'reserved' | 'prepared' | 'partial' | 'closed' | 'all';
type Common = { today: string; product: (id: string) => Product | undefined; can: (type: Action['type']) => boolean; disabled: boolean; onPrepare: (orderId: string) => void; onOpen: (type: 'dispatch' | 'document' | 'cancel', orderId: string) => void };

const n = (v: number) => new Intl.NumberFormat('it-IT').format(v);
const shortDate = (d: string) => new Intl.DateTimeFormat('it-IT', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'Europe/Rome' }).format(new Date(d + 'T12:00:00Z'));
const active = (o: Order) => o.status === 'reserved' || o.status === 'prepared' || o.status === 'partial';
const stepNames = ['Prenotato', 'Pronto', 'Partito', 'Documento'];

function due(o: Order, today: string): { label: string; tone: string } {
  if (o.status === 'dispatched') return { label: 'Consegnato', tone: 'gray' };
  if (o.status === 'cancelled') return { label: 'Annullato', tone: 'gray' };
  if (o.date < today) return { label: 'In ritardo', tone: 'red' };
  if (o.date === today) return { label: 'Consegna oggi', tone: 'amber' };
  if (o.date === addDays(today, 1)) return { label: 'Consegna domani', tone: 'blue' };
  return { label: 'Consegna ' + shortDate(o.date), tone: 'gray' };
}

/** Which step is done, current or still to do; the invoice step is optional. */
function steps(o: Order): ('done' | 'current' | 'todo' | 'stopped')[] {
  const invoice = o.documents.some(d => !d.quantities?.length);
  switch (o.status) {
    case 'reserved': return ['done', 'current', 'todo', 'todo'];
    case 'prepared': return ['done', 'done', 'current', 'todo'];
    case 'partial': return ['done', 'done', 'current', invoice ? 'done' : 'todo'];
    case 'dispatched': return ['done', 'done', 'done', invoice ? 'done' : 'current'];
    default: return ['done', o.lines.some(l => l.shipped > 0) ? 'done' : 'stopped', o.lines.some(l => l.shipped > 0) ? 'done' : 'stopped', 'stopped'];
  }
}

export function OrderCard({ order: o, lots, today, product, can, disabled, onPrepare, onOpen }: Common & { order: Order; lots: (id: string) => Lot | undefined }) {
  const d = due(o, today); const state = steps(o);
  const requested = o.lines.reduce((t, l) => t + l.quantity, 0); const shipped = o.lines.reduce((t, l) => t + l.shipped, 0);
  const anyShipped = shipped > 0; const isOpen = active(o);
  const next: { text: string; action?: ReactNode } = (() => {
    if (o.status === 'reserved') return { text: 'Prepara la merce indicata e segnala che è pronta. La giacenza fisica non cambia.', action: can('order.prepare') ? <button className="button primary" disabled={disabled} onClick={() => onPrepare(o.id)}><Check size={16}/>Segna pronto</button> : undefined };
    if (o.status === 'prepared') return { text: 'Quando la merce parte, registra la partenza con il numero del DDT: scarica il magazzino.', action: can('order.dispatch') ? <button className="button primary" disabled={disabled} onClick={() => onOpen('dispatch', o.id)}><Truck size={16}/>Registra partenza</button> : undefined };
    if (o.status === 'partial') return { text: `Partito ${n(shipped)} su ${n(requested)}. Registra la partenza del residuo oppure annullalo.`, action: can('order.dispatch') ? <button className="button primary" disabled={disabled} onClick={() => onOpen('dispatch', o.id)}><Truck size={16}/>Registra il residuo</button> : undefined };
    if (o.status === 'dispatched') return { text: state[3] === 'done' ? 'Ordine completato e documentato.' : 'Ordine consegnato. Se vuoi, collega la fattura: non scarica di nuovo la merce.' };
    return { text: anyShipped ? 'Residuo annullato: le quantità partite restano nello storico.' : 'Ordine annullato: la merce prenotata è tornata disponibile.' };
  })();
  return <article className={'oc state-' + o.status} aria-label={`Ordine ${o.customer}`}>
    <header className="oc-head">
      <div className="oc-title"><h3>{o.customer}</h3><p><MapPin size={14} aria-hidden="true"/>{o.destination}<span className="oc-id">Ordine {o.id.slice(0, 8).toUpperCase()}</span></p></div>
      <div className="oc-when"><span className={'chip ' + d.tone}>{d.label}</span><small><CalendarDays size={13} aria-hidden="true"/>{shortDate(o.date)}</small></div>
    </header>
    <ol className="oc-steps" aria-label="Passaggi dell’ordine">{stepNames.map((name, i) => <li key={name} className={state[i]} aria-current={state[i] === 'current' ? 'step' : undefined}><span className="oc-step-dot" aria-hidden="true">{state[i] === 'done' ? <Check size={13}/> : state[i] === 'stopped' ? <Ban size={12}/> : i + 1}</span><span>{name}{i === 3 ? <small> (fattura, facoltativo)</small> : null}</span></li>)}</ol>
    <div className="table-scroll"><table className="data-table oc-lines">
      <thead><tr><th>Articolo</th><th>Lotto</th><th className="num">Richiesto</th><th className="num">Partito</th><th className="num">Da consegnare</th></tr></thead>
      <tbody>{o.lines.map(l => { const lot = lots(l.lotId); const p = product(lot?.productId ?? ''); const rest = isOpen ? l.quantity - l.shipped : 0; return <tr key={l.lotId}>
        <td>{p ? <>{p.name}<span className="cell-sub">{p.code}</span></> : 'Articolo non disponibile'}</td>
        <td className="nowrap">{lot?.code ?? '—'}<span className="cell-sub">{lot?.expiry ? 'scad. ' + lot.expiry.split('-').reverse().join('/') : lot ? 'senza scadenza' : ''}</span></td>
        <td className="num nowrap">{n(l.quantity)} {p?.unit}</td>
        <td className="num nowrap">{l.shipped ? `${n(l.shipped)} ${p?.unit ?? ''}` : '—'}</td>
        <td className="num nowrap">{rest > 0 ? <span className="oc-rest">{n(rest)} {p?.unit}</span> : isOpen ? <CircleCheck size={16} aria-label="completo"/> : '—'}</td>
      </tr>; })}</tbody>
    </table></div>
    {o.documents.length > 0 && <ul className="oc-docs">{o.documents.map((doc, i) => <li key={i}><FileText size={14} aria-hidden="true"/>{doc.quantities?.length ? 'DDT' : 'Documento'} {doc.reference}{doc.note ? ` · ${doc.note}` : ''}</li>)}</ul>}
    <footer className="oc-foot">
      <p className="oc-next"><span className="oc-next-label">Prossimo passo</span>{next.text}{!next.action && isOpen && <span className="oc-wait"> In attesa dell’amministrazione.</span>}</p>
      <div className="oc-actions">
        {next.action}
        {anyShipped && can('order.document') && <button className="button secondary" disabled={disabled} onClick={() => onOpen('document', o.id)}><FileText size={16}/>Collega documento</button>}
        {isOpen && can('order.cancel') && <button className="button ghost" disabled={disabled} onClick={() => onOpen('cancel', o.id)}>{anyShipped ? 'Annulla il residuo' : 'Annulla ordine'}</button>}
      </div>
    </footer>
  </article>;
}

export default function OrdersPanel(props: Common & { orders: Order[]; lots: (id: string) => Lot | undefined; filter: OrderFilter; onFilter: (f: OrderFilter) => void; search: string; onSearch: (q: string) => void; onNew?: () => void; archived?: ReactNode }) {
  const { orders, filter, onFilter, search, onSearch, onNew, archived, today } = props;
  const words = search.trim().toLowerCase();
  const visible = orders.filter(o => !words || `${o.customer} ${o.destination} ${o.id.slice(0, 8)} ${o.documents.map(d => d.reference).join(' ')}`.toLowerCase().includes(words));
  const count = (f: OrderFilter) => visible.filter(o => match(o, f)).length;
  const late = visible.filter(o => active(o) && o.date < today).length;
  function match(o: Order, f: OrderFilter) { return f === 'all' || (f === 'open' ? active(o) : f === 'closed' ? !active(o) : o.status === f); }
  const byDate = (a: Order, b: Order) => a.date.localeCompare(b.date) || a.customer.localeCompare(b.customer, 'it');
  const card = (o: Order) => <OrderCard key={o.id} order={o} {...props}/>;
  const stages: [OrderFilter, string, string, typeof Truck][] = [
    ['reserved', 'Da preparare', 'merce prenotata, da preparare', ClipboardList],
    ['prepared', 'Pronti alla partenza', 'aspettano il DDT', PackageCheck],
    ['partial', 'Consegne parziali', 'residuo da consegnare', Truck],
    ['closed', 'Completati', 'consegnati o annullati', CircleCheck],
  ];
  const sections: [string, Order[]][] = filter === 'open'
    ? stages.slice(0, 3).map(([f, label]) => [label, visible.filter(o => o.status === f).sort(byDate)] as [string, Order[]]).filter(([, list]) => list.length)
    : [['', visible.filter(o => match(o, filter)).sort(filter === 'closed' ? (a, b) => byDate(b, a) : byDate)]];
  return <div className="orders">
    <div className="orders-stages" role="group" aria-label="Fasi degli ordini">
      <button className={'stage ' + (filter === 'open' ? 'active' : '')} aria-pressed={filter === 'open'} onClick={() => onFilter('open')}><span className="stage-count">{n(count('open'))}</span><span className="stage-name">Da completare</span><small>{late ? `${late} in ritardo` : 'tutti gli ordini aperti'}</small></button>
      {stages.map(([f, label, hint, Icon], i) => <button key={f} className={'stage ' + (filter === f ? 'active' : '')} aria-pressed={filter === f} onClick={() => onFilter(f)}><span className="stage-count"><Icon size={16} aria-hidden="true"/>{n(count(f))}</span><span className="stage-name">{i < 3 ? `${i + 1}. ` : ''}{label}</span><small>{hint}</small></button>)}
    </div>
    <div className="toolbar"><label className="search-field"><Search size={17}/><input aria-label="Cerca ordine" placeholder="Cerca cliente, destinazione, DDT o fattura…" value={search} onChange={e => onSearch(e.target.value)}/></label>{filter !== 'all' && <button className="button ghost small" onClick={() => onFilter('all')}>Mostra tutti</button>}</div>
    {sections.some(([, list]) => list.length) ? sections.map(([label, list]) => <section key={label || 'list'} className="orders-section" aria-label={label || 'Ordini'}>
      {label && <h2 className="orders-section-head">{label} <span>{n(list.length)}</span></h2>}
      <div className="order-list">{list.map(card)}</div>
    </section>) : <section className="panel"><div className="empty-state"><div className="empty-icon"><Truck size={27}/></div><h3>{orders.length ? 'Nessun ordine in questa fase' : onNew ? 'Registra il primo ordine' : 'Nessun ordine da preparare'}</h3><p>{orders.length ? (words ? 'Nessun ordine corrisponde alla ricerca.' : 'Scegli un’altra fase qui sopra.') : onNew ? 'Prenota la merce per un cliente, preparala e registra la partenza con il DDT. Puoi gestire anche consegne parziali.' : 'Gli ordini inseriti dall’amministrazione compariranno qui, pronti da preparare e far partire.'}</p>{!orders.length && onNew && <button className="button primary" disabled={props.disabled} onClick={onNew}><Plus size={17}/>Nuovo ordine</button>}</div></section>}
    {archived}
    <div className="notice blue" style={{ marginTop: 16 }}><FileText size={20}/><div><b>Come funziona</b><p>1. La prenotazione tiene da parte la merce: il magazzino non cambia. 2. «Segna pronto» quando è preparata. 3. La partenza con il DDT scarica il magazzino (anche in parte, con il motivo). 4. Collegare la fattura non scarica di nuovo.</p></div></div>
  </div>;
}


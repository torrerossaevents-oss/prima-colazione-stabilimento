"use client";
/** Panels backed by the paginated archive and device APIs. Plain Italian, explicit units. */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Activity, Download, KeyRound, RefreshCw, Search, ShieldCheck, Upload } from 'lucide-react';
import { addDays, productionSummary, type Audit, type Lot, type Order, type Session } from '../lib/domain';
import { describeError, request } from '../lib/client-api';

export type DeviceInfo = { id: string; name: string; line: string; createdAt: string; revokedAt: string | null; lastSeenAt: string | null; status: { at?: string | null; bridgeVersion?: string | null; queueLength?: number | null; plc?: { reachable?: boolean; lastReadAt?: string | null }; session?: { id?: string | null; cartons?: number | null } | null } | null };
const n = (v: number) => new Intl.NumberFormat('it-IT').format(v);
const when = (v: string) => new Intl.DateTimeFormat('it-IT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' }).format(new Date(v));
const day = (v: string) => new Intl.DateTimeFormat('it-IT', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Europe/Rome' }).format(new Date(v + 'T12:00:00Z'));
const csvCell = (v: unknown) => '"' + String(v ?? '').replaceAll('"', '""').replace(/^[=+\-@\t\r]/, "'$&") + '"';
export const STALE_MS = 90_000;

function Loading({ children }: { children: ReactNode }) { return <p className="muted" role="status"><RefreshCw size={14} className="spin"/> {children}</p>; }

/** Daily production by article/lot. Older than 30 days → read from the archive. */
export function ProductionSummaryPanel({ sessions, today, archivedCount, onExport }: { sessions: Session[]; today: string; archivedCount: number; onExport: (name: string, content: string, type: string) => void }) {
  const [from, setFrom] = useState(today); const [to, setTo] = useState(today);
  const [archived, setArchived] = useState<Session[]>([]); const [loading, setLoading] = useState(false); const [error, setError] = useState('');
  const needsArchive = archivedCount > 0 && from < addDays(today, -30);
  useEffect(() => {
    if (!needsArchive) return;
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) { setLoading(true); setError(''); } });
    (async () => {
      const rows: Session[] = []; let before = '';
      for (let page = 0; page < 20; page++) {
        const res = await request(`/api/workspace/archive?kind=session&from=${from}&to=${to}&limit=500${before ? '&before=' + encodeURIComponent(before) : ''}`);
        const data = await res.json() as { items?: Session[]; next?: { day: string; id: string } | null; error?: string };
        if (!res.ok) throw new Error(data.error || 'Archivio non disponibile.');
        rows.push(...(data.items ?? [])); if (!data.next) break; before = data.next.day + '|' + data.next.id;
      }
      if (!cancelled) setArchived(rows);
    })().catch(e => { if (!cancelled) setError(describeError(e, 'Archivio non disponibile.')); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [needsArchive, from, to]);
  const rows = useMemo(() => { const all = new Map([...(needsArchive ? archived : []), ...sessions].map(s => [s.id, s])); return productionSummary([...all.values()], from, to); }, [archived, needsArchive, sessions, from, to]);
  const preset = (a: string, b: string) => { setFrom(a); setTo(b); };
  function exportCsv() {
    const head = ['Giorno (avvio, Europe/Rome)', 'Codice', 'Articolo', 'Lotto', 'Lavorazioni', 'Cartoni confermati', 'Cartoni in corso (non definitivi)', 'Cartoni scartati', 'Unità per cartone', 'Unità confermate', 'Unità di misura', 'Lavorazioni da ponte', 'Da verificare'];
    const body = rows.map(r => [r.day, r.productCode, r.productName, r.lotCode, r.sessions, r.confirmedCartons, r.activeCartons, r.scrapCartons, r.unitsPerBox, r.confirmedCartons * r.unitsPerBox, r.unit, r.deviceSessions, r.toVerify]);
    onExport(`prima-colazione-produzione-${from}_${to}.csv`, '﻿' + [head, ...body].map(r => r.map(csvCell).join(';')).join('\r\n'), 'text/csv;charset=utf-8');
  }
  return <section className="panel" style={{ marginTop: 24 }}>
    <div className="panel-head"><div><h2>Riepilogo per periodo</h2><p>Più giorni insieme, per giorno, articolo e lotto. Il giorno è quello di avvio della lavorazione.</p></div><button className="button secondary small" disabled={!rows.length} onClick={exportCsv}><Download size={15}/>Esporta CSV</button></div>
    <div className="panel-body stack">
      <div className="summary-filters">
        <div className="tabs">{[['Oggi', today, today], ['Ieri', addDays(today, -1), addDays(today, -1)], ['Ultimi 7 giorni', addDays(today, -6), today]].map(([label, a, b]) => <button key={label} className={'tab ' + (from === a && to === b ? 'active' : '')} onClick={() => preset(a, b)}>{label}</button>)}</div>
        <label className="field" style={{ minWidth: 150 }}><span>Dal</span><input type="date" value={from} max={to} onChange={e => e.target.value && setFrom(e.target.value)}/></label>
        <label className="field" style={{ minWidth: 150 }}><span>Al</span><input type="date" value={to} min={from} max={today} onChange={e => e.target.value && setTo(e.target.value)}/></label>
      </div>
      {loading && <Loading>Lettura dell’archivio…</Loading>}
      {error && <div role="alert" className="alert-error">{error}</div>}
      {rows.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Giorno</th><th>Articolo / lotto</th><th>Lavorazioni</th><th>Cartoni confermati</th><th>In corso</th><th>Scarti</th><th>Unità confermate</th></tr></thead><tbody>
        {rows.map(r => <tr key={r.day + r.productId + r.lotCode}><td>{day(r.day)}</td><td>{r.productName}<span className="cell-sub">{r.productCode} · Lotto {r.lotCode}</span></td><td>{n(r.sessions)}{r.deviceSessions > 0 && <small className="cell-sub">{r.deviceSessions} da ponte</small>}{r.toVerify > 0 && <span className="chip amber">{r.toVerify} da verificare</span>}</td><td>{n(r.confirmedCartons)} cartoni</td><td>{r.activeCartons ? `${n(r.activeCartons)} cartoni` : '—'}</td><td>{r.scrapCartons ? `${n(r.scrapCartons)} cartoni` : '—'}</td><td>{n(r.confirmedCartons * r.unitsPerBox)} {r.unit}<small className="cell-sub">{r.unitsPerBox} per cartone</small></td></tr>)}
      </tbody></table></div> : !loading && <p className="muted">Nessuna lavorazione nel periodo scelto.</p>}
      <p className="form-help">Le lavorazioni restano distinte anche nello stesso giorno; i totali sono per articolo e lotto, senza sommare unità diverse. «In corso» comprende la lavorazione ancora aperta.</p>
    </div>
  </section>;
}

/** Paginated activity log with server-side search. */
export function HistoryPanel({ recent, total, onExport, loaded }: { recent: Audit[]; total: number; onExport: () => void; loaded: boolean }) {
  const [q, setQ] = useState(''); const [items, setItems] = useState<Audit[] | null>(null); const [next, setNext] = useState<{ at: string; id: string } | null>(null);
  const [loading, setLoading] = useState(false); const [error, setError] = useState('');
  async function load(query: string, cursor: { at: string; id: string } | null) {
    setLoading(true); setError('');
    try {
      const res = await request(`/api/workspace/history?limit=50&q=${encodeURIComponent(query)}${cursor ? '&before=' + encodeURIComponent(cursor.at + '|' + cursor.id) : ''}`);
      const data = await res.json() as { items?: Audit[]; next?: { at: string; id: string } | null; error?: string };
      if (!res.ok) throw new Error(data.error || 'Storico non disponibile.');
      setItems(prev => cursor && prev ? [...prev, ...(data.items ?? [])] : data.items ?? []); setNext(data.next ?? null);
    } catch (e) { setError(describeError(e, 'Storico non disponibile.')); } finally { setLoading(false); }
  }
  useEffect(() => { const t = setTimeout(() => { void load(q, null); }, q ? 300 : 0); return () => clearTimeout(t); }, [q, total]);
  const list = items ?? recent;
  return <section className="panel">
    <div className="panel-head"><div><h2>Registro delle operazioni</h2><p>{n(total)} operazioni registrate, dalla più recente.</p></div><button className="button secondary small" disabled={!loaded} onClick={onExport}><Download size={15}/>Esporta stato operativo</button></div>
    <div className="panel-body stack">
      <label className="search-field"><Search size={17}/><input aria-label="Cerca nello storico" placeholder="Cerca codice, lotto, cliente, documento…" value={q} onChange={e => setQ(e.target.value)}/></label>
      {error && <div role="alert" className="alert-error">{error} <button className="button small secondary" onClick={() => load(q, null)}>Riprova</button></div>}
      {list.length ? <div className="timeline">{list.map(a => <div className="timeline-item" key={a.id}><span className="timeline-dot"/><div><b>{a.detail}</b><small>{when(a.at)} · {a.id.slice(0, 8)}{a.actor?.startsWith('dispositivo:') ? ' · ponte' : ''}</small></div></div>)}</div> : !loading && <p className="muted">{q ? 'Nessuna operazione trovata.' : 'Lo storico parte dalla prima operazione salvata.'}</p>}
      {loading && <Loading>Caricamento…</Loading>}
      {next && !loading && <button className="button secondary" onClick={() => load(q, next)}>Carica altre 50</button>}
    </div>
  </section>;
}

/** Orders closed more than 30 days ago, loaded on request. */
export function ArchivedOrders({ search, count, renderOrder, hotOrderIds, refreshKey }: { search: string; count: number; renderOrder: (o: Order, lots: Map<string, Lot>) => ReactNode; hotOrderIds: Set<string>; refreshKey: number }) {
  const [items, setItems] = useState<Order[] | null>(null); const [lots, setLots] = useState<Map<string, Lot>>(new Map()); const [next, setNext] = useState<{ day: string; id: string } | null>(null); const [loading, setLoading] = useState(false); const [error, setError] = useState('');
  async function load(cursor: typeof next) {
    setLoading(true); setError('');
    try {
      const res = await request(`/api/workspace/archive?kind=order&limit=30&q=${encodeURIComponent(search)}${cursor ? '&before=' + encodeURIComponent(cursor.day + '|' + cursor.id) : ''}`);
      const data = await res.json() as { items?: Order[]; lots?: Lot[]; next?: typeof next; error?: string };
      if (!res.ok) throw new Error(data.error || 'Archivio non disponibile.');
      setItems(prev => cursor && prev ? [...prev, ...(data.items ?? [])] : data.items ?? []); setNext(data.next ?? null);
      setLots(prev => { const map = new Map(cursor ? prev : []); for (const l of data.lots ?? []) map.set(l.id, l); return map; });
    } catch (e) { setError(describeError(e, 'Archivio non disponibile.')); } finally { setLoading(false); }
  }
  // Reload after a search change or after any saved operation (an order may have returned to the hot state).
  useEffect(() => { if (items) { const t = setTimeout(() => { void load(null); }, 300); return () => clearTimeout(t); } }, [search, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!items) return <section className="panel"><div className="panel-body split"><p className="muted">{n(count)} ordini chiusi da oltre 30 giorni sono in archivio.</p><button className="button secondary small" disabled={loading} onClick={() => load(null)}>{loading ? 'Caricamento…' : 'Mostra ordini archiviati'}</button></div>{error && <div role="alert" className="alert-error">{error}</div>}</section>;
  return <>{items.filter(o => !hotOrderIds.has(o.id)).map(o => renderOrder(o, lots))}{!items.length && <p className="muted">Nessun ordine archiviato corrisponde alla ricerca.</p>}{error && <div role="alert" className="alert-error">{error}</div>}{next && <button className="button secondary" disabled={loading} onClick={() => load(next)}>{loading ? 'Caricamento…' : 'Altri ordini archiviati'}</button>}</>;
}

function age(at: string | null, now: number) { if (!at) return 'mai'; const s = Math.max(0, Math.round((now - Date.parse(at)) / 1000)); return s < 90 ? `${s} s fa` : s < 5400 ? `${Math.round(s / 60)} min fa` : when(at); }

export function DeviceStatusNotice({ devices, now, session }: { devices: DeviceInfo[] | null; now: number; session?: Session }) {
  const active = devices?.filter(d => !d.revokedAt) ?? [];
  const latest = active.filter(d => d.lastSeenAt).sort((a, b) => b.lastSeenAt!.localeCompare(a.lastSeenAt!))[0];
  const stale = !latest || now - Date.parse(latest.lastSeenAt!) > STALE_MS;
  const hooked = Boolean(session && latest?.status?.session?.id === session.id);
  return <div className={'notice ' + (stale ? 'amber' : '')}><Activity size={21}/><div>
    <b>{!devices ? 'Ponte conta-cartoni: lettura dello stato…' : stale ? 'Ponte conta-cartoni: dato non aggiornato' : 'Ponte conta-cartoni collegato'}</b>
    <p>{latest ? <>Ultimo contatto {age(latest.lastSeenAt, now)} · PLC {latest.status?.plc?.reachable ? 'raggiungibile' : 'non raggiungibile'} · eventi in coda {latest.status?.queueLength ?? '—'}{session?.source === 'device' ? (hooked ? ' · ponte agganciato a questa lavorazione' : ' · ponte non ancora agganciato: non avviare la linea') : ''}.</> : 'Nessun contatto ricevuto dal ponte.'} Collegamento in prova: nessun carico automatico a magazzino e nessun comando alla macchina.</p>
  </div></div>;
}

/** Owner-only bridge credentials: created once, shown once, revocable. */
export function DevicesPanel({ devices, onChange, now }: { devices: DeviceInfo[] | null; onChange: () => Promise<void> | void; now: number }) {
  const [name, setName] = useState(''); const [token, setToken] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function call(body: unknown) {
    setBusy(true); setError('');
    try {
      const res = await request('/api/devices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json() as { token?: string; error?: string };
      if (!res.ok) throw new Error(data.error || 'Operazione non riuscita.');
      if (data.token) { setToken(data.token); setName(''); }
      await onChange();
    } catch (e) { setError(describeError(e, 'Operazione non riuscita.') + ' Controlla l’elenco prima di ripetere.'); } finally { setBusy(false); }
  }
  return <section className="panel" style={{ marginTop: 24 }}>
    <div className="panel-head"><div><h2>Dispositivi del conta-cartoni</h2><p>Credenziali dedicate per il ponte sul PC di linea. Mai usare il proprio accesso personale.</p></div><KeyRound size={20}/></div>
    <div className="panel-body stack">
      {error && <div role="alert" className="alert-error">{error}</div>}
      {token && <div className="notice amber"><KeyRound size={20}/><div><b>Token mostrato una sola volta</b><p>Copialo nel file <code>token.local.json</code> del ponte (vedi guida). Non inviarlo via chat o e-mail. Se va perso, revoca il dispositivo e creane uno nuovo.</p><input readOnly value={token} aria-label="Token del dispositivo" onFocus={e => e.currentTarget.select()} style={{ width: '100%', fontFamily: 'monospace' }}/><div className="page-actions"><button className="button secondary small" onClick={() => navigator.clipboard?.writeText(token)}>Copia</button><button className="button ghost small" onClick={() => setToken('')}>Ho salvato il token</button></div></div></div>}
      {devices === null ? <Loading>Lettura dei dispositivi…</Loading> : devices.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Dispositivo</th><th>Linea</th><th>Ultimo contatto</th><th>Stato</th><th></th></tr></thead><tbody>{devices.map(d => <tr key={d.id}><td>{d.name}<span className="cell-sub">{d.id}</span></td><td>{d.line}</td><td>{age(d.lastSeenAt, now)}</td><td>{d.revokedAt ? <span className="chip gray">Revocato</span> : d.lastSeenAt && now - Date.parse(d.lastSeenAt) <= STALE_MS ? <span className="chip green">Attivo</span> : <span className="chip amber">Non aggiornato</span>}</td><td>{!d.revokedAt && <button className="button ghost small" disabled={busy} onClick={() => { if (confirm(`Revocare «${d.name}»? Il ponte smetterà subito di inviare dati.`)) void call({ op: 'revoke', id: d.id }); }}>Revoca</button>}</td></tr>)}</tbody></table></div> : <p className="muted">Nessun dispositivo registrato. Le lavorazioni restano con conteggio manuale.</p>}
      <form className="split" onSubmit={e => { e.preventDefault(); if (name.trim()) void call({ op: 'create', name }); }}><label className="field" style={{ flex: 1 }}><span>Nome del nuovo dispositivo</span><input value={name} maxLength={60} onChange={e => setName(e.target.value)} placeholder="es. PC linea confezionamento"/></label><button className="button primary" disabled={busy || !name.trim()} type="submit">{busy ? 'Salvataggio…' : 'Crea credenziale'}</button></form>
    </div>
  </section>;
}

/** Full backup download; restore only into an empty archive, verified by digest. */
export function BackupPanel({ emptyArchive, onRestored }: { emptyArchive: boolean; onRestored: () => Promise<void> | void }) {
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const [error, setError] = useState('');
  async function restore(file: File) {
    setBusy(true); setError(''); setMessage('');
    try {
      const res = await request('/api/workspace/backup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: await file.text() }, 120_000);
      const data = await res.json() as { ok?: boolean; digest?: string; counts?: Record<string, number>; error?: string };
      if (!res.ok) throw new Error(data.error || 'Ripristino non riuscito.');
      setMessage(`Ripristino verificato: versione ${data.counts?.version}, ${data.counts?.audit} operazioni nello storico. Impronta ${data.digest?.slice(0, 12)}…`); await onRestored();
    } catch (e) { setError(describeError(e, 'Ripristino non riuscito.') + ' Ricarica la pagina per controllare lo stato prima di riprovare.'); } finally { setBusy(false); }
  }
  return <section className="panel" style={{ marginTop: 24 }}>
    <div className="panel-head"><div><h2>Backup completo</h2><p>Stato operativo, storico, archivio e ricevute in un unico file. Contiene dati aziendali: conservalo in un luogo riservato, mai su GitHub.</p></div><ShieldCheck size={20}/></div>
    <div className="panel-body stack">
      <div className="page-actions"><a className="button primary" href="/api/workspace/backup" download><Download size={16}/>Scarica backup completo</a></div>
      <p className="form-help">Per provare il ripristino senza toccare il gestionale: <code>node --experimental-strip-types scripts/verify-backup.ts &lt;file&gt;</code> (vedi docs/BACKUP-RIPRISTINO.md).</p>
      {emptyArchive && <div className="notice"><Upload size={20}/><div><b>Ripristina in questo archivio vuoto</b><p>Disponibile solo quando l’archivio non contiene ancora dati: non sovrascrive mai registrazioni esistenti.</p><input type="file" accept="application/json,.json" disabled={busy} onChange={e => { const f = e.target.files?.[0]; if (f && confirm(`Ripristinare «${f.name}» in questo archivio vuoto?`)) void restore(f); e.target.value = ''; }}/></div></div>}
      {busy && <Loading>Ripristino e verifica in corso…</Loading>}
      {message && <div role="status" className="notice">{message}</div>}
      {error && <div role="alert" className="alert-error">{error}</div>}
    </div>
  </section>;
}

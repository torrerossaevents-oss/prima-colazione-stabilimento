"use client";
/**
 * App «Linea» per l'iPad della produzione (/linea, installabile dalla schermata Home).
 * 1. Foto o file dell'etichetta → codice a barre e testo letti sull'iPad → articolo riconosciuto
 *    (o proposto all'amministrazione da creare/aggiornare con i dati letti).
 * 2. Avvio con lotto (AAMMGG di oggi) e scadenza calcolati, operatore ricordato.
 * 3. Contatore grande, chiusura con carico in magazzino.
 * Stesso archivio e stesse regole del gestionale: ogni operazione passa da /api/workspace con
 * versione attesa e identificativo stabile (una risposta persa non crea doppioni).
 */
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Camera, Check, CircleAlert, Factory, ImageUp, LayoutDashboard, PackagePlus, Play, RefreshCw, Save, ScanLine, Wheat, X } from 'lucide-react';
import { activeSession, DEFAULT_SHELF_LIFE_MONTHS, productByScan, productionArea, productionDay, productionExpiry, productionLot, todayRome, type Action, type Product, type State } from '../lib/domain';
import { canRecord, roleNames, type Role } from '../lib/permissions';
import { describeError, listPending, readWorkspaceResponse, removePending, request, writePending } from '../lib/client-api';
import type { LabelScan } from '../lib/label-reader';
import LabelPreview from './label-preview';
import LabelCamera from './label-camera';

type Resp = { state: State; version: number; role?: Role; error?: string; duplicate?: boolean };
const OPERATOR_KEY = 'prima-colazione-linea-operatore';
const n = (v: number) => new Intl.NumberFormat('it-IT').format(v);
const itDate = (d: string) => d.split('-').reverse().join('/');
const time = (v: string) => new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' }).format(new Date(v));

export default function LineApp() {
  const [state, setState] = useState<State | null>(null);
  const [version, setVersion] = useState(0);
  const [role, setRole] = useState<Role>('laboratorio');
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const today = todayRome(new Date(now));
  const can = (type: Action['type']) => canRecord(role, type);

  const apply = (data: Resp) => { setState(data.state); setVersion(data.version); if (data.role) setRole(data.role); };
  const load = useCallback(async () => {
    try {
      const res = await request('/api/workspace'); const data = await readWorkspaceResponse<Resp>(res);
      if (!res.ok) throw new Error(data.error || 'Archivio non raggiungibile.');
      apply(data); setError(''); setNow(Date.now());
      // An operation left uncertain (lost answer) is checked on the server receipt before anything else.
      for (const p of listPending()) {
        const r = await request('/api/workspace/receipt?id=' + encodeURIComponent(p.id)); const body = await r.json() as { committed?: boolean };
        if (r.ok && body.committed) removePending(p.id); else setUncertain(true);
      }
    } catch (e) { setError(describeError(e, 'Archivio non raggiungibile: controlla la rete dell’iPad.')); }
  }, []);
  useEffect(() => {
    const first = setTimeout(() => { void load(); }, 0);
    const tick = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 15_000);
    const visible = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', visible);
    return () => { clearTimeout(first); clearInterval(tick); document.removeEventListener('visibilitychange', visible); };
  }, [load]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 4000); return () => clearTimeout(t); }, [toast]);

  /** Same protocol as the main app: expected version + stable id; an uncertain answer keeps the id for the retry. */
  async function send(action: Action, message: string): Promise<boolean> {
    if (busy) return false;
    const key = JSON.stringify(action);
    const previous = listPending().find(p => p.key === key);
    const id = previous?.id ?? crypto.randomUUID();
    writePending({ key, id, version, label: message, at: new Date().toISOString(), status: 'sending' });
    setBusy(true); setError('');
    let sure = false;
    try {
      const res = await request('/api/workspace', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, expectedVersion: previous?.version ?? version, requestId: id }) }, 20_000);
      const data = await readWorkspaceResponse<Resp>(res);
      if (!res.ok) {
        if (res.status >= 400 && res.status < 500) { sure = true; removePending(id); }
        if (res.status === 409 && data.state) apply(data);
        throw new Error(data.error || 'Operazione non riuscita.');
      }
      apply(data); removePending(id); setUncertain(false);
      setToast(data.duplicate ? 'Operazione già registrata: nessun doppione.' : message);
      return true;
    } catch (e) {
      if (!sure) { writePending({ key, id, version: previous?.version ?? version, label: message, at: new Date().toISOString(), status: 'uncertain' }); setUncertain(true); }
      setError(describeError(e, 'Operazione non riuscita.') + (sure ? '' : ' Risposta non arrivata: ripeti la stessa operazione, non verrà registrata due volte.'));
      return false;
    } finally { setBusy(false); }
  }

  const current = state ? activeSession(state) : undefined;
  const day = state ? productionDay(state.sessions, today) : null;
  return <div className="ipad-app">
    <header className="ipad-top">
      <div className="ipad-brand"><span className="ipad-mark"><Wheat size={22} aria-hidden="true"/></span><div><span className="ipad-title">Linea 1</span><span className="ipad-sub">{current ? 'In lavorazione' : 'Ferma'} · {roleNames[role]}</span></div></div>
      <div className="ipad-top-actions">
        <span className={'ipad-status ' + (error && !state ? 'off' : 'on')}>{error && !state ? 'Non collegata' : 'Collegata al gestionale'}</span>
        <button className="ipad-icon" aria-label="Aggiorna" onClick={() => void load()}><RefreshCw size={22}/></button>
        <button className="ipad-icon" aria-label="Apri il gestionale completo" onClick={() => window.location.assign('/')}><LayoutDashboard size={22}/></button>
      </div>
    </header>
    <main className="ipad-main">
      {error && <div className="ipad-alert" role="alert"><CircleAlert size={22}/><span>{error}</span><button className="ipad-icon" aria-label="Chiudi avviso" onClick={() => setError('')}><X size={20}/></button></div>}
      {uncertain && !error && <div className="ipad-alert amber" role="status"><CircleAlert size={22}/><span>Un’operazione è in attesa di conferma: se la ripeti non viene registrata due volte.</span></div>}
      {!state ? <p className="ipad-loading"><RefreshCw size={20} className="spin"/> Collegamento al gestionale…</p>
        : current ? <RunView key={current.id} state={state} sessionId={current.id} busy={busy} can={can} send={send} now={now}/>
        : <StartView state={state} busy={busy} can={can} send={send} today={today}/>}
      {day && day.totals.runs > 0 && <section className="ipad-card ipad-today" aria-label="Produzione di oggi">
        <h2>Oggi</h2>
        <div className="ipad-today-totals"><span><b>{n(day.totals.confirmedCartons)}</b> cartoni confermati</span><span><b>{n(day.totals.runs)}</b> lavorazioni</span>{day.totals.activeCartons > 0 && <span><b>{n(day.totals.activeCartons)}</b> in corso</span>}</div>
        <ol className="ipad-runs">{day.flow.map(r => <li key={r.id}><span>{time(r.startedAt)}</span><span>{r.productCode} · {r.productName}</span><span>{n(r.cartons)} cartoni{r.status === 'active' ? ' · in corso' : ''}</span></li>)}</ol>
      </section>}
    </main>
    {toast && <div className="ipad-toast" role="status"><Check size={20}/>{toast}</div>}
  </div>;
}

type ViewProps = { state: State; busy: boolean; can: (t: Action['type']) => boolean; send: (a: Action, m: string) => Promise<boolean> };

function RunView({ state, sessionId, busy, can, send, now }: ViewProps & { sessionId: string; now: number }) {
  const s = state.sessions.find(x => x.id === sessionId)!; const p = state.products.find(x => x.id === s.productId);
  const [closing, setClosing] = useState(false); const [scrap, setScrap] = useState('0'); const [note, setNote] = useState(''); const [counted, setCounted] = useState(''); const [reason, setReason] = useState(''); const [ok, setOk] = useState(false); const [custom, setCustom] = useState('');
  const hours = (now - Date.parse(s.startedAt)) / 3_600_000;
  const area = productionArea(state); const autoLoad = state.settings?.autoLoad !== false;
  const add = (cartons: number) => { if (cartons > 0) void send({ type: 'production.count', sessionId, cartons }, `+${cartons} cartoni`); };
  const device = s.source === 'device';
  async function close() {
    const scrapN = Number(scrap) || 0;
    const done = await send({ type: 'production.close', sessionId, ...(scrapN > 0 ? { scrapCartons: scrapN, note } : {}), ...(device ? { override: reason, cartons: Number(counted) } : {}) }, autoLoad && area ? 'Lavorazione chiusa e caricata in magazzino' : 'Lavorazione chiusa');
    if (done) setClosing(false);
  }
  return <section className="ipad-run" aria-label="Lavorazione in corso">
    <div className="ipad-card ipad-run-head">
      <div><span className="ipad-code">Codice {s.productCode}</span><h1>{s.productName}</h1></div>
      <dl className="ipad-facts"><div><dt>Lotto</dt><dd>{s.lotCode}</dd></div><div><dt>Scadenza</dt><dd>{itDate(s.expiry)}</dd></div><div><dt>Operatore</dt><dd>{s.operator}</dd></div><div><dt>Impasto</dt><dd>{s.ident ?? '—'}</dd></div><div><dt>Avviata</dt><dd>{time(s.startedAt)}</dd></div></dl>
    </div>
    <div className="ipad-card ipad-counter">
      <div className="ipad-count" aria-live="polite"><span className="ipad-count-n">{n(s.cartons)}</span><span>cartoni{hours >= 0.05 && s.cartons > 0 ? ` · ${n(Math.round(s.cartons / hours))} all’ora` : ''}</span></div>
      {device ? <p className="ipad-help">Conteggio dal contapezzi. A fine lavorazione premete il pulsante sulla linea: la lavorazione si chiude e carica il magazzino da sola.</p>
        : can('production.count') && <div className="ipad-add">{[1, 5, 10].map(k => <button key={k} className="ipad-btn big" disabled={busy} onClick={() => add(k)}>+{k}</button>)}<div className="ipad-custom"><input type="number" inputMode="numeric" min="1" step="1" placeholder="Altro" aria-label="Cartoni da aggiungere" value={custom} onChange={e => setCustom(e.target.value)}/><button className="ipad-btn" disabled={busy || !(Number(custom) > 0)} onClick={() => { add(Math.floor(Number(custom))); setCustom(''); }}>Aggiungi</button></div></div>}
      {can('production.close') && !closing && <button className="ipad-btn primary wide" disabled={busy} onClick={() => setClosing(true)}><Save size={22}/>{autoLoad && area ? 'Chiudi e carica in magazzino' : 'Chiudi la lavorazione'}</button>}
      {closing && <div className="ipad-close">
        <h2>Chiusura di {s.productCode}</h2>
        {device && <><label className="ipad-field"><span>Cartoni contati a mano</span><input type="number" inputMode="numeric" min="0" step="1" value={counted} onChange={e => setCounted(e.target.value)}/></label><label className="ipad-field"><span>Motivo della chiusura manuale</span><input value={reason} onChange={e => setReason(e.target.value)} placeholder="Es. contapezzi fermo"/></label></>}
        <label className="ipad-field"><span>Cartoni scartati</span><input type="number" inputMode="numeric" min="0" step="1" value={scrap} onChange={e => setScrap(e.target.value)}/></label>
        {Number(scrap) > 0 && <label className="ipad-field"><span>Motivo degli scarti</span><input value={note} onChange={e => setNote(e.target.value)}/></label>}
        <p className="ipad-help">{!autoLoad ? 'Carico automatico disattivato: il magazzino si aggiorna a mano.' : !area ? 'Area di carico non impostata: la chiusura non carica il magazzino. Avvisa l’amministrazione.' : `Entrano in magazzino ${n(Math.max(0, (device ? Number(counted) || 0 : s.cartons) - (Number(scrap) || 0)))} cartoni nel lotto ${s.lotCode}, in ${area}.`}</p>
        <label className="ipad-check"><input type="checkbox" checked={ok} onChange={e => setOk(e.target.checked)}/>Ho verificato articolo e cartoni.</label>
        <div className="ipad-row"><button className="ipad-btn" onClick={() => setClosing(false)} disabled={busy}>Indietro</button><button className="ipad-btn primary" disabled={busy || !ok || (Number(scrap) > 0 && !note.trim()) || (device && (!reason.trim() || counted === ''))} onClick={() => void close()}><Check size={22}/>Conferma chiusura</button></div>
      </div>}
    </div>
    {p && <div className="ipad-card"><LabelPreview product={{ ...p, piecesPerCarton: s.piecesPerCarton ?? p.piecesPerCarton, pieceWeightG: s.pieceWeightG ?? p.pieceWeightG }} lotCode={s.lotCode} expiry={s.expiry} settings={state.settings} ident={s.ident}/></div>}
  </section>;
}

function StartView({ state, busy, can, send, today }: ViewProps & { today: string }) {
  const [scan, setScan] = useState<LabelScan | null>(null);
  const [progress, setProgress] = useState<{ step: string; fraction?: number } | null>(null);
  const [scanError, setScanError] = useState('');
  const [typed, setTyped] = useState('');
  const [chosen, setChosen] = useState<string | null>(null);
  const [operator, setOperator] = useState('');
  const [ident, setIdent] = useState('');
  const upload = useRef<HTMLInputElement>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  // Article recognised from the barcode alone (no text reading needed); the frame is kept to read the text on request.
  const [detected, setDetected] = useState<{ ean: string; preview: string; frame: HTMLCanvasElement } | null>(null);
  const startCard = useRef<HTMLDivElement>(null);
  useEffect(() => { try { const saved = localStorage.getItem(OPERATOR_KEY); if (saved) queueMicrotask(() => setOperator(saved)); } catch { /* not remembered */ } }, []);

  const r = scan?.reading;
  // Wording already in the catalog: a close reading is replaced by the exact text.
  const known = [...new Set(state.products.map(p => p.labelDescription).filter((d): d is string => !!d))];
  const found: Product | undefined = chosen ? state.products.find(p => p.id === chosen) : (r && ((r.ean && productByScan(state, r.ean)) || (r.code && productByScan(state, r.code)))) || undefined;
  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
    setScan(null); setChosen(null); setScanError(''); setProgress({ step: 'Apertura della foto…' });
    try { const { scanLabel } = await import('../lib/label-reader'); setScan(await scanLabel(file, (step, fraction) => setProgress({ step, fraction }), { known })); }
    catch (err) { setScanError(describeError(err, 'Etichetta non letta. Riprova con più luce, inquadrando tutta l’etichetta, oppure scrivi il codice.')); }
    finally { setProgress(null); }
  }
  async function readFrame(frame: HTMLCanvasElement, barcode?: string) {
    setScan(null); setChosen(null); setDetected(null); setScanError(''); setProgress({ step: 'Lettura del testo dell’etichetta…' });
    try { const { scanCanvas } = await import('../lib/label-reader'); setScan(await scanCanvas(frame, (step, fraction) => setProgress({ step, fraction }), barcode, { known })); }
    catch (err) { setScanError(describeError(err, 'Etichetta non letta. Riprova con più luce, inquadrando tutta l’etichetta, oppure scrivi il codice.')); }
    finally { setProgress(null); }
  }
  /** Scanner hit: known article → straight to the start; unknown → read the text of the same frame. */
  function onDetected(code: string, frame: HTMLCanvasElement) {
    setCameraOpen(false); setScanError('');
    const known = productByScan(state, code);
    if (known) { setScan(null); setChosen(known.id); setDetected({ ean: code, preview: frame.toDataURL('image/jpeg', 0.6), frame }); }
    else void readFrame(frame, code);
  }
  function findTyped() { const p = productByScan(state, typed); if (p) { setChosen(p.id); setScan(null); setScanError(''); } else setScanError(`Nessun prodotto finito con codice o EAN «${typed.trim()}».`); }

  const months = found?.shelfLifeMonths ?? DEFAULT_SHELF_LIFE_MONTHS;
  const lot = productionLot(today); const expiry = productionExpiry(today, months);
  // Label vs catalog: differences the administration can accept with one tap.
  const diffs: [string, string, string][] = found && r ? ([
    ['EAN', found.ean ?? '—', r.ean ?? ''], ['Pezzi per cartone', found.piecesPerCarton ? String(found.piecesPerCarton) : '—', r.piecesPerCarton ? String(r.piecesPerCarton) : ''],
    ['Peso del pezzo (g)', found.pieceWeightG ? String(found.pieceWeightG) : '—', r.pieceWeightG ? String(r.pieceWeightG) : ''], ['Durata (mesi)', String(found.shelfLifeMonths ?? `${DEFAULT_SHELF_LIFE_MONTHS} (predefinita)`), r.shelfLifeMonths ? String(r.shelfLifeMonths) : ''],
    ['Dicitura in etichetta', found.labelDescription ?? '—', r.description ?? ''],
  ] as [string, string, string][]).filter(([, a, b]) => b && a !== b) : [];
  const fromLabel = () => ({ ...(r?.ean ? { ean: r.ean } : {}), ...(r?.piecesPerCarton ? { piecesPerCarton: r.piecesPerCarton } : {}), ...(r?.pieceWeightG ? { pieceWeightG: r.pieceWeightG } : {}), ...(r?.shelfLifeMonths ? { shelfLifeMonths: r.shelfLifeMonths } : {}), ...(r?.description ? { labelDescription: r.description.slice(0, 160) } : {}), ...(r?.ingredients ? { ingredients: r.ingredients } : {}), ...(r?.storage ? { storage: r.storage } : {}) });

  // Once an article is recognised, bring the start card into view (the operator only types the name).
  const foundId = found?.id;
  useEffect(() => { if (foundId) startCard.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, [foundId]);

  async function start() {
    if (!found) return;
    try { localStorage.setItem(OPERATOR_KEY, operator.trim()); } catch { /* not remembered */ }
    if (await send({ type: 'production.start', code: found.code, operator: operator.trim(), ident: ident.trim().toUpperCase() }, `Produzione avviata: ${found.code}, lotto ${lot}, impasto ${ident.trim().toUpperCase()}`)) { setScan(null); setChosen(null); setIdent(''); }
  }
  return <section className="ipad-start" aria-label="Avvio della produzione">
    <div className="ipad-card">
      <h1 className="ipad-step"><span>1</span>Etichetta del prodotto</h1>
      <p className="ipad-help">Inquadra l’etichetta del cartone: appena l’iPad riconosce il codice a barre la fotocamera si chiude da sola e si passa all’avvio. Per un articolo nuovo legge anche codice, descrizione, pezzi, peso, lotto e scadenza. Le immagini restano sull’iPad.</p>
      <div className="ipad-row">
        <input ref={upload} type="file" accept="image/*" hidden onChange={onFile}/>
        <button className="ipad-btn primary big" disabled={!!progress} onClick={() => { setScanError(''); setCameraOpen(true); }}><Camera size={26}/>Inquadra l’etichetta</button>
        <button className="ipad-btn big" disabled={!!progress} onClick={() => upload.current?.click()}><ImageUp size={26}/>Carica foto o file</button>
      </div>
      <div className="ipad-row ipad-manual"><label className="ipad-field grow"><span>Oppure scrivi il codice o l’EAN</span><input value={typed} onChange={e => setTyped(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') findTyped(); }} inputMode="text" autoCapitalize="characters" placeholder="Es. 024 o 8000000004642"/></label><button className="ipad-btn" disabled={!typed.trim()} onClick={findTyped}><ScanLine size={22}/>Cerca</button></div>
      {progress && <div className="ipad-progress" role="status"><RefreshCw size={20} className="spin"/><span>{progress.step}</span>{progress.fraction !== undefined && <progress max={1} value={progress.fraction}/>}</div>}
      {scanError && <div className="ipad-alert" role="alert"><CircleAlert size={22}/><span>{scanError}</span></div>}
      {detected && found && <div className="ipad-detected" role="status">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={detected.preview} alt="Fotogramma dell’etichetta riconosciuta"/>
        <div><span className="ipad-code">Riconosciuto dal codice a barre · EAN {detected.ean}</span><b>{found.code} · {found.name}</b>{<button className="ipad-btn" onClick={() => void readFrame(detected.frame, detected.ean)}><ScanLine size={22}/>Leggi anche il testo e confronta con la scheda</button>}</div>
      </div>}
      {scan && r && <div className="ipad-scan">
        {/* A local data URL of the photo just read: nothing for an image optimizer to serve. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={scan.preview} alt="Foto dell’etichetta letta"/>
        <dl className="ipad-read">
          {([['Codice', r.code], ['Descrizione articolo', r.name], ['Dicitura in etichetta', r.description], ['EAN', r.ean ? r.ean + (scan.barcode ? ' (codice a barre)' : ' (cifre)') : undefined], ['Contenuto', r.piecesPerCarton ? `${r.piecesPerCarton} pezzi${r.pieceWeightG ? ` × ${r.pieceWeightG} g = ${n(r.netWeightG ?? 0)} g` : ''}` : undefined], ['Lotto stampato', r.lot ? `${r.lot}${r.productionDay ? ` (prodotto il ${itDate(r.productionDay)})` : ''}` : undefined], ['Scadenza stampata', r.expiry ? itDate(r.expiry) : undefined], ['Durata', r.shelfLifeMonths ? `${r.shelfLifeMonths} mesi (calcolata)` : undefined], ['Impasto stampato (IDENT.)', r.ident]] as [string, string | undefined][]).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v ?? <span className="ipad-missing">non letto</span>}</dd></div>)}
        </dl>
        {r.warnings.length > 0 && <ul className="ipad-warnings">{r.warnings.map(w => <li key={w}>{w}</li>)}</ul>}
      </div>}
      {scan && r && !found && <NewProduct reading={r} can={can} busy={busy} send={send}/>}
      {found && scan && diffs.length > 0 && <div className="ipad-diff"><h2>L’etichetta è diversa dalla scheda</h2><table><thead><tr><th>Dato</th><th>Scheda</th><th>Etichetta</th></tr></thead><tbody>{diffs.map(([k, a, b]) => <tr key={k}><td>{k}</td><td>{a}</td><td>{b}</td></tr>)}</tbody></table>
        {can('product.update') ? <button className="ipad-btn" disabled={busy} onClick={() => void send({ type: 'product.update', productId: found.id, product: { ...found, ...fromLabel() } }, 'Scheda prodotto aggiornata con i dati dell’etichetta')}><Check size={22}/>Aggiorna la scheda con l’etichetta</button> : <p className="ipad-help">Solo l’amministrazione può aggiornare la scheda. Puoi comunque avviare con i dati della scheda.</p>}
      </div>}
    </div>
    {cameraOpen && <LabelCamera onDetected={onDetected} onCapture={frame => { setCameraOpen(false); void readFrame(frame); }} onClose={message => { setCameraOpen(false); if (message) setScanError(message); }}/>}
    {found && <div className="ipad-card" ref={startCard}>
      <h1 className="ipad-step"><span>2</span>Avvio della produzione</h1>
      <div className="ipad-found"><span className="ipad-code">Codice {found.code}{found.ean ? ` · EAN ${found.ean}` : ''}</span><h2>{found.name}</h2></div>
      <dl className="ipad-facts big"><div><dt>Lotto</dt><dd>{lot}</dd></div><div><dt>Scadenza</dt><dd>{itDate(expiry)}</dd></div><div><dt>Cartone</dt><dd>{found.piecesPerCarton ? `${found.piecesPerCarton} pezzi` : '—'}</dd></div></dl>
      <p className="ipad-help">Lotto = data di oggi (AAMMGG); scadenza = oggi + {months} mesi. {productionArea(state) ? `Alla chiusura i cartoni entrano in ${productionArea(state)}.` : 'Area di carico non impostata: la chiusura non caricherà il magazzino.'}</p>
      <div className="ipad-grid two"><label className="ipad-field"><span>Operatore</span><input value={operator} onChange={e => setOperator(e.target.value)} placeholder="Nome di chi lavora sulla linea" autoComplete="name"/></label>
      <label className="ipad-field"><span>Impasto (IDENT.)</span><input value={ident} maxLength={20} onChange={e => setIdent(e.target.value)} placeholder="Es. 02/F" autoCapitalize="characters" autoComplete="off"/></label></div>
      <button className="ipad-btn primary wide" disabled={busy || !operator.trim() || !ident.trim() || !can('production.start')} onClick={() => void start()}><Play size={24}/>Avvia produzione</button>
      {!ident.trim() && <p className="ipad-help">Indica l’impasto di questa produzione: è obbligatorio e va sull’etichetta.</p>}
      <LabelPreview product={found} lotCode={lot} expiry={expiry} settings={state.settings} ident={ident.trim().toUpperCase() || undefined}/>
    </div>}
  </section>;
}

function NewProduct({ reading: r, can, busy, send }: Omit<ViewProps, 'state'> & { reading: LabelScan['reading'] }) {
  const [code, setCode] = useState(r.code ?? ''); const [name, setName] = useState(r.name ?? ''); const [ean, setEan] = useState(r.ean ?? ''); const [wording, setWording] = useState(r.description ?? '');
  const [pieces, setPieces] = useState(r.piecesPerCarton ? String(r.piecesPerCarton) : ''); const [weight, setWeight] = useState(r.pieceWeightG ? String(r.pieceWeightG) : ''); const [months, setMonths] = useState(String(r.shelfLifeMonths ?? DEFAULT_SHELF_LIFE_MONTHS));
  if (!can('product.add')) return <div className="ipad-alert amber"><CircleAlert size={22}/><span>L’articolo {r.code ? `«${r.code}»` : ''} non è nel catalogo. Chiedi all’amministrazione di crearlo (anche da qui, con la stessa foto).</span></div>;
  async function create() {
    const product = { code: code.trim(), name: name.trim(), kind: 'finished' as const, unit: 'CRT', unitsPerBox: 1, minStock: 0, ...(ean.trim() ? { ean: ean.trim() } : {}), ...(Number(pieces) > 0 ? { piecesPerCarton: Number(pieces) } : {}), ...(Number(weight) > 0 ? { pieceWeightG: Number(weight) } : {}), ...(Number(months) > 0 ? { shelfLifeMonths: Number(months) } : {}), ...(wording.trim() ? { labelDescription: wording.trim().slice(0, 160) } : {}), ...(r.ingredients ? { ingredients: r.ingredients } : {}), ...(r.storage ? { storage: r.storage } : {}) };
    // Once saved, the parent recognises the new article from the same reading (code or EAN).
    await send({ type: 'product.add', product }, `Articolo ${product.code} creato dall’etichetta`);
  }
  return <div className="ipad-new"><h2><PackagePlus size={22}/>Nuovo articolo dall’etichetta</h2><p className="ipad-help">Non è nel catalogo. Controlla i dati letti e crealo: unità CRT (giacenza in cartoni).</p>
    <div className="ipad-grid">
      <label className="ipad-field"><span>Codice</span><input value={code} onChange={e => setCode(e.target.value)}/></label>
      <label className="ipad-field"><span>EAN</span><input value={ean} inputMode="numeric" onChange={e => setEan(e.target.value)}/></label>
      <label className="ipad-field span2"><span>Descrizione articolo (nome nel catalogo)</span><input value={name} onChange={e => setName(e.target.value)}/></label>
      <label className="ipad-field span3"><span>Dicitura in etichetta</span><input value={wording} maxLength={160} onChange={e => setWording(e.target.value)} placeholder="Es. Prodotto da forno crudo congelato"/></label>
      <label className="ipad-field"><span>Pezzi per cartone</span><input type="number" inputMode="numeric" value={pieces} onChange={e => setPieces(e.target.value)}/></label>
      <label className="ipad-field"><span>Peso del pezzo (g)</span><input type="number" inputMode="numeric" value={weight} onChange={e => setWeight(e.target.value)}/></label>
      <label className="ipad-field"><span>Durata (mesi)</span><input type="number" inputMode="numeric" value={months} onChange={e => setMonths(e.target.value)}/></label>
    </div>
    <button className="ipad-btn primary wide" disabled={busy || !code.trim() || !name.trim()} onClick={() => void create()}><Factory size={22}/>Crea l’articolo</button>
  </div>;
}

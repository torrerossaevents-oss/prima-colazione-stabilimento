"use client";
import { useState, useEffect, useRef, type ReactNode, type FormEvent } from 'react';
import { LayoutDashboard, Package, Factory, ClipboardList, History, Settings2, ArrowUpRight, ArrowRight, Plus, Search, ChevronRight, X, Check, ScanLine, Box, Wheat, Layers3, Truck, Download, CircleHelp, ShieldCheck, CircleAlert, Cable, Play, Save, Menu, RefreshCw, Camera, CheckCircle2, MapPin, FileText } from 'lucide-react';
import { initialState, activeSession, availableForLot, reservedForLot, productTotals, todayRome, type State, type Action } from '../lib/domain';
type View = 'overview' | 'inventory' | 'production' | 'orders' | 'history' | 'settings';
type Modal = {
    type: string;
    id?: string;
} | null;
type WorkspaceResponse = {
    state: State;
    version: number;
    error?: string;
};
const navigation = [
    { id: 'overview', name: 'Panoramica', icon: LayoutDashboard }, { id: 'inventory', name: 'Magazzino', icon: Package },
    { id: 'production', name: 'Produzione', icon: Factory }, { id: 'orders', name: 'Ordini', icon: ClipboardList },
    { id: 'history', name: 'Storico attività', icon: History },
] as const;
const viewNames: Record<View, string> = { overview: 'Panoramica', inventory: 'Magazzino', production: 'Produzione', orders: 'Ordini', history: 'Storico attività', settings: 'Configurazione' };
const descriptions: Record<View, string> = { overview: 'Scorte, lavorazioni e consegne in un unico spazio.', inventory: 'Quantità disponibili, lotti e ubicazioni sempre chiari.', production: 'Un articolo alla volta. Ogni lavorazione rimane salvata.', orders: 'Dalla prenotazione della merce alla consegna.', history: 'Ritrova ogni operazione, con data e dettagli.', settings: 'I collegamenti e le regole del tuo spazio di lavoro.' };
const n = (v: number) => new Intl.NumberFormat('it-IT').format(v);
const date = (v: string, time = false) => new Intl.DateTimeFormat('it-IT', { day: '2-digit', month: 'short', ...(time ? { hour: '2-digit', minute: '2-digit' } : {}), timeZone: 'Europe/Rome' }).format(new Date(v.length === 10 ? v + 'T12:00:00Z' : v));
const statusName: Record<string, string> = { reserved: 'Da preparare', prepared: 'Pronto alla partenza', partial: 'Consegna parziale', dispatched: 'Consegnato', cancelled: 'Annullato' };
const kindName: Record<string, string> = { finished: 'Prodotto finito', raw: 'Materia prima', packaging: 'Imballaggio' };
function Empty({ icon: Icon = Box, title, children, action }: {
    icon?: typeof Box;
    title: string;
    children: ReactNode;
    action?: ReactNode;
}) { return <div className="empty-state"><div className="empty-icon"><Icon size={27}/></div><h3>{title}</h3><p>{children}</p>{action}</div>; }
function Field({ label, children, hint, wide = false }: {
    label: string;
    children: ReactNode;
    hint?: string;
    wide?: boolean;
}) { return <label className={'field ' + (wide ? 'span-2' : '')}><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>; }
function DownloadFile(filename: string, content: string, type: string) { const url = URL.createObjectURL(new Blob([content], { type })); const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url); }
function CameraScan({ onCode, onClose }: {
    onCode: (code: string) => void;
    onClose: () => void;
}) {
    const video = useRef<HTMLVideoElement>(null);
    const [error, setError] = useState('');
    useEffect(() => {
        let stopped = false;
        let stream: MediaStream | undefined;
        let timer: ReturnType<typeof setTimeout>;
        (async () => {
            try {
                const Detector = (window as any).BarcodeDetector;
                if (!Detector)
                    throw new Error('La fotocamera per i codici non è supportata da questo browser. Usa un lettore oppure digita il codice.');
                stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
                if (stopped) {
                    stream.getTracks().forEach(t => t.stop());
                    return;
                }
                if (video.current) {
                    video.current.srcObject = stream;
                    await video.current.play();
                }
                const detector = new Detector();
                async function scan() { if (stopped)
                    return; try {
                    if (video.current && video.current.readyState >= 2) {
                        const codes = await detector.detect(video.current);
                        if (codes[0]?.rawValue) {
                            onCode(codes[0].rawValue);
                            return;
                        }
                    }
                }
                catch { } timer = setTimeout(scan, 250); }
                scan();
            }
            catch (e) {
                if (!stopped)
                    setError(e instanceof Error ? e.message : 'Fotocamera non disponibile.');
            }
        })();
        return () => { stopped = true; clearTimeout(timer); stream?.getTracks().forEach(t => t.stop()); };
    }, []);
    return <div className="notice"><div className="split"><b>Inquadra il codice dell’articolo</b><button type="button" className="icon-button" onClick={onClose} aria-label="Chiudi fotocamera"><X size={18}/></button></div>{error ? <p>{error}</p> : <video ref={video} playsInline muted style={{ width: '100%', maxHeight: 240, borderRadius: 8 }}/>}</div>;
}
export default function StabilimentoApp() {
    const [state, setState] = useState<State>(initialState);
    const [version, setVersion] = useState(0);
    const [loaded, setLoaded] = useState(false);
    const [view, setView] = useState<View>('overview');
    const [mobile, setMobile] = useState(false);
    const [search, setSearch] = useState('');
    const [tab, setTab] = useState('lots');
    const [orderFilter, setOrderFilter] = useState('open');
    const [modal, setModal] = useState<Modal>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [toast, setToast] = useState('');
    const [code, setCode] = useState('');
    const [camera, setCamera] = useState(false);
    const [online, setOnline] = useState(true);
    const dialog = useRef<HTMLElement>(null);
    const [orderRows, setOrderRows] = useState([{ lotId: '', quantity: 1 }]);
    const retry = useRef<{
        key: string;
        id: string;
        version: number;
    } | null>(null);
    const [pending, setPending] = useState(false);
    const pendingKey = "prima-colazione-pending-v1";
    function clearPending() { retry.current = null; setPending(false); sessionStorage.removeItem(pendingKey); }
    const today = todayRome();
    const current = activeSession(state);
    const openOrders = state.orders.filter(o => !['dispatched', 'cancelled'].includes(o.status));
    const near = state.lots.filter(l => l.quantity > 0 && l.expiry && l.expiry <= new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10));
    const lows = state.products.filter(p => p.minStock > 0 && productTotals(state, p.id).available < p.minStock);
    const produced = state.sessions.filter(s => s.day === today).reduce((a, s) => a + s.cartons, 0);
    const product = (id: string) => state.products.find(p => p.id === id);
    async function reload() { try {
        const res = await fetch('/api/workspace', { cache: 'no-store' });
        const data = await res.json() as WorkspaceResponse;
        if (!res.ok)
            throw new Error(data.error || 'Impossibile leggere i dati.');
        setState(data.state);
        setVersion(data.version);
        setLoaded(true);
        setError('');
    }
    catch (e) {
        setError(e instanceof Error ? e.message : 'Connessione non disponibile.');
    } }
    useEffect(() => {
        try { const saved = JSON.parse(sessionStorage.getItem(pendingKey) || 'null');
            if (saved && typeof saved.key === 'string' && typeof saved.id === 'string' && Number.isSafeInteger(saved.version)) { retry.current = saved; setPending(true); }
        } catch { setError('Impossibile recuperare la richiesta sospesa. Controlla lo storico prima di ripetere operazioni.'); }
        reload(); const listener = () => { const id = location.hash.slice(1); if (id in viewNames)
        setView(id as View); }; listener(); window.addEventListener('hashchange', listener); const connection = () => setOnline(navigator.onLine); connection(); window.addEventListener('online', connection); window.addEventListener('offline', connection); return () => { window.removeEventListener('hashchange', listener); window.removeEventListener('online', connection); window.removeEventListener('offline', connection); }; }, []);
    useEffect(() => { if (!modal)
        return; const before = document.activeElement as HTMLElement | null; const el = dialog.current; const focusable = () => Array.from(el?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select,textarea,a[href]') || []); focusable().find(x => x.tagName === 'INPUT')?.focus(); const key = (e: KeyboardEvent) => { if (e.key !== 'Tab')
        return; const list = focusable(); if (!list.length)
        return; const first = list[0], last = list[list.length - 1]; if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
    }
    else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
    } }; document.addEventListener('keydown', key); return () => { document.removeEventListener('keydown', key); before?.focus(); }; }, [modal]);
    useEffect(() => { if (toast) {
        const t = setTimeout(() => setToast(''), 4500);
        return () => clearTimeout(t);
    } }, [toast]);
    useEffect(() => { const closeMenu = (e: KeyboardEvent) => { if (e.key === 'Escape') setMobile(false); }; if (mobile) document.addEventListener('keydown', closeMenu); return () => document.removeEventListener('keydown', closeMenu); }, [mobile]);
    function go(v: View) { setView(v); location.hash = v; setSearch(''); setMobile(false); }
    function open(type: string, id?: string) { setError(''); setCode(''); setCamera(false); setOrderRows([{ lotId: '', quantity: 1 }]); setModal({ type, id }); }
    async function act(action: Action, message = 'Operazione salvata') {
        if (busy)
            return;
        const key = JSON.stringify(action);
        if (retry.current && retry.current.key !== key) { setError('Prima verifica l’operazione in attesa di conferma. Chiudi questa finestra e usa il pulsante di recupero.'); return false; }
        setBusy(true);
        setError('');
        if (!retry.current) retry.current = { key, id: crypto.randomUUID(), version };
        try {
            sessionStorage.setItem(pendingKey, JSON.stringify(retry.current));
            setPending(true);
            const res = await fetch('/api/workspace', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, expectedVersion: retry.current.version, requestId: retry.current.id }) });
            const data = await res.json() as WorkspaceResponse;
            if (!res.ok) {
                if (res.status >= 400 && res.status < 500) clearPending();
                if (res.status === 409) await reload();
                throw new Error(data.error || 'Salvataggio non riuscito.');
            }
            setState(data.state);
            setVersion(data.version);
            clearPending();
            setModal(null);
            setToast(message);
            return true;
        }
        catch (e) {
            setError(e instanceof Error ? e.message : 'Salvataggio non confermato. Riprova la stessa operazione: non sarà duplicata.');
            return false;
        }
        finally {
            setBusy(false);
        }
    }
    const disabled = busy || !loaded || !online;
    const primary = (text: string, type: string, Icon = Plus) => <button className="button primary" disabled={disabled} onClick={() => open(type)}><Icon size={17}/>{text}</button>;
    function exportCSV() { const rows = [['Codice', 'Articolo', 'Lotto', 'Scadenza', 'Area', 'Presenti', 'Bloccati', 'Prenotati', 'Disponibili', 'Unita'], ...state.lots.map(l => [product(l.productId)?.code, product(l.productId)?.name, l.code, l.expiry, l.area, l.quantity, l.blocked, reservedForLot(state, l.id), availableForLot(state, l.id), product(l.productId)?.unit])]; DownloadFile('prima-colazione-magazzino-' + today + '.csv', '\uFEFF' + rows.map(r => r.map(v => '"' + String(v ?? '').replaceAll('"', '""').replace(/^[=+@-]/, "'$&") + '"').join(';')).join('\r\n'), 'text/csv;charset=utf-8'); }
    async function submit(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const str = (k: string) => String(fd.get(k) || '').trim();
        const num = (k: string) => Number(fd.get(k));
        if (!modal)
            return;
        const id = modal.id || '';
        let action: Action;
        switch (modal.type) {
            case 'product':
                action = { type: 'product.add', product: { code: str('code'), name: str('name'), kind: str('kind') as any, unit: str('unit'), unitsPerBox: num('unitsPerBox'), minStock: num('minStock') } };
                break;
            case 'receive':
                action = { type: 'lot.receive', lot: { productId: str('productId'), code: str('lotCode'), expiry: str('expiry'), area: str('area'), quantity: num('quantity') } };
                break;
            case 'order':
                action = { type: 'order.create', order: { customer: str('customer'), destination: str('destination'), date: str('date'), lines: orderRows } };
                break;
            case 'start':
                action = { type: 'production.start', code, operator: str('operator'), lotCode: str('lotCode'), expiry: str('expiry') };
                break;
            case 'count':
                action = { type: 'production.count', sessionId: id, cartons: num('cartons') };
                break;
            case 'close':
                action = { type: 'production.close', sessionId: id };
                break;
            case 'block':
                action = { type: 'lot.block', lotId: id, blocked: num('blocked') };
                break;
            case 'transfer':
                action = { type: 'lot.transfer', lotId: id, quantity: num('quantity'), area: str('area') };
                break;
            case 'adjust':
                action = { type: 'lot.adjust', lotId: id, delta: num('delta'), reason: str('reason'), responsible: str('responsible') };
                break;
            case 'document':
                action = { type: 'order.document', orderId: id, documentRef: str('documentRef') };
                break;
            case 'dispatch': {
                const order = state.orders.find(o => o.id === id)!;
                action = { type: 'order.dispatch', orderId: id, documentRef: str('documentRef'), quantities: order.lines.map(l => ({ lotId: l.lotId, quantity: num('qty-' + l.lotId) })).filter(l => l.quantity > 0) };
                break;
            }
            case 'cancel':
                action = { type: 'order.cancel', orderId: id };
                break;
            default: return;
        }
        await act(action);
    }
    const selectedLot = state.lots.find(l => l.id === modal?.id);
    const selectedOrder = state.orders.find(o => o.id === modal?.id);
    const matched = state.products.find(p => p.code.toLowerCase() === code.trim().toLowerCase() && p.kind === 'finished');
    const filteredLots = state.lots.filter(l => (product(l.productId)?.name + ' ' + product(l.productId)?.code + ' ' + l.code + ' ' + l.area).toLowerCase().includes(search.toLowerCase()));
    const filteredProducts = state.products.filter(p => (p.name + ' ' + p.code).toLowerCase().includes(search.toLowerCase()));
    function orderCard(o: State['orders'][number]) { return <article className="order-card" key={o.id}><div className="order-head"><div><span className="eyebrow">{o.id.slice(0, 8).toUpperCase()}</span><h3>{o.customer}</h3><p className="muted"><MapPin size={13}/> {o.destination} · {date(o.date)}</p></div><span className={'chip ' + (o.status === 'dispatched' ? 'green' : 'gray')}>{statusName[o.status]}</span></div><div className="order-lines">{o.lines.map(l => { const lot = state.lots.find(x => x.id === l.lotId); const p = product(lot?.productId || ''); return <div className="split" key={l.lotId}><div><b>{p?.name}</b><small className="cell-sub">Lotto {lot?.code}</small></div><span>{n(l.quantity)} {p?.unit}<small className="cell-sub">{n(l.shipped || 0)} consegnati</small></span></div>; })}</div><div className="page-actions">{o.status === 'reserved' && <button className="button secondary small" disabled={disabled} onClick={() => act({ type: 'order.prepare', orderId: o.id }, 'Ordine pronto alla partenza')}><Check size={15}/>Segna pronto</button>}{['prepared', 'partial'].includes(o.status) && <button className="button primary small" disabled={disabled} onClick={() => open('dispatch', o.id)}><Truck size={15}/>Registra partenza</button>}{!['dispatched', 'cancelled'].includes(o.status) && <button className="button ghost small" disabled={disabled} onClick={() => open('cancel', o.id)}>Annulla residuo</button>}{o.lines.some(l => l.shipped > 0) && <button className="button secondary small" disabled={disabled} onClick={() => open('document', o.id)}><FileText size={15}/>Collega documento</button>}</div>{o.documentRef && <p className="form-help">Documento: {o.documentRef}</p>}</article>; }
    return <div className="app-shell">
 {mobile && <button className="sidebar-backdrop" aria-label="Chiudi menu" onClick={() => setMobile(false)} />}
 <aside className={'sidebar ' + (mobile ? 'open' : '')}><a className="brand" href="#overview" onClick={() => go('overview')}><div className="brand-mark"><Wheat size={25}/></div><div><div className="brand-name">prima colazione<span>.</span></div><div className="brand-sub">STABILIMENTO</div></div></a><div className="nav-label">SPAZIO DI LAVORO</div><nav aria-label="Navigazione principale">{navigation.map(item => <button key={item.id} className={'nav-item ' + (view === item.id ? 'active' : '')} aria-current={view === item.id ? 'page' : undefined} onClick={() => go(item.id)}><item.icon size={19}/><span>{item.name}</span>{item.id === 'orders' && openOrders.length > 0 && <span className="nav-count">{openOrders.length}</span>}{view === item.id && <span className="status-dot"/>}</button>)}</nav><div className="sidebar-bottom"><div className="site-status"><span className="status-dot"/><div><b>Il tuo stabilimento</b><small>Un unico spazio, tutto collegato</small></div></div><button className={'nav-item ' + (view === 'settings' ? 'active' : '')} onClick={() => go('settings')}><Settings2 size={19}/>Configurazione</button><button className="nav-item" onClick={() => open('help')}><CircleHelp size={19}/>Guida rapida</button><div className="sidebar-user"><span className="avatar">PC</span><div><b>Prima Colazione</b><small>Area riservata</small></div><ShieldCheck size={17}/></div></div></aside>
 <div className="main-shell"><header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" aria-label={mobile ? "Chiudi navigazione" : "Apri navigazione"} aria-expanded={mobile} onClick={() => setMobile(!mobile)}><Menu size={22}/></button><span>Stabilimento</span><ChevronRight size={14}/><b>{viewNames[view]}</b></div><div className="topbar-right"><span className={'chip ' + (loaded && online ? 'green' : 'amber')}><span className="status-dot"/>{!online ? 'Offline' : loaded ? 'Archivio connesso' : 'Connessione…'}</span><button className="icon-button" aria-label="Aggiorna dati" onClick={reload} disabled={busy}><RefreshCw size={17}/></button><span className="avatar">PC</span></div></header>
 <main key={view} className="page-content view-content"><div className="page-heading"><div><div className="eyebrow">PRIMA COLAZIONE / {view === 'overview' ? 'IL TUO SPAZIO DI LAVORO' : 'STABILIMENTO'}</div><h1>{view === 'overview' ? 'La giornata, sotto controllo.' : viewNames[view]}</h1><p>{descriptions[view]}</p></div><div className="page-actions">{view === 'overview' && <span className="muted date-label">{new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Rome' }).format(new Date())}</span>}{view === 'inventory' && <><button className="button secondary" onClick={exportCSV} disabled={!loaded}><Download size={16}/>Esporta</button>{primary(tab === 'catalog' ? 'Nuovo articolo' : 'Registra entrata', tab === 'catalog' ? 'product' : 'receive')}</>}{view === 'production' && !current && primary('Nuova lavorazione', 'start', ScanLine)}{view === 'orders' && primary('Nuovo ordine', 'order')}</div></div>
 {!modal && pending && <div className="notice amber"><CircleAlert size={20}/><div><b>Un’operazione attende conferma</b><p>Completa il recupero prima di registrare altro. Il controllo usa la stessa richiesta e non duplica un salvataggio già riuscito.</p><button className="button secondary small" disabled={busy || !loaded || !online} onClick={() => { if (retry.current) act(JSON.parse(retry.current.key) as Action, 'Operazione verificata e salvata'); }}>Verifica operazione sospesa</button></div></div>}
 {!modal && error && <div role="alert" className="alert-error">{error} <button className="button small secondary" onClick={reload}>Ricarica dati</button></div>}
 {!online && <div className="notice amber"><CircleAlert size={19}/><div><b>Connessione assente</b><p>I dati visualizzati possono non essere aggiornati. Le operazioni ripartiranno quando torna la connessione.</p></div></div>}
 {view === 'overview' && <>
 <div className="stat-grid">{[{ label: 'Articoli in catalogo', value: state.products.length, note: 'Prodotti, materie prime e imballi', icon: Package }, { label: 'Cartoni di oggi', value: produced, note: 'Conteggi manuali registrati', icon: Box }, { label: 'Ordini aperti', value: openOrders.length, note: 'Da preparare o consegnare', icon: ClipboardList }, { label: 'Scadenze da controllare', value: near.length, note: 'Entro 7 giorni o già scaduti', icon: CircleAlert }].map(s => <div className="stat-card" key={s.label}><div className="stat-top"><span>{s.label}</span><s.icon size={19}/></div><div className="stat-value">{loaded ? n(s.value) : '—'}</div><div className="stat-note">{s.note}</div></div>)}</div>
 <div className="quick-actions"><button className="quick-action" disabled={disabled} onClick={() => open('receive')}><span className="quick-icon"><Package size={23}/></span><span><b>Registra un’entrata</b><small>Aggiorna le quantità ricevute</small></span><ArrowUpRight size={20}/></button><button className="quick-action" disabled={disabled} onClick={() => current ? go('production') : open('start')}><span className="quick-icon"><ScanLine size={23}/></span><span><b>{current ? 'Vai alla lavorazione' : 'Avvia una lavorazione'}</b><small>Identifica l’articolo e inizia</small></span><ArrowUpRight size={20}/></button><button className="quick-action" disabled={disabled} onClick={() => open('order')}><span className="quick-icon"><ClipboardList size={23}/></span><span><b>Prepara un ordine</b><small>Prenota la merce disponibile</small></span><ArrowUpRight size={20}/></button></div>
 <div className="dashboard-grid"><div className="stack"><section className="panel"><div className="panel-head"><h2>Ordini in lavorazione</h2><button className="section-link" onClick={() => go('orders')}>Tutti gli ordini <ArrowRight size={15}/></button></div>{openOrders.length ? <div className="panel-body stack">{openOrders.slice(0, 3).map(orderCard)}</div> : <Empty icon={ClipboardList} title="Nessun ordine da completare">Qui trovi gli ordini aperti e la merce da preparare per le prossime consegne.<button className="section-link" disabled={disabled} onClick={() => open('order')}>Crea il primo ordine <ArrowRight size={15}/></button></Empty>}</section>
 <section className="panel"><div className="panel-head"><h2>Da controllare</h2><span className="chip gray">{near.length + lows.length} segnalazioni</span></div><div className="panel-body">{!near.length && !lows.length ? <div className="split"><span className="quick-icon"><ShieldCheck size={23}/></span><div style={{ flex: 1 }}><b>{state.lots.length ? 'Nessuna scadenza vicina' : 'Scadenze e scorte, in evidenza'}</b><p className="muted">{state.lots.length ? 'Qui trovi lotti in scadenza e articoli sotto scorta.' : 'Registra i lotti per vedere le scadenze vicine e gli articoli sotto scorta.'}</p></div></div> : <div className="stack">{near.slice(0, 4).map(l => <button className="step-row" key={l.id} onClick={() => go('inventory')}><CircleAlert size={18}/><span><b>{product(l.productId)?.name}</b><small>Lotto {l.code} · {date(l.expiry)}</small></span><span className="chip amber">{l.expiry < today ? 'Scaduto' : 'In scadenza'}</span></button>)}{lows.slice(0, 3).map(p => <button className="step-row" key={p.id} onClick={() => go('inventory')}><Package size={18}/><span><b>{p.name}</b><small>Disponibili {productTotals(state, p.id).available} {p.unit}</small></span><span className="chip amber">Sotto scorta</span></button>)}</div>}</div></section>
 <section className="panel"><div className="panel-head"><h2>Attività recenti</h2><button className="section-link" onClick={() => go('history')}>Vedi tutte <ArrowRight size={15}/></button></div><div className="panel-body">{state.audit.length ? <div className="timeline">{[...state.audit].reverse().slice(0, 3).map(a => <div className="timeline-item" key={a.id}><span className="timeline-dot"/><div><b>{a.detail}</b><small>{date(a.at, true)}</small></div></div>)}</div> : <p className="muted">Le nuove operazioni compariranno qui dopo il salvataggio.</p>}</div></section></div>
 <div className="stack"><section className="counter-card"><div className="split"><span className="eyebrow">PRODUZIONE</span><Factory size={22}/></div><h2>{current ? 'Lavorazione in corso' : 'Inizia la prossima lavorazione'}</h2><p>{current ? current.productName : 'Identifica il prodotto, conferma i dati e registra i cartoni.'}</p>{current ? <div className="counter-number">{n(current.cartons)} <small>cartoni</small></div> : <div className="flow-strip"><span className="flow-step"><ScanLine size={22}/></span><span>···</span><span className="flow-step"><Box size={22}/></span><span>···</span><span className="flow-step"><Save size={22}/></span></div>}<button className="button" disabled={disabled} onClick={() => current ? go('production') : open('start')}>{current ? 'Apri lavorazione' : 'Nuova lavorazione'}<ArrowRight size={16}/></button><small>Registrazione manuale · fotocellule da collegare</small></section>
 <section className="panel"><div className="panel-head"><h2>{state.products.length && state.lots.length ? 'Il flusso di lavoro' : 'Configura il tuo magazzino'}</h2><span className="chip gray">{[state.products.length > 0, state.lots.length > 0, state.orders.length > 0].filter(Boolean).length}/3</span></div><div className="panel-body step-list">{[{ title: 'Inserisci gli articoli', text: 'Codice, unità e pezzi per cartone', done: state.products.length > 0, type: 'product' }, { title: 'Registra le scorte iniziali', text: 'Quantità reali, lotti e ubicazioni', done: state.lots.length > 0, type: 'receive' }, { title: 'Registra il primo ordine', text: 'Destinazione e merce da preparare', done: state.orders.length > 0, type: 'order' }].map((s, i) => <button className="step-row" key={s.title} disabled={disabled} onClick={() => open(s.type)}><span className={'step-number ' + (s.done ? 'done' : '')}>{s.done ? <Check size={16}/> : i + 1}</span><span><b>{s.title}</b><small>{s.text}</small></span><ChevronRight size={16}/></button>)}</div></section><p className="footer-note"><ShieldCheck size={15}/>Spazio riservato · archivio sul server</p></div></div>
 </>}
 {view === 'inventory' && <><div className="panel"><div className="toolbar"><div className="tabs"><button className={'tab ' + (tab === 'lots' ? 'active' : '')} onClick={() => setTab('lots')}>Giacenze e lotti <span>{state.lots.length}</span></button><button className={'tab ' + (tab === 'catalog' ? 'active' : '')} onClick={() => setTab('catalog')}>Catalogo articoli <span>{state.products.length}</span></button></div><label className="search-field"><Search size={17}/><input aria-label="Cerca in magazzino" placeholder="Cerca articolo, codice o lotto…" value={search} onChange={e => setSearch(e.target.value)}/></label></div>
 {tab === 'lots' ? filteredLots.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Articolo / lotto</th><th>Ubicazione</th><th>Scadenza</th><th>Presenti</th><th>Prenotati</th><th>Bloccati</th><th>Disponibili</th><th>Operazioni</th></tr></thead><tbody>{filteredLots.map(l => { const p = product(l.productId); return <tr key={l.id}><td><div className="product-cell"><span className="product-icon"><Box size={19}/></span><div><b>{p?.name}</b><span className="cell-sub">{p?.code} · Lotto {l.code}</span></div></div></td><td>{l.area}</td><td><span className={'chip ' + (l.expiry && l.expiry <= today ? 'amber' : 'gray')}>{l.expiry ? date(l.expiry) : 'Non prevista'}</span></td><td>{n(l.quantity)}<small className="cell-sub">{p?.unit}</small></td><td>{n(reservedForLot(state, l.id))}</td><td>{n(l.blocked)}</td><td><b>{n(availableForLot(state, l.id))}</b></td><td><div className="page-actions"><button className="button ghost small" disabled={disabled} onClick={() => open('block', l.id)}>Blocco</button><button className="button ghost small" disabled={disabled} onClick={() => open('transfer', l.id)}>Sposta</button><button className="button ghost small" disabled={disabled} onClick={() => open('adjust', l.id)}>Rettifica</button></div></td></tr>; })}</tbody></table></div> : <Empty title={search ? 'Nessun risultato' : 'Il magazzino inizia dal primo conteggio'}>Registra solo la merce effettivamente presente, con lotto e ubicazione.{!search && <button className="section-link" disabled={disabled} onClick={() => open(state.products.length ? 'receive' : 'product')}>{state.products.length ? 'Registra un’entrata' : 'Inserisci il primo articolo'}<ArrowRight size={15}/></button>}</Empty> : filteredProducts.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Articolo</th><th>Tipologia</th><th>Unità</th><th>Unità per cartone</th><th>Scorta minima</th><th>Disponibili</th></tr></thead><tbody>{filteredProducts.map(p => <tr key={p.id}><td><b>{p.name}</b><span className="cell-sub mono">{p.code}</span></td><td>{kindName[p.kind]}</td><td>{p.unit}</td><td>{p.unitsPerBox}</td><td>{p.minStock || 'Non impostata'}</td><td><b>{productTotals(state, p.id).available}</b></td></tr>)}</tbody></table></div> : <Empty icon={Layers3} title={search ? 'Nessun risultato' : 'Un catalogo unico per tutti'}>Inserisci i codici che usate sulle etichette. Il catalogo collega magazzino, produzione e ordini.</Empty>}
 </div><p className="footer-note">Disponibile = presente − bloccato − prenotato. I lotti scaduti non sono prenotabili. Quantità espresse nell’unità dell’articolo.</p></>}
 {view === 'production' && <><div className="notice amber"><Cable size={21}/><div><b>Produzione in modalità manuale</b><p>Le fotocellule sono da collegare. Per ora registra i cartoni contati: la chiusura non carica automaticamente il magazzino.</p></div></div><div className="dashboard-grid"><section className="panel"><div className="panel-head"><h2>Postazione produzione</h2><span className={'chip ' + (current ? 'green' : 'gray')}>{current ? 'Lavorazione aperta' : 'In attesa'}</span></div>{current ? <div className="panel-body"><div className="split"><div><span className="eyebrow">{current.productCode}</span><h2>{current.productName}</h2><p className="muted">Lotto {current.lotCode} · {current.operator}</p></div><span className="chip gray">Manuale</span></div><div className="counter-number" style={{ color: 'var(--ink)', margin: '30px 0' }}>{n(current.cartons)} <small>cartoni</small></div><div className="stat-note">{n(current.cartons * current.unitsPerBox)} unità registrate · {current.unitsPerBox} unità per cartone</div><div className="counter-controls"><button className="button secondary" disabled={disabled} onClick={() => open('count', current.id)}><Plus size={17}/>Aggiungi cartoni</button><button className="button primary" disabled={disabled} onClick={() => open('close', current.id)}><Save size={17}/>Chiudi / salva lavorazione</button></div><p className="form-help">Avviata {date(current.startedAt, true)}. Una sola lavorazione aperta per volta.</p></div> : <Empty icon={ScanLine} title="Scegli l’articolo da produrre">Leggi il codice con un lettore o con la fotocamera supportata. Controlla il prodotto prima di avviare.<button className="button primary" disabled={disabled} onClick={() => open('start')}><ScanLine size={17}/>Identifica articolo</button></Empty>}</section><section className="panel"><div className="panel-head"><h2>Il flusso di produzione</h2></div><div className="panel-body step-list">{[['Identifica', 'Scansiona il codice e conferma i dati.'], ['Registra', 'Ogni conteggio appartiene al suo articolo.'], ['Chiudi e salva', 'Conserva lo storico; la nuova lavorazione riparte da zero.']].map(([a, b], i) => <div className="step-row" key={a}><span className="step-number">{i + 1}</span><span><b>{a}</b><small>{b}</small></span></div>)}</div></section></div><section className="panel" style={{ marginTop: 24 }}><div className="panel-head"><h2>Lavorazioni salvate</h2><span className="chip gray">{state.sessions.filter(s => s.status === 'closed').length}</span></div>{state.sessions.some(s => s.status === 'closed') ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Articolo</th><th>Lotto</th><th>Operatore</th><th>Inizio</th><th>Cartoni</th><th>Unità</th></tr></thead><tbody>{[...state.sessions].reverse().filter(s => s.status === 'closed').map(s => <tr key={s.id}><td><b>{s.productName}</b><span className="cell-sub">{s.productCode}</span></td><td>{s.lotCode}</td><td>{s.operator}</td><td>{date(s.startedAt, true)}</td><td>{n(s.cartons)}</td><td>{n(s.cartons * s.unitsPerBox)}</td></tr>)}</tbody></table></div> : <div className="panel-body"><p className="muted">Le lavorazioni chiuse appariranno qui. Chiudere non cancella mai lo storico.</p></div>}</section></>}
 {view === 'orders' && <><div className="toolbar"><div className="tabs">{[['open', 'Da completare'], ['closed', 'Completati e annullati'], ['all', 'Tutti']].map(([id, label]) => <button className={'tab ' + (orderFilter === id ? 'active' : '')} key={id} onClick={() => setOrderFilter(id)}>{label}</button>)}</div><label className="search-field"><Search size={17}/><input aria-label="Cerca ordine" placeholder="Cerca cliente o destinazione…" value={search} onChange={e => setSearch(e.target.value)}/></label></div><div className="stack">{state.orders.filter(o => (o.customer + ' ' + o.destination).toLowerCase().includes(search.toLowerCase()) && (orderFilter === 'all' || (orderFilter === 'open' ? !['dispatched', 'cancelled'].includes(o.status) : ['dispatched', 'cancelled'].includes(o.status)))).map(orderCard)}{!state.orders.length && <section className="panel"><Empty icon={Truck} title="Registra il primo ordine">Crea l’ordine, prepara la merce e registra la partenza. Puoi gestire anche una consegna parziale.<button className="button primary" disabled={disabled} onClick={() => open('order')}><Plus size={17}/>Nuovo ordine</button></Empty></section>}</div><div className="notice" style={{ marginTop: 24 }}><FileText size={20}/><div><b>Una partenza, un solo scarico</b><p>La prenotazione lascia la merce in magazzino. La partenza con DDT la scarica. Collegare una fattura non modifica le quantità.</p></div></div></>}
 {view === 'history' && <section className="panel"><div className="panel-head"><h2>Registro delle operazioni</h2><button className="button secondary small" disabled={!loaded} onClick={() => DownloadFile('prima-colazione-archivio-' + today + '.json', JSON.stringify({ exportedAt: new Date().toISOString(), version, state }, null, 2), 'application/json')}><Download size={15}/>Esporta archivio</button></div>{state.audit.length ? <div className="panel-body timeline">{[...state.audit].reverse().map(a => <div className="timeline-item" key={a.id}><span className="timeline-dot"/><div><b>{a.detail}</b><small>{date(a.at, true)} · {a.id.slice(0, 8)}</small></div></div>)}</div> : <Empty icon={History} title="Lo storico parte dalla prima operazione">Entrate, prenotazioni, partenze e lavorazioni salvate: qui ritrovi lo storico delle operazioni.</Empty>}</section>}
 {view === 'settings' && <><div className="integration-grid">{[{ title: 'Archivio del gestionale', icon: ShieldCheck, status: loaded ? 'Connesso' : 'Non raggiungibile', ready: loaded, text: 'Catalogo, giacenze, ordini e lavorazioni vengono salvati sul server. Accesso riservato al proprietario.' }, { title: 'Conta-cartoni / Siemens LOGO!', icon: Cable, status: 'Da collegare', ready: false, text: 'Servono programma LOGO!, servizio sul PC locale e collaudo della linea. Per ora i conteggi sono manuali.' }, { title: 'TeamSystem', icon: FileText, status: 'Da verificare', ready: false, text: 'La contabilità rimane nel gestionale esistente. Qui puoi associare il riferimento di un documento a una consegna.' }, { title: 'Etichettatrice e ricette', icon: ScanLine, status: 'Da verificare', ready: false, text: 'Macchina, formato dei codici e ricette devono essere verificati prima di attivare automatismi.' }].map(c => <section className="panel integration-card" key={c.title}><div className="split"><span className="quick-icon"><c.icon size={24}/></span><span className={'chip ' + (c.ready ? 'green' : 'amber')}>{c.status}</span></div><h2>{c.title}</h2><p className="muted">{c.text}</p></section>)}</div><section className="panel" style={{ marginTop: 24 }}><div className="panel-head"><h2>Le regole condivise</h2></div><div className="panel-body form-grid"><div><h3>Un catalogo unico</h3><p className="muted">Codici univoci e confezionamento dichiarato. Fino a tre aree interne; i nomi si definiscono registrando le entrate.</p></div><div><h3>Dati e codice separati</h3><p className="muted">Il codice del progetto è trasferibile. Scorte, ordini e operatori restano nell’archivio riservato e non vanno pubblicati su GitHub.</p></div><div><h3>Accesso attuale</h3><p className="muted">Prima versione riservata al proprietario. Inviti e ruoli distinti per gli operatori devono ancora essere configurati.</p></div><div><h3>Esporta il tuo archivio</h3><p className="muted">Porta con te le registrazioni in JSON e le giacenze in CSV. Un’esportazione non sostituisce un backup automatico.</p><button className="section-link" onClick={() => go('history')}>Apri lo storico<ArrowRight size={15}/></button></div></div></section></>}
 <footer className="footer-note page-footer"><span>PRIMA COLAZIONE · STABILIMENTO</span><span>Magazzino. Produzione. Ordini.</span></footer>
 </main></div>
 {toast && <div role="status" className="toast"><CheckCircle2 size={19}/>{toast}</div>}
 {modal && <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget && !busy)
            setModal(null); }}><section ref={dialog} className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" onKeyDown={e => { if (e.key === 'Escape' && !busy)
            setModal(null); }}><header><div><span className="eyebrow">PRIMA COLAZIONE</span><h2 id="modal-title">{({ product: 'Nuovo articolo', receive: 'Registra un’entrata', order: 'Nuovo ordine', start: 'Nuova lavorazione', count: 'Aggiungi cartoni', close: 'Chiudi / salva lavorazione', block: 'Quantità bloccata', transfer: 'Sposta in un’altra area', adjust: 'Rettifica motivata', dispatch: 'Registra la partenza', document: 'Collega un documento', cancel: 'Annulla il residuo', help: 'Come usare lo stabilimento' } as Record<string, string>)[modal.type]}</h2></div><button className="icon-button" aria-label="Chiudi finestra" disabled={busy} onClick={() => setModal(null)}><X size={20}/></button></header>
 {modal.type === 'help' ? <div className="panel-body stack"><p>Inizia da <b>Magazzino → Catalogo articoli</b>, poi registra le quantità realmente presenti.</p><p>In <b>Produzione</b> identifica l’articolo, apri la lavorazione e aggiungi i cartoni contati. <b>Chiudi / salva</b> conserva la lavorazione e libera la postazione.</p><p>In <b>Ordini</b> prenota la merce per una destinazione, segna l’ordine pronto e registra la partenza con il riferimento del DDT.</p><p>In <b>Storico attività</b> controlla lo storico o esporta l’archivio. In <b>Configurazione</b> trovi lo stato dei collegamenti.</p><div className="notice amber">Questa versione usa registrazioni manuali. Le fotocellule non sono ancora collegate.</div></div> : <form onSubmit={submit}><div className="panel-body stack">{error && <div role="alert" className="alert-error">{error}</div>}
 {modal.type === 'product' && <div className="form-grid"><Field label="Nome articolo"><input name="name" autoFocus required placeholder="Nome usato in stabilimento" maxLength={120}/></Field><Field label="Codice etichetta"><input name="code" required placeholder="Barcode, QR o codice interno" maxLength={100}/></Field><Field label="Tipologia"><select name="kind"><option value="finished">Prodotto finito</option><option value="raw">Materia prima</option><option value="packaging">Imballaggio</option></select></Field><Field label="Unità di conteggio" hint="Usa un’unità intera, ad esempio confezioni o grammi."><input name="unit" required placeholder="es. confezioni" maxLength={30}/></Field><Field label="Unità per cartone"><input name="unitsPerBox" type="number" min="1" step="1" required placeholder="es. 12"/></Field><Field label="Scorta minima" hint="0 se non vuoi ancora impostarla."><input name="minStock" type="number" min="0" step="1" defaultValue="0" required/></Field></div>}
 {modal.type === 'receive' && (state.products.length ? <div className="form-grid"><Field label="Articolo" wide><select name="productId" required><option value="">Seleziona un articolo</option>{state.products.map(p => <option key={p.id} value={p.id}>{p.code} · {p.name} ({p.unit})</option>)}</select></Field><Field label="Lotto"><input name="lotCode" required placeholder="Codice lotto reale"/></Field><Field label="Scadenza" hint="Obbligatoria per prodotti e materie prime; facoltativa per gli imballaggi."><input name="expiry" type="date"/></Field><Field label="Ubicazione" hint="Fino a tre aree interne."><input name="area" required list="areas" placeholder="Nome dell’area"/></Field><Field label="Quantità effettiva" hint="Nell’unità dell’articolo, non in cartoni."><input name="quantity" type="number" required min="1" step="1"/></Field><p className="form-help span-2">Registra solo la merce ricevuta o contata. La stessa combinazione articolo, lotto e area viene aggiornata, non duplicata.</p></div> : <div className="notice">Prima inserisci almeno un articolo nel catalogo.<button className="button secondary" type="button" onClick={() => open('product')}>Inserisci articolo</button></div>)}
 {modal.type === 'start' && <><Field label="Scansiona o digita il codice articolo"><div className="search-field"><ScanLine size={19}/><input value={code} onChange={e => setCode(e.target.value)} onKeyDown={e => { if (e.key === 'Enter')
                e.preventDefault(); }} required autoFocus placeholder="Codice dell’etichetta"/></div></Field><button type="button" className="button secondary" onClick={() => setCamera(!camera)}><Camera size={17}/>Usa fotocamera</button>{camera && <CameraScan onClose={() => setCamera(false)} onCode={v => { setCode(v); setCamera(false); }}/>}{matched ? <div className="notice"><CheckCircle2 size={20}/><div><b>{matched.name}</b><p>{matched.code} · {matched.unitsPerBox} {matched.unit} per cartone</p></div></div> : code && <div className="notice amber">Codice non riconosciuto come prodotto finito. Controlla il catalogo.</div>}<div className="form-grid"><Field label="Operatore"><input name="operator" required placeholder="Nome del responsabile"/></Field><Field label="Lotto di produzione"><input name="lotCode" required/></Field><Field label="Scadenza"><input name="expiry" type="date" min={today} required/></Field></div><p className="form-help">Avvio in modalità manuale. Il conteggio riparte da zero; non attiva la macchina.</p></>}
 {modal.type === 'count' && <><Field label="Cartoni da aggiungere"><input name="cartons" type="number" min="1" step="1" required autoFocus/></Field><p className="form-help">Inserisci soltanto i cartoni aggiuntivi contati. Il totale verrà aggiornato dopo il salvataggio.</p></>}
 {modal.type === 'close' && <><div className="notice"><Save size={22}/><div><b>{current?.productName}</b><p>{current?.cartons} cartoni · Lotto {current?.lotCode}</p></div></div><p>La lavorazione viene salvata nello storico. Potrai iniziarne una nuova scegliendo di nuovo l’articolo.</p><p className="form-help">Non azzera lo storico e non carica il magazzino. È la chiusura del registro manuale.</p><label className="check-label"><input type="checkbox" required/>Ho verificato l’articolo e il conteggio finale.</label></>}
 {modal.type === 'order' && <><div className="form-grid"><Field label="Cliente / destinatario"><input name="customer" required autoFocus/></Field><Field label="Destinazione"><input name="destination" required/></Field><Field label="Data di consegna"><input name="date" type="date" required defaultValue={today}/></Field></div><div className="stack">{orderRows.map((row, i) => <div className="form-grid" key={i}><Field label={'Articolo e lotto ' + (i + 1)}><select required value={row.lotId} onChange={e => setOrderRows(r => r.map((v, j) => j === i ? { ...v, lotId: e.target.value } : v))}><option value="">Seleziona merce disponibile</option>{state.lots.filter(l => availableForLot(state, l.id) > 0).map(l => <option value={l.id} key={l.id}>{product(l.productId)?.name} · {l.code} · {availableForLot(state, l.id)} {product(l.productId)?.unit}</option>)}</select></Field><Field label="Quantità da prenotare"><div className="split"><input required type="number" min="1" step="1" value={row.quantity} onChange={e => setOrderRows(r => r.map((v, j) => j === i ? { ...v, quantity: Number(e.target.value) } : v))}/>{orderRows.length > 1 && <button type="button" className="icon-button" aria-label={'Rimuovi riga ' + (i + 1)} onClick={() => setOrderRows(r => r.filter((_, j) => j !== i))}><X size={17}/></button>}</div></Field></div>)}</div><button className="button secondary" type="button" onClick={() => setOrderRows(r => [...r, { lotId: '', quantity: 1 }])}><Plus size={16}/>Aggiungi riga</button><p className="form-help">La conferma prenota la merce. Il fisico verrà aggiornato soltanto alla partenza.</p></>}
 {modal.type === 'block' && <><p>{product(selectedLot?.productId || '')?.name} · Lotto {selectedLot?.code}</p><Field label="Quantità totale da tenere bloccata" hint="Inserisci 0 per sbloccare. La merce prenotata non può essere bloccata."><input name="blocked" type="number" min="0" step="1" defaultValue={selectedLot?.blocked} required/></Field></>}
 {modal.type === 'transfer' && <div className="form-grid"><Field label="Quantità da spostare"><input name="quantity" type="number" min="1" step="1" required/></Field><Field label="Area di destinazione"><input name="area" list="areas" required/></Field><p className="form-help span-2">Sposta solo quantità non bloccate e non prenotate. Il totale dello stabilimento rimane invariato.</p></div>}
 {modal.type === 'adjust' && <div className="form-grid"><Field label="Variazione di quantità" hint="Numero negativo per ridurre, positivo per aggiungere."><input name="delta" type="number" step="1" required/></Field><Field label="Responsabile della verifica"><input name="responsible" required/></Field><Field label="Motivo della rettifica" wide><textarea name="reason" required placeholder="Spiega il risultato del riconteggio o il motivo del movimento."/></Field><label className="check-label span-2"><input type="checkbox" required/>Ho verificato la quantità reale e sono autorizzato alla rettifica.</label></div>}
 {modal.type === 'dispatch' && <><p>Registra le quantità che partono realmente. Lascia a zero ciò che rimane da consegnare.</p>{selectedOrder?.lines.filter(l => l.shipped < l.quantity).map(l => { const lot = state.lots.find(x => x.id === l.lotId); return <Field key={l.lotId} label={`${product(lot?.productId || '')?.name} · Lotto ${lot?.code}`} hint={`Residuo: ${l.quantity - l.shipped}`}><input name={'qty-' + l.lotId} type="number" min="0" max={l.quantity - l.shipped} step="1" defaultValue={l.quantity - l.shipped} required/></Field>; })}<Field label="Riferimento DDT / documento di partenza"><input name="documentRef" required placeholder="Numero e data"/></Field><label className="check-label"><input type="checkbox" required/>Confermo la partenza effettiva della merce indicata.</label></>}
 {modal.type === 'document' && <><Field label="Riferimento del documento"><input name="documentRef" required placeholder="es. Fattura n. … del …"/></Field><p className="form-help">Il documento viene associato all’ordine e conservato nello storico. Non scarica di nuovo la merce.</p></>}
 {modal.type === 'cancel' && <p>Il residuo dell’ordine di <b>{selectedOrder?.customer}</b> non verrà più consegnato. Le prenotazioni residue verranno liberate; le quantità già partite rimangono nello storico.</p>}
 <datalist id="areas">{[...new Set(state.lots.map(l => l.area))].map(area => <option value={area} key={area}/>)}</datalist>
 </div><footer><button type="button" className="button secondary" disabled={busy} onClick={() => setModal(null)}>Indietro</button><button className="button primary" disabled={disabled || (modal.type === 'start' && !matched) || (modal.type === 'receive' && !state.products.length)} type="submit">{busy ? 'Salvataggio…' : modal.type === 'start' ? 'Conferma e avvia' : modal.type === 'close' ? 'Salva lavorazione' : modal.type === 'order' ? 'Conferma e prenota' : 'Conferma e salva'}<Check size={17}/></button></footer></form>}
 </section></div>}
 </div>;
}

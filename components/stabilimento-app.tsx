"use client";
import { useState, useEffect, useRef, useMemo, useCallback, type ReactNode, type FormEvent } from 'react';
import { LayoutDashboard, Package, Factory, ClipboardList, History, Settings2, ArrowRight, Plus, Search, ChevronRight, X, Check, ScanLine, Box, Wheat, Truck, Undo2, Download, CircleHelp, ShieldCheck, CircleAlert, Cable, Save, Menu, RefreshCw, Camera, CheckCircle2, MapPin, FileText, CalendarDays, Ban, PackageMinus, MoreHorizontal, Clock, ArrowDownToLine, TriangleAlert } from 'lucide-react';
import CommandPalette, { type PaletteAction, type PaletteView } from './command-palette';
import ProductionDay from './production-day';
import { canRecord, canUse, roleNames, type Role } from '../lib/permissions';
import { initialState, activeSession, stockIndex, expiringLots, todayRome, addDays, type State, type Action, type Audit } from '../lib/domain';
import { ProductionSummaryPanel, HistoryPanel, ArchivedOrders, DevicesPanel, BackupPanel, DeviceStatusNotice, type DeviceInfo } from './operations-panels';
import { request, describeError, readWorkspaceResponse, listPending, writePending, SENDING_GRACE_MS, removePending, PENDING_STORAGE_KEY, type Pending } from '../lib/client-api';
import CatalogPanel from './catalog-panel';
import LogoPreparationPanel from './logo-preparation-panel';
type View = 'overview' | 'inventory' | 'production' | 'orders' | 'history' | 'settings';
type Modal = {
    type: string;
    id?: string;
} | null;
type WorkspaceResponse = {
    state: State;
    version: number;
    error?: string;
    code?: string;
    duplicate?: boolean;
    recentAudit?: Audit[];
    archive?: Record<string, number>;
    devicesEnabled?: boolean;
    role?: Role;
};
/** Visible save state: never shows «salvato» unless the server confirmed it. */
type SaveStatus = { kind: 'idle' | 'saving' | 'saved' | 'uncertain' | 'failed'; at?: number };
const saveLabel: Record<SaveStatus['kind'], string> = { idle: '', saving: 'Salvataggio in corso…', saved: 'Salvato', uncertain: 'Da verificare', failed: 'Non riuscito' };
const navigation = [
    { id: 'overview', name: 'Panoramica', icon: LayoutDashboard }, { id: 'inventory', name: 'Magazzino', icon: Package },
    { id: 'production', name: 'Produzione', icon: Factory }, { id: 'orders', name: 'Ordini', icon: ClipboardList },
    { id: 'history', name: 'Storico attività', icon: History },
] as const;
const viewNames: Record<View, string> = { overview: 'Panoramica', inventory: 'Magazzino', production: 'Produzione', orders: 'Ordini', history: 'Storico attività', settings: 'Configurazione' };
const n = (v: number) => new Intl.NumberFormat('it-IT').format(v);
/** «1 lotto scaduto», «3 lotti scaduti». */
const plural = (count: number, one: string, many: string) => `${n(count)} ${count === 1 ? one : many}`;
/** Clock read used only inside event handlers and effects. */
const nowMs = () => Date.now();
const date = (v: string, time = false) => new Intl.DateTimeFormat('it-IT', { day: '2-digit', month: 'short', ...(time ? { hour: '2-digit', minute: '2-digit' } : {}), timeZone: 'Europe/Rome' }).format(new Date(v.length === 10 ? v + 'T12:00:00Z' : v));
const statusName: Record<string, string> = { reserved: 'Da preparare', prepared: 'Pronto alla partenza', partial: 'Consegna parziale', dispatched: 'Consegnato', cancelled: 'Annullato' };
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
                const Detector = (window as unknown as { BarcodeDetector?: new () => { detect(source: HTMLVideoElement): Promise<{ rawValue?: string }[]> } }).BarcodeDetector;
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
    const [recentAudit, setRecentAudit] = useState<Audit[]>([]);
    const [archiveCounts, setArchiveCounts] = useState<Record<string, number>>({});
    const [devicesEnabled, setDevicesEnabled] = useState(false);
    const [devices, setDevices] = useState<DeviceInfo[] | null>(null);
    const [saveStatus, setSaveStatus] = useState<SaveStatus>({ kind: 'idle' });
    const [now, setNow] = useState(() => Date.now());
    const [pendingInfo, setPendingInfo] = useState<Pending | null>(null);
    const [palette, setPalette] = useState(false);
    const [role, setRole] = useState<Role>('amministrazione');
    const can = (type: Action['type']) => canRecord(role, type);
    const isAdmin = role === 'amministrazione';
    const [lotFilter, setLotFilter] = useState<'all' | 'expired' | 'soon' | 'blocked' | 'available'>('all');
    const [areaFilter, setAreaFilter] = useState('');
    const [catalogFocus, setCatalogFocus] = useState<{ code: string; nonce: number } | null>(null);
    const [version, setVersion] = useState(0);
    const [loaded, setLoaded] = useState(false);
    const [view, setView] = useState<View>('overview');
    const [mobile, setMobile] = useState(false);
    const [search, setSearch] = useState('');
    const [tab, setTab] = useState('catalog');
    const [createRequested, setCreateRequested] = useState(false);
    const [receiveProductId, setReceiveProductId] = useState('');
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
    // The uncertain request survives tab and browser restarts (localStorage); the server receipt decides.
    const retry = useRef<Pending | null>(null);
    const pending = pendingInfo !== null;
    const sending = useRef(false);
    function setRetry(value: Pending | null) { const previous = retry.current; retry.current = value; setPendingInfo(value?.status === 'sending' ? null : value); if (value) writePending(value); else if (previous) removePending(previous.id); }
    function clearPending() { setRetry(null); }
    const today = todayRome(new Date(now));
    const index = useMemo(() => stockIndex(state, today), [state, today]);
    const productsById = useMemo(() => new Map(state.products.map(p => [p.id, p])), [state.products]);
    const lotsById = useMemo(() => new Map(state.lots.map(l => [l.id, l])), [state.lots]);
    const current = activeSession(state);
    const openOrders = state.orders.filter(o => !['dispatched', 'cancelled'].includes(o.status));
    const near = expiringLots(state, today, 7);
    const lows = state.products.filter(p => p.minStock > 0 && index.totals(p.id).available < p.minStock);
    const producedToday = state.sessions.filter(s => s.day === today);
    const product = (id: string) => productsById.get(id);
    function applyResponse(data: WorkspaceResponse) {
        setState(data.state);
        setVersion(data.version);
        if (data.recentAudit) setRecentAudit(data.recentAudit);
        if (data.archive) setArchiveCounts(data.archive);
        if (typeof data.devicesEnabled === 'boolean') setDevicesEnabled(data.devicesEnabled);
        if (data.role === 'amministrazione' || data.role === 'laboratorio') setRole(data.role);
    }
    const reload = useCallback(async function reload() { try {
        const res = await request('/api/workspace');
        const data = await readWorkspaceResponse<WorkspaceResponse>(res);
        if (!res.ok)
            throw new Error(data.error || 'Impossibile leggere i dati.');
        applyResponse(data);
        setLoaded(true);
        setNow(Date.now());
        setError('');
    }
    catch (e) {
        setError(describeError(e, 'Connessione non disponibile. I dati mostrati possono non essere aggiornati.'));
    } }, []);
    /** Read-only check of an uncertain request: committed → done; otherwise the user decides. */
    async function checkPending(entry: Pending) { try {
        const res = await request('/api/workspace/receipt?id=' + encodeURIComponent(entry.id));
        const data = await res.json() as { committed?: boolean; error?: string };
        if (!res.ok) throw new Error(data.error || 'Verifica non riuscita.');
        if (data.committed) { retry.current = entry; clearPending(); setSaveStatus({ kind: 'saved', at: Date.now() }); setToast('L’operazione in sospeso risulta già salvata: non va ripetuta.'); await reload(); }
        else setSaveStatus({ kind: 'uncertain' });
    } catch (e) { setSaveStatus({ kind: 'uncertain' }); setError(describeError(e, 'Verifica dell’operazione sospesa non riuscita.')); } }
    useEffect(() => {
        // Requests another live tab is still sending are shown only after the grace period.
        const recover = () => { if (sending.current || retry.current) return; const saved = listPending({ foreignOnly: true })[0]; if (saved) { retry.current = saved; setPendingInfo(saved); setSaveStatus({ kind: 'uncertain' }); void checkPending(saved); } };
        recover(); const later = setTimeout(recover, SENDING_GRACE_MS + 1_000);
        reload(); const listener = () => { const id = location.hash.slice(1); if (id in viewNames)
        setView(id as View); }; listener(); window.addEventListener('hashchange', listener); const connection = () => setOnline(navigator.onLine); connection(); window.addEventListener('online', connection); window.addEventListener('offline', connection); return () => { clearTimeout(later); window.removeEventListener('hashchange', listener); window.removeEventListener('online', connection); window.removeEventListener('offline', connection); }; }, []);
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
    // Returning to an open tab or regaining the network refreshes data (form fields are kept: they are not part of the state).
    useEffect(() => {
        const visible = () => { if (document.visibilityState === 'visible') { setNow(Date.now()); void reload(); } };
        const back = () => { void reload(); };
        document.addEventListener('visibilitychange', visible); window.addEventListener('online', back);
        const tick = setInterval(() => setNow(Date.now()), 60_000);
        // Another tab started or resolved an uncertain request: share the same banner.
        const storage = (e: StorageEvent) => { if (e.key !== PENDING_STORAGE_KEY || sending.current) return; const value = listPending({ foreignOnly: true })[0] ?? null; retry.current = value; setPendingInfo(value); };
        window.addEventListener('storage', storage);
        return () => { document.removeEventListener('visibilitychange', visible); window.removeEventListener('online', back); window.removeEventListener('storage', storage); clearInterval(tick); };
    }, [reload]);
    const loadDevices = useCallback(async () => { try { const res = await request('/api/devices'); const data = await res.json() as { devices?: DeviceInfo[] }; if (res.ok && data.devices) setDevices(data.devices); } catch { /* status stays unknown */ } }, []);
    useEffect(() => {
        if (view !== 'production' && view !== 'settings') return;
        const first = setTimeout(() => { void loadDevices(); }, 0);
        const timer = setInterval(() => { if (document.visibilityState === 'visible') void loadDevices(); }, 30_000);
        return () => { clearTimeout(first); clearInterval(timer); };
    }, [view, loadDevices]);
    useEffect(() => { if (toast) {
        const t = setTimeout(() => setToast(''), 4500);
        return () => clearTimeout(t);
    } }, [toast]);
    // Leaving the page with an open form or a save in progress asks for confirmation.
    useEffect(() => {
        if (!modal && !busy) return;
        const guard = (e: BeforeUnloadEvent) => { e.preventDefault(); };
        window.addEventListener('beforeunload', guard);
        return () => window.removeEventListener('beforeunload', guard);
    }, [modal, busy]);
    // Ctrl/⌘ K anywhere, or «/» outside text fields, opens the global search.
    useEffect(() => {
        const key = (e: KeyboardEvent) => {
            const typing = (e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"]');
            if ((e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); setPalette(true); }
            else if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); setPalette(true); }
        };
        document.addEventListener('keydown', key);
        return () => document.removeEventListener('keydown', key);
    }, []);
    useEffect(() => { const closeMenu = (e: KeyboardEvent) => { if (e.key === 'Escape') setMobile(false); }; if (mobile) document.addEventListener('keydown', closeMenu); return () => document.removeEventListener('keydown', closeMenu); }, [mobile]);
    function go(v: View) { setView(v); window.history.pushState(null, '', '#' + v); setSearch(''); setMobile(false); if (v !== 'overview') setNow(nowMs()); }
    function open(type: string, id?: string) { if (type === 'product') { setModal(null); go('inventory'); setTab('catalog'); setCreateRequested(true); setError(''); return; } setReceiveProductId(type === 'receive' ? id || '' : ''); setError(''); setCode(''); setCamera(false); setOrderRows([{ lotId: '', quantity: 1 }]); setModal({ type, id }); }
    async function act(action: Action, message = 'Operazione salvata') {
        if (busy)
            return false;
        const key = JSON.stringify(action);
        if (retry.current && retry.current.key !== key) { setError('Prima verifica l’operazione in attesa di conferma. Chiudi questa finestra e usa il pulsante di recupero.'); return false; }
        setBusy(true);
        setError('');
        setSaveStatus({ kind: 'saving' });
        // The id is created once and reused for every retry of the same operation.
        // Stored as «sending» before the request: if the tab closes now, the next load verifies it.
        const entry: Pending = { ...(retry.current ?? { key, id: crypto.randomUUID(), version, label: message }), at: new Date().toISOString(), status: 'sending' };
        sending.current = true;
        setRetry(entry);
        let uncertain = true;
        try {
            const res = await request('/api/workspace', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, expectedVersion: entry.version, requestId: entry.id }) }, 20_000);
            // A non-JSON or incomplete answer (e.g. login page after an expired session) is uncertain, never «saved».
            const data = await readWorkspaceResponse<WorkspaceResponse>(res);
            if (!res.ok) {
                // A JSON 4xx: the server certainly did not apply this request. 5xx: outcome unknown, keep it pending.
                if (res.status >= 400 && res.status < 500) { uncertain = false; clearPending(); }
                if (res.status === 409 && data.state) { applyResponse(data); setLoaded(true); }
                throw new Error(data.error || 'Salvataggio non riuscito.');
            }
            applyResponse(data);
            clearPending();
            setSaveStatus({ kind: 'saved', at: nowMs() });
            setModal(null);
            setToast(data.duplicate ? 'Operazione già registrata: nessun doppione.' : message);
            return true;
        }
        catch (e) {
            if (uncertain && retry.current) setRetry({ ...retry.current, status: 'uncertain' });
            setSaveStatus({ kind: uncertain ? 'uncertain' : 'failed' });
            setError(uncertain ? describeError(e, 'Salvataggio non confermato.') + ' Usa «Verifica» o ripeti la stessa operazione: non sarà duplicata.' : describeError(e, 'Salvataggio non riuscito.'));
            return false;
        }
        finally {
            sending.current = false;
            setBusy(false);
        }
    }
    /** «Scarta»: the server burns the id, so a late arrival of the original request is refused. */
    async function abandonPending(entry: Pending) {
        if (!confirm('Scartare l’operazione in sospeso? Verrà annullata sul server anche se arrivasse in ritardo. Potrai inserirla di nuovo.')) return;
        try {
            const res = await request('/api/workspace/receipt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: entry.id }) });
            const data = await res.json() as { committed?: boolean; error?: string };
            if (!res.ok) throw new Error(data.error || 'Operazione non riuscita.');
            retry.current = entry; clearPending();
            if (data.committed) { setSaveStatus({ kind: 'saved', at: nowMs() }); setToast('L’operazione risultava già salvata: non è stata scartata.'); }
            else { setSaveStatus({ kind: 'idle' }); setToast('Operazione scartata: non è stata registrata.'); }
            await reload();
        } catch (e) { setError(describeError(e, 'Impossibile scartare l’operazione: riprova quando la connessione è disponibile.')); }
    }
    const disabled = busy || !loaded || !online;
    const primary = (text: string, type: string, Icon = Plus) => <button className="button primary" disabled={disabled} onClick={() => open(type)}><Icon size={17}/>{text}</button>;
    function exportCSV(lots = state.lots, scope = 'tutti') { const rows = [['Codice', 'Articolo', 'Lotto', 'Scadenza', 'Area', 'Presenti', 'Bloccati', 'Prenotati', 'Disponibili', 'Unità'], ...lots.map(l => [product(l.productId)?.code, product(l.productId)?.name, l.code, l.expiry, l.area, l.quantity, l.blocked, index.lot(l.id).reserved, index.lot(l.id).available, product(l.productId)?.unit])]; DownloadFile(`prima-colazione-giacenze-${scope}-${today}.csv`, '\uFEFF' + rows.map(r => r.map(v => '"' + String(v ?? '').replaceAll('"', '""').replace(/^[=+\-@\t\r]/, "'$&") + '"').join(';')).join('\r\n'), 'text/csv;charset=utf-8'); }
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
            case 'receive':
                action = { type: 'lot.receive', lot: { productId: str('productId'), code: str('lotCode'), expiry: str('expiry'), area: str('area'), quantity: num('quantity') } };
                break;
            case 'order':
                action = { type: 'order.create', order: { customer: str('customer'), destination: str('destination'), date: str('date'), lines: orderRows } };
                break;
            case 'start':
                action = { type: 'production.start', code: code.trim(), operator: str('operator'), lotCode: str('lotCode'), expiry: str('expiry'), counting: str('counting') === 'device' ? 'device' : 'manual' };
                break;
            case 'scrap':
                action = { type: 'lot.scrap', lotId: id, quantity: num('quantity'), fromBlocked: fd.get('fromBlocked') === 'on', reason: str('reason'), responsible: str('responsible') };
                break;
            case 'consume':
                action = { type: 'lot.consume', lotId: id, quantity: num('quantity'), reason: str('reason'), responsible: str('responsible') };
                break;
            case 'return':
                action = { type: 'lot.return', lot: { productId: str('productId'), code: str('lotCode'), expiry: str('expiry'), area: str('area'), quantity: num('quantity') }, reason: str('reason'), reference: str('reference') };
                break;
            case 'count':
                action = { type: 'production.count', sessionId: id, cartons: num('cartons') };
                break;
            case 'close':
                action = { type: 'production.close', sessionId: id, ...(num('scrapCartons') > 0 ? { scrapCartons: num('scrapCartons') } : {}), ...(str('note') ? { note: str('note') } : {}), ...(str('override') ? { override: str('override') } : {}) };
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
                action = { type: 'order.dispatch', orderId: id, documentRef: str('documentRef'), quantities: order.lines.filter(l => l.shipped < l.quantity).map(l => ({ lotId: l.lotId, quantity: num('qty-' + l.lotId) })).filter(l => l.quantity > 0), ...(str('note') ? { note: str('note') } : {}) };
                break;
            }
            case 'cancel':
                action = { type: 'order.cancel', orderId: id };
                break;
            default: return;
        }
        await act(action);
    }
    const selectedLot = modal?.id ? lotsById.get(modal.id) : undefined;
    const selectedOrder = state.orders.find(o => o.id === modal?.id);
    const matched = state.products.find(p => p.code === code.trim().toUpperCase() && p.kind === 'finished');
    const matchedOther = !matched && code.trim() ? state.products.find(p => p.code === code.trim().toUpperCase()) : undefined;
    const words = search.trim().toLocaleLowerCase('it').split(/\s+/).filter(Boolean);
    const lotState = (l: State['lots'][number]) => { const expired = Boolean(l.expiry && l.expiry < today); return { expired, soon: !expired && Boolean(l.expiry && l.expiry <= addDays(today, 7)), blocked: l.blocked > 0, available: index.lot(l.id).available > 0 }; };
    const stockedLots = state.lots.filter(l => l.quantity > 0 || l.blocked > 0);
    const lotCounts = { all: stockedLots.length, expired: stockedLots.filter(l => lotState(l).expired).length, soon: stockedLots.filter(l => lotState(l).soon).length, blocked: stockedLots.filter(l => lotState(l).blocked).length, available: stockedLots.filter(l => lotState(l).available).length };
    const areas = [...new Set(state.lots.map(l => l.area))];
    // First to expire first (FEFO); lots without expiry last.
    const filteredLots = state.lots.filter(l => { if (lotFilter !== 'all' && !lotState(l)[lotFilter]) return false; if (areaFilter && l.area !== areaFilter) return false; const hay = (product(l.productId)?.name + ' ' + product(l.productId)?.code + ' ' + l.code + ' ' + l.area).toLocaleLowerCase('it'); return words.every(w => hay.includes(w)); }).sort((a, b) => (a.expiry || '9999-99-99').localeCompare(b.expiry || '9999-99-99') || a.code.localeCompare(b.code));
    const statusTone: Record<string, string> = { reserved: 'blue', prepared: 'green', partial: 'amber', dispatched: 'gray', cancelled: 'gray' };
    function orderCard(o: State['orders'][number], extraLots?: Map<string, State['lots'][number]>) {
        const rows = o.lines.map(l => ({ l, lot: lotsById.get(l.lotId) ?? extraLots?.get(l.lotId) }));
        const closed = ['dispatched', 'cancelled'].includes(o.status);
        return <article className={'order-card state-' + o.status} key={o.id}>
            <div className="order-head"><div><span className="eyebrow">Ordine {o.id.slice(0, 8).toUpperCase()}</span><h3>{o.customer}</h3><p><span><MapPin aria-hidden="true"/>{o.destination}</span><span><CalendarDays aria-hidden="true"/>Consegna {date(o.date)}</span><span>{o.lines.length} {o.lines.length === 1 ? 'riga' : 'righe'}</span></p></div><span className={'chip ' + statusTone[o.status]}>{statusName[o.status]}</span></div>
            <div className="order-lines">{rows.map(({ l, lot }) => { const p = product(lot?.productId || ''); return <div key={l.lotId}><span>{p?.code} {p?.name}<small className="cell-sub">Lotto {lot?.code ?? '—'}{lot?.expiry ? `, scadenza ${date(lot.expiry)}` : ''}</small></span><span>{n(l.quantity)} {p?.unit}<small className="cell-sub">{l.shipped ? `${n(l.shipped)} partiti` : closed ? 'non partiti' : 'da consegnare'}</small></span></div>; })}</div>
            {o.documents.length > 0 && <p className="form-help">Documenti: {o.documents.map(d => d.reference + (d.note ? ` (${d.note})` : '')).join(', ')}</p>}
            {((!closed && (can('order.prepare') || can('order.dispatch') || can('order.cancel'))) || (o.lines.some(l => l.shipped > 0) && can('order.document'))) && <div className="page-actions">{o.status === 'reserved' && <button className="button secondary small" disabled={disabled} onClick={() => act({ type: 'order.prepare', orderId: o.id }, 'Ordine pronto alla partenza')}><Check size={15}/>Segna pronto</button>}{['prepared', 'partial'].includes(o.status) && <button className="button primary small" disabled={disabled} onClick={() => open('dispatch', o.id)}><Truck size={15}/>Registra partenza</button>}{o.lines.some(l => l.shipped > 0) && can('order.document') && <button className="button secondary small" disabled={disabled} onClick={() => open('document', o.id)}><FileText size={15}/>Collega documento</button>}{!closed && can('order.cancel') && <button className="button ghost small" disabled={disabled} onClick={() => open('cancel', o.id)}>Annulla residuo</button>}</div>}
        </article>;
    }
    // «Da fare adesso»: what needs attention, most urgent first, each with its operation.
    type QueueItem = { key: string; tone: 'stop' | 'warn' | 'info'; icon: typeof Box; title: string; detail: string; action: string; run?: () => void; prepareOrderId?: string; needs?: Action['type'] };
    const tomorrow = addDays(today, 1);
    const queue: QueueItem[] = [];
    for (const l of state.lots) { const p = product(l.productId); if (l.quantity > 0 && l.expiry && l.expiry < today) queue.push({ key: 'exp' + l.id, tone: 'stop', icon: Ban, title: `Lotto ${l.code} scaduto`, detail: `${p?.name}: ${n(l.quantity)} ${p?.unit} in ${l.area}`, action: 'Registra scarto', run: () => open('scrap', l.id), needs: 'lot.scrap' }); }
    for (const o of state.orders) { if (o.status === 'prepared') queue.push({ key: 'o' + o.id, tone: 'info', icon: Truck, title: `Pronto alla partenza: ${o.customer}`, detail: `${o.destination}, consegna ${date(o.date)}`, action: 'Registra partenza', run: () => open('dispatch', o.id) }); else if (o.status === 'partial') queue.push({ key: 'o' + o.id, tone: 'warn', icon: Truck, title: `Residuo da consegnare: ${o.customer}`, detail: `${o.destination}, consegna ${date(o.date)}`, action: 'Registra partenza', run: () => open('dispatch', o.id) }); else if (o.status === 'reserved' && o.date <= tomorrow) queue.push({ key: 'o' + o.id, tone: 'info', icon: ClipboardList, title: `Da preparare: ${o.customer}`, detail: `Consegna ${o.date <= today ? 'oggi' : 'domani'}, ${o.lines.length} ${o.lines.length === 1 ? 'riga' : 'righe'}`, action: 'Segna pronto', prepareOrderId: o.id }); }
    for (const l of state.lots) { const p = product(l.productId); if (l.blocked > 0 && !(l.expiry && l.expiry < today)) queue.push({ key: 'b' + l.id, tone: 'warn', icon: TriangleAlert, title: `${n(l.blocked)} ${p?.unit} bloccati nel lotto ${l.code}`, detail: `${p?.name}, ${l.area}: da controllare, sbloccare o scartare`, action: 'Gestisci blocco', run: () => open('block', l.id), needs: 'lot.block' }); }
    for (const l of near) { if (l.expiry < today) continue; const p = product(l.productId); queue.push({ key: 'n' + l.id, tone: 'warn', icon: Clock, title: `Lotto ${l.code} in scadenza il ${date(l.expiry)}`, detail: `${p?.name}: ${n(l.quantity)} ${p?.unit} in ${l.area}`, action: 'Vedi lotto', run: () => { go('inventory'); setTab('lots'); setSearch(l.code); } }); }
    for (const p of lows) queue.push({ key: 'm' + p.id, tone: 'warn', icon: PackageMinus, title: `${p.name} sotto scorta`, detail: `Disponibili ${n(index.totals(p.id).available)} ${p.unit}, minimo ${n(p.minStock)}`, action: 'Registra entrata', run: () => open('receive', p.id) });
    const cartonsToday = producedToday.reduce((a, s) => a + s.cartons, 0);
    const expiredCount = state.lots.filter(l => l.quantity > 0 && l.expiry && l.expiry < today).length;
    const availableProducts = state.products.filter(p => index.totals(p.id).available > 0).length;
    const dueSoon = openOrders.filter(o => o.date <= tomorrow).length;
    const time = (v: string | number) => new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' }).format(new Date(v));
    const headingNote: Record<View, string> = {
        overview: new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Rome' }).format(new Date(now)),
        inventory: `${n(state.products.length)} articoli, ${n(state.lots.filter(l => l.quantity > 0).length)} lotti in giacenza, ${new Set(state.lots.map(l => l.area)).size} aree`,
        production: current ? `Linea 1 in lavorazione: ${current.productName}` : 'Linea 1 ferma. Identifica l’articolo per iniziare.',
        orders: `${n(openOrders.length)} ordini da completare, ${n(dueSoon)} in consegna entro domani`,
        history: `${n(archiveCounts.audit || 0)} operazioni registrate`,
        settings: 'Collegamenti, dispositivi del conta-cartoni e backup.',
    };
    function navButton(item: (typeof navigation)[number]) {
        const count = item.id === 'orders' ? openOrders.length : item.id === 'inventory' ? expiredCount + near.length + lows.length : 0;
        return <button key={item.id} className={'nav-item ' + (view === item.id ? 'active' : '')} aria-current={view === item.id ? 'page' : undefined} onClick={() => go(item.id)}><item.icon size={18} aria-hidden="true"/><span>{item.name}</span>{count > 0 && <span className={'nav-count ' + (item.id === 'inventory' && expiredCount ? 'alert' : '')} aria-label={item.id === 'inventory' ? `${count} segnalazioni` : `${count} aperti`}>{count}</span>}{item.id === 'production' && current && <span className="status-dot" aria-label="Lavorazione aperta"/>}</button>;
    }
    function paletteAction(a: PaletteAction) { if (a === 'product') { open('product'); return; } open(a); }
    function paletteNavigate(v: PaletteView) { go(v); }
    return <div className="app-shell">
 {mobile && <button className="sidebar-backdrop" aria-label="Chiudi menu" onClick={() => setMobile(false)} />}
 <a className="skip-link" href="#contenuto">Vai al contenuto</a>
 <aside className={'sidebar ' + (mobile ? 'open' : '')} aria-label="Menu"><a className="brand" href="#overview" onClick={e => { e.preventDefault(); go('overview'); }}><div className="brand-mark"><Wheat size={22} aria-hidden="true"/></div><div><div className="brand-name">prima colazione<span>.</span></div><div className="brand-sub">Stabilimento</div></div></a><nav aria-label="Navigazione principale"><div className="nav-label">Lavoro</div>{navigation.slice(0, 4).map(navButton)}<div className="nav-label">Registro</div>{navigation.slice(4).map(navButton)}</nav><div className="sidebar-bottom"><div className={'site-status ' + (loaded && online ? '' : 'offline')}><span className="status-dot"/><div><b>{!online ? 'Offline' : loaded ? 'Archivio connesso' : 'Connessione…'}</b><small>Accesso: {roleNames[role]}</small><small>{current ? 'Linea 1 in lavorazione' : 'Linea 1 ferma'}</small></div></div><button className={'nav-item ' + (view === 'settings' ? 'active' : '')} aria-current={view === 'settings' ? 'page' : undefined} onClick={() => go('settings')}><Settings2 size={18} aria-hidden="true"/>Configurazione</button><button className="nav-item" onClick={() => open('help')}><CircleHelp size={18} aria-hidden="true"/>Guida rapida</button></div></aside>
 <div className="main-shell"><header className="topbar"><button className="icon-button mobile-menu" aria-label={mobile ? "Chiudi navigazione" : "Apri navigazione"} aria-expanded={mobile} onClick={() => setMobile(!mobile)}><Menu size={20}/></button><div className="breadcrumb"><span>Stabilimento</span><ChevronRight size={14} aria-hidden="true"/><b>{viewNames[view]}</b></div><button className="topbar-search" onClick={() => setPalette(true)} aria-label="Cerca o vai a (Ctrl K)" aria-keyshortcuts="Control+K /"><Search size={16} aria-hidden="true"/><span>Cerca codice, lotto, cliente o azione…</span><kbd>Ctrl K</kbd></button><div className="topbar-right">{saveStatus.kind !== 'idle' && <span role="status" className={'chip ' + (saveStatus.kind === 'saved' ? 'green' : saveStatus.kind === 'saving' ? 'gray' : saveStatus.kind === 'failed' ? 'red' : 'amber')}>{saveStatus.kind === 'saving' && <RefreshCw size={13} className="spin"/>}{saveLabel[saveStatus.kind]}{saveStatus.kind === 'saved' && saveStatus.at ? ' alle ' + new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' }).format(saveStatus.at) : ''}</span>}<span className={'chip connection-chip ' + (loaded && online ? 'green' : 'amber')}>{!online ? 'Offline' : loaded ? 'Archivio connesso' : 'Connessione…'}</span><button className="icon-button" aria-label="Aggiorna dati" onClick={reload} disabled={busy}><RefreshCw size={17}/></button></div></header>
 <main id="contenuto" key={view} className="page-content view-content" tabIndex={-1}><div className="page-heading"><div><h1>{view === 'overview' ? 'Oggi in stabilimento' : viewNames[view]}</h1><p>{headingNote[view]}</p></div><div className="page-actions">{view === 'overview' && <><button className="button secondary" disabled={disabled} onClick={() => open('receive')}><ArrowDownToLine size={16}/>Registra entrata</button>{can('order.create') && <button className="button secondary" disabled={disabled} onClick={() => open('order')}><Plus size={16}/>Nuovo ordine</button>}<button className="button primary" disabled={disabled} onClick={() => current ? go('production') : open('start')}><ScanLine size={16}/>{current ? 'Vai alla lavorazione' : 'Nuova lavorazione'}</button></>}{view === 'inventory' && tab === 'lots' && <><button className="button secondary" onClick={() => words.length ? exportCSV(filteredLots, 'filtrate') : exportCSV()} disabled={!loaded}><Download size={16}/>{words.length ? `Esporta ${filteredLots.length} filtrate` : 'Esporta tutte le giacenze'}</button>{primary('Registra reso', 'return', Undo2)}{primary('Registra entrata', 'receive')}</>}{view === 'production' && !current && primary('Nuova lavorazione', 'start', ScanLine)}{view === 'orders' && can('order.create') && primary('Nuovo ordine', 'order')}</div></div>
 {!modal && pending && pendingInfo && <div className="notice amber"><CircleAlert size={20}/><div><b>Un’operazione è da verificare</b><p>«{pendingInfo.label}», avviata {date(pendingInfo.at, true)}. La risposta del server non è arrivata: potrebbe essere già salvata. Verifica prima di registrare altro; la ripetizione usa lo stesso identificativo e non crea doppioni.</p><div className="page-actions"><button className="button secondary small" disabled={busy || !online} onClick={() => checkPending(pendingInfo)}>Verifica sul server</button><button className="button primary small" disabled={busy || !loaded || !online} onClick={() => { if (retry.current) act(JSON.parse(retry.current.key) as Action, retry.current.label || 'Operazione verificata e salvata'); }}>Ripeti la stessa operazione</button><button className="button ghost small" disabled={busy || !online} onClick={() => abandonPending(pendingInfo)}>Scarta</button></div></div></div>}
 {!modal && error && <div role="alert" className="alert-error">{error} <button className="button small secondary" onClick={reload}>Ricarica dati</button></div>}
 {!online && <div className="notice amber"><CircleAlert size={19}/><div><b>Connessione assente</b><p>I dati visualizzati possono non essere aggiornati. Le operazioni ripartiranno quando torna la connessione.</p></div></div>}
 {view === 'overview' && <>
 <div className="kpi-strip">
  <button className="kpi" onClick={() => { go('inventory'); setTab('lots'); }}><span className="kpi-label"><Package aria-hidden="true"/>Articoli disponibili</span><span className="kpi-value">{loaded ? <>{n(availableProducts)}<small>su {n(state.products.length)}</small></> : '—'}</span><span className="kpi-note">con merce prenotabile adesso</span></button>
  <button className="kpi" onClick={() => go('orders')}><span className="kpi-label"><ClipboardList aria-hidden="true"/>Ordini aperti</span><span className="kpi-value">{loaded ? n(openOrders.length) : '—'}</span><span className="kpi-note">{n(dueSoon)} in consegna entro domani</span></button>
  <button className="kpi" onClick={() => { go('production'); setTimeout(() => document.getElementById('produzione-del-giorno')?.scrollIntoView({ block: 'start' }), 120); }}><span className="kpi-label"><Factory aria-hidden="true"/>Cartoni letti oggi</span><span className="kpi-value">{loaded ? n(cartonsToday) : '—'}</span><span className="kpi-note">{plural(producedToday.length, 'lavorazione', 'lavorazioni')}, nessun carico automatico</span></button>
  <button className={'kpi ' + (expiredCount ? 'alert' : near.length + lows.length ? 'attention' : '')} onClick={() => { go('inventory'); setTab('lots'); }}><span className="kpi-label"><CircleAlert aria-hidden="true"/>Da controllare</span><span className="kpi-value">{loaded ? n(expiredCount + near.length + lows.length) : '—'}</span><span className="kpi-note">{plural(expiredCount, 'scaduto', 'scaduti')}, {n(Math.max(0, near.length - expiredCount))} in scadenza, {n(lows.length)} sotto scorta</span></button>
 </div>
 <div className="overview-grid">
  <section className="panel" aria-labelledby="queue-title"><div className="panel-head"><div><h2 id="queue-title">Da fare adesso</h2><p>In ordine di urgenza. Ogni riga apre l’operazione.</p></div>{queue.length > 0 && <span className="chip gray plain">{queue.length}</span>}</div>
   {!loaded ? <p className="panel-body" role="status">Caricamento dei dati…</p> : queue.length ? <ul className="queue">{queue.slice(0, 9).map(q => <li key={q.key} className={'queue-item ' + q.tone}><span className="queue-icon"><q.icon aria-hidden="true"/></span><span className="queue-text"><b>{q.title}</b><small>{q.detail}</small></span>{(!q.needs || can(q.needs)) ? <button className="button secondary small" disabled={disabled} onClick={() => q.prepareOrderId ? act({ type: 'order.prepare', orderId: q.prepareOrderId }, 'Ordine pronto alla partenza') : q.run?.()}>{q.action}</button> : <span className="form-help">Per l’amministrazione</span>}</li>)}</ul> : <div className="queue-done"><CheckCircle2 size={22} aria-hidden="true"/><div><b>Nessuna attività in sospeso</b><p className="form-help">Scadenze, scorte e ordini sono in regola. Le nuove segnalazioni compariranno qui.</p></div></div>}
   {queue.length > 9 && <p className="form-help" style={{ padding: '0 18px 14px' }}>Altre {queue.length - 9} segnalazioni in Magazzino e Ordini.</p>}
   {loaded && !state.products.length && <div className="panel-body step-list" style={{ borderTop: '1px solid var(--line)' }}>{[{ title: 'Inserisci gli articoli', text: 'Codice, unità e pezzi per cartone, oppure importa il file Excel', done: state.products.length > 0, type: 'product' }, { title: 'Registra le scorte iniziali', text: 'Quantità reali, lotti e ubicazioni', done: state.lots.length > 0, type: 'receive' }, { title: 'Registra il primo ordine', text: 'Destinazione e merce da preparare', done: state.orders.length > 0, type: 'order' }].map((s, i) => <button className="step-row" key={s.title} disabled={disabled} onClick={() => open(s.type)}><span className={'step-number ' + (s.done ? 'done' : '')}>{s.done ? <Check size={15}/> : i + 1}</span><span><b>{s.title}</b><small>{s.text}</small></span><ChevronRight size={16}/></button>)}</div>}
  </section>
  <div className="stack">
   <section className={'line-card ' + (current ? 'running' : 'idle')} aria-labelledby="line-title"><div className="split"><h2 id="line-title">Linea 1</h2><span className="line-state">{current ? (current.source === 'device' ? 'In lavorazione, fotocellule' : 'In lavorazione') : 'Ferma'}</span></div>
    {current ? <><p className="line-product">{current.productName}</p><div className="line-meta"><span>Codice {current.productCode}</span><span>Lotto {current.lotCode}</span><span>Dalle {time(current.startedAt)}</span></div><div className="line-count">{current.source === 'device' ? '—' : n(current.cartons)}<small>{current.source === 'device' ? 'conteggio dal ponte' : 'cartoni'}</small></div><small>Operatore: {current.operator}</small><button className="button" disabled={!loaded} onClick={() => go('production')}><Factory size={16}/>Apri la postazione</button></> : <><p className="line-product">Nessuna lavorazione aperta</p><div className="line-steps"><span>1. Identifica l’articolo</span><span>2. Conta i cartoni</span><span>3. Chiudi e salva</span></div><button className="button" disabled={disabled} onClick={() => open('start')}><ScanLine size={16}/>Nuova lavorazione</button></>}
    <p className="form-help">Oggi {n(cartonsToday)} cartoni letti in {producedToday.length} {producedToday.length === 1 ? 'lavorazione' : 'lavorazioni'}.</p></section>
   <section className="panel"><div className="panel-head"><h2>Attività recenti</h2><button className="section-link" onClick={() => go('history')}>Tutto lo storico<ArrowRight size={15}/></button></div><div className="panel-body">{recentAudit.length ? <div className="timeline">{recentAudit.slice(0, 5).map(a => <div className="timeline-item" key={a.id}><span className="timeline-dot"/><div><b>{a.detail}</b><small>{date(a.at, true)}</small></div></div>)}</div> : <p className="muted">Le nuove operazioni compariranno qui dopo il salvataggio.</p>}</div></section>
  </div>
 </div>
 </>}
 {view === 'inventory' && <>
 <div className="toolbar inventory-tabs"><div className="tabs" role="tablist" aria-label="Viste magazzino"><button role="tab" aria-selected={tab === 'catalog'} className={'tab ' + (tab === 'catalog' ? 'active' : '')} onClick={() => setTab('catalog')}>Prodotti <span>{state.products.length}</span></button><button role="tab" aria-selected={tab === 'lots'} className={'tab ' + (tab === 'lots' ? 'active' : '')} onClick={() => setTab('lots')}>Giacenze e lotti <span>{state.lots.length}</span></button></div>{tab === 'lots' && <label className="search-field"><Search size={17}/><input aria-label="Cerca in magazzino" placeholder="Codice, lotto o descrizione…" value={search} onChange={e => setSearch(e.target.value)}/></label>}</div>
 {tab === 'lots' && <div className="lot-filters"><div className="tabs" role="group" aria-label="Filtra lotti per stato">{([['all', 'Tutti'], ['available', 'Disponibili'], ['soon', 'In scadenza'], ['expired', 'Scaduti'], ['blocked', 'Bloccati']] as const).map(([k, label]) => <button key={k} type="button" className={'tab ' + (lotFilter === k ? 'active' : '')} aria-pressed={lotFilter === k} onClick={() => setLotFilter(k)}>{label}<span>{lotCounts[k]}</span></button>)}</div><label className="field inline-field"><span>Area</span><select value={areaFilter} onChange={e => setAreaFilter(e.target.value)}><option value="">Tutte le aree</option>{areas.map(a => <option key={a} value={a}>{a}</option>)}</select></label><span className="form-help">Ordinati per scadenza: in alto il lotto da usare per primo.</span></div>}
 {tab === 'catalog' ? <CatalogPanel canEdit={can('product.add')} focusRequest={catalogFocus} state={state} busy={busy} disabled={disabled} onAction={act} onReceive={id => open('receive', id)} createRequested={createRequested} onCreateRequestHandled={() => setCreateRequested(false)} saveError={error} onClearError={() => setError('')}/> : <><div className="panel">{filteredLots.length ? <div className="table-wrap"><table className="data-table lots-table"><caption className="sr-only">Giacenze per lotto e ubicazione</caption><thead><tr><th>Articolo / lotto</th><th>Ubicazione</th><th>Scadenza</th><th className="num">Presenti</th><th className="num">Prenotati</th><th className="num">Bloccati</th><th className="num">Disponibili</th><th><span className="sr-only">Operazioni</span></th></tr></thead><tbody>{filteredLots.map(l => { const p = product(l.productId); const info = index.lot(l.id); const expired = info.expired; const soon = !expired && l.expiry && l.expiry <= addDays(today, 7); return <tr key={l.id}><td><div className="product-cell"><span className="product-icon"><Box size={16} aria-hidden="true"/></span><div><b>{p?.name}</b><span className="cell-sub">{p?.code}, lotto {l.code}</span></div></div></td><td data-label="Ubicazione">{l.area}</td><td data-label="Scadenza">{l.expiry ? <span className={'row-flag ' + (expired ? 'stop' : soon ? 'warn' : 'ok')}>{date(l.expiry)}{expired ? ', scaduto' : soon ? ', in scadenza' : ''}</span> : <span className="row-flag">Non prevista</span>}</td><td className="num" data-label="Presenti"><span>{n(l.quantity)} <small>{p?.unit}</small></span></td><td className="num" data-label="Prenotati">{n(info.reserved)}</td><td className="num" data-label="Bloccati">{l.blocked ? <span className="row-flag warn">{n(l.blocked)}</span> : 0}</td><td className="num" data-label="Disponibili">{n(info.available)}</td><td><div className="page-actions lot-actions"><button className="button ghost small" disabled={disabled} onClick={() => open('transfer', l.id)}>Sposta</button>{can('lot.block') && <button className="button ghost small" disabled={disabled} onClick={() => open('block', l.id)}>Blocco</button>}{isAdmin && <details className="row-menu"><summary className="button ghost small" aria-label={`Altre operazioni sul lotto ${l.code}`}><MoreHorizontal size={16}/>Altro</summary><div><button disabled={disabled} onClick={e => { (e.currentTarget.closest('details') as HTMLDetailsElement).open = false; open('scrap', l.id); }}><Ban/>Scarto</button><button disabled={disabled} onClick={e => { (e.currentTarget.closest('details') as HTMLDetailsElement).open = false; open('consume', l.id); }}><PackageMinus/>Consumo</button><button disabled={disabled} onClick={e => { (e.currentTarget.closest('details') as HTMLDetailsElement).open = false; open('adjust', l.id); }}><Save/>Rettifica</button></div></details>}</div></td></tr>; })}</tbody><tfoot><tr><td colSpan={8}>{filteredLots.length} {filteredLots.length === 1 ? 'lotto' : 'lotti'}{words.length || lotFilter !== 'all' || areaFilter ? ' con i filtri scelti' : ''}. Le quantità di articoli diversi non si sommano: i totali sono nella scheda di ogni prodotto.</td></tr></tfoot></table></div> : <Empty title={search ? 'Nessun risultato' : 'Il magazzino inizia dal primo conteggio'}>Registra solo la merce effettivamente presente, con lotto e ubicazione.{!search && <button className="section-link" disabled={disabled} onClick={() => open(state.products.length ? 'receive' : 'product')}>{state.products.length ? 'Registra un’entrata' : 'Inserisci il primo articolo'}<ArrowRight size={15}/></button>}</Empty>}</div><p className="footer-note">Disponibile = presente − bloccato − prenotato. I lotti scaduti non sono prenotabili. Quantità espresse nell’unità dell’articolo. I lotti esauriti da oltre il giorno di chiusura sono in archivio ({n(archiveCounts.lot || 0)}).</p></>}
 </>}

 {view === 'production' && <>{devicesEnabled ? <DeviceStatusNotice devices={devices} now={now} session={current}/> : <div className="notice amber"><Cable size={21}/><div><b>Produzione in modalità manuale</b><p>Le fotocellule non sono collegate. Registra i cartoni contati: la chiusura non carica automaticamente il magazzino.</p></div></div>}<div className="overview-grid"><section className="panel"><div className="panel-head"><h2>Postazione, linea 1</h2><span className={'chip ' + (current ? 'green' : 'gray')}>{current ? 'Lavorazione aperta' : 'In attesa'}</span></div>{current ? <div className="panel-body"><div className="station-head"><div><span className="station-code">Codice {current.productCode}</span><p className="station-name">{current.productName}</p></div><span className="chip blue">{current.source === 'device' ? 'Fotocellule' : 'Conteggio manuale'}</span></div><dl className="station-facts"><div><dt>Lotto</dt><dd>{current.lotCode}</dd></div><div><dt>Scadenza</dt><dd>{date(current.expiry)}</dd></div><div><dt>Operatore</dt><dd>{current.operator}</dd></div><div><dt>Avviata</dt><dd>{date(current.startedAt, true)}</dd></div></dl><div className="counter-number">{current.source === 'device' ? (() => { const live = devices?.find(d => !d.revokedAt && d.status?.session?.id === current.id)?.status?.session?.cartons; return live == null ? <>— <small>in attesa del ponte</small></> : <>{n(live)} <small>cartoni (dal ponte, non definitivi)</small></>; })() : <>{n(current.cartons)} <small>cartoni</small></>}</div><p className="form-help">{n(current.cartons * current.unitsPerBox)} {current.unit || 'unità'} registrate, {current.unitsPerBox} per cartone (confezionamento salvato all’avvio)</p><div className="counter-controls">{current.source !== 'device' && <button className="button secondary" disabled={disabled} onClick={() => open('count', current.id)}><Plus size={17}/>Aggiungi cartoni</button>}<button className="button primary" disabled={disabled} onClick={() => open('close', current.id)}><Save size={17}/>Chiudi / salva lavorazione</button></div><p className="form-help">Una sola lavorazione aperta per volta. La chiusura non carica il magazzino.</p></div> : <Empty icon={ScanLine} title="Scegli l’articolo da produrre">Leggi il codice con un lettore o con la fotocamera supportata. Controlla il prodotto prima di avviare.<button className="button primary" disabled={disabled} onClick={() => open('start')}><ScanLine size={17}/>Identifica articolo</button></Empty>}</section><section className="panel"><div className="panel-head"><h2>Il flusso di produzione</h2></div><div className="panel-body step-list">{[['Identifica', 'Scansiona il codice e conferma i dati.'], ['Registra', 'Ogni conteggio appartiene al suo articolo.'], ['Chiudi e salva', 'Conserva lo storico; la nuova lavorazione riparte da zero.']].map(([a, b], i) => <div className="step-row" key={a}><span className="step-number">{i + 1}</span><span><b>{a}</b><small>{b}</small></span></div>)}</div></section></div><ProductionDay sessions={state.sessions} today={today} archivedCount={archiveCounts.session || 0} onExport={DownloadFile}/>
 <ProductionSummaryPanel sessions={state.sessions} today={today} archivedCount={archiveCounts.session || 0} onExport={DownloadFile}/>
 <section className="panel" style={{ marginTop: 16 }}><div className="panel-head"><h2>Lavorazioni salvate</h2><span className="chip gray">{state.sessions.filter(s => s.status === 'closed').length} negli ultimi 30 giorni</span></div>{state.sessions.some(s => s.status === 'closed') ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Articolo</th><th>Lotto</th><th>Operatore</th><th>Giorno / orari</th><th>Cartoni letti</th><th>Scarti</th><th>Unità</th><th>Origine</th></tr></thead><tbody>{[...state.sessions].reverse().filter(s => s.status === 'closed').map(s => <tr key={s.id}><td><b>{s.productName}</b><span className="cell-sub">{s.productCode}</span></td><td>{s.lotCode}</td><td>{s.operator}</td><td>{date(s.day)}<small className="cell-sub">{date(s.startedAt, true)} → {s.closedAt ? date(s.closedAt, true) : '—'}</small></td><td>{n(s.cartons)}</td><td>{n(s.scrapCartons || 0)}</td><td>{n(s.cartons * s.unitsPerBox)} {s.unit || ''}</td><td>{s.closedBy === 'device' ? 'Ponte' : s.closedBy === 'manual-override' ? 'Chiusura manuale (ponte)' : 'Manuale'}{s.device?.anomalies.length ? <small className="cell-sub">Da verificare: {s.device.anomalies.join(', ')}</small> : null}{s.closeNote && <small className="cell-sub">{s.closeNote}</small>}</td></tr>)}</tbody></table></div> : <div className="panel-body"><p className="muted">Le lavorazioni chiuse appariranno qui. Chiudere non cancella mai lo storico.</p></div>}</section></>}
 {view === 'orders' && <><div className="toolbar"><div className="tabs">{[['open', 'Da completare'], ['closed', 'Completati e annullati'], ['all', 'Tutti']].map(([id, label]) => <button className={'tab ' + (orderFilter === id ? 'active' : '')} key={id} onClick={() => setOrderFilter(id)}>{label}</button>)}</div><label className="search-field"><Search size={17}/><input aria-label="Cerca ordine" placeholder="Cerca cliente o destinazione…" value={search} onChange={e => setSearch(e.target.value)}/></label></div><div className="order-list">{state.orders.filter(o => (o.customer + ' ' + o.destination).toLowerCase().includes(search.toLowerCase()) && (orderFilter === 'all' || (orderFilter === 'open' ? !['dispatched', 'cancelled'].includes(o.status) : ['dispatched', 'cancelled'].includes(o.status)))).map(o => orderCard(o))}{orderFilter !== 'open' && (archiveCounts.order || 0) > 0 && <ArchivedOrders search={search} count={archiveCounts.order || 0} renderOrder={orderCard} hotOrderIds={new Set(state.orders.map(o => o.id))} refreshKey={version}/>}{!state.orders.length && !(archiveCounts.order || 0) && <section className="panel"><Empty icon={Truck} title={can('order.create') ? 'Registra il primo ordine' : 'Nessun ordine da preparare'}>{can('order.create') ? 'Crea l’ordine, prepara la merce e registra la partenza. Puoi gestire anche una consegna parziale.' : 'Gli ordini inseriti dall’amministrazione compariranno qui, pronti da preparare e far partire.'}{can('order.create') && <button className="button primary" disabled={disabled} onClick={() => open('order')}><Plus size={17}/>Nuovo ordine</button>}</Empty></section>}</div><div className="notice blue" style={{ marginTop: 16 }}><FileText size={20}/><div><b>Una partenza, un solo scarico</b><p>La prenotazione lascia la merce in magazzino. La partenza con DDT la scarica. Collegare una fattura non modifica le quantità.</p></div></div></>}
 {view === 'history' && <HistoryPanel recent={recentAudit} total={archiveCounts.audit || 0} onExport={() => DownloadFile('prima-colazione-stato-operativo-' + today + '.json', JSON.stringify({ exportedAt: new Date().toISOString(), version, note: 'Esportazione dello stato operativo (non è un backup completo: usa Configurazione → Backup).', state }, null, 2), 'application/json')} loaded={loaded}/>}
 {view === 'settings' && <><div className="integration-grid">{[{ title: 'Archivio del gestionale', icon: ShieldCheck, status: loaded ? 'Connesso' : 'Non raggiungibile', ready: loaded, text: 'Catalogo, giacenze, ordini e lavorazioni vengono salvati sul server. Accesso riservato al proprietario.' }, { title: 'Conta-cartoni / Siemens LOGO!', icon: Cable, status: devicesEnabled ? 'Ponte registrato · da collaudare' : 'Da collegare', ready: false, text: 'Ponte locale con simulatore e test automatici. Il collegamento all’impianto richiede dati del LOGO!, programma del PLC e collaudo sulla linea. Nessun carico automatico di magazzino.' }, { title: 'TeamSystem', icon: FileText, status: 'Da verificare', ready: false, text: 'La contabilità rimane nel gestionale esistente. Qui puoi associare il riferimento di un documento a una consegna.' }, { title: 'Etichettatrice e ricette', icon: ScanLine, status: 'Da verificare', ready: false, text: 'Macchina, formato dei codici e ricette devono essere verificati prima di attivare automatismi.' }].map(c => <section className="panel integration-card" key={c.title}><div className="split"><span className="quick-icon"><c.icon size={24}/></span><span className={'chip ' + (c.ready ? 'green' : 'amber')}>{c.status}</span></div><h2>{c.title}</h2><p className="muted">{c.text}</p></section>)}</div>{canUse(role, 'devices') && <DevicesPanel devices={devices} onChange={loadDevices} now={now}/>}<LogoPreparationPanel/>{canUse(role, 'backup') ? <BackupPanel emptyArchive={loaded && version === 0} onRestored={reload}/> : <div className="notice blue" style={{ marginTop: 16 }}><ShieldCheck size={20}/><div><b>Accesso del laboratorio</b><p>Dispositivi del conta-cartoni, backup, catalogo, nuovi ordini, blocchi, rettifiche e scarti sono gestiti dall’amministrazione.</p></div></div>}<section className="panel" style={{ marginTop: 24 }}><div className="panel-head"><h2>Le regole condivise</h2></div><div className="panel-body form-grid"><div><h3>Un catalogo unico</h3><p className="muted">Codici univoci e confezionamento dichiarato. Fino a tre aree interne; i nomi si definiscono registrando le entrate.</p></div><div><h3>Dati e codice separati</h3><p className="muted">Il codice del progetto è trasferibile. Scorte, ordini e operatori restano nell’archivio riservato e non vanno pubblicati su GitHub.</p></div><div><h3>Accesso attuale</h3><p className="muted">Prima versione riservata al proprietario. Inviti e ruoli distinti per gli operatori devono ancora essere configurati.</p></div><div><h3>Esportazioni e backup</h3><p className="muted">Le esportazioni (giacenze CSV, stato JSON) servono per consultare i dati. Il backup completo qui sopra comprende anche storico, archivio e ricevute ed è l’unico da usare per un ripristino.</p><button className="section-link" onClick={() => go('history')}>Apri lo storico<ArrowRight size={15}/></button></div></div></section></>}
 <footer className="page-footer"><span>Prima Colazione, stabilimento</span><span>Premi <kbd>Ctrl K</kbd> per cercare o aprire un’operazione</span></footer>
 </main></div>
 <CommandPalette open={palette} onClose={() => setPalette(false)} state={state} canAct={!disabled} allowed={a => can(({ receive: 'lot.receive', return: 'lot.return', order: 'order.create', start: 'production.start', product: 'product.add' } as const)[a])} onNavigate={paletteNavigate} onAction={paletteAction} onProduct={code => { go('inventory'); setTab('catalog'); setCatalogFocus({ code, nonce: Date.now() }); }} onLot={code => { go('inventory'); setTab('lots'); setSearch(code); }} onOrder={customer => { go('orders'); setOrderFilter('all'); setSearch(customer); }}/>
 {toast && <div role="status" aria-live="polite" className="toast"><CheckCircle2 size={19}/>{toast}</div>}
 {modal && <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget && !busy)
            setModal(null); }}><section ref={dialog} className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" onKeyDown={e => { if (e.key === 'Escape' && !busy)
            setModal(null); }}><header><div><h2 id="modal-title">{({ product: 'Nuovo articolo', receive: 'Registra un’entrata', order: 'Nuovo ordine', start: 'Nuova lavorazione', count: 'Aggiungi cartoni', close: 'Chiudi / salva lavorazione', block: 'Quantità bloccata', transfer: 'Sposta in un’altra area', adjust: 'Rettifica motivata', dispatch: 'Registra la partenza', document: 'Collega un documento', cancel: 'Annulla il residuo', help: 'Come usare lo stabilimento', scrap: 'Registra uno scarto', consume: 'Consumo interno', return: 'Registra un reso da controllare' } as Record<string, string>)[modal.type]}</h2></div><button className="icon-button" aria-label="Chiudi finestra" disabled={busy} onClick={() => setModal(null)}><X size={20}/></button></header>
 {modal.type === 'help' ? <div className="panel-body stack"><p>Inizia da <b>Magazzino → Prodotti</b>, poi registra le quantità realmente presenti.</p><p>In <b>Produzione</b> identifica l’articolo, apri la lavorazione e aggiungi i cartoni contati. <b>Chiudi / salva</b> conserva la lavorazione e libera la postazione.</p><p>In <b>Ordini</b> prenota la merce per una destinazione, segna l’ordine pronto e registra la partenza con il riferimento del DDT.</p><p>In <b>Storico attività</b> controlla lo storico o esporta l’archivio. In <b>Configurazione</b> trovi lo stato dei collegamenti.</p><div className="notice amber">Questa versione usa registrazioni manuali. Le fotocellule non sono ancora collegate.</div></div> : <form onSubmit={submit} autoComplete="off"><div className="panel-body stack">{error && <div role="alert" className="alert-error">{error}</div>}
 {modal.type === 'receive' && (state.products.length ? <div className="form-grid"><Field label="Articolo" wide><select name="productId" required value={receiveProductId} onChange={e => setReceiveProductId(e.target.value)}><option value="">Seleziona un articolo</option>{state.products.map(p => <option key={p.id} value={p.id}>{p.code} · {p.name} ({p.unit})</option>)}</select></Field><Field label="Lotto"><input name="lotCode" required placeholder="Codice lotto reale"/></Field><Field label="Scadenza" hint="Obbligatoria per prodotti e materie prime; facoltativa per gli imballaggi."><input name="expiry" type="date"/></Field><Field label="Ubicazione" hint="Fino a tre aree interne."><input name="area" required list="areas" placeholder="Nome dell’area"/></Field><Field label="Quantità effettiva" hint={receiveProductId ? `Quantità in ${product(receiveProductId)?.unit}. CRT indica cartoni.` : "Seleziona l’articolo per verificare l’unità di misura."}><input name="quantity" type="number" required min="1" step="1"/></Field><p className="form-help span-2">Registra solo la merce ricevuta o contata. La stessa combinazione articolo, lotto e area viene aggiornata, non duplicata.</p></div> : <div className="notice">Prima inserisci almeno un articolo nel catalogo.<button className="button secondary" type="button" onClick={() => open('product')}>Inserisci articolo</button></div>)}
 {modal.type === 'start' && <><Field label="Scansiona o digita il codice articolo"><div className="search-field"><ScanLine size={19}/><input value={code} onChange={e => setCode(e.target.value)} onKeyDown={e => { if (e.key === 'Enter')
                e.preventDefault(); }} required autoFocus placeholder="Codice dell’etichetta"/></div></Field><button type="button" className="button secondary" onClick={() => setCamera(!camera)}><Camera size={17}/>Usa fotocamera</button>{camera && <CameraScan onClose={() => setCamera(false)} onCode={v => { setCode(v); setCamera(false); }}/>}{matched ? <div className="notice"><CheckCircle2 size={20}/><div><b>{matched.name}</b><p>Codice esatto {matched.code} · {matched.unitsPerBox} {matched.unit === 'CRT' ? 'cartone' : matched.unit} per cartone · confezionamento salvato nella lavorazione</p></div></div> : code.trim() && <div className="notice amber">{matchedOther ? `Il codice ${matchedOther.code} esiste ma non è un prodotto finito: non si può avviare una lavorazione.` : 'Codice non presente nel catalogo: avvio non consentito. Controlla l’etichetta o il catalogo.'}</div>}<div className="form-grid"><Field label="Operatore"><input name="operator" required placeholder="Nome del responsabile"/></Field><Field label="Lotto di produzione"><input name="lotCode" required/></Field><Field label="Scadenza"><input name="expiry" type="date" min={today} required/></Field></div>{devicesEnabled ? <fieldset className="field"><span>Conteggio dei cartoni</span><label className="check-label"><input type="radio" name="counting" value="manual" defaultChecked/>Manuale (aggiungo i cartoni contati)</label><label className="check-label"><input type="radio" name="counting" value="device"/>Fotocellule tramite ponte (in prova: niente conteggi a mano)</label></fieldset> : <input type="hidden" name="counting" value="manual"/>}<p className="form-help">Il conteggio riparte da zero; l’avvio non comanda la macchina.</p></>}
 {modal.type === 'count' && <><Field label="Cartoni da aggiungere"><input name="cartons" type="number" min="1" step="1" required autoFocus/></Field><p className="form-help">Inserisci soltanto i cartoni aggiuntivi contati. Il totale verrà aggiornato dopo il salvataggio.</p></>}
 {modal.type === 'close' && <><div className="notice"><Save size={22}/><div><b>{current?.productName}</b><p>{current?.source === 'device' ? 'Conteggio da fotocellule' : `${n(current?.cartons || 0)} cartoni letti`} · Lotto {current?.lotCode}</p></div></div><p>La lavorazione viene salvata nello storico. La successiva richiede una nuova identificazione dell’articolo.</p>{current?.source === 'device' ? <Field label="Motivo della chiusura manuale" wide hint="Di norma la lavorazione si chiude con il pulsante sulla linea. Una chiusura qui resta segnalata e il conteggio del ponte andrà verificato."><textarea name="override" required/></Field> : <div className="form-grid"><Field label="Cartoni scartati" hint="Facoltativo. Restano distinti dai cartoni letti."><input name="scrapCartons" type="number" min="0" max={current?.cartons} step="1" defaultValue={0}/></Field><Field label="Nota (obbligatoria se ci sono scarti)"><input name="note" maxLength={300}/></Field></div>}<p className="form-help">Non azzera lo storico e non carica il magazzino.</p><label className="check-label"><input type="checkbox" required/>Ho verificato l’articolo e il conteggio finale.</label></>}
 {modal.type === 'order' && <><div className="form-grid"><Field label="Cliente / destinatario"><input name="customer" required autoFocus/></Field><Field label="Destinazione"><input name="destination" required/></Field><Field label="Data di consegna"><input name="date" type="date" required defaultValue={today}/></Field></div><div className="stack">{orderRows.map((row, i) => <div className="form-grid" key={i}><Field label={'Articolo e lotto ' + (i + 1)}><select required value={row.lotId} onChange={e => setOrderRows(r => r.map((v, j) => j === i ? { ...v, lotId: e.target.value } : v))}><option value="">Seleziona merce disponibile</option>{state.lots.filter(l => index.lot(l.id).available > 0).sort((a, b) => (a.expiry || '9999').localeCompare(b.expiry || '9999')).map(l => <option value={l.id} key={l.id}>{product(l.productId)?.code} · {product(l.productId)?.name} · lotto {l.code} · scad. {l.expiry ? date(l.expiry) : '—'} · {l.area} · {n(index.lot(l.id).available)} {product(l.productId)?.unit} disponibili</option>)}</select></Field><Field label="Quantità da prenotare"><div className="split"><input required type="number" min="1" step="1" value={row.quantity} onChange={e => setOrderRows(r => r.map((v, j) => j === i ? { ...v, quantity: Number(e.target.value) } : v))}/>{orderRows.length > 1 && <button type="button" className="icon-button" aria-label={'Rimuovi riga ' + (i + 1)} onClick={() => setOrderRows(r => r.filter((_, j) => j !== i))}><X size={17}/></button>}</div></Field></div>)}</div><button className="button secondary" type="button" onClick={() => setOrderRows(r => [...r, { lotId: '', quantity: 1 }])}><Plus size={16}/>Aggiungi riga</button><p className="form-help">La conferma prenota la merce. Il fisico verrà aggiornato soltanto alla partenza.</p></>}
 {modal.type === 'block' && <><p>{product(selectedLot?.productId || '')?.name} · Lotto {selectedLot?.code}</p><Field label="Quantità totale da tenere bloccata" hint="Inserisci 0 per sbloccare. La merce prenotata non può essere bloccata."><input name="blocked" type="number" min="0" step="1" defaultValue={selectedLot?.blocked} required/></Field></>}
 {modal.type === 'transfer' && <div className="form-grid"><Field label="Quantità da spostare"><input name="quantity" type="number" min="1" step="1" required/></Field><Field label="Area di destinazione"><input name="area" list="areas" required/></Field><p className="form-help span-2">Sposta solo quantità non bloccate e non prenotate. Il totale dello stabilimento rimane invariato.</p></div>}
 {modal.type === 'adjust' && <div className="form-grid"><Field label="Variazione di quantità" hint="Numero negativo per ridurre, positivo per aggiungere."><input name="delta" type="number" step="1" required/></Field><Field label="Responsabile della verifica"><input name="responsible" required/></Field><Field label="Motivo della rettifica" wide><textarea name="reason" required placeholder="Spiega il risultato del riconteggio o il motivo del movimento."/></Field><label className="check-label span-2"><input type="checkbox" required/>Ho verificato la quantità reale e sono autorizzato alla rettifica.</label></div>}
 {modal.type === 'dispatch' && <><p>Registra le quantità che partono realmente. Lascia a zero ciò che rimane da consegnare.</p>{selectedOrder?.lines.filter(l => l.shipped < l.quantity).map(l => { const lot = state.lots.find(x => x.id === l.lotId); return <Field key={l.lotId} label={`${product(lot?.productId || '')?.name} · Lotto ${lot?.code}`} hint={`Residuo: ${l.quantity - l.shipped}`}><input name={'qty-' + l.lotId} type="number" min="0" max={l.quantity - l.shipped} step="1" defaultValue={l.quantity - l.shipped} required/></Field>; })}<Field label="Riferimento DDT / documento di partenza"><input name="documentRef" required placeholder="Numero e data"/></Field><Field label="Motivo della differenza" hint="Obbligatorio se parte meno del residuo: resta nello storico dell’ordine."><input name="note" maxLength={300} placeholder="es. merce non pronta, richiesta del cliente"/></Field><label className="check-label"><input type="checkbox" required/>Confermo la partenza effettiva della merce indicata.</label></>}
 {modal.type === 'document' && <><Field label="Riferimento del documento"><input name="documentRef" required placeholder="es. Fattura n. … del …"/></Field><p className="form-help">Il documento viene associato all’ordine e conservato nello storico. Non scarica di nuovo la merce.</p></>}
 {modal.type === 'cancel' && <p>Il residuo dell’ordine di <b>{selectedOrder?.customer}</b> non verrà più consegnato. Le prenotazioni residue verranno liberate; le quantità già partite rimangono nello storico.</p>}
 {(modal.type === 'scrap' || modal.type === 'consume') && <><p>{product(selectedLot?.productId || '')?.code} · {product(selectedLot?.productId || '')?.name} · Lotto {selectedLot?.code} · {selectedLot?.area}</p><p className="form-help">Presenti {n(selectedLot?.quantity || 0)} · bloccati {n(selectedLot?.blocked || 0)} · disponibili {n(selectedLot ? index.lot(selectedLot.id).available : 0)} {product(selectedLot?.productId || '')?.unit}. {modal.type === 'scrap' ? 'Lo scarto riduce il fisico con un movimento esplicito.' : 'Il consumo interno riduce il fisico; non vale per merce scaduta, bloccata o prenotata.'}</p><div className="form-grid"><Field label={modal.type === 'scrap' ? 'Quantità scartata' : 'Quantità consumata'}><input name="quantity" type="number" min="1" step="1" required autoFocus/></Field><Field label="Responsabile"><input name="responsible" required/></Field><Field label="Motivo" wide><textarea name="reason" required/></Field>{modal.type === 'scrap' && <label className="check-label span-2"><input type="checkbox" name="fromBlocked" defaultChecked={(selectedLot?.blocked || 0) > 0}/>Scarta dalla quantità bloccata (es. reso o merce danneggiata già messa da parte)</label>}</div></>}
 {modal.type === 'return' && (state.products.length ? <div className="form-grid"><Field label="Articolo" wide><select name="productId" required value={receiveProductId} onChange={e => setReceiveProductId(e.target.value)}><option value="">Seleziona un articolo</option>{state.products.map(p => <option key={p.id} value={p.id}>{p.code} · {p.name} ({p.unit})</option>)}</select></Field><Field label="Lotto"><input name="lotCode" required/></Field><Field label="Scadenza"><input name="expiry" type="date"/></Field><Field label="Ubicazione"><input name="area" required list="areas"/></Field><Field label="Quantità resa"><input name="quantity" type="number" min="1" step="1" required/></Field><Field label="Riferimento (cliente, documento)"><input name="reference" required/></Field><Field label="Motivo del reso" wide><textarea name="reason" required/></Field><p className="form-help span-2">Il reso entra come merce bloccata da controllare: non è prenotabile finché non la sblocchi (Blocco → 0) o la scarti.</p></div> : <div className="notice">Prima inserisci almeno un articolo nel catalogo.</div>)}
 <datalist id="areas">{[...new Set(state.lots.map(l => l.area))].map(area => <option value={area} key={area}/>)}</datalist>
 </div><footer><button type="button" className="button secondary" disabled={busy} onClick={() => setModal(null)}>Indietro</button><button className="button primary" disabled={disabled || (modal.type === 'start' && !matched) || ((modal.type === 'receive' || modal.type === 'return') && !state.products.length)} type="submit">{busy ? 'Salvataggio…' : modal.type === 'start' ? 'Conferma e avvia' : modal.type === 'close' ? 'Salva lavorazione' : modal.type === 'order' ? 'Conferma e prenota' : 'Conferma e salva'}<Check size={17}/></button></footer></form>}
 </section></div>}
 </div>;
}

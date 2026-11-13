"use client";
/**
 * Global search (Ctrl/⌘ K or «/»): jump to a view, start an operation, open a product,
 * a lot or an order. Read-only: it only navigates or opens the usual forms.
 */
import { useEffect, useRef } from 'react';
import { Command } from 'cmdk';
import { ArrowDownToLine, Box, ClipboardList, Download, Factory, History, LayoutDashboard, Package, Plus, ScanLine, Settings2, Truck, Undo2 } from 'lucide-react';
import type { State } from '../lib/domain';

export type PaletteView = 'overview' | 'inventory' | 'production' | 'orders' | 'history' | 'settings';
export type PaletteAction = 'receive' | 'return' | 'order' | 'start' | 'product';
type Props = {
  open: boolean;
  onClose: () => void;
  state: State;
  canAct: boolean;
  /** Operations allowed to the current access profile. */
  allowed?: (action: PaletteAction) => boolean;
  onNavigate: (view: PaletteView) => void;
  onAction: (action: PaletteAction) => void;
  onProduct: (code: string) => void;
  onLot: (code: string) => void;
  onOrder: (customer: string) => void;
};

const views: [PaletteView, string, typeof Box][] = [
  ['overview', 'Panoramica', LayoutDashboard], ['inventory', 'Magazzino', Package], ['production', 'Produzione', Factory],
  ['orders', 'Ordini', ClipboardList], ['history', 'Storico attività', History], ['settings', 'Configurazione', Settings2],
];
const actions: [PaletteAction, string, typeof Box][] = [
  ['receive', 'Registra un’entrata', ArrowDownToLine], ['start', 'Nuova lavorazione', ScanLine], ['order', 'Nuovo ordine', Plus],
  ['return', 'Registra un reso da controllare', Undo2], ['product', 'Nuovo prodotto', Plus],
];

export default function CommandPalette({ open, onClose, state, canAct, allowed = () => true, onNavigate, onAction, onProduct, onLot, onOrder }: Props) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const before = document.activeElement as HTMLElement | null;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); before?.focus?.(); };
  }, [open, onClose]);
  if (!open) return null;
  const run = (fn: () => void) => { onClose(); fn(); };
  const lots = state.lots.filter(l => l.quantity > 0 || l.blocked > 0);
  const productOf = (id: string) => state.products.find(p => p.id === id);
  return <>
    <div className="palette-overlay" onClick={onClose} aria-hidden="true"/>
    <div ref={panel} className="palette" role="dialog" aria-modal="true" aria-label="Cerca o vai a">
      <Command label="Cerca o vai a" loop>
        <Command.Input autoFocus placeholder="Cerca codice, prodotto, lotto, cliente o azione…" aria-label="Cerca nel gestionale" spellCheck={false}/>
        <Command.List>
          <Command.Empty>Nessun risultato. Prova con il codice, il lotto o il nome del cliente.</Command.Empty>
          {canAct && <Command.Group heading="Operazioni">
            {actions.filter(([id]) => allowed(id)).map(([id, label, Icon]) => <Command.Item key={id} value={'azione ' + label} onSelect={() => run(() => onAction(id))}><Icon aria-hidden="true"/><span>{label}</span></Command.Item>)}
          </Command.Group>}
          <Command.Group heading="Vai a">
            {views.map(([id, label, Icon]) => <Command.Item key={id} value={'vai ' + label} onSelect={() => run(() => onNavigate(id))}><Icon aria-hidden="true"/><span>{label}</span></Command.Item>)}
            <Command.Item value="backup completo scarica" onSelect={() => run(() => { const link = document.createElement('a'); link.href = '/api/workspace/backup'; link.download = ''; link.click(); })}><Download aria-hidden="true"/><span>Scarica backup completo</span></Command.Item>
          </Command.Group>
          {state.products.length > 0 && <Command.Group heading="Prodotti">
            {state.products.map(p => <Command.Item key={p.id} value={`prodotto ${p.code} ${p.name} ${p.category ?? ''}`} onSelect={() => run(() => onProduct(p.code))}><Box aria-hidden="true"/><span>{p.code} · {p.name}</span><small>{p.unit}</small></Command.Item>)}
          </Command.Group>}
          {lots.length > 0 && <Command.Group heading="Lotti in giacenza">
            {lots.map(l => { const p = productOf(l.productId); return <Command.Item key={l.id} value={`lotto ${l.code} ${p?.code ?? ''} ${p?.name ?? ''} ${l.area}`} onSelect={() => run(() => onLot(l.code))}><Package aria-hidden="true"/><span>Lotto {l.code} · {p?.name}</span><small>{l.quantity} {p?.unit} · {l.area}</small></Command.Item>; })}
          </Command.Group>}
          {state.orders.length > 0 && <Command.Group heading="Ordini">
            {state.orders.map(o => <Command.Item key={o.id} value={`ordine ${o.customer} ${o.destination} ${o.id.slice(0, 8)} ${o.documents.map(d => d.reference).join(' ')}`} onSelect={() => run(() => onOrder(o.customer))}><Truck aria-hidden="true"/><span>{o.customer}</span><small>{o.destination}</small></Command.Item>)}
          </Command.Group>}
        </Command.List>
      </Command>
      <div className="palette-foot" aria-hidden="true"><span><kbd>↑</kbd> <kbd>↓</kbd> scegli</span><span><kbd>Invio</kbd> apri</span><span><kbd>Esc</kbd> chiudi</span></div>
    </div>
  </>;
}

/**
 * Hot/cold split of the workspace. The hot state (one JSON row, version-checked)
 * keeps what daily work needs; closed history moves to indexed archive tables in
 * the same D1 transaction. Pure functions: no I/O, deterministic for a given day.
 */
import { activeOrder, addDays, todayRome, type Action, type Audit, type Lot, type Order, type Session, type State } from './domain.ts';

/** Closed orders and sessions stay in the hot state for this many calendar days. */
export const HOT_DAYS = 30;
export type ArchiveKind = 'order' | 'session' | 'lot';
export type ArchiveRow = { kind: ArchiveKind; id: string; day: string; ref: string; search: string; payload: string };
export type ArchiveNeeds = { order: string[]; session: string[]; lot: string[]; lotRef: string[] };

const lower = (...parts: (string | undefined)[]) => parts.filter(Boolean).join(' ').toLocaleLowerCase('it');
export const lotRef = (productId: string, code: string) => `${productId}|${code}`;

function orderLastDay(order: Order): string {
  const stamps = [order.closedAt, ...order.documents.map(d => d.at)].filter(Boolean) as string[];
  if (!stamps.length) return order.date;
  return todayRome(stamps.sort().at(-1)!);
}

export function orderRow(order: Order): ArchiveRow {
  return { kind: 'order', id: order.id, day: orderLastDay(order), ref: '', search: lower(order.customer, order.destination, ...order.documents.map(d => d.reference)), payload: JSON.stringify(order) };
}
export function sessionRow(session: Session): ArchiveRow {
  return { kind: 'session', id: session.id, day: session.day, ref: session.productId, search: lower(session.productCode, session.productName, session.lotCode, session.operator), payload: JSON.stringify(session) };
}
export function lotRow(lot: Lot, day: string): ArchiveRow {
  return { kind: 'lot', id: lot.id, day, ref: lotRef(lot.productId, lot.code), search: lower(lot.code, lot.area), payload: JSON.stringify(lot) };
}

/**
 * Moves out: every audit entry; closed orders and sessions older than HOT_DAYS;
 * lots with no stock, no block and no reference from a hot order.
 * Balances are unaffected: archived lots hold zero quantity by construction.
 */
export function partition(state: State, today: string): { hot: State; rows: ArchiveRow[]; audit: Audit[] } {
  const cutoff = addDays(today, -HOT_DAYS);
  const rows: ArchiveRow[] = [];
  const orders = state.orders.filter(order => {
    if (activeOrder(order) || orderLastDay(order) >= cutoff) return true;
    rows.push(orderRow(order));
    return false;
  });
  const sessions = state.sessions.filter(session => {
    if (session.status === 'active' || session.day >= cutoff) return true;
    rows.push(sessionRow(session));
    return false;
  });
  const referenced = new Set(orders.flatMap(order => order.lines.map(line => line.lotId)));
  const lots = state.lots.filter(lot => {
    if (lot.quantity > 0 || lot.blocked > 0 || referenced.has(lot.id)) return true;
    rows.push(lotRow(lot, today));
    return false;
  });
  return { hot: { ...state, orders, sessions, lots, audit: [] }, rows, audit: state.audit };
}

/** Archived rows an action may need back in the hot state to be applied with full context. */
export function archiveNeeds(action: Action, state: State): ArchiveNeeds {
  const needs: ArchiveNeeds = { order: [], session: [], lot: [], lotRef: [] };
  const hasLot = new Set(state.lots.map(l => l.id));
  const addLot = (id: unknown) => { if (typeof id === 'string' && !hasLot.has(id)) needs.lot.push(id); };
  const a = action as Record<string, unknown>;
  switch (action.type) {
    case 'lot.block': case 'lot.transfer': case 'lot.adjust': case 'lot.scrap': case 'lot.consume': addLot(a.lotId); break;
    case 'lot.receive': case 'lot.return': {
      const lot = a.lot as { productId?: unknown; code?: unknown } | undefined;
      if (lot && typeof lot.productId === 'string' && typeof lot.code === 'string') needs.lotRef.push(lotRef(lot.productId, lot.code.trim()));
      break;
    }
    case 'order.create': {
      const lines = (a.order as { lines?: unknown } | undefined)?.lines;
      if (Array.isArray(lines)) for (const line of lines.slice(0, 350)) addLot((line as { lotId?: unknown } | null)?.lotId);
      break;
    }
    case 'order.prepare': case 'order.cancel': case 'order.dispatch': case 'order.document':
      if (typeof a.orderId === 'string' && !state.orders.some(o => o.id === a.orderId)) needs.order.push(a.orderId);
      break;
    case 'production.count': case 'production.close': case 'production.deviceClose':
      if (typeof a.sessionId === 'string' && !state.sessions.some(s => s.id === a.sessionId)) needs.session.push(a.sessionId);
      break;
  }
  return needs;
}

/** Puts archived rows back into a copy of the hot state (never duplicating an id). */
export function rehydrate(state: State, rows: { kind: ArchiveKind; payload: string }[]): State {
  const next = { ...state, orders: [...state.orders], sessions: [...state.sessions], lots: [...state.lots] };
  for (const row of rows) {
    const value = JSON.parse(row.payload);
    const list = row.kind === 'order' ? next.orders : row.kind === 'session' ? next.sessions : next.lots;
    if (!(list as { id: string }[]).some(item => item.id === value.id)) (list as unknown[]).push(value);
  }
  return next;
}

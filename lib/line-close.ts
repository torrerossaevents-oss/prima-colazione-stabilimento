/**
 * «Chiusura ricevuta» della pagina Linea (decisione di Teo del 27/11/2026): dopo una chiusura dal
 * pulsante della linea resta un riquadro fisso con ora, cartoni, lotto ed esito del carico, finché
 * non parte la lavorazione successiva. Solo lettura dello stato: il carico lo decide il server.
 */
import { productionArea, type Session, type State } from './domain.ts';

export type LineClose = {
  sessionId: string; at: string; productCode: string; productName: string; cartons: number; lotCode: string;
  loaded: boolean; problem: boolean; load: string; todo?: string; anomalies: string[];
};

/** Ultima lavorazione chiusa dal ponte, se è anche l'ultima lavorazione della linea; altrimenti null. */
export function lastLineClose(state: State): LineClose | null {
  const last = state.sessions.reduce<Session | undefined>((a, s) => !a || s.startedAt >= a.startedAt ? s : a, undefined);
  if (!last || last.status !== 'closed' || last.closedBy !== 'device') return null;
  const unit = last.unit ?? state.products.find(p => p.id === last.productId)?.unit ?? '';
  const lot = last.loadedLotId ? state.lots.find(l => l.id === last.loadedLotId) : undefined;
  const base = {
    sessionId: last.id, at: last.device?.deviceClosedAt ?? last.closedAt ?? last.startedAt, productCode: last.productCode,
    productName: last.productName, cartons: last.cartons, lotCode: last.lotCode, anomalies: last.device?.anomalies ?? [],
  };
  if (last.stockLoaded) return { ...base, loaded: true, problem: false, load: `Carico a magazzino fatto: ${last.loadedQuantity ?? 0} ${unit} nel lotto ${last.lotCode}${lot ? ` in ${lot.area}` : ''}.` };
  // Carico tentato (area e carico automatico a posto) ma nessun cartone buono: niente da fare.
  if (last.autoLoad) return { ...base, loaded: false, problem: false, load: 'Carico a magazzino NON fatto: nessun cartone buono da caricare.' };
  // Stessa quantità che il server avrebbe caricato: cartoni buoni × unità per cartone, nell'unità dell'articolo.
  const quantity = Math.max(0, last.cartons - (last.scrapCartons ?? 0)) * last.unitsPerBox;
  const expiry = last.expiry.split('-').reverse().join('/');
  const manual = `registrare a mano l’entrata di ${quantity} ${unit}${last.unitsPerBox > 1 ? ` (${last.cartons} cartoni da ${last.unitsPerBox})` : ''} nel lotto ${last.lotCode}, scadenza ${expiry} (Magazzino → Registra entrata).`;
  if (state.settings?.autoLoad === false) return { ...base, loaded: false, problem: true, load: 'Carico a magazzino NON fatto: carico automatico disattivato.', todo: `Avvisa l’amministrazione: ${manual}` };
  if (!productionArea(state)) return { ...base, loaded: false, problem: true, load: 'Carico a magazzino NON fatto: area di carico non impostata.', todo: `Avvisa l’amministrazione: scegliere l’area in Configurazione → Produzione ed etichette, poi ${manual}` };
  return { ...base, loaded: false, problem: true, load: 'Carico a magazzino NON fatto alla chiusura.', todo: `Avvisa l’amministrazione: ${manual} Il motivo è scritto nello storico.` };
}

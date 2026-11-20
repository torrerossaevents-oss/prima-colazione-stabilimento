/**
 * Conteggio dal vivo del ponte (ultimo heartbeat). È un conteggio in corso, non un carico di magazzino:
 * i cartoni entrano in magazzino solo alla chiusura della lavorazione.
 */
export type Live = { lastSeenAt: string; at: string | null; plcReachable: boolean; sessionId: string | null; cartons: number | null };
/** Intervallo di lettura dal gestionale; il ponte invia un heartbeat ogni ~6 s se configurato così. */
export const LIVE_POLL_MS = 6_000;
/** Oltre questo ritardo il dato è considerato fermo (ponte chiuso, PC in pausa, finestra bloccata). */
export const LIVE_STALE_MS = 20_000;

export type LiveView = { state: 'loading' | 'unknown' | 'stale' | 'waiting' | 'live'; cartons: number | null; ageS: number | null; plcReachable: boolean };

/** Stato da mostrare per una lavorazione: età calcolata sull'orologio del server, nessuna stima. */
export function liveView(live: Live | null | undefined, serverTime: string | null | undefined, sessionId: string): LiveView {
  if (!serverTime) return { state: 'loading', cartons: null, ageS: null, plcReachable: false };
  if (!live) return { state: 'unknown', cartons: null, ageS: null, plcReachable: false };
  const ageMs = Math.max(0, Date.parse(serverTime) - Date.parse(live.lastSeenAt));
  const ageS = Number.isFinite(ageMs) ? Math.round(ageMs / 1000) : null;
  if (ageS === null || ageMs > LIVE_STALE_MS) return { state: 'stale', cartons: live.sessionId === sessionId ? live.cartons : null, ageS, plcReachable: live.plcReachable };
  if (live.sessionId !== sessionId) return { state: 'waiting', cartons: null, ageS, plcReachable: live.plcReachable };
  return { state: 'live', cartons: live.cartons, ageS, plcReachable: live.plcReachable };
}

/** Frase per l'operatore, in italiano semplice. */
export function liveMessage(view: LiveView): string {
  if (view.state === 'loading') return 'Lettura del conteggio dal vivo…';
  if (view.state === 'unknown') return 'Nessun dato dal ponte del contapezzi: controlla che il PC di linea sia acceso e il ponte avviato.';
  if (view.state === 'stale') return `Il ponte non si aggiorna da ${view.ageS ?? '?'} s: controlla il PC di linea (finestra del ponte aperta, nessun clic dentro).`;
  if (view.state === 'waiting') return 'Ponte non ancora agganciato a questa lavorazione: non avviare la linea.';
  return `Ponte agganciato · aggiornato ${view.ageS} s fa${view.plcReachable ? '' : ' · LOGO! non raggiungibile'}. Il numero entra in magazzino alla chiusura.`;
}

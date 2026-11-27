/**
 * Conteggio dal vivo del ponte (ultimo heartbeat). È un conteggio in corso, non un carico di magazzino:
 * i cartoni entrano in magazzino solo alla chiusura della lavorazione.
 */
export type Live = { lastSeenAt: string; at: string | null; plcReachable: boolean; sessionId: string | null; cartons: number | null; queueLength?: number | null };
/** Intervallo di lettura dal gestionale; il ponte invia un heartbeat ogni ~6 s se configurato così. */
export const LIVE_POLL_MS = 6_000;
/**
 * Pagina Linea (27/11/2026): con una lavorazione da fotocellule aperta si legge ogni 3 s (ritardo massimo
 * ≈ 6 s dell'heartbeat + 3 s, invece di 12 s); senza lavorazione ogni 10 s, solo per lo stato del ponte.
 */
export const LINE_LIVE_POLL_MS = 3_000;
export const LINE_IDLE_POLL_MS = 10_000;
/** Oltre questo ritardo il dato è fermo e la pagina Linea scrive «Ponte non risponde» (ponte chiuso, PC in pausa, finestra bloccata). */
export const LIVE_STALE_MS = 30_000;

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

/** Stato del ponte per la pagina Linea, anche senza lavorazione aperta. null = dato non disponibile. */
export type BridgeStatus = {
  known: boolean;              // almeno un segnale ricevuto
  silent: boolean;             // nessun segnale da oltre LIVE_STALE_MS: «Ponte non risponde»
  ageS: number | null;         // secondi dall'ultimo segnale, sull'orologio del server
  lastSeenAt: string | null;   // ora dell'ultimo segnale
  hooked: boolean | null;      // ponte agganciato alla lavorazione aperta; null se non c'è una lavorazione da fotocellule
  plcReachable: boolean | null;
  queueLength: number | null;  // eventi del ponte non ancora confermati dal gestionale
};

export function bridgeStatus(live: Live | null | undefined, serverTime: string | null | undefined, sessionId?: string | null): BridgeStatus {
  if (!serverTime || !live) return { known: false, silent: Boolean(serverTime), ageS: null, lastSeenAt: null, hooked: sessionId ? false : null, plcReachable: null, queueLength: null };
  const ageMs = Math.max(0, Date.parse(serverTime) - Date.parse(live.lastSeenAt));
  const ageS = Number.isFinite(ageMs) ? Math.round(ageMs / 1000) : null;
  const silent = ageS === null || ageMs > LIVE_STALE_MS;
  return {
    known: true, silent, ageS, lastSeenAt: live.lastSeenAt,
    hooked: sessionId ? !silent && live.sessionId === sessionId : null,
    plcReachable: silent ? null : live.plcReachable,
    queueLength: typeof live.queueLength === 'number' ? live.queueLength : null,
  };
}

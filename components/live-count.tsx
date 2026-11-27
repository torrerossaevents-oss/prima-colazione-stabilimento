'use client';
import { useEffect, useState } from 'react';
import { request } from '../lib/client-api';
import { LIVE_POLL_MS, type Live } from '../lib/live';

/** Legge /api/workspace/live mentre `enabled` è vero e la pagina è visibile, ogni `intervalMs`. In modalità prova va passato false. */
export function useLiveCount(enabled: boolean, intervalMs: number = LIVE_POLL_MS) {
  // receivedAt: ora locale dell'ultima lettura riuscita, per accorgersi anche quando è questa pagina a non raggiungere il server.
  const [data, setData] = useState<{ live: Live | null; serverTime: string | null; receivedAt: number | null }>({ live: null, serverTime: null, receivedAt: null });
  useEffect(() => {
    if (!enabled) return;
    let stop = false;
    async function load() {
      try {
        const res = await request('/api/workspace/live', {}, 8_000);
        const body = await res.json() as { live?: Live | null; serverTime?: string };
        if (!stop && res.ok) setData({ live: body.live ?? null, serverTime: body.serverTime ?? null, receivedAt: Date.now() });
      } catch { /* the age shown keeps growing: the next poll retries */ }
    }
    const first = setTimeout(() => { void load(); }, 0);
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, intervalMs);
    const visible = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', visible);
    return () => { stop = true; clearTimeout(first); clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
  }, [enabled, intervalMs]);
  return data;
}

"use client";
/**
 * Fotocamera-lettore dell'app Linea: anteprima dal vivo a tutto schermo, lettura continua del codice
 * a barre EAN; appena lo riconosce emette un bip, cattura il fotogramma, spegne la fotocamera e
 * restituisce codice e immagine. «Scatta adesso» cattura senza codice (l'etichetta verrà letta dal testo).
 * Tutto sull'iPad: nessun fotogramma lascia il dispositivo.
 */
import { useEffect, useRef, useState } from 'react';
import { Camera, X, Zap } from 'lucide-react';

type Props = { onDetected: (barcode: string, frame: HTMLCanvasElement) => void; onCapture: (frame: HTMLCanvasElement) => void; onClose: (message?: string) => void };

/** Full-resolution copy of the current video frame. */
function grab(video: HTMLVideoElement, maxSide = 2400): HTMLCanvasElement {
  const scale = Math.min(1, maxSide / Math.max(video.videoWidth, video.videoHeight));
  const c = document.createElement('canvas'); c.width = Math.round(video.videoWidth * scale); c.height = Math.round(video.videoHeight * scale);
  c.getContext('2d')!.drawImage(video, 0, 0, c.width, c.height); return c;
}
function beep() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext; if (!Ctx) return;
    const ctx = new Ctx(); const o = ctx.createOscillator(); const g = ctx.createGain();
    o.frequency.value = 1650; g.gain.value = 0.08; o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.12); setTimeout(() => void ctx.close(), 300);
  } catch { /* silent */ }
}

export default function LabelCamera({ onDetected, onCapture, onClose }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState('Avvio della fotocamera…');
  const [slow, setSlow] = useState(false);
  const [torch, setTorch] = useState<MediaStreamTrack | null>(null);
  const done = useRef(false);
  const callbacks = useRef({ onDetected, onCapture, onClose });
  useEffect(() => { callbacks.current = { onDetected, onCapture, onClose }; });

  useEffect(() => {
    let stream: MediaStream | undefined; let timer: ReturnType<typeof setTimeout> | undefined; let stopped = false;
    const stop = () => { stopped = true; clearTimeout(timer); stream?.getTracks().forEach(t => t.stop()); };
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Questo browser non permette di usare la fotocamera: usa «Carica foto o file».');
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
        if (stopped) { stream.getTracks().forEach(t => t.stop()); return; }
        const v = video.current!; v.srcObject = stream; await v.play();
        const track = stream.getVideoTracks()[0];
        if ((track.getCapabilities?.() as { torch?: boolean } | undefined)?.torch) setTorch(track);
        setStatus('Inquadra il codice a barre dell’etichetta');
        const { decodeFrame } = await import('../lib/label-reader');
        const started = Date.now();
        // ~4 reads per second on a smaller copy of the frame: fast enough for a scanner, light on the battery.
        const loop = async () => {
          if (stopped || done.current) return;
          if (v.videoWidth) {
            const code = await decodeFrame(grab(v, 1280));
            if (code && !done.current) {
              done.current = true; beep(); const frame = grab(v); stop(); callbacks.current.onDetected(code, frame); return;
            }
            if (Date.now() - started > 8000) setSlow(true);
          }
          timer = setTimeout(() => { void loop(); }, 250);
        };
        void loop();
      } catch (e) {
        stop();
        const name = (e as { name?: string })?.name;
        callbacks.current.onClose(name === 'NotAllowedError' ? 'Accesso alla fotocamera negato: consentilo in Impostazioni → Safari → Fotocamera, oppure usa «Carica foto o file».' : e instanceof Error ? e.message : 'Fotocamera non disponibile: usa «Carica foto o file».');
      }
    })();
    return stop;
  }, []);

  function captureNow() {
    const v = video.current; if (!v?.videoWidth || done.current) return;
    done.current = true; const frame = grab(v); (v.srcObject as MediaStream | null)?.getTracks().forEach(t => t.stop()); onCapture(frame);
  }
  async function toggleTorch() {
    if (!torch) return;
    const on = !(torch.getSettings() as { torch?: boolean }).torch;
    try { await torch.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] }); } catch { /* not supported */ }
  }
  return <div className="cam" role="dialog" aria-modal="true" aria-label="Lettore etichetta">
    <video ref={video} className="cam-video" playsInline muted autoPlay/>
    <div className="cam-frame" aria-hidden="true"><span/></div>
    <div className="cam-top"><span className="cam-status" role="status">{status}</span><button className="cam-btn round" aria-label="Chiudi la fotocamera" onClick={() => { done.current = true; (video.current?.srcObject as MediaStream | null)?.getTracks().forEach(t => t.stop()); onClose(); }}><X size={28}/></button></div>
    <div className="cam-bottom">
      {slow && <p className="cam-hint">Il codice a barre non si legge? Avvicina l’iPad, evita riflessi, oppure scatta e leggo il testo.</p>}
      <div className="cam-actions">
        {torch && <button className="cam-btn" onClick={() => void toggleTorch()}><Zap size={24}/>Luce</button>}
        <button className="cam-btn primary" onClick={captureNow}><Camera size={26}/>Scatta adesso</button>
      </div>
    </div>
  </div>;
}

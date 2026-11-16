/**
 * Reads a label photo in the browser: EAN barcode (@zxing/library) and text (tesseract.js, Italian
 * model). Both run on the device; their files are served from /ocr on our own domain. The photo is
 * never uploaded. Browser-only module (canvas, workers): import it dynamically from the client.
 */
import { parseLabel, type LabelReading } from './label-parse.ts';

export type LabelScan = { text: string; barcode?: string; reading: LabelReading; preview: string };
type Progress = (step: string, fraction?: number) => void;
type OcrWorker = { recognize: (image: HTMLCanvasElement) => Promise<{ data: { text: string } }>; terminate: () => Promise<unknown> };

let worker: Promise<OcrWorker> | null = null;
async function ocrWorker(progress: Progress): Promise<OcrWorker> {
  worker ??= (async () => {
    const { createWorker } = await import('tesseract.js');
    // OEM 1 = LSTM only: the lstm cores copied to /ocr. Same-origin files, no blob worker, no CDN.
    return await createWorker('ita', 1, {
      workerPath: '/ocr/worker.min.js', corePath: '/ocr/', langPath: '/ocr', gzip: true, workerBlobURL: false,
      logger: (m: { status: string; progress: number }) => progress(m.status === 'recognizing text' ? 'Lettura del testo…' : 'Preparazione del lettore…', m.progress),
    }) as unknown as OcrWorker;
  })();
  try { return await worker; } catch (error) { worker = null; throw error; }
}

async function loadImage(file: Blob): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image(); img.decoding = 'async'; img.src = url;
    await img.decode();
    // Big enough for small label text, small enough for an iPad's memory and a fast read.
    const scale = Math.min(1, 2400 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale); canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally { URL.revokeObjectURL(url); }
}

function luminance(canvas: HTMLCanvasElement): Uint8ClampedArray {
  const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
  const out = new Uint8ClampedArray(canvas.width * canvas.height);
  for (let i = 0, j = 0; j < out.length; i += 4, j++) out[j] = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
  return out;
}

export async function readBarcode(canvas: HTMLCanvasElement): Promise<string | undefined> {
  const ZX = await import('@zxing/library');
  const hints = new Map(); hints.set(ZX.DecodeHintType.POSSIBLE_FORMATS, [ZX.BarcodeFormat.EAN_13, ZX.BarcodeFormat.EAN_8]); hints.set(ZX.DecodeHintType.TRY_HARDER, true);
  const reader = new ZX.MultiFormatReader(); reader.setHints(hints);
  // Full image first, then a smaller copy (helps with very large or slightly blurred photos).
  for (const scale of [1, 0.5]) {
    const c = scale === 1 ? canvas : (() => { const s = document.createElement('canvas'); s.width = Math.round(canvas.width * scale); s.height = Math.round(canvas.height * scale); s.getContext('2d')!.drawImage(canvas, 0, 0, s.width, s.height); return s; })();
    try { return reader.decode(new ZX.BinaryBitmap(new ZX.HybridBinarizer(new ZX.RGBLuminanceSource(luminance(c), c.width, c.height)))).getText(); }
    catch { /* try the next size */ }
  }
  return undefined;
}

/**
 * Live scanner: decodes one camera frame quickly (EAN only). Returns the code or undefined.
 * The reader is created once and reused for every frame.
 */
let frameReader: Promise<(canvas: HTMLCanvasElement) => string | undefined> | null = null;
export async function decodeFrame(canvas: HTMLCanvasElement): Promise<string | undefined> {
  frameReader ??= (async () => {
    const ZX = await import('@zxing/library');
    const hints = new Map(); hints.set(ZX.DecodeHintType.POSSIBLE_FORMATS, [ZX.BarcodeFormat.EAN_13, ZX.BarcodeFormat.EAN_8]);
    const reader = new ZX.MultiFormatReader(); reader.setHints(hints);
    return (c: HTMLCanvasElement) => { try { return reader.decode(new ZX.BinaryBitmap(new ZX.HybridBinarizer(new ZX.RGBLuminanceSource(luminance(c), c.width, c.height)))).getText(); } catch { return undefined; } };
  })();
  return (await frameReader)(canvas);
}

export async function scanLabel(file: File, progress: Progress = () => {}): Promise<LabelScan> {
  if (!file.type.startsWith('image/')) throw new Error('Carica una foto dell’etichetta (JPG, PNG o foto dell’iPad). I PDF non sono letti.');
  progress('Apertura della foto…');
  return scanCanvas(await loadImage(file), progress);
}

/** Full reading of an image already on a canvas (photo or camera frame); a barcode already decoded is reused. */
export async function scanCanvas(canvas: HTMLCanvasElement, progress: Progress = () => {}, knownBarcode?: string): Promise<LabelScan> {
  progress('Lettura del codice a barre…');
  const barcode = knownBarcode ?? await readBarcode(canvas);
  const ocr = await ocrWorker(progress);
  progress('Lettura del testo…', 0);
  const { data } = await ocr.recognize(canvas);
  const preview = canvas.toDataURL('image/jpeg', 0.6);
  return { text: data.text, barcode, reading: parseLabel(data.text, barcode), preview };
}

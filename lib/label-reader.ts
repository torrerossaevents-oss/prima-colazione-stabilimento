/**
 * Reads a label photo in the browser: EAN barcode (@zxing/library) and text (tesseract.js, Italian
 * model). Both run on the device; their files are served from /ocr on our own domain. The photo is
 * never uploaded. Browser-only module (canvas, workers): import it dynamically from the client.
 */
import { parseLabel, type LabelReading, type ParseOptions } from './label-parse.ts';

export type LabelScan = { text: string; barcode?: string; reading: LabelReading; preview: string };
type Progress = (step: string, fraction?: number) => void;
type OcrWorker = { recognize: (image: HTMLCanvasElement) => Promise<{ data: { text: string } }>; setParameters: (p: Record<string, string>) => Promise<unknown>; terminate: () => Promise<unknown> };

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
    // Loaded at most at 4032 px (an iPad photo); the reading size is set in scanCanvas.
    const scale = Math.min(1, 4032 / Math.max(img.naturalWidth, img.naturalHeight));
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

export async function scanLabel(file: File, progress: Progress = () => {}, options: ParseOptions = {}): Promise<LabelScan> {
  if (!file.type.startsWith('image/')) throw new Error('Carica una foto dell’etichetta (JPG, PNG o foto dell’iPad). I PDF non sono letti.');
  progress('Apertura della foto…');
  return scanCanvas(await loadImage(file), progress, undefined, options);
}

/** Reading size: 3000 px on the long side, enlarging small photos too (tested on the real label: below this the
 * wording and the lot were misread). */
function fit(canvas: HTMLCanvasElement, side = 3000): HTMLCanvasElement {
  const scale = side / Math.max(canvas.width, canvas.height); if (Math.abs(scale - 1) < 0.02) return canvas;
  const out = document.createElement('canvas'); out.width = Math.round(canvas.width * scale); out.height = Math.round(canvas.height * scale);
  const ctx = out.getContext('2d')!; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(canvas, 0, 0, out.width, out.height); return out;
}
/** Grey copy with the contrast stretched (1 % of the darkest and lightest pixels clipped): small label text reads much better. */
function enhance(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const out = document.createElement('canvas'); out.width = canvas.width; out.height = canvas.height;
  const ctx = out.getContext('2d')!; ctx.drawImage(canvas, 0, 0);
  const img = ctx.getImageData(0, 0, out.width, out.height); const d = img.data; const n = d.length / 4;
  const grey = new Uint8ClampedArray(n); const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) { const g = (d[i * 4] * 299 + d[i * 4 + 1] * 587 + d[i * 4 + 2] * 114) / 1000; grey[i] = g; hist[grey[i]]++; }
  let lo = 0, hi = 255, acc = 0; const cut = n * 0.01;
  while (lo < 255 && (acc += hist[lo]) < cut) lo++;
  acc = 0; while (hi > 0 && (acc += hist[hi]) < cut) hi--;
  const span = Math.max(1, hi - lo);
  for (let i = 0; i < n; i++) { const v = Math.min(255, Math.max(0, ((grey[i] - lo) * 255) / span)); d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; }
  ctx.putImageData(img, 0, 0); return out;
}

/** Full reading of an image already on a canvas (photo or camera frame); a barcode already decoded is reused. */
export async function scanCanvas(source: HTMLCanvasElement, progress: Progress = () => {}, knownBarcode?: string, options: ParseOptions = {}): Promise<LabelScan> {
  progress('Lettura del codice a barre…');
  const barcode = knownBarcode ?? await readBarcode(source);
  const canvas = fit(source);
  const ocr = await ocrWorker(progress);
  // Pass 1: grey + contrast, block layout (best for the wording and the content line on the real label).
  progress('Lettura del testo…', 0);
  await ocr.setParameters({ tessedit_pageseg_mode: '4', user_defined_dpi: '300', preserve_interword_spaces: '1' });
  const texts = [(await ocr.recognize(enhance(canvas))).data.text];
  let reading = parseLabel(texts, barcode, options);
  // Pass 2 only when something is missing (on the real label the lot line next to the barcode reads better in colour).
  if (!reading.code || !reading.name || !reading.description || !reading.piecesPerCarton || !reading.expiry || !reading.lot) {
    progress('Seconda lettura per i dati mancanti…', 0);
    await ocr.setParameters({ tessedit_pageseg_mode: '3', user_defined_dpi: '0' });
    texts.push((await ocr.recognize(canvas)).data.text);
    reading = parseLabel(texts, barcode, options);
  }
  return { text: texts.join('\n\n'), barcode, reading, preview: source.toDataURL('image/jpeg', 0.6) };
}

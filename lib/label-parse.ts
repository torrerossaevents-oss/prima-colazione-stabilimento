/**
 * Lettura dell'etichetta del cartone da testo OCR (+ codice a barre letto dall'immagine).
 * Regole ricavate dall'etichetta reale (14/11/2026): «NOME … COD.024», «Prodotto da forno crudo
 * congelato Da consumarsi previa idonea cottura», «Contiene n 50 pezzi peso netto 4500g»,
 * «Da consumarsi preferibilmente entro il 02/10/2027», «Lotto: 261002» (= data di produzione
 * AAMMGG), EAN-13 sotto il codice a barre. L'«IDENT.» stampato non viene letto (decisione di Teo, 17/11/2026).
 *
 * Più letture della stessa etichetta (es. in grigio con contrasto e a colori) si combinano: ogni
 * dato viene dalla prima lettura che lo riporta in modo valido; la dicitura dalla lettura più pulita.
 * Le parole tipiche delle etichette sbagliate di una lettera vengono corrette; una dicitura già
 * usata nel catalogo viene ripresa identica. Ciò che non si legge con certezza resta vuoto con un avviso.
 */
import { eanValid, productionExpiry } from './domain.ts';

export type LabelReading = {
  code?: string; name?: string; description?: string; ean?: string;
  piecesPerCarton?: number; netWeightG?: number; pieceWeightG?: number;
  lot?: string; productionDay?: string; expiry?: string; shelfLifeMonths?: number;
  ingredients?: string; storage?: string;
  warnings: string[];
};
export type ParseOptions = { /** Diciture già nel catalogo: una lettura simile viene sostituita dal testo esatto. */ known?: string[] };

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
/** Real calendar day or undefined. */
function day(y: number, m: number, d: number): string | undefined {
  const value = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const parsed = new Date(value + 'T00:00:00Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : undefined;
}
const clip = (text: string, max: number, name: string, warnings: string[]) => {
  if (text.length <= max) return text;
  warnings.push(`${name}: testo lungo, tagliato a ${max} caratteri. Controllalo.`);
  return text.slice(0, max - 1).trimEnd() + '…';
};

// ── Vocabulary of carton labels: words the OCR often gets one letter wrong ──
const LABEL_WORDS = new Set(`prodotto prodotti da di del della forno crudo cruda crudi crude cotto cotta cotti precotto precotta precotti
congelato congelata congelati congelate surgelato surgelata surgelati surgelate fresco fresca consumarsi consumare previa idonea idoneo
cottura preferibilmente entro il la lo le conservare conservato conservata temperatura inferiore superiore una volta scongelato scongelata
non deve essere ricongelato ricongelata modalità utilizzo preriscaldare disporre sulla sulle teglia minuti comunque portare doratura
desiderata uso professionale destinato consumo diretto contiene pezzi pezzo peso netto lotto ingredienti farcitura farcito farcita
glassa copertura vegetale vegetali burro latte uova zucchero farina frumento lievito sale cioccolato crema nocciola nocciole
albicocca ciliegia vuoto vuota cornetto cornetti treccia fagottino saccottino plumcake yogurt luogo asciutto ambiente prodotto`.split(/\s+/));
function distance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 9;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) { const row = [i]; for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = row; }
  return prev[b.length];
}
/** One-letter OCR errors on label words («orudo» → «crudo», «sonsumarsi» → «consumarsi»); real words are kept. */
function correctWords(text: string): { text: string; fixes: number } {
  let fixes = 0;
  const out = text.replace(/[A-Za-zÀ-ÿ']{3,}/g, (word, offset: number) => {
    const lower = word.toLowerCase(); const startOfSentence = offset === 0 || /[.!?]\s*$/.test(text.slice(0, offset));
    if (LABEL_WORDS.has(lower)) {
      // «Idonea» / «ldonea» in mid sentence: the capital is an OCR error (I and l look alike).
      if (!startOfSentence && word[0] !== lower[0] && word.slice(1) === lower.slice(1) && lower !== 'da') { fixes++; return lower; }
      return word;
    }
    if (word === word.toUpperCase() && word.length > 3) return word; // allergens in capitals are never touched
    const limit = lower.length >= 9 ? 2 : lower.length >= 4 ? 1 : 0; if (!limit) return word;
    const variants = [lower, lower.replace(/^l/, 'i')];
    const close = [...LABEL_WORDS].filter(w => variants.some(v => distance(v, w) <= limit));
    if (close.length !== 1) return word;
    fixes++; const fixed = close[0];
    return startOfSentence && word[0] === word[0].toUpperCase() ? fixed[0].toUpperCase() + fixed.slice(1) : fixed;
  });
  return { text: out, fixes };
}
/** «… congelato Da consumarsi …»: two phrases printed side by side become two sentences. */
const sentences = (text: string) => clean(text.trim().split(/\s{2,}/).join('. ')).replace(/([a-zà-ÿ])\s+(?=Da\s+consumarsi)/g, '$1. ').replace(/\.\s*\./g, '.');
const normalized = (s: string) => s.toLowerCase().replace(/[^a-zà-ÿ0-9]+/g, '');
function similar(a: string, b: string): number {
  const x = normalized(a), y = normalized(b); if (!x || !y) return 0;
  if (Math.abs(x.length - y.length) > Math.max(x.length, y.length) * 0.2) return 0;
  let prev = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i++) { const row = [i]; for (let j = 1; j <= y.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1)); prev = row; }
  return 1 - prev[y.length] / Math.max(x.length, y.length);
}

// ── Extraction from one OCR text ──
const codeRe = /\bC[O0][DP](?:\s*[.:]\s*|\s+)([A-Z0-9-]{0,19}\d[A-Z0-9-]{0,19})\b/i; // «COD.024», «C0D 024», «cop.024»; never «CODICE»
type One = { lines: string[]; flat: string; raw: string };
const prepare = (raw: string): One => ({ raw, flat: clean(raw), lines: raw.split(/\r?\n/).map(l => l.replace(/\s+$/, '')).filter(l => l.trim()) });
function codeAndName(t: One) {
  const i = t.lines.findIndex(l => codeRe.test(l)); if (i < 0) return undefined;
  const before = clean(t.lines[i].slice(0, t.lines[i].search(codeRe)));
  return { code: t.lines[i].match(codeRe)![1].toUpperCase(), name: before.length >= 3 ? before : undefined, next: t.lines[i + 1] };
}
function content(t: One) {
  const m = t.flat.match(/\w?ontiene\s*n\.?\s*(\d{1,6})\s*pezz\w*\s*peso\s*n\w{3,4}\s*([\d.,]{1,9})\s*(kg|g)?/i); if (!m) return undefined;
  const raw = Number(m[2].replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.'));
  return { pieces: Number(m[1]), net: m[3]?.toLowerCase() === 'kg' ? Math.round(raw * 1000) : Math.round(raw), unit: !!m[3] };
}
function expiry(t: One) {
  const after = t.flat.match(/entro\s*il\s*(\d{2})[/.\-](\d{2})[/.\-](\d{4})/i);
  const candidates = after ? [after] : [...t.flat.matchAll(/(\d{2})[/.\-](\d{2})[/.\-](\d{4})/g)];
  return candidates.map(m => day(Number(m[3]), Number(m[2]), Number(m[1]))).filter((d): d is string => !!d).sort().at(-1);
}
const lotOf = (t: One) => t.flat.match(/\bLott[o0]\s*[:.]?\s*(\d{6})\b/i)?.[1];
const printedEan = (t: One) => [...t.raw.matchAll(/(?<!\d)(\d(?:\s?\d){12})(?!\d)/g)].map(m => m[1].replace(/\s/g, '')).find(eanValid);
const ingredientsOf = (t: One) => t.flat.match(/\b\w{0,4}REDIENTI\s*:?\s*(.+?)(?=\w?rod\w{0,4}\s+in\s+uno\s+stabilimento|Conservare|\w?ontiene\s*n|$)/i)?.[1];
const storageOf = (t: One) => t.flat.match(/((?:Prodotto in uno stabilimento|Conservare).+?)(?=\w?ontiene\s*n|$)/i)?.[1];

export function parseLabel(input: string | string[], barcode?: string, options: ParseOptions = {}): LabelReading {
  const texts = (Array.isArray(input) ? input : [input]).map(prepare);
  const first = <T>(fn: (t: One) => T | undefined) => { for (const t of texts) { const v = fn(t); if (v !== undefined && v !== null && v !== '') return v; } return undefined; };
  const warnings: string[] = []; const out: LabelReading = { warnings };

  const head = first(codeAndName);
  if (head) { out.code = head.code; out.name = first(t => codeAndName(t)?.name); }
  else warnings.push('Codice articolo (COD.) non letto: inseriscilo a mano.');
  if (!out.name) out.name = first(t => { const l = t.lines.find(x => /[A-Z]{3,}/.test(x) && !codeRe.test(x)); return l ? clean(l) : undefined; });

  // Label wording: the line under the name, from the reading that needs the fewest corrections.
  const candidates = texts.map(t => codeAndName(t)?.next).filter((l): l is string => !!l && !/REDIENTI/i.test(l) && /[a-z]/.test(l))
    .map(l => { const fixed = correctWords(l); return { text: sentences(fixed.text), fixes: fixed.fixes }; }).sort((a, b) => a.fixes - b.fixes);
  if (candidates.length) {
    const best = candidates[0].text;
    const known = (options.known ?? []).map(k => ({ k, score: similar(best, k) })).sort((a, b) => b.score - a.score)[0];
    out.description = clip(known && known.score >= 0.85 ? known.k : best, 160, 'Dicitura', warnings);
  }

  // Pieces and net weight. The piece weight printed in the name («90g») wins over a misread net weight
  // («peso nello 46009»); the net weight is recomputed and a disagreement becomes a warning.
  const c = first(t => { const v = content(t); return v && (v.unit || !texts.some(x => content(x)?.unit)) ? v : undefined; }) ?? first(content);
  const fromName = out.name?.match(/(\d{1,5})\s*g\b/i);
  if (c) {
    out.piecesPerCarton = c.pieces;
    if (fromName) {
      out.pieceWeightG = Number(fromName[1]); out.netWeightG = c.pieces * out.pieceWeightG;
      const nets = texts.map(content).filter(v => v?.pieces === c.pieces).map(v => v!.net);
      if (!nets.includes(out.netWeightG)) warnings.push(`Peso netto letto ${c.net} g, calcolato ${out.netWeightG} g (${c.pieces} × ${out.pieceWeightG} g): controlla.`);
    } else if (c.unit && c.pieces > 0 && c.net % c.pieces === 0) { out.netWeightG = c.net; out.pieceWeightG = c.net / c.pieces; }
    else warnings.push('Peso netto non letto con certezza: indica il peso del pezzo.');
  } else warnings.push('Pezzi e peso netto non letti.');

  out.expiry = first(expiry); if (!out.expiry) warnings.push('Scadenza non letta o non valida.');
  const lot = first(lotOf);
  if (lot) {
    out.lot = lot; out.productionDay = day(2000 + Number(lot.slice(0, 2)), Number(lot.slice(2, 4)), Number(lot.slice(4, 6)));
    if (!out.productionDay) warnings.push(`Il lotto ${lot} non è una data AAMMGG: la durata non si può calcolare.`);
  } else warnings.push('Lotto non letto.');
  // Shelf life in whole months, only if production day + N months gives exactly the printed expiry.
  if (out.productionDay && out.expiry) {
    const [py, pm] = out.productionDay.split('-').map(Number); const [ey, em] = out.expiry.split('-').map(Number);
    const months = (ey - py) * 12 + (em - pm);
    if (months >= 1 && months <= 120 && productionExpiry(out.productionDay, months) === out.expiry) out.shelfLifeMonths = months;
    else warnings.push('Durata non in mesi interi tra lotto e scadenza: indicala a mano.');
  }

  // EAN: the barcode read from the image wins; otherwise the 13 digits printed under it.
  if (barcode && eanValid(barcode)) out.ean = barcode;
  else { out.ean = first(printedEan); if (!out.ean) warnings.push('EAN non letto: inquadra meglio il codice a barre o scrivilo a mano.'); }

  const ingredients = first(ingredientsOf); if (ingredients) out.ingredients = clip(clean(ingredients), 700, 'Ingredienti', warnings);
  const storage = first(storageOf); if (storage) out.storage = clip(correctWords(clean(storage)).text, 250, 'Conservazione', warnings);
  return out;
}

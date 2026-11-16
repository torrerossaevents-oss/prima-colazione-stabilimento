/**
 * Lettura dell'etichetta del cartone da testo OCR (+ codice a barre letto dall'immagine).
 * Regole ricavate dall'etichetta reale (14/11/2026): «NOME … COD.024», «Contiene n 50 pezzi peso
 * netto 4500g», «Da consumarsi preferibilmente entro il 02/10/2027», «Lotto: 261002» (= data di
 * produzione AAMMGG), «IDENT. 02/F», EAN-13 sotto il codice a barre.
 * Ciò che non si legge con certezza resta vuoto con un avviso: niente valori inventati.
 */
import { eanValid, productionExpiry } from './domain.ts';

export type LabelReading = {
  code?: string; name?: string; description?: string; ean?: string;
  piecesPerCarton?: number; netWeightG?: number; pieceWeightG?: number;
  lot?: string; productionDay?: string; expiry?: string; shelfLifeMonths?: number;
  ident?: string; ingredients?: string; storage?: string;
  warnings: string[];
};

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

export function parseLabel(text: string, barcode?: string): LabelReading {
  const warnings: string[] = [];
  const lines = text.split(/\r?\n/).map(l => l.replace(/\s+$/, '')).filter(l => l.trim());
  const flat = clean(text);
  const out: LabelReading = { warnings };

  // Code and name: «NOME …   COD.024» on one line (OCR may read O as 0).
  // «COD.024», «COD 024», «C0D. 024»: a separator and at least one digit (so «CODICE» is not a code).
  // OCR also reads it as «cop.» / «C0D»: the separator and the digit keep words like «CODICE» out.
  const codeRe = /\bC[O0][DP](?:\s*[.:]\s*|\s+)([A-Z0-9-]{0,19}\d[A-Z0-9-]{0,19})\b/i;
  const codeLine = lines.findIndex(l => codeRe.test(l));
  if (codeLine >= 0) {
    out.code = lines[codeLine].match(codeRe)![1].toUpperCase();
    const before = clean(lines[codeLine].slice(0, lines[codeLine].search(codeRe)));
    if (before.length >= 3) out.name = before;
  } else warnings.push('Codice articolo (COD.) non letto: inseriscilo a mano.');
  if (!out.name) { const first = lines.find(l => /[A-Z]{3,}/.test(l) && !codeRe.test(l)); if (first) out.name = clean(first); }

  // Description: the line right after the name, unless it is already the ingredient list.
  const descLine = codeLine >= 0 ? lines[codeLine + 1] : undefined;
  // Wide gaps separate the phrases printed side by side («… congelato   Da consumarsi …»).
  if (descLine && !/REDIENTI/i.test(descLine) && /[a-z]/.test(descLine)) out.description = clip(clean(descLine.trim().split(/\s{2,}/).join('. ')), 160, 'Descrizione', warnings);

  // Pieces and net weight: «Contiene n 50 pezzi peso netto 4500g». Real OCR misreads it
  // («Sontiene n 50 pezzi peso nello 46009»): the piece weight printed in the name («90g»)
  // wins, and the net weight is recomputed from it; a disagreeing reading becomes a warning.
  const content = flat.match(/\w?ontiene\s*n\.?\s*(\d{1,6})\s*pezz\w*\s*peso\s*n\w{3,4}\s*([\d.,]{1,9})\s*(kg|g)?/i);
  const fromName = out.name?.match(/(\d{1,5})\s*g\b/i);
  if (content) {
    out.piecesPerCarton = Number(content[1]);
    const raw = Number(content[2].replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.'));
    const net = content[3]?.toLowerCase() === 'kg' ? Math.round(raw * 1000) : Math.round(raw);
    if (fromName) {
      out.pieceWeightG = Number(fromName[1]); out.netWeightG = out.piecesPerCarton * out.pieceWeightG;
      if (net !== out.netWeightG) warnings.push(`Peso netto letto ${net} g, calcolato ${out.netWeightG} g (${out.piecesPerCarton} × ${out.pieceWeightG} g): controlla.`);
    } else if (content[3] && out.piecesPerCarton > 0 && net % out.piecesPerCarton === 0) { out.netWeightG = net; out.pieceWeightG = net / out.piecesPerCarton; }
    else warnings.push('Peso netto non letto con certezza: indica il peso del pezzo.');
  } else warnings.push('Pezzi e peso netto non letti.');

  // Expiry: the date after «entro il», otherwise the latest date on the label.
  const dateRe = /(\d{2})[/.\-](\d{2})[/.\-](\d{4})/g;
  const after = flat.match(/entro\s*il\s*(\d{2})[/.\-](\d{2})[/.\-](\d{4})/i);
  const candidates = after ? [after] : [...flat.matchAll(dateRe)];
  const dates = candidates.map(m => day(Number(m[3]), Number(m[2]), Number(m[1]))).filter((d): d is string => !!d).sort();
  if (dates.length) out.expiry = dates.at(-1); else warnings.push('Scadenza non letta o non valida.');

  // Lot = production day AAMMGG.
  const lot = flat.match(/\bLott[o0]\s*[:.]?\s*(\d{6})\b/i);
  if (lot) {
    out.lot = lot[1];
    out.productionDay = day(2000 + Number(lot[1].slice(0, 2)), Number(lot[1].slice(2, 4)), Number(lot[1].slice(4, 6)));
    if (!out.productionDay) warnings.push(`Il lotto ${lot[1]} non è una data AAMMGG: la durata non si può calcolare.`);
  } else warnings.push('Lotto non letto.');

  // Shelf life in whole months, only if production day + N months gives exactly the printed expiry.
  if (out.productionDay && out.expiry) {
    const [py, pm] = out.productionDay.split('-').map(Number); const [ey, em] = out.expiry.split('-').map(Number);
    const months = (ey - py) * 12 + (em - pm);
    if (months >= 1 && months <= 120 && productionExpiry(out.productionDay, months) === out.expiry) out.shelfLifeMonths = months;
    else warnings.push('Durata non in mesi interi tra lotto e scadenza: indicala a mano.');
  }

  const ident = flat.match(/\bIDENT\s*[.:]?\s*([A-Z0-9]{1,6}\/[A-Z0-9]{1,6}|[A-Z0-9/-]{1,12})\b/i);
  if (ident) out.ident = ident[1].toUpperCase();

  // EAN: the barcode read from the image wins; otherwise the 13 digits printed under it.
  if (barcode && eanValid(barcode)) out.ean = barcode;
  else {
    const printed = [...text.matchAll(/(?<!\d)(\d(?:\s?\d){12})(?!\d)/g)].map(m => m[1].replace(/\s/g, '')).find(eanValid);
    if (printed) out.ean = printed; else warnings.push('EAN non letto: inquadra meglio il codice a barre o scrivilo a mano.');
  }

  // Ingredients: from «INGREDIENTI:» to the storage/content block; storage: «Prodotto in uno stabilimento…» or «Conservare…».
  const ingredients = flat.match(/\b\w{0,4}REDIENTI\s*:?\s*(.+?)(?=\w?rod\w{0,4}\s+in\s+uno\s+stabilimento|Conservare|\w?ontiene\s*n|$)/i);
  if (ingredients) out.ingredients = clip(clean(ingredients[1]), 700, 'Ingredienti', warnings);
  const storage = flat.match(/((?:Prodotto in uno stabilimento|Conservare).+?)(?=\w?ontiene\s*n|$)/i);
  if (storage) out.storage = clip(clean(storage[1]), 250, 'Conservazione', warnings);
  return out;
}

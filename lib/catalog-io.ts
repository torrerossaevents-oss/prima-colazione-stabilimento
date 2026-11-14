import { normalizeProduct, todayRome, type Product, type ProductInput } from './domain.ts';
import type { Workbook, Worksheet, CellValue } from 'exceljs';

export type CatalogImport = { products: ProductInput[]; warnings: string[] };
/** `all` = the complete catalog; `filtered` = only the rows currently shown by search/category filters. */
export type ExportScope = 'all' | 'filtered';
export type ExportOptions = { scope?: ExportScope; format?: 'xlsx' | 'csv' };
type Field = 'category' | 'code' | 'name' | 'unit' | 'priceGelCor' | 'priceGelitria' | 'priceDistribution' | 'kind' | 'unitsPerBox' | 'minStock';
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 350;
const MAX_SHEET_ROWS = 1000;
const MAX_COLUMNS = 60;
const headers: { field: Field; title: string; width: number }[] = [
  { field: 'category', title: 'Categoria', width: 19 },
  { field: 'code', title: 'Cod.', width: 18 },
  { field: 'name', title: 'Descrizione', width: 64 },
  { field: 'unit', title: 'U.m.', width: 12 },
  { field: 'priceGelCor', title: 'Listino 3 - Gel.Cor.', width: 23 },
  { field: 'priceGelitria', title: 'GELITRIA SRL', width: 21 },
  { field: 'priceDistribution', title: 'Distribuzione', width: 21 },
  { field: 'kind', title: 'Tipologia', width: 23 },
  { field: 'unitsPerBox', title: 'Unità per cartone', width: 21 },
  { field: 'minStock', title: 'Scorta minima', width: 19 },
];
const aliases: Record<string, Field> = {
  categoria: 'category', categoriacommerciale: 'category', category: 'category',
  cod: 'code', codice: 'code', codicearticolo: 'code', codarticolo: 'code', code: 'code',
  descrizione: 'name', articolo: 'name', nome: 'name', nomearticolo: 'name', name: 'name',
  um: 'unit', unitadimisura: 'unit', unita: 'unit', unit: 'unit',
  listino3gelcor: 'priceGelCor', listinogelcor: 'priceGelCor', gelcor: 'priceGelCor', pricegelcor: 'priceGelCor',
  gelitriasrl: 'priceGelitria', listinogelitriasrl: 'priceGelitria', listinogelitria: 'priceGelitria', gelitria: 'priceGelitria', pricegelitria: 'priceGelitria',
  distribuzione: 'priceDistribution', listinodistribuzione: 'priceDistribution', pricedistribution: 'priceDistribution',
  tipologia: 'kind', tipo: 'kind', tipooperativo: 'kind', kind: 'kind',
  unitapercartone: 'unitsPerBox', pezzipercartone: 'unitsPerBox', unitsperbox: 'unitsPerBox',
  scortaminima: 'minStock', minstock: 'minStock',
};
function normalizedHeader(value: unknown): string {
  return typeof value === 'string' ? value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '') : '';
}
function isEmpty(value: unknown): boolean { return value === null || value === undefined || (typeof value === 'string' && !value.trim()); }
/** Text that a spreadsheet could read as a formula or control sequence (OWASP CSV injection). */
const FORMULA_START = /^[=+\-@\t\r]/;
function isFormula(value: unknown): boolean { return !!value && typeof value === 'object' && ('formula' in value || 'sharedFormula' in value); }
function textCell(value: unknown, label: string, row: number): string {
  if (isEmpty(value)) return '';
  if (typeof value === 'string') {
    const text = value.trim();
    // Undo the apostrophe added by the CSV export to neutralise formula-like text.
    return text.startsWith("'") && FORMULA_START.test(text.slice(1)) ? text.slice(1).trim() : text;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (isFormula(value)) throw new Error(`Riga ${row}, ${label}: la formula non ha un valore salvato utilizzabile. Apri il file in Excel, ricalcola e salva, oppure incolla i valori.`);
  throw new Error(`Riga ${row}, ${label}: usa un valore semplice, senza date, errori o collegamenti.`);
}
function price(value: unknown, label: string, row: number): number | null {
  if (isEmpty(value)) return null;
  if (typeof value === 'number') return value;
  const raw = textCell(value, label, row).replace(/\s|€/g, '');
  // Italian convention: comma = decimals, dots before the comma = thousands (1.234,567).
  // A dot alone is a decimal point (1.5), except «1.234»: thousands or three decimals cannot be told apart.
  if (!raw.includes(',') && /^[1-9]\d{0,2}\.\d{3}$/.test(raw)) throw new Error(`Riga ${row}, ${label}: «${raw}» è ambiguo (migliaia o decimali?). Scrivi ${raw.replace('.', '')} oppure ${raw.replace('.', ',')}.`);
  const valid = raw.includes(',') ? /^(?:\d+|\d{1,3}(?:\.\d{3})+),\d{1,3}$/.test(raw) : /^\d+(?:\.\d{1,3})?$/.test(raw);
  if (!valid) throw new Error(`Riga ${row}, ${label}: «${raw}» non è un prezzo valido. Usa un numero da 0 in su con la virgola per i decimali (es. 1,5 o 1.234,567), al massimo 3 decimali, oppure lascia vuoto.`);
  return Number(raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw);
}
function integer(value: unknown, label: string, row: number, fallback?: number): number {
  if (isEmpty(value) && fallback !== undefined) return fallback;
  const raw = textCell(value, label, row);
  if (!/^\d+$/.test(raw)) throw new Error(`Riga ${row}, ${label}: inserisci un numero intero da 0 in su, senza decimali né separatori delle migliaia (es. 1000).`);
  return Number(raw);
}
function kind(value: unknown, row: number): ProductInput['kind'] {
  const raw = textCell(value, 'Tipologia', row).toLowerCase();
  const kinds: Record<string, ProductInput['kind']> = { '': 'finished', finished: 'finished', 'prodotto finito': 'finished', raw: 'raw', 'materia prima': 'raw', packaging: 'packaging', imballaggio: 'packaging' };
  if (!Object.hasOwn(kinds, raw)) throw new Error(`Riga ${row}, Tipologia: usa Prodotto finito, Materia prima o Imballaggio.`);
  return kinds[raw];
}
type Mapping = Partial<Record<Field, number[]>>;
function mapHeader(row: unknown[]): Mapping {
  const result: Mapping = {};
  row.forEach((value, column) => { const key = normalizedHeader(value); const field = Object.hasOwn(aliases, key) ? aliases[key] : undefined; if (field) (result[field] ??= []).push(column); });
  return result;
}
const HEADER_SCAN_ROWS = 20;
const requiredFields = ['code', 'name', 'unit'] as const;
const titleOf = (field: Field) => headers.find(h => h.field === field)!.title;
function locateHeader(rows: unknown[][]): { index: number; mapping: Mapping } | null {
  for (let index = 0; index < Math.min(rows.length, HEADER_SCAN_ROWS); index++) {
    const mapping = mapHeader(rows[index] ?? []);
    if (requiredFields.every(field => mapping[field])) return { index, mapping };
  }
  return null;
}
function missingHeaderMessage(rows: unknown[][]): string {
  let best: Mapping = {};
  for (const row of rows.slice(0, HEADER_SCAN_ROWS)) { const mapping = mapHeader(row); if (Object.keys(mapping).length > Object.keys(best).length) best = mapping; }
  const missing = requiredFields.filter(field => !best[field]).map(titleOf);
  return `Intestazioni mancanti: non trovo ${missing.join(', ')}. Servono Cod., Descrizione e U.m. nella stessa riga, entro le prime ${HEADER_SCAN_ROWS}. Usa il modello disponibile.`;
}
function checkSheetSize(rowCount: number, columnCount: number, where: string): void {
  if (rowCount > MAX_SHEET_ROWS) throw new Error(`${where} ha ${rowCount} righe: il limite è ${MAX_SHEET_ROWS} righe (intestazione compresa) e ${MAX_ROWS} prodotti. Elimina le righe estranee al catalogo.`);
  if (columnCount > MAX_COLUMNS) throw new Error(`${where} ha ${columnCount} colonne: il limite è ${MAX_COLUMNS}. Elimina le colonne estranee al catalogo.`);
}

/** Parse a complete catalog atomically. Zero-based arrays represent physical spreadsheet rows/columns. */
export function parseCatalogRows(rows: unknown[][]): CatalogImport {
  checkSheetSize(rows.length, Math.max(0, ...rows.map(row => row.length)), 'Il foglio');
  const header = locateHeader(rows);
  if (!header) throw new Error(missingHeaderMessage(rows));
  for (const [field, indexes] of Object.entries(header.mapping)) {
    // Category may span adjacent merged columns in the supplied business format.
    if (indexes!.length > 1 && field !== 'category') throw new Error(`La colonna ${titleOf(field as Field)} compare più volte.`);
  }
  const products: ProductInput[] = [], warnings: string[] = [], issues: string[] = [];
  const unknown = rows[header.index].filter(cell => !isEmpty(cell) && !Object.hasOwn(aliases, normalizedHeader(cell))).map(cell => `«${String(cell).trim()}»`);
  if (unknown.length) warnings.push(`Colonne non riconosciute e ignorate: ${unknown.join(', ')}.`);
  const seen = new Map<string, number>();
  const dataRows = rows.map((row, index) => ({ row, number: index + 1 })).slice(header.index + 1).filter(({ row }) => row.some(value => !isEmpty(value)));
  for (let index = 0; index < dataRows.length; index++) {
    const { row, number: rowNumber } = dataRows[index];
    const value = (field: Field): unknown => {
      const cells = (header.mapping[field] ?? []).map(column => row[column]).filter(cell => !isEmpty(cell));
      if (cells.length > 1 && cells.some(cell => cell !== cells[0])) throw new Error(`Riga ${rowNumber}: la categoria è presente in più colonne con valori diversi.`);
      return cells[0];
    };
    try {
      const codeValue = value('code');
      // The source workbook ends with a bare count in Description, not an article.
      if (isEmpty(codeValue) && row.filter(cell => !isEmpty(cell)).length === 1 && index === dataRows.length - 1 && products.length > 0 && String(value('name')).trim() === String(products.length)) {
        warnings.push(`Riga ${rowNumber}: escluso il totale finale di ${products.length} prodotti.`);
        continue;
      }
      if (typeof codeValue === 'number') throw new Error(`Riga ${rowNumber}, Cod.: il codice è numerico. Imposta la cella come Testo e verifica gli eventuali zeri iniziali prima di importare.`);
      const code = textCell(codeValue, 'Cod.', rowNumber).toUpperCase();
      if (!code) throw new Error(`Riga ${rowNumber}: manca il codice articolo.`);
      if (/^[+-]?\d+(?:[.,]\d+)?e[+-]?\d+$/i.test(code)) throw new Error(`Riga ${rowNumber}, Cod.: il valore sembra in notazione scientifica. Ripristina il codice completo come testo.`);
      if (seen.has(code)) throw new Error(`Riga ${rowNumber}: codice ${code} duplicato (già alla riga ${seen.get(code)}).`);
      const unit = textCell(value('unit'), 'U.m.', rowNumber);
      if (!unit) throw new Error(`Riga ${rowNumber}: manca l’unità di misura.`);
      const unitsValue = value('unitsPerBox');
      if (isEmpty(unitsValue) && unit.toUpperCase() !== 'CRT') throw new Error(`Riga ${rowNumber}: specifica Unità per cartone per l’unità ${unit}. Il valore 1 è automatico solo per CRT.`);
      const product = normalizeProduct({
        code, name: textCell(value('name'), 'Descrizione', rowNumber), category: textCell(value('category'), 'Categoria', rowNumber),
        unit, kind: kind(value('kind'), rowNumber), unitsPerBox: integer(unitsValue, 'Unità per cartone', rowNumber, unit.toUpperCase() === 'CRT' ? 1 : undefined),
        minStock: integer(value('minStock'), 'Scorta minima', rowNumber, 0),
        priceGelCor: price(value('priceGelCor'), 'Listino 3 - Gel.Cor.', rowNumber),
        priceGelitria: price(value('priceGelitria'), 'GELITRIA SRL', rowNumber),
        priceDistribution: price(value('priceDistribution'), 'Distribuzione', rowNumber),
      });
      // An absent column is not a request to erase an existing optional value.
      for (const field of ['category', 'priceGelCor', 'priceGelitria', 'priceDistribution', 'kind', 'minStock'] as const) if (!header.mapping[field]) delete (product as Partial<ProductInput>)[field];
      seen.set(code, rowNumber);
      products.push(product);
    } catch (error) { const message = error instanceof Error ? error.message : 'Dati non validi.'; issues.push(message.startsWith('Riga ') ? message : `Riga ${rowNumber}: ${message}`); }
  }
  if (issues.length) throw new Error(`Importazione non eseguita. ${issues.slice(0, 8).join('\n')}${issues.length > 8 ? `\nAltre ${issues.length - 8} righe da correggere.` : ''}`);
  if (products.length > MAX_ROWS) throw new Error(`Il file contiene ${products.length} prodotti: il catalogo pilota accetta al massimo ${MAX_ROWS} prodotti per file.`);
  if (!products.length) throw new Error('Il file non contiene prodotti da importare. Compila almeno una riga del modello.');
  const missingPrices = products.filter(p => p.priceGelCor == null && p.priceGelitria == null && p.priceDistribution == null).length;
  if (missingPrices) warnings.push(`${missingPrices} ${missingPrices === 1 ? 'prodotto senza prezzi indicati nel file' : 'prodotti senza prezzi indicati nel file'}.`);
  if (!header.mapping.kind) warnings.push('Tipologia non presente nel file: i nuovi articoli sono Prodotti finiti, quelli esistenti mantengono la loro tipologia.');
  if (!header.mapping.minStock) warnings.push('Scorta minima non presente nel file: 0 per i nuovi articoli, invariata per quelli esistenti.');
  warnings.push('Il file aggiorna solo il catalogo: giacenze, lotti e scadenze restano invariati.');
  return { products, warnings };
}

/** RFC4180-style CSV, including quoted separators/newlines, UTF-8 BOM and Excel sep= hint. */
export function parseCatalogCsv(input: string): CatalogImport {
  if (new TextEncoder().encode(input).byteLength > MAX_FILE_BYTES) throw new Error('Il file supera il limite di 5 MB.');
  return parseCsvText(input);
}
function parseCsvText(input: string): CatalogImport {
  let text = input.replace(/^\uFEFF/, '');
  let delimiter = '';
  const hint = text.match(/^sep=([;,\t])\r?\n/i);
  if (hint) { delimiter = hint[1]; text = text.slice(hint[0].length); }
  if (!delimiter) {
    const counts: Record<string, number> = { ';': 0, ',': 0, '\t': 0 }; let quoted = false;
    for (let index = 0; index < text.length; index++) {
      const char = text[index];
      if (char === '"') { if (quoted && text[index + 1] === '"') index++; else quoted = !quoted; }
      else if (!quoted && (char === '\n' || char === '\r')) break;
      else if (!quoted && char in counts) counts[char]++;
    }
    delimiter = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    if (!counts[delimiter]) throw new Error('CSV non riconosciuto: separa le colonne con punto e virgola o virgola.');
  }
  const rows: string[][] = []; let row: string[] = [], cell = '', quoted = false, closed = false;
  // Stop as soon as a limit is crossed instead of materialising an oversized table.
  const finishCell = () => { row.push(cell); cell = ''; closed = false; if (row.length > MAX_COLUMNS) throw new Error(`Il CSV, alla riga ${rows.length + 1}, supera ${MAX_COLUMNS} colonne: il limite è ${MAX_COLUMNS}. Elimina le colonne estranee al catalogo.`); };
  const finishRow = () => { finishCell(); rows.push(row); row = []; if (rows.length > MAX_SHEET_ROWS) throw new Error(`Il CSV supera ${MAX_SHEET_ROWS} righe: il limite è ${MAX_SHEET_ROWS} righe (intestazione e righe vuote comprese) e ${MAX_ROWS} prodotti. Elimina le righe estranee al catalogo.`); };
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) { if (char === '"') { if (text[index + 1] === '"') { cell += '"'; index++; } else { quoted = false; closed = true; } } else cell += char; continue; }
    if (char === delimiter) { finishCell(); continue; }
    if (char === '\n' || char === '\r') { finishRow(); if (char === '\r' && text[index + 1] === '\n') index++; continue; }
    if (closed) { if (char === ' ' || char === '\t') continue; throw new Error(`CSV riga ${rows.length + 1}: caratteri dopo la chiusura delle virgolette.`); }
    if (char === '"') { if (cell.length) throw new Error(`CSV riga ${rows.length + 1}: virgolette non valide.`); quoted = true; continue; }
    cell += char;
  }
  if (quoted) throw new Error('CSV non valido: una cella tra virgolette non è stata chiusa. Controlla le virgolette (") nel file.');
  if (cell || row.length || closed) finishRow();
  return parseCatalogRows(rows);
}

/** Check archive metadata before ExcelJS allocates the workbook in browser memory. */
function checkXlsxArchive(bytes: Uint8Array): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let index = bytes.length - 22; index >= Math.max(0, bytes.length - 65557); index--) if (view.getUint32(index, true) === 0x06054b50) { end = index; break; }
  if (end < 0) throw new Error('Il file non è un XLSX valido. Esportalo nuovamente da Excel.');
  const entries = view.getUint16(end + 10, true), start = view.getUint32(end + 16, true);
  if (entries > 1000 || entries === 0 || start >= bytes.length || view.getUint16(end + 4, true) !== 0 || view.getUint16(end + 6, true) !== 0) throw new Error('Il file Excel è troppo complesso. Copia il catalogo nel modello disponibile.');
  let offset = start, expanded = 0;
  for (let index = 0; index < entries; index++) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) throw new Error('Archivio Excel non valido.');
    if (view.getUint16(offset + 8, true) & 1) throw new Error('Il file Excel è protetto: salva una copia senza password.');
    expanded += view.getUint32(offset + 24, true);
    if (expanded > 20 * 1024 * 1024) throw new Error('Il contenuto Excel supera 20 MB. Usa un file contenente soltanto il catalogo.');
    offset += 46 + view.getUint16(offset + 28, true) + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
  }
}
/** Formulas are never evaluated: the value Excel last calculated and saved in the file is used. */
function simpleExcelValue(value: CellValue): unknown {
  if (value && typeof value === 'object' && 'richText' in value) return value.richText.map(run => run.text).join('');
  if (isFormula(value)) { const result = (value as { result?: unknown }).result; return typeof result === 'string' || typeof result === 'number' ? result : value; }
  return value;
}
type SheetData = { rows: unknown[][]; formulas: number };
function sheetRows(sheet: Worksheet): SheetData {
  // Limits apply to the area that holds values: formatting alone does not make a sheet larger.
  let lastRow = 0, lastColumn = 0;
  sheet.eachRow((row, rowNumber) => row.eachCell((cell, column) => { if (!isEmpty(simpleExcelValue(cell.value))) { lastRow = rowNumber; lastColumn = Math.max(lastColumn, column); } }));
  checkSheetSize(lastRow, lastColumn, `Il foglio «${sheet.name}»`);
  const rows: unknown[][] = [];
  let formulas = 0;
  for (let rowIndex = 1; rowIndex <= lastRow; rowIndex++) {
    const row: unknown[] = [];
    for (let column = 1; column <= lastColumn; column++) {
      const value = sheet.getCell(rowIndex, column).value, simple = simpleExcelValue(value);
      if (isFormula(value) && simple !== value) formulas++;
      row.push(simple);
    }
    rows.push(row);
  }
  return { rows, formulas };
}
async function newWorkbook(): Promise<Workbook> {
  const exceljs = await import('exceljs');
  const Excel = exceljs.default ?? exceljs;
  return new Excel.Workbook();
}
/** Excel saves CSV as UTF-8 (with BOM), ANSI/Windows-1252 or UTF-16 ("Testo Unicode"). */
function decodeCsv(bytes: Uint8Array): { text: string; warning?: string } {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(bytes) };
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { text: new TextDecoder('utf-16be').decode(bytes) };
  try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) }; }
  catch { return { text: new TextDecoder('windows-1252').decode(bytes), warning: 'Il CSV non è in UTF-8: è stato letto come Windows-1252 (ANSI). Controlla accenti e simboli nell’anteprima prima di importare.' }; }
}

export async function readCatalogFile(file: File): Promise<CatalogImport> {
  if (file.size > MAX_FILE_BYTES) throw new Error('Il file supera il limite di 5 MB.');
  if (!file.size) throw new Error('Il file è vuoto.');
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (extension === 'csv') {
    const { text, warning } = decodeCsv(new Uint8Array(await file.arrayBuffer()));
    const result = parseCsvText(text);
    if (warning) result.warnings.unshift(warning);
    return result;
  }
  if (extension !== 'xlsx') throw new Error('Scegli un file Excel .xlsx oppure un CSV. Per i vecchi .xls, salva prima una copia .xlsx.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  checkXlsxArchive(bytes);
  const workbook = await newWorkbook();
  try { await workbook.xlsx.load(bytes as unknown as Parameters<Workbook['xlsx']['load']>[0]); }
  catch { throw new Error('Non riesco a leggere il file Excel. Salvalo come .xlsx senza password e riprova.'); }
  if (!workbook.worksheets.length) throw new Error('Il file Excel non contiene fogli. Usa il modello disponibile.');
  const candidates = workbook.worksheets.map(sheet => ({ sheet, ...sheetRows(sheet) })).filter(item => locateHeader(item.rows));
  if (candidates.length !== 1) throw new Error(candidates.length ? 'Più fogli contengono un catalogo. Salva un file con un solo foglio prodotti da importare.' : 'Nessun foglio contiene Cod., Descrizione e U.m. Usa il modello disponibile.');
  const result = parseCatalogRows(candidates[0].rows);
  if (candidates[0].formulas) result.warnings.unshift(`${candidates[0].formulas} ${candidates[0].formulas === 1 ? 'cella con formula' : 'celle con formula'}: importato il valore già calcolato e salvato nel file; le formule non vengono eseguite.`);
  const ignored = workbook.worksheets.filter(sheet => sheet !== candidates[0].sheet);
  if (ignored.length) result.warnings.unshift(`Letto il foglio «${candidates[0].sheet.name}»; esclusi ${ignored.length} fogli senza intestazioni prodotto.`);
  return result;
}

function downloadBytes(name: string, bytes: Uint8Array, type: string): void {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; document.body.appendChild(anchor); anchor.click(); anchor.remove();
  // Keep the object URL alive long enough for browsers to begin their download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const kindNames = { finished: 'Prodotto finito', raw: 'Materia prima', packaging: 'Imballaggio' };
const scopeNames: Record<ExportScope, string> = { all: 'tutti', filtered: 'filtrati' };
/** e.g. Catalogo_Prima_Colazione_tutti_2026-11-13.xlsx or ..._filtrati_... */
export function exportFileName(scope: ExportScope, format: 'xlsx' | 'csv', now: string | Date = new Date()): string {
  return `Catalogo_Prima_Colazione_${scopeNames[scope]}_${todayRome(now)}.${format}`;
}
function exportRow(product: Product): Record<Field, string | number | null> {
  return { category: product.category ?? '', code: product.code, name: product.name, unit: product.unit, kind: kindNames[product.kind], unitsPerBox: product.unitsPerBox, minStock: product.minStock, priceGelCor: product.priceGelCor ?? null, priceGelitria: product.priceGelitria ?? null, priceDistribution: product.priceDistribution ?? null };
}
/** CSV for Excel in Italian locale: UTF-8 BOM, «;» separator, decimal comma, CRLF. Formula-like text gets a leading apostrophe. */
export function catalogCsv(products: Product[]): string {
  const cell = (value: string | number | null): string => {
    if (value === null) return '';
    if (typeof value === 'number') return String(value).replace('.', ',');
    const text = FORMULA_START.test(value) ? `'${value}` : value;
    return /[;,"\r\n]|^\s|\s$/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [headers.map(h => cell(h.title)).join(';'), ...products.map(product => { const row = exportRow(product); return headers.map(h => cell(row[h.field])).join(';'); })];
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}
/** XLSX bytes. Text is written as typed string cells (never <f> formulas), so «=2+2» stays literal text. */
export async function catalogWorkbook(products: Product[], scope: ExportScope | 'template' = 'all'): Promise<Uint8Array> {
  const workbook = await newWorkbook();
  workbook.creator = 'Prima Colazione · Stabilimento';
  workbook.title = scope === 'template' ? 'Modello catalogo prodotti' : `Catalogo prodotti – ${scope === 'all' ? 'tutti i prodotti' : 'solo risultati filtrati'} (${products.length})`;
  const sheet = workbook.addWorksheet('Prodotti', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = headers.map(column => ({ header: column.title, key: column.field, width: column.width }));
  sheet.getColumn('code').numFmt = '@';
  for (const field of ['priceGelCor', 'priceGelitria', 'priceDistribution']) sheet.getColumn(field).numFmt = '#,##0.00# "€"';
  for (const product of products) sheet.addRow(exportRow(product));
  const header = sheet.getRow(1); header.height = 30;
  header.eachCell(cell => { cell.font = { name: 'Calibri', bold: true, color: { argb: 'FFFFFFFF' }, size: 12 }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF007D75' } }; cell.alignment = { vertical: 'middle', wrapText: true }; });
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, products.length + 1), column: headers.length } };
  sheet.eachRow((row, number) => { if (number === 1) return; row.height = 32; row.eachCell({ includeEmpty: true }, cell => { cell.font = { name: 'Calibri', size: 11, color: { argb: 'FF1C2F3E' } }; cell.alignment = { vertical: 'middle', wrapText: true }; if (number % 2 === 0) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F7F8' } }; }); });
  if (scope === 'template') {
    // No fake product rows: instructions are isolated and never imported as products.
    const guide = workbook.addWorksheet('Istruzioni'); guide.columns = [{ width: 28 }, { width: 100 }];
    guide.addRows([
      ['Compilazione catalogo', 'Inserisci i prodotti nel foglio Prodotti, dalla riga 2.'],
      ['Cod.', 'Obbligatorio e univoco. Mantieni le celle come Testo per conservare gli zeri iniziali.'],
      ['Descrizione e U.m.', 'Obbligatorie. CRT indica cartoni.'],
      ['Categoria', 'Categoria commerciale libera, distinta dalla tipologia operativa.'],
      ['Tre listini', 'Prezzi facoltativi, massimo 3 decimali, virgola per i decimali (1,5 o 1.234,567). Vuoto = prezzo non indicato; 0 = prezzo zero. Nessuna aliquota IVA viene dedotta.'],
      ['Tipologia', 'Prodotto finito, Materia prima o Imballaggio. Se vuoto: Prodotto finito.'],
      ['Unità per cartone', 'Per CRT inserisci 1 o lascia vuoto. Per altre unità specifica quante unità sono contenute in un cartone.'],
      ['Scorta minima', 'Intero da 0 in su. Vuoto = 0.'],
      ['Limiti', `Massimo ${MAX_ROWS} prodotti, ${MAX_SHEET_ROWS} righe, ${MAX_COLUMNS} colonne e 5 MB. Le formule non vengono eseguite: si usa il valore salvato.`],
      ['Giacenze e lotti', 'Questo file importa solo il catalogo. Le quantità effettive, i lotti e le scadenze si registrano dalle entrate di magazzino.'],
      ['Aggiorna esistenti', 'Questa modalità sostituisce i dati con quelli del file. Celle vuote nelle colonne categoria/listini cancellano il dato; colonne categoria/listini assenti conservano il dato esistente. Nessuna giacenza viene sostituita.'],
    ]);
    guide.eachRow(row => { row.height = 46; row.alignment = { vertical: 'middle', wrapText: true }; });
    guide.getRow(1).font = { bold: true, size: 14 };
  }
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}
/**
 * Downloads exactly the products passed in. The caller states whether they are the whole catalog
 * (`scope: 'all'`, default) or the filtered results (`scope: 'filtered'`); the file name says so.
 * Returns the file name used.
 */
export async function exportCatalog(products: Product[], { scope = 'all', format = 'xlsx' }: ExportOptions = {}): Promise<string> {
  const name = exportFileName(scope, format);
  if (format === 'csv') downloadBytes(name, new TextEncoder().encode(catalogCsv(products)), 'text/csv;charset=utf-8');
  else downloadBytes(name, await catalogWorkbook(products, scope), XLSX_TYPE);
  return name;
}
export async function downloadCatalogTemplate(): Promise<void> { downloadBytes('Modello_prodotti_Prima_Colazione.xlsx', await catalogWorkbook([], 'template'), XLSX_TYPE); }

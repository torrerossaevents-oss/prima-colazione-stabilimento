import test from 'node:test';
import assert from 'node:assert/strict';
import Excel from 'exceljs';
import JSZip from 'jszip';
import { parseCatalogRows, parseCatalogCsv, readCatalogFile, exportCatalog, catalogCsv, catalogWorkbook, exportFileName } from '../lib/catalog-io.ts';
import { applyAction, initialState, normalizeProduct, type Product, type State } from '../lib/domain.ts';

// Fictitious, recognisable test data only.
const columns = ['Categoria', 'Cod.', 'Descrizione', 'U.m.', 'Listino 3 - Gel.Cor.', 'GELITRIA SRL', 'Distribuzione'];
const allColumns = [...columns, 'Tipologia', 'Unità per cartone', 'Scorta minima'];
const row = ['Categoria prova', '001/QA', 'Prodotto di prova PZ.12', 'CRT', 12.345, null, 0];
const MB5 = 5 * 1024 * 1024;
const catalog: Product[] = [
  { id: 'id-prova-1', code: '00123', name: 'Prodotto di prova 00123', category: 'Categoria prova', kind: 'raw', unit: 'PZ', unitsPerBox: 12, minStock: 4, priceGelCor: 1.5, priceGelitria: null, priceDistribution: 0 },
  { id: 'id-prova-2', code: '000-PROVA/A', name: '=2+2 prova formula', category: '', kind: 'finished', unit: 'CRT', unitsPerBox: 1, minStock: 0, priceGelCor: 1234.567, priceGelitria: null, priceDistribution: null },
  { id: 'id-prova-3', code: '-PROVA-3', name: '@prova; con "virgolette"\ne a capo', category: '=HYPERLINK("http://example.invalid")', kind: 'packaging', unit: 'KG', unitsPerBox: 5, minStock: 10, priceGelCor: 0.001, priceGelitria: 999999.999, priceDistribution: 2 },
  { id: 'id-prova-4', code: 'PROVA-4', name: '+39 prova più', kind: 'finished', unit: 'CRT', unitsPerBox: 1, minStock: 0 },
];
const expected = catalog.map(product => normalizeProduct(product));
// Copying into a fresh Uint8Array gives the ArrayBuffer-backed BlobPart that the DOM typings require.
const csvFile = (text: string | Uint8Array, name = 'prova.csv') => new File([typeof text === 'string' ? text : new Uint8Array(text)], name);
const xlsxFile = (bytes: Uint8Array, name = 'prova.xlsx') => new File([new Uint8Array(bytes)], name);
async function workbookBytes(fill: (workbook: Excel.Workbook) => void): Promise<Uint8Array> {
  const workbook = new Excel.Workbook(); fill(workbook);
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}
const productRows = (count: number) => Array.from({ length: count }, (_, index) => ['QA', `PROVA${String(index).padStart(4, '0')}`, 'Prova', 'CRT']);
/** Captures the Blob passed to the browser download instead of touching a real DOM. */
async function captureDownload(run: () => Promise<unknown>): Promise<{ blob: Blob; name: string }> {
  let blob: Blob | undefined; let name = '';
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const oldCreate = URL.createObjectURL, oldRevoke = URL.revokeObjectURL;
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({ click() {}, remove() {}, set download(value: string) { name = value; } }), body: { appendChild() {} } } });
  URL.createObjectURL = value => { blob = value as Blob; return 'blob:catalog-test'; };
  URL.revokeObjectURL = () => {};
  try { await run(); } finally {
    if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument); else Reflect.deleteProperty(globalThis, 'document');
    URL.createObjectURL = oldCreate; URL.revokeObjectURL = oldRevoke;
  }
  assert.ok(blob); return { blob, name };
}

// ---------- Existing parser behaviour ----------
test('import preserves leading zeros, category, three decimals, null and zero', () => {
  const result = parseCatalogRows([columns, row]);
  assert.deepEqual(result.products[0], { code: '001/QA', name: 'Prodotto di prova PZ.12', category: 'Categoria prova', unit: 'CRT', unitsPerBox: 1, priceGelCor: 12.345, priceGelitria: null, priceDistribution: 0 });
  // Kind and minimum stock columns are absent: they are omitted, so an update keeps stored values.
  assert.ok(result.warnings.some(w => /Tipologia non presente/.test(w)));
});
test('merged category headers and exact count footer are supported', () => {
  const result = parseCatalogRows([['Categoria', 'Categoria', ...columns.slice(1)], [null, ...row], [null, null, null, 1]]);
  assert.equal(result.products[0].category, 'Categoria prova');
  assert.match(result.warnings.join(' '), /escluso il totale finale/);
  assert.throws(() => parseCatalogRows([columns, row, ['', '', 2]]), /manca il codice/);
});
test('CSV handles BOM, quoted commas, semicolons, escaped quotes and multiline description', () => {
  const csv = '\uFEFF' + columns.join(';') + '\r\nQA;0007;"Prova; con ""virgolette""\ne virgola, qui";CRT;"1.234,567";;0';
  const result = parseCatalogCsv(csv);
  assert.equal(result.products[0].code, '0007');
  assert.equal(result.products[0].name, 'Prova; con "virgolette"\ne virgola, qui');
  assert.equal(result.products[0].priceGelCor, 1234.567);
  assert.equal(result.products[0].priceGelitria, null);
  assert.equal(result.products[0].priceDistribution, 0);
});
test('CSV supports comma separator and an Excel separator hint', () => {
  assert.equal(parseCatalogCsv('Cod.,Descrizione,U.m.\n001,Test,CRT').products[0].code, '001');
  assert.equal(parseCatalogCsv('sep=;\nCod.;Descrizione;U.m.\n002;Test;CRT').products[0].code, '002');
});
test('all supported fields round-trip as explicit columns and require safe conversion', () => {
  const result = parseCatalogRows([allColumns, ['QA', '003', 'Prova', 'PZ', null, 9.99, null, 'Materia prima', '12', '4']]);
  assert.equal(result.products[0].kind, 'raw'); assert.equal(result.products[0].unitsPerBox, 12); assert.equal(result.products[0].minStock, 4);
  assert.throws(() => parseCatalogRows([columns, ['QA', '003', 'Prova', 'PZ']]), /specifica Unità per cartone/);
  assert.throws(() => parseCatalogRows([[...columns, 'Unità per cartone'], [...row, 12]]), /CRT/);
});
test('absent optional columns preserve update intent while explicit empty cells clear it', () => {
  const absent = parseCatalogRows([['Cod.', 'Descrizione', 'U.m.'], ['001', 'Prova', 'CRT']]).products[0];
  assert.equal(Object.hasOwn(absent, 'priceGelCor'), false);
  assert.equal(Object.hasOwn(absent, 'category'), false);
  const empty = parseCatalogRows([columns, ['QA', '001', 'Prova', 'CRT', '', '', '']]).products[0];
  assert.equal(empty.priceGelCor, null); assert.equal(empty.priceGelitria, null); assert.equal(empty.priceDistribution, null);
});

// ---------- 1. Export → reimport ----------
test('XLSX export → reimport keeps codes as text with leading zeros, every field, empty vs zero prices', async () => {
  const bytes = await catalogWorkbook(catalog);
  const result = await readCatalogFile(xlsxFile(bytes));
  assert.deepEqual(result.products, expected);
  assert.equal(result.products[0].code, '00123');
  assert.equal(result.products[0].priceGelitria, null); assert.equal(result.products[0].priceDistribution, 0);
  assert.equal(result.products[3].category, '');
  assert.doesNotMatch(result.warnings.join(' '), /formula|ignorate/);
  const workbook = new Excel.Workbook(); await workbook.xlsx.load(bytes as unknown as ArrayBuffer);
  const sheet = workbook.worksheets[0];
  assert.deepEqual((sheet.getRow(1).values as unknown[]).slice(1), allColumns);
  assert.equal(sheet.getCell('B2').value, '00123');
  assert.equal(sheet.getCell('F2').value, null);
  assert.equal(sheet.getCell('G2').value, 0);
});
test('CSV export → reimport keeps the same data; decimal comma, empty cells and text codes', async () => {
  const csv = catalogCsv(catalog);
  assert.ok(csv.startsWith('\uFEFFCategoria;Cod.;Descrizione;U.m.;Listino 3 - Gel.Cor.;GELITRIA SRL;Distribuzione;Tipologia;Unità per cartone;Scorta minima\r\n'));
  assert.match(csv, /\r\nCategoria prova;00123;Prodotto di prova 00123;PZ;1,5;;0;Materia prima;12;4\r\n/);
  assert.match(csv, /;1234,567;;;Prodotto finito;1;0\r\n/);
  assert.equal((await readCatalogFile(csvFile(csv))).products.length, 4);
  assert.deepEqual((await readCatalogFile(csvFile(csv))).products, expected);
  assert.deepEqual(parseCatalogCsv(csv).products, expected);
});
test('exported internal ids are not in the file: reimport matches by code, update keeps ids and creates no stock', async () => {
  let state: State = initialState();
  let next = 0;
  const context = { now: '2026-11-13T09:00:00Z', id: () => `id-nuovo-${++next}` };
  state = applyAction(state, { type: 'product.add', product: { ...expected[0], name: 'Nome precedente', priceGelCor: 9 } }, context);
  const originalId = state.products[0].id;
  const fromFile = (await readCatalogFile(csvFile(catalogCsv(catalog)))).products;
  const skipped = applyAction(state, { type: 'product.import', products: fromFile, mode: 'skip' }, context);
  assert.equal(skipped.products.length, 4);
  assert.deepEqual(skipped.products[0], { ...state.products[0] }); // solo aggiunta: existing row untouched
  assert.equal(skipped.lots.length, 0);
  const updated = applyAction(state, { type: 'product.import', products: fromFile, mode: 'update' }, context);
  assert.equal(updated.products.find(p => p.code === '00123')!.id, originalId);
  assert.equal(updated.products.find(p => p.code === '00123')!.name, 'Prodotto di prova 00123');
  assert.equal(updated.products.find(p => p.code === '00123')!.priceGelCor, 1.5);
  assert.equal(updated.products.length, 4);
  assert.equal(updated.lots.length, 0);
  assert.match(updated.audit.at(-1)!.detail, /3 aggiunti, 1 aggiornati, 0 già presenti/);
});

// ---------- Decimal and empty values ----------
test('prices: accepted Italian and dot-decimal forms, ambiguous or invalid forms rejected per row', () => {
  const accepted: [string, number][] = [['1,5', 1.5], ['1.234,567', 1234.567], ['12.345,6', 12345.6], ['1234,567', 1234.567], ['1.5', 1.5], ['0.125', 0.125], ['1234.567', 1234.567], ['€ 2,50', 2.5], ['1 234,5', 1234.5], ['0', 0], ['0,000', 0]];
  for (const [text, value] of accepted) assert.equal(parseCatalogRows([columns, ['QA', '001', 'Prova', 'CRT', text]]).products[0].priceGelCor, value, text);
  assert.throws(() => parseCatalogRows([columns, ['QA', '001', 'Prova', 'CRT', '1.234']]), /Riga 2, Listino 3 - Gel.Cor.: «1.234» è ambiguo.*Scrivi 1234 oppure 1,234/);
  assert.throws(() => parseCatalogRows([columns, ['QA', '001', 'Prova', 'CRT', null, '12.345']]), /GELITRIA SRL: «12.345» è ambiguo/);
  for (const text of ['1,2345', '1,234.56', '-1', '1.234.567', 'abc', ',5', '1,']) assert.throws(() => parseCatalogRows([columns, ['QA', '001', 'Prova', 'CRT', null, null, text]]), /Riga 2, Distribuzione: «.*» non è un prezzo valido/, text);
  assert.throws(() => parseCatalogRows([columns, ['QA', '001', 'Prova', 'CRT', 1.2345]]), /Riga 2: .*3 decimali/);
  assert.throws(() => parseCatalogRows([columns, ['QA', '001', 'Prova', 'CRT', -1]]), /Riga 2/);
});
test('empty cells: blank price = not indicated, blank minimum stock = 0, blank CRT packaging = 1, integers without separators', () => {
  const product = parseCatalogRows([allColumns, ['', '001', 'Prova', 'CRT', '  ', null, '', '', '', '']]).products[0];
  assert.deepEqual(product, { code: '001', name: 'Prova', category: '', unit: 'CRT', kind: 'finished', unitsPerBox: 1, minStock: 0, priceGelCor: null, priceGelitria: null, priceDistribution: null });
  assert.throws(() => parseCatalogRows([allColumns, ['', '001', 'Prova', 'PZ', '', '', '', '', '1.000', '']]), /Unità per cartone: inserisci un numero intero.*senza decimali né separatori/);
  // CRT: pieces in the description are never converted into packaging.
  assert.equal(parseCatalogRows([columns, ['QA', '001', 'Cartone PZ.24', 'crt']]).products[0].unitsPerBox, 1);
});

// ---------- 2. Invalid and duplicate rows ----------
test('invalid or duplicate rows reject the complete file, listing each source row', () => {
  assert.throws(() => parseCatalogRows([columns, row, [...row]]), /Riga 3: codice 001\/QA duplicato \(già alla riga 2\)/);
  assert.throws(() => parseCatalogRows([columns, ['QA', 'abc', 'Prova', 'CRT'], ['QA', 'ABC', 'Prova', 'CRT']]), /Riga 3: codice ABC duplicato/);
  assert.throws(() => parseCatalogRows([columns, ['QA', 2, 'Altro', 'CRT']]), /codice è numerico/);
  assert.throws(() => parseCatalogRows([columns, ['QA', '2e5', 'Altro', 'CRT']]), /notazione scientifica/);
  assert.throws(() => parseCatalogRows([columns, ['QA', '002', 'Altro', 'CRT', { formula: '1+1' }]]), /formula/);
  assert.throws(() => parseCatalogRows([columns, ['QA', '002', 'Altro', 'CRT', new Date('2026-11-13')]]), /valore semplice/);
  let message = '';
  try { parseCatalogRows([columns, row, ['QA', '', 'Senza codice', 'CRT'], ['QA', '003', 'Senza unità', ''], ['QA', '004', 'Prezzo', 'CRT', 'abc'], [...row]]); } catch (error) { message = (error as Error).message; }
  assert.match(message, /^Importazione non eseguita\./);
  for (const line of [/Riga 3: manca il codice/, /Riga 4: manca l’unità/, /Riga 5, Listino 3/, /Riga 6: codice 001\/QA duplicato/]) assert.match(message, line);
  assert.throws(() => parseCatalogRows([columns, ...Array.from({ length: 10 }, (_, index) => ['QA', `E${index}`, 'Prova', 'PZ'])]), /Altre 2 righe da correggere/);
});

// ---------- 3. Limits at the boundaries ----------
test('products: 350 accepted, 351 rejected', () => {
  assert.equal(parseCatalogRows([columns, ...productRows(350)]).products.length, 350);
  assert.throws(() => parseCatalogRows([columns, ...productRows(351)]), /contiene 351 prodotti: .*massimo 350 prodotti/);
});
test('rows: 1000 accepted, 1001 rejected (rows array, CSV and XLSX)', async () => {
  const blank = (count: number) => Array.from({ length: count }, () => ['', '', '', '']);
  assert.equal(parseCatalogRows([columns, ...productRows(350), ...blank(649)]).products.length, 350);
  assert.throws(() => parseCatalogRows([columns, ...productRows(350), ...blank(650)]), /ha 1001 righe: il limite è 1000 righe/);
  const csv = (lines: number) => ['Cod.;Descrizione;U.m.', ...productRows(350).map(r => r.slice(1).join(';')), ...Array(lines - 351).fill(';;')].join('\n');
  assert.equal(parseCatalogCsv(csv(1000)).products.length, 350);
  assert.throws(() => parseCatalogCsv(csv(1001)), /supera 1000 righe/);
  // XLSX: 1000 rows with values pass the size check (the error is then about the 999 products), 1001 do not.
  const sheetWith = (dataRows: number) => workbookBytes(workbook => { const sheet = workbook.addWorksheet('Prodotti'); sheet.addRow(['Cod.', 'Descrizione', 'U.m.']); productRows(dataRows).forEach(r => sheet.addRow(r.slice(1))); });
  await assert.rejects(readCatalogFile(xlsxFile(await sheetWith(999))), /contiene 999 prodotti/);
  await assert.rejects(readCatalogFile(xlsxFile(await sheetWith(1000))), /«Prodotti» ha 1001 righe/);
  // Formatting without values does not count towards the limit.
  const styled = await workbookBytes(workbook => { const sheet = workbook.addWorksheet('Prodotti'); sheet.addRow(['Cod.', 'Descrizione', 'U.m.']); sheet.addRow(['001', 'Prova', 'CRT']); sheet.getCell('BZ1500').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } }; });
  assert.equal((await readCatalogFile(xlsxFile(styled))).products.length, 1);
});
test('columns: 60 accepted with unknown columns reported, 61 rejected (rows array, CSV and XLSX)', async () => {
  const extra = (count: number) => Array.from({ length: count }, (_, index) => `Extra ${index + 1}`);
  const wide = (count: number) => [[...allColumns, ...extra(count - allColumns.length)], ['QA', '001', 'Prova', 'CRT', 1, 2, 3, '', '', '']];
  const ok = parseCatalogRows(wide(60));
  assert.equal(ok.products.length, 1);
  assert.match(ok.warnings[0], /^Colonne non riconosciute e ignorate: «Extra 1», .*«Extra 50»\.$/);
  assert.throws(() => parseCatalogRows(wide(61)), /ha 61 colonne: il limite è 60/);
  const csv = (count: number) => wide(count).map(r => r.join(';')).join('\n');
  assert.equal(parseCatalogCsv(csv(60)).products.length, 1);
  assert.throws(() => parseCatalogCsv(csv(61)), /alla riga 1, supera 60 colonne/);
  const xlsx = (count: number) => workbookBytes(workbook => { const sheet = workbook.addWorksheet('Prodotti'); wide(count).forEach(r => sheet.addRow(r)); });
  assert.equal((await readCatalogFile(xlsxFile(await xlsx(60)))).products.length, 1);
  await assert.rejects(readCatalogFile(xlsxFile(await xlsx(61))), /«Prodotti» ha 61 colonne/);
});
test('file size: exactly 5 MB accepted, one byte more rejected; empty and wrong extension rejected', async () => {
  const padded = (bytes: number) => { const head = 'Cod.;Descrizione;U.m.;Note\n001;Prova;CRT;'; return head + 'x'.repeat(bytes - new TextEncoder().encode(head).byteLength); };
  assert.equal((await readCatalogFile(csvFile(padded(MB5)))).products.length, 1);
  assert.equal(parseCatalogCsv(padded(MB5)).products.length, 1);
  await assert.rejects(readCatalogFile(csvFile(padded(MB5 + 1))), /supera il limite di 5 MB/);
  assert.throws(() => parseCatalogCsv(padded(MB5 + 1)), /supera il limite di 5 MB/);
  // XLSX: 5 MB passes the size check and reaches the archive check; 5 MB + 1 byte stops before.
  await assert.rejects(readCatalogFile(xlsxFile(new Uint8Array(MB5))), /non è un XLSX valido/);
  await assert.rejects(readCatalogFile(xlsxFile(new Uint8Array(MB5 + 1))), /supera il limite di 5 MB/);
  await assert.rejects(readCatalogFile(csvFile('')), /vuoto/);
  await assert.rejects(readCatalogFile(csvFile('x', 'catalogo.xls')), /\.xlsx oppure un CSV/);
});

// ---------- 4. Malformed files, encodings and formulas ----------
test('malformed XLSX: not a zip, truncated, corrupted, no sheets, no header, two catalog sheets', async () => {
  await assert.rejects(readCatalogFile(xlsxFile(new TextEncoder().encode('broken'))), /XLSX valido/);
  const good = await catalogWorkbook(catalog);
  await assert.rejects(readCatalogFile(xlsxFile(good.slice(0, good.length - 30))), /non è un XLSX valido/);
  const corrupted = good.slice(); for (let index = 60; index < 2000; index++) corrupted[index] ^= 0x5a;
  await assert.rejects(readCatalogFile(xlsxFile(corrupted)), /Non riesco a leggere il file Excel/);
  await assert.rejects(readCatalogFile(xlsxFile(await workbookBytes(() => {}))), /non contiene fogli/);
  await assert.rejects(readCatalogFile(xlsxFile(await workbookBytes(workbook => { workbook.addWorksheet('Note').addRow(['Solo testo']); }))), /Nessun foglio contiene Cod., Descrizione e U.m./);
  await assert.rejects(readCatalogFile(xlsxFile(await workbookBytes(workbook => { for (const name of ['A', 'B']) workbook.addWorksheet(name).addRows([['Cod.', 'Descrizione', 'U.m.'], ['001', 'Prova', 'CRT']]); }))), /Più fogli contengono un catalogo/);
  // The template has headers only: nothing to import, instructions sheet never imported.
  await assert.rejects(readCatalogFile(xlsxFile(await catalogWorkbook([], 'template'))), /non contiene prodotti/);
});
test('malformed CSV: unclosed quotes, characters after a closing quote, no separator', () => {
  assert.throws(() => parseCatalogCsv('Cod.;Descrizione;U.m.\n001;"Prova;CRT'), /non è stata chiusa/);
  assert.throws(() => parseCatalogCsv('Cod.;Descrizione;U.m.\n001;"Prova"oops;CRT'), /dopo la chiusura/);
  assert.throws(() => parseCatalogCsv('Cod.;Descrizione;U.m.\n001;Pro"va;CRT'), /virgolette non valide/);
  assert.throws(() => parseCatalogCsv('Solo una colonna\n001'), /CSV non riconosciuto/);
});
test('CSV encodings: UTF-8 with BOM, Windows-1252 (ANSI) with warning, UTF-16 tab-separated', async () => {
  const text = 'Cod.;Descrizione;U.m.;Unità per cartone\r\n001;Caffè d’orzo prova;PZ;6\r\n';
  const utf8 = await readCatalogFile(csvFile('\uFEFF' + text));
  assert.equal(utf8.products[0].name, 'Caffè d’orzo prova'); assert.doesNotMatch(utf8.warnings.join(' '), /UTF-8/);
  const ansiText = text.replace('’', "'");
  const ansi = await readCatalogFile(csvFile(Uint8Array.from(ansiText, char => char.charCodeAt(0))));
  assert.equal(ansi.products[0].name, "Caffè d'orzo prova"); assert.equal(ansi.products[0].unitsPerBox, 6);
  assert.match(ansi.warnings[0], /non è in UTF-8: è stato letto come Windows-1252/);
  const tabbed = text.replaceAll(';', '\t');
  const utf16 = new Uint8Array(2 + tabbed.length * 2); utf16.set([0xff, 0xfe]);
  for (let index = 0; index < tabbed.length; index++) { utf16[2 + index * 2] = tabbed.charCodeAt(index) & 0xff; utf16[3 + index * 2] = tabbed.charCodeAt(index) >> 8; }
  assert.equal((await readCatalogFile(csvFile(utf16))).products[0].name, 'Caffè d’orzo prova');
});
test('export neutralises formula-like text: XLSX as typed text cells, CSV with an apostrophe the reimport removes', async () => {
  const dangerous = ['=2+2', '+39', '-meno', '@somma', '\t=tab', '\r=cr'];
  const products: Product[] = dangerous.map((name, index) => ({ id: `id-${index}`, code: `F${index}`, name, kind: 'finished', unit: 'CRT', unitsPerBox: 1, minStock: 0 }));
  const csv = catalogCsv(products);
  const lines = csv.split('\r\n');
  assert.ok(lines.some(line => line.includes(";'=2+2;")) && lines.some(line => line.includes(";'+39;")) && lines.some(line => line.includes(";'-meno;")) && lines.some(line => line.includes(";'@somma;")));
  assert.ok(csv.includes(";'\t=tab;") && csv.includes(`;"'\r=cr";`));
  assert.doesNotMatch(csv.replace(/^\uFEFF/, ''), /(^|;|\r\n)[=+\-@\t\r]/, 'no CSV cell starts with a formula character');
  const back = parseCatalogCsv(csv).products.map(p => p.name);
  // Leading/trailing whitespace is always trimmed by the catalog, so tab/CR prefixes are not restored.
  assert.deepEqual(back, ['=2+2', '+39', '-meno', '@somma', '=tab', '=cr']);
  const xlsx = await catalogWorkbook(products);
  const sheetXml = await (await JSZip.loadAsync(xlsx)).file('xl/worksheets/sheet1.xml')!.async('string');
  assert.doesNotMatch(sheetXml, /<f[ >]/, 'no formula element in the exported sheet');
  assert.deepEqual((await readCatalogFile(xlsxFile(xlsx))).products.map(p => p.name), ['=2+2', '+39', '-meno', '@somma', '=tab', '=cr']);
  // A genuine apostrophe that does not precede a formula character is kept.
  assert.equal(parseCatalogRows([['Cod.', 'Descrizione', 'U.m.'], ['001', "'Prova'", 'CRT']]).products[0].name, "'Prova'");
});
test('XLSX formula cells: the saved value is imported, nothing is executed; formulas without a value are rejected', async () => {
  const bytes = await workbookBytes(workbook => {
    const sheet = workbook.addWorksheet('Prodotti');
    sheet.addRow(columns);
    sheet.addRow(['QA', { formula: '"00123"', result: '00123' }, { formula: 'HYPERLINK("http://example.invalid","Prova formula")', result: 'Prova formula' }, 'CRT', { formula: '1+0.5', result: 1.5 }]);
  });
  const result = await readCatalogFile(xlsxFile(bytes));
  assert.equal(result.products[0].code, '00123'); assert.equal(result.products[0].name, 'Prova formula'); assert.equal(result.products[0].priceGelCor, 1.5);
  assert.match(result.warnings[0], /^3 celle con formula: importato il valore già calcolato/);
  const noValue = await workbookBytes(workbook => { const sheet = workbook.addWorksheet('Prodotti'); sheet.addRow(columns); sheet.addRow(['QA', '001', 'Prova', 'CRT', { formula: 'A1*2' }]); });
  await assert.rejects(readCatalogFile(xlsxFile(noValue)), /Riga 2, Listino 3 - Gel.Cor.: la formula non ha un valore salvato/);
});

// ---------- 5. Column recognition ----------
test('header variants (case, spaces, accents, real price-list names) map to fields; unknown columns are reported', () => {
  const header = ['  CODICE ARTICOLO ', 'descrizione', 'UNITÀ DI MISURA', 'listino 3 gel cor', 'Gelitria s.r.l.', 'Listino Distribuzione', 'Tipo operativo', "Unita' per cartone", 'Scorta Minima', 'Categoria commerciale', 'Note interne'];
  const result = parseCatalogRows([['Catalogo di prova'], [], header, ['001', 'Prova', 'PZ', '1,5', '', '0', 'Imballaggio', '6', '2', 'Categoria prova', 'ignorata']]);
  assert.deepEqual(result.products[0], { code: '001', name: 'Prova', category: 'Categoria prova', unit: 'PZ', kind: 'packaging', unitsPerBox: 6, minStock: 2, priceGelCor: 1.5, priceGelitria: null, priceDistribution: 0 });
  assert.match(result.warnings[0], /Colonne non riconosciute e ignorate: «Note interne»\./);
  assert.throws(() => parseCatalogRows([['Cod.', 'U.m.'], ['001', 'CRT']]), /Intestazioni mancanti: non trovo Descrizione\./);
  assert.throws(() => parseCatalogRows([['Codice', 'Prezzo'], ['001', '1']]), /non trovo Descrizione, U.m\./);
  assert.throws(() => parseCatalogRows([['Cod.', 'Descrizione', 'U.m.', 'Codice'], ['001', 'Prova', 'CRT', '002']]), /La colonna Cod\. compare più volte/);
});

// ---------- 6. Export scope ----------
test('export writes exactly the products passed and states «tutti» or «filtrati» in the name and file properties', async () => {
  assert.equal(exportFileName('all', 'xlsx', '2026-11-13T10:00:00Z'), 'Catalogo_Prima_Colazione_tutti_2026-11-13.xlsx');
  assert.equal(exportFileName('filtered', 'csv', '2026-11-13T23:30:00Z'), 'Catalogo_Prima_Colazione_filtrati_2026-11-14.csv');
  const all = await captureDownload(() => exportCatalog(catalog));
  assert.match(all.name, /^Catalogo_Prima_Colazione_tutti_\d{4}-\d{2}-\d{2}\.xlsx$/);
  assert.deepEqual((await readCatalogFile(new File([all.blob], all.name))).products, expected);
  const workbook = new Excel.Workbook(); await workbook.xlsx.load(await all.blob.arrayBuffer());
  assert.equal(workbook.title, 'Catalogo prodotti – tutti i prodotti (4)');
  const filtered = await captureDownload(() => exportCatalog([catalog[2]], { scope: 'filtered' }));
  assert.match(filtered.name, /_filtrati_/);
  const filteredBook = new Excel.Workbook(); await filteredBook.xlsx.load(await filtered.blob.arrayBuffer());
  assert.equal(filteredBook.title, 'Catalogo prodotti – solo risultati filtrati (1)');
  assert.deepEqual((await readCatalogFile(new File([filtered.blob], filtered.name))).products, [expected[2]]);
  const csv = await captureDownload(() => exportCatalog([catalog[0]], { scope: 'filtered', format: 'csv' }));
  assert.match(csv.name, /_filtrati_.*\.csv$/); assert.equal(csv.blob.type, 'text/csv;charset=utf-8');
  assert.deepEqual((await readCatalogFile(new File([csv.blob], csv.name))).products, [expected[0]]);
});

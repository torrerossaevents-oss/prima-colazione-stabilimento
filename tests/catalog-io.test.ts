import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore Node's native type stripping requires a .ts extension.
import { parseCatalogRows, parseCatalogCsv, readCatalogFile, exportCatalog } from '../lib/catalog-io.ts';

const columns = ['Categoria', 'Cod.', 'Descrizione', 'U.m.', 'Listino 3 - Gel.Cor.', 'GELITRIA SRL', 'Distribuzione'];
const row = ['Categoria prova', '001/QA', 'Prodotto di prova PZ.12', 'CRT', 12.345, null, 0];

test('import preserves leading zeros, category, three decimals, null and zero', () => {
  const result = parseCatalogRows([columns, row]);
  assert.deepEqual(result.products[0], { code: '001/QA', name: 'Prodotto di prova PZ.12', category: 'Categoria prova', unit: 'CRT', kind: 'finished', unitsPerBox: 1, minStock: 0, priceGelCor: 12.345, priceGelitria: null, priceDistribution: 0 });
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
test('invalid fields or duplicates reject the complete file with source rows', () => {
  assert.throws(() => parseCatalogRows([columns, row, [...row]]), /Riga 3: codice 001\/QA duplicato/);
  assert.throws(() => parseCatalogRows([columns, row, ['QA', '002', 'Altro', 'CRT', -1]]), /Riga 3/);
  assert.throws(() => parseCatalogRows([columns, ['QA', '002', 'Altro', 'CRT', '1,2345']]), /3 decimali/);
  assert.throws(() => parseCatalogRows([columns, ['QA', 2, 'Altro', 'CRT']]), /codice è numerico/);
  assert.throws(() => parseCatalogRows([columns, ['QA', '2e5', 'Altro', 'CRT']]), /notazione scientifica/);
  assert.throws(() => parseCatalogRows([columns, ['QA', '002', 'Altro', 'CRT', { formula: '1+1', result: 2 }]]), /senza formule/);
});
test('all supported fields round-trip as explicit columns and require safe conversion', () => {
  const result = parseCatalogRows([[...columns, 'Tipologia', 'Unità per cartone', 'Scorta minima'], ['QA', '003', 'Prova', 'PZ', null, 9.99, null, 'Materia prima', '12', '4']]);
  assert.equal(result.products[0].kind, 'raw'); assert.equal(result.products[0].unitsPerBox, 12); assert.equal(result.products[0].minStock, 4);
  assert.throws(() => parseCatalogRows([columns, ['QA', '003', 'Prova', 'PZ']]), /specifica Unità per cartone/);
  assert.throws(() => parseCatalogRows([[...columns, 'Unità per cartone'], [...row, 12]]), /CRT/);
});
test('CSV malformed quoting and missing required headers fail', () => {
  assert.throws(() => parseCatalogCsv('Cod.;Descrizione;U.m.\n001;"Prova;CRT'), /non è stata chiusa/);
  assert.throws(() => parseCatalogCsv('Cod.;Descrizione;U.m.\n001;"Prova"oops;CRT'), /dopo la chiusura/);
  assert.throws(() => parseCatalogRows([['Codice', 'Descrizione'], ['001', 'Test']]), /Intestazioni mancanti/);
});
test('350 product and file-size limits are enforced', async () => {
  assert.throws(() => parseCatalogRows([columns, ...Array.from({ length: 351 }, (_, index) => ['QA', String(index).padStart(4, '0'), 'Prova', 'CRT'])]), /350 prodotti/);
  await assert.rejects(readCatalogFile(new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.csv')), /5 MB/);
  await assert.rejects(readCatalogFile(new File(['broken'], 'broken.xlsx')), /XLSX valido/);
});
test('absent optional columns preserve update intent while explicit empty cells clear it', () => {
  const absent = parseCatalogRows([['Cod.', 'Descrizione', 'U.m.'], ['001', 'Prova', 'CRT']]).products[0];
  assert.equal(Object.hasOwn(absent, 'priceGelCor'), false);
  assert.equal(Object.hasOwn(absent, 'category'), false);
  const empty = parseCatalogRows([columns, ['QA', '001', 'Prova', 'CRT', '', '', '']]).products[0];
  assert.equal(empty.priceGelCor, null); assert.equal(empty.priceGelitria, null); assert.equal(empty.priceDistribution, null);
});
test('XLSX export and reimport preserve codes as text, literal descriptions and price precision', async () => {
  let exported: Blob | undefined;
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const oldCreate = URL.createObjectURL;
  const oldRevoke = URL.revokeObjectURL;
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({ click() {}, remove() {} }), body: { appendChild() {} } } });
  URL.createObjectURL = blob => { exported = blob as Blob; return 'blob:catalog-test'; };
  URL.revokeObjectURL = () => {};
  try {
    const product = parseCatalogRows([columns, ['QA', '0001', '=2+2', 'CRT', 9.875, null, 0]]).products[0];
    await exportCatalog([{ ...product, id: 'test-id' }]);
    assert.ok(exported);
    const result = await readCatalogFile(new File([exported], 'roundtrip.xlsx'));
    assert.deepEqual(result.products[0], product);
    const Excel = (await import('exceljs')).default;
    const workbook = new Excel.Workbook();
    await workbook.xlsx.load(await exported.arrayBuffer());
    assert.equal(typeof workbook.worksheets[0].getCell('B2').value, 'string');
    assert.equal(workbook.worksheets[0].getCell('C2').value, '=2+2');
    assert.equal(workbook.worksheets[0].getCell('F2').value, null);
    assert.equal(workbook.worksheets[0].getCell('G2').value, 0);
  } finally {
    if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument); else Reflect.deleteProperty(globalThis, 'document');
    URL.createObjectURL = oldCreate; URL.revokeObjectURL = oldRevoke;
  }
});

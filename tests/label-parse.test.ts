/**
 * Lettura dell'etichetta del cartone dal testo riconosciuto (OCR) e dal codice a barre.
 * Il testo segue l'etichetta reale del Fagottino PF cioccolato 90 g (14/11/2026); produttore e
 * indirizzo sono sostituiti con dati di prova. Anche il testo «sporco» tipico dell'OCR è coperto.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLabel } from '../lib/label-parse.ts';

const label = `FAGOTTINO PF CIOCCOLATO 90g                COD.024
Prodotto da forno crudo congelato   Da consumarsi previa idonea cottura
INGREDIENTI: Farina di FRUMENTO, zucchero, margarina vegetale(grassi vegetali: palma; acqua; grasso vegetale totalmente
idrogenato; olio vegetale: girasole); LATTE scremato in polvere; sale; UOVA pastorizzate; LIEVITO madre.
Farcitura: Crema NOCCIOLA(30%): zucchero, oli e grassi vegetali: colza; palma; cacao magro in polvere(8%), NOCCIOLE(6%).
Prodotto in uno stabilimento che utilizza: frutta a guscio e semi di SESAMO,LATTOSIO,UOVA. Conservare ad una temperatura non inferiore
a -18°C. Il prodotto una volta scongelato non deve essere ricongelato.
Contiene n 50 pezzi peso netto 4500g C^e
Produttore di prova, via di esempio 1 (prova).
Prodotto ad uso professionale non destinato al consumo diretto.
Da consumarsi preferibilmente entro il
02/10/2027
Prodotto in Italia
Lotto: 261002
IDENT. 02/F
8 000000 004642`;

test('etichetta del Fagottino: codice, nome, descrizione, contenuto, lotto, scadenza, durata, EAN', () => {
  const r = parseLabel(label);
  assert.equal(r.code, '024');
  assert.equal(r.name, 'FAGOTTINO PF CIOCCOLATO 90g');
  assert.equal(r.description, 'Prodotto da forno crudo congelato. Da consumarsi previa idonea cottura');
  assert.equal(r.piecesPerCarton, 50); assert.equal(r.netWeightG, 4500); assert.equal(r.pieceWeightG, 90);
  assert.equal(r.lot, '261002'); assert.equal(r.productionDay, '2026-10-02'); assert.equal(r.expiry, '2027-10-02');
  assert.equal(r.shelfLifeMonths, 12, 'calcolata da lotto e scadenza');
  assert.equal(r.ident, '02/F');
  assert.equal(r.ean, '8000000004642', 'dalle cifre sotto il codice a barre, verificate');
  assert.match(r.ingredients!, /^Farina di FRUMENTO/); assert.match(r.ingredients!, /Farcitura: Crema NOCCIOLA/);
  assert.ok(r.ingredients!.length <= 700);
  assert.match(r.storage!, /-18°C/); assert.ok(r.storage!.length <= 250);
  assert.deepEqual(r.warnings, []);
});

test('il codice a barre letto dall’immagine vince sulle cifre del testo', () => {
  assert.equal(parseLabel(label, '4006381333931').ean, '4006381333931');
  assert.equal(parseLabel(label, '1234567890123').ean, '8000000004642', 'un codice a barre non valido è ignorato');
});

test('testo sporco tipico dell’OCR: C0D, Lott0, spazi e virgole', () => {
  assert.equal(parseLabel('PLUMCAKE YOGURT cop.00210').code, '00210', 'OCR reading «cop.»');
  const noisy = `FAGOTTINO PF CIOCCOLATO 90g C0D. 024\nContiene n. 50 pezzi peso netto 4.500 g\nentro il 02.10.2027\nLott0 261002\nIDENT 02/F`;
  const r = parseLabel(noisy);
  assert.equal(r.code, '024'); assert.equal(r.piecesPerCarton, 50); assert.equal(r.netWeightG, 4500); assert.equal(r.pieceWeightG, 90);
  assert.equal(r.expiry, '2027-10-02'); assert.equal(r.lot, '261002'); assert.equal(r.shelfLifeMonths, 12); assert.equal(r.ident, '02/F');
});

test('dati mancanti o incoerenti producono avvisi, non valori inventati', () => {
  const r = parseLabel('PRODOTTO SENZA CODICE\nLotto: 269999\nentro il 31/02/2027');
  assert.equal(r.code, undefined); assert.equal(r.productionDay, undefined); assert.equal(r.expiry, undefined); assert.equal(r.shelfLifeMonths, undefined);
  assert.ok(r.warnings.some(w => /codice/i.test(w))); assert.ok(r.warnings.some(w => /scadenza/i.test(w)));
  const odd = parseLabel('X COD.1\nLotto: 261002\nentro il 15/12/2027');
  assert.equal(odd.shelfLifeMonths, undefined, 'durata non intera: non indovinata'); assert.ok(odd.warnings.some(w => /durata/i.test(w)));
});

// Text actually recognised by tesseract (ita, best_int) on the photo of the real label, 14/11/2026.
// Producer, address, phone and email lines replaced with test data; OCR errors kept as they were.
const realOcr = `FAGOTTINO PF CIOCCOLATO 90g COD.024
Prodotto da forno orudo congelato Da consumarsi previa Idonea cottura
NOREDIENTI: Farina di FRUMENTO, zucchero, margarina vegetale(grassi vegetali: palma; acqua; grasso vegetale totalmonte
drogenato; ollo vegetale: girasole; grasso vegetale parzialmente Idrogenato: correttori di aeldia’: acido eltrico, citrati di sodio;
MATTE seromato In polvere; sale; emulsionanti: E471; conservanti: sorbato di potassio; aromi; coloranti: caroteni. JUOVA
EVITO di birre, FRUMENTOMALTATO, sale, aromi naturali.
aroltura: Crema NOCCIOLA (80%): zuochero, oll e grassi vegetali: colza; palma; oaoso magro In polvere(8%),
Vrodoto In uno stabilimento ehe ullazadrata a guanlo a nomi dI CESANO LATO ODO, aaa itato a 180 HD apo provata le
PEA Ca
Sontiene n 50 pezzi peso nello 46009 C'e
Produttore di prova, via di esempio (prova).
»rodotto ad uso professionale non destinato al consumo diretto.
Da consumarsi preferibilmente entro Il
02/10/2027
Prodotto In Italia
Lotto: 261002
varozF 8 00000 004642
Intestazione di prova`;

test('testo OCR reale della foto: i dati che servono alla produzione ci sono, il resto è segnalato', () => {
  const r = parseLabel(realOcr, '8000000004642'); // the barcode was decoded from the same photo
  assert.equal(r.code, '024'); assert.equal(r.name, 'FAGOTTINO PF CIOCCOLATO 90g');
  assert.equal(r.piecesPerCarton, 50); assert.equal(r.pieceWeightG, 90); assert.equal(r.netWeightG, 4500, 'dal nome, non dal «46009» letto male');
  assert.ok(r.warnings.some(w => /46009/.test(w)), 'la differenza viene segnalata');
  assert.equal(r.lot, '261002'); assert.equal(r.expiry, '2027-10-02'); assert.equal(r.shelfLifeMonths, 12);
  assert.equal(r.ean, '8000000004642');
  assert.match(r.ingredients!, /^Farina di FRUMENTO/);
  assert.equal(parseLabel(realOcr).ean, undefined, 'senza codice a barre le cifre lette male non bastano');
});

test('dicitura: parole tipiche corrette quando l’OCR sbaglia una lettera, frasi separate', () => {
  const r = parseLabel('FAGOTTINO PF CIOCCOLATO 90g COD.024\nProdotto da forno orudo congelato Da sonsumarsi previa Idonea cottura');
  assert.equal(r.description, 'Prodotto da forno crudo congelato. Da consumarsi previa idonea cottura');
  // A word that is right is never changed into another one.
  assert.equal(parseLabel('X COD.1\nProdotto da forno cotto surgelato').description, 'Prodotto da forno cotto surgelato');
});

test('dicitura già usata da un altro articolo: ripresa identica', () => {
  const known = ['Prodotto da forno crudo congelato. Da consumarsi previa idonea cottura', 'Prodotto da forno precotto surgelato'];
  const r = parseLabel('Y COD.7\nProdolto da forno crudo congelalo Da consumarsi previa idonea coltura', undefined, { known });
  assert.equal(r.description, known[0]);
  assert.equal(parseLabel('Y COD.7\nTorta di mele della casa', undefined, { known }).description, 'Torta di mele della casa', 'testo diverso: non sostituito');
});

test('due letture della stessa etichetta: ogni dato preso dalla lettura che lo riporta', () => {
  const gray = 'FAGOTTINO PF CIOCCOLATO 90g COD.024\nProdotto da forno crudo congelato Da consumarsi previa idonea cottura\nContiene n 50 pezzi peso netto 4500g\nDa consumarsi preferibilmente entro il 02/10/2027';
  const color = 'FAGOTTINO PF CIOCCOLATO 90g COD.024\nProdotto da forno orudo congelato Da sonsumarsi previa ldonea\nSontiene n 50 pezzi peso nello 46009\nLotto: 261002\nIDENT. 02/F';
  const r = parseLabel([gray, color], '8000000004642');
  assert.equal(r.description, 'Prodotto da forno crudo congelato. Da consumarsi previa idonea cottura', 'la dicitura più pulita');
  assert.equal(r.lot, '261002'); assert.equal(r.expiry, '2027-10-02'); assert.equal(r.shelfLifeMonths, 12);
  assert.equal(r.netWeightG, 4500); assert.equal(r.ident, '02/F');
  assert.ok(!r.warnings.some(w => /Lotto non letto|Scadenza non letta/.test(w)));
});

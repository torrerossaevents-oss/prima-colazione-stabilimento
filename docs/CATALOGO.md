# Catalogo prodotti

In **Magazzino → Prodotti** si consultano codice, descrizione, categoria commerciale, unità di misura e tre listini separati: **Listino 3 - Gel.Cor.**, **GELITRIA SRL** e **Distribuzione**. Il tipo operativo (prodotto finito, materia prima o imballaggio) resta distinto dalla categoria commerciale.

La ricerca filtra subito per codice, descrizione o codice di un lotto associato; il filtro categoria si combina con la ricerca. La scheda dettaglio mostra tutti i campi e le quantità per lotto. **Nuovo prodotto** permette l'inserimento manuale; **Modifica**, disponibile direttamente su ogni riga del catalogo, apre la scheda compilata: aggiornare i campi e premere **Salva modifiche**. Lo stesso comando resta disponibile nella scheda dettaglio come **Modifica prodotto**.

## Importazione ed esportazione

Regole verificate da `tests/catalog-io.test.ts` (parser in `lib/catalog-io.ts`, salvataggio in `lib/domain.ts`, azione `product.import`).

### Formati e colonne

- Importazione da Excel `.xlsx` e CSV, con anteprima e controllo prima del salvataggio. I vecchi `.xls` vanno prima salvati come `.xlsx`.
- Colonne del modello e dell'esportazione, in quest'ordine: **Categoria**, **Cod.**, **Descrizione**, **U.m.**, **Listino 3 - Gel.Cor.**, **GELITRIA SRL**, **Distribuzione**, **Tipologia**, **Unità per cartone**, **Scorta minima**. Obbligatorie: Cod., Descrizione e U.m., nella stessa riga di intestazione entro le prime 20 righe; se ne manca una l'errore elenca quali.
- Le intestazioni si riconoscono ignorando maiuscole, spazi, punteggiatura e accenti; sono accettate anche varianti come «Codice articolo», «Unità di misura», «Categoria commerciale», «Tipo operativo», «Listino Gel.Cor.», «Gelitria s.r.l.», «Listino Distribuzione», «Pezzi per cartone». Una colonna ripetuta (eccetto Categoria su celle unite con lo stesso valore) blocca l'importazione.
- Le colonne non riconosciute vengono ignorate e compaiono tra gli avvisi dell'anteprima («Colonne non riconosciute e ignorate: …»).
- CSV: separatore `;`, `,` o tabulazione (rilevato dalla riga di intestazione, oppure indicato con `sep=;`), virgolette RFC 4180 anche su più righe. Codifiche: UTF-8 (con o senza BOM), UTF-16 con BOM («Testo Unicode» di Excel) e, se il file non è UTF-8 valido, Windows-1252/ANSI con un avviso da controllare nell'anteprima.

### Valori

- **Cod.** è testo: zeri iniziali conservati, maiuscole normalizzate, spazi esterni rimossi. Un codice numerico in Excel o in notazione scientifica (`2e5`) è rifiutato, perché gli zeri iniziali potrebbero essere già persi.
- **Prezzi**: cella vuota = prezzo non indicato (diverso da 0). Massimo 3 decimali, da 0 a 999.999,999. Nel testo sono accettati `1,5`, `1.234,567`, `1234,567`, `1.5`, `0.125`, `1234.567`, `€ 2,50`, `1 234,5`. Sono rifiutati con messaggio per riga `1.234` e `12.345` (ambigui: migliaia o decimali? il messaggio propone `1234` oppure `1,234`), `1,234.56`, `1.234.567` senza virgola, valori negativi o con più di 3 decimali. Nessuna IVA viene dedotta.
- **Tipologia** vuota = Prodotto finito; **Scorta minima** vuota = 0; numeri interi senza decimali né separatori (`1000`, non `1.000`).
- **CRT**: unità per cartone vuota = 1, valori diversi da 1 rifiutati; i pezzi indicati nella descrizione non vengono convertiti. Per le altre unità il confezionamento è obbligatorio.
- Una colonna Categoria o listino **assente** conserva il dato esistente in aggiornamento; una cella **vuota** in una colonna presente lo cancella. Tipologia e Scorta minima assenti valgono Prodotto finito e 0 anche per gli articoli aggiornati (avviso in anteprima).
- **Formule** (XLSX): non vengono mai eseguite. Si usa il valore già calcolato e salvato da Excel, con un avviso sul numero di celle; una formula senza valore salvato, una data o un errore bloccano la riga.

### Errori e duplicati

- Una riga non valida interrompe l'intera operazione: nessun catalogo parzialmente importato. Il messaggio indica la riga del foglio (prime 8 righe, poi «Altre N righe da correggere»).
- Un codice ripetuto nel file (anche con maiuscole diverse) è un errore con il riferimento alla prima riga.
- Codici già presenti nel catalogo: la modalità predefinita **solo aggiunta** li mantiene invariati e importa solo i nuovi; **aggiorna per codice** sostituisce i dati usando il codice come chiave e conserva l'identificativo interno, i lotti e le lavorazioni. Per articoli con lotti o lavorazioni codice, tipo, unità e confezionamento non possono cambiare: in quel caso l'intera importazione viene rifiutata.
- L'identificativo interno non è nel file: esportazione e reimportazione si abbinano per codice.
- I file vengono letti nel browser; si salvano soltanto i dati del catalogo dopo conferma. Le ricevute permanenti e il controllo della versione evitano doppi inserimenti e sovrascritture concorrenti. Un'importazione non crea giacenze, lotti o scadenze.

### Limiti effettivi

| Limite | Accettato | Rifiutato |
| --- | --- | --- |
| Dimensione file (`.xlsx` e `.csv`) | 5 MB esatti (5.242.880 byte) | 1 byte in più |
| Prodotti per file | 350 | 351 |
| Righe del foglio (intestazione e righe vuote comprese) | 1.000 | 1.001 |
| Colonne | 60 | 61 |
| Catalogo totale dopo l'importazione | 350 | 351 (nessuna riga importata) |

Per XLSX contano solo righe e colonne con valori (la sola formattazione non conta); il contenuto non compresso è limitato a 20 MB e a 1.000 elementi dell'archivio; file protetti da password, archivi troncati o danneggiati, cartelle senza fogli, senza intestazioni o con più fogli catalogo sono rifiutati con un messaggio esplicito. Nel CSV contano tutte le righe fisiche, anche quelle vuote.

### Esportazione

- `exportCatalog(prodotti, { scope, format })` esporta esattamente i prodotti ricevuti. `scope: 'all'` (predefinito) dichiara il catalogo completo, `scope: 'filtered'` i soli risultati filtrati; il nome del file lo indica: `Catalogo_Prima_Colazione_tutti_AAAA-MM-GG.xlsx` oppure `…_filtrati_…`. Nell'XLSX anche il titolo del documento riporta «tutti i prodotti (N)» o «solo risultati filtrati (N)».
- Nell'interfaccia attuale il pulsante **Esporta Excel** esporta sempre l'intero catalogo in XLSX; l'esportazione dei soli risultati filtrati e il CSV sono disponibili nella libreria ma non ancora collegati a un comando.
- Formati: XLSX (codici in celle di testo) e CSV (UTF-8 con BOM, `;`, virgola decimale, nessun separatore delle migliaia, CRLF).
- Protezione dalle formule: nell'XLSX ogni testo è una cella di tipo testo, mai una formula, e resta identico (`=2+2` resta `=2+2`). Nel CSV un testo che inizia con `=`, `+`, `-`, `@`, tabulazione o ritorno a capo riceve un apostrofo iniziale (`'=2+2`); la reimportazione lo rimuove e ripristina il testo. Differenza nota: tabulazioni e spazi iniziali o finali sono comunque eliminati dal catalogo, e un apostrofo scritto intenzionalmente davanti a uno di quei caratteri viene tolto.
- Esportazione e reimportazione (XLSX e CSV) restituiscono gli stessi valori: codici con zeri iniziali, tutti i campi, prezzo vuoto distinto da 0, tre decimali.

## Quantità e riferimenti

Un file di catalogo non costituisce un inventario: non crea giacenze, lotti, scadenze o carichi. Questi si registrano in **Giacenze e lotti** usando i dati effettivi.

`CRT` significa cartoni: l'unità del prodotto coincide con il cartone e **unità per cartone = 1**. I pezzi riportati nella descrizione restano parte della descrizione e non vengono usati per convertire automaticamente il magazzino. Per altre unità, il confezionamento va dichiarato esplicitamente.

Quando esistono lotti o lavorazioni, codice, tipo, unità e confezionamento non sono modificabili; nome, categoria, scorta minima e listini restano aggiornabili. Le lavorazioni già salvate mantengono i propri dati storici.

## Portabilità e riservatezza

Implementazione: `components/catalog-panel.tsx`, `lib/catalog-io.ts`, `lib/domain.ts`; regole e parser verificati con i test del progetto. L'API conserva autenticazione, controllo dell'origine, versione e ricevute permanenti. Il limite per una richiesta è 500 kB, quello dello stato 2 MB.

Su GitHub vengono versionati sorgenti, test e documentazione. File originali, listini aziendali, esportazioni e registrazioni operative rimangono nell'area riservata e non sono inclusi nel repository.

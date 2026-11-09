# Catalogo prodotti

In **Magazzino → Prodotti** si consultano codice, descrizione, categoria commerciale, unità di misura e tre listini separati: **Listino 3 - Gel.Cor.**, **GELITRIA SRL** e **Distribuzione**. Il tipo operativo (prodotto finito, materia prima o imballaggio) resta distinto dalla categoria commerciale.

La ricerca filtra subito per codice, descrizione o codice di un lotto associato; il filtro categoria si combina con la ricerca. La scheda dettaglio mostra tutti i campi e le quantità per lotto. **Nuovo prodotto** permette l'inserimento manuale; **Modifica**, disponibile direttamente su ogni riga del catalogo, apre la scheda compilata: aggiornare i campi e premere **Salva modifiche**. Lo stesso comando resta disponibile nella scheda dettaglio come **Modifica prodotto**.

## Importazione ed esportazione

- Importazione da Excel `.xlsx` e CSV, con anteprima e controllo prima del salvataggio.
- Il modello scaricabile e l'esportazione Excel contengono i campi del catalogo; i codici sono celle di testo per conservare gli zeri iniziali.
- La modalità predefinita aggiunge solo i codici nuovi. La modalità di aggiornamento usa il codice come chiave e conserva l'identificativo interno del prodotto.
- Una riga non valida interrompe l'intera operazione: nessun catalogo parzialmente importato. Le ricevute permanenti e il controllo della versione evitano doppi inserimenti e sovrascritture concorrenti.
- Il limite rimane 350 prodotti. I file vengono letti nel browser; si salvano soltanto i dati del catalogo dopo conferma.
- Prezzi mancanti e prezzi pari a zero rimangono distinti. Si conservano fino a tre decimali; non si deduce il trattamento IVA o il significato economico dei listini.

## Quantità e riferimenti

Un file di catalogo non costituisce un inventario: non crea giacenze, lotti, scadenze o carichi. Questi si registrano in **Giacenze e lotti** usando i dati effettivi.

`CRT` significa cartoni: l'unità del prodotto coincide con il cartone e **unità per cartone = 1**. I pezzi riportati nella descrizione restano parte della descrizione e non vengono usati per convertire automaticamente il magazzino. Per altre unità, il confezionamento va dichiarato esplicitamente.

Quando esistono lotti o lavorazioni, codice, tipo, unità e confezionamento non sono modificabili; nome, categoria, scorta minima e listini restano aggiornabili. Le lavorazioni già salvate mantengono i propri dati storici.

## Portabilità e riservatezza

Implementazione: `components/catalog-panel.tsx`, `lib/catalog-io.ts`, `lib/domain.ts`; regole e parser verificati con i test del progetto. L'API conserva autenticazione, controllo dell'origine, versione e ricevute permanenti. Il limite per una richiesta è 500 kB, quello dello stato 2 MB.

Su GitHub vengono versionati sorgenti, test e documentazione. File originali, listini aziendali, esportazioni e registrazioni operative rimangono nell'area riservata e non sono inclusi nel repository.

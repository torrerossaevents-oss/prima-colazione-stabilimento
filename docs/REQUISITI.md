# Requisiti di Prima Colazione · Stabilimento

Riferimenti funzionali: progetto conta-cartoni Rev. 02 del 6 novembre 2026 e proposta operativa dello stesso giorno. Questo documento conserva le regole necessarie allo sviluppo senza riprodurre informazioni commerciali riservate.

## Obiettivo e perimetro

Un solo spazio operativo collega catalogo, materie prime, produzione, prodotti finiti, scadenze, ordini, preparazione e partenza. Il primo perimetro previsto è una sede, fino a tre aree interne e un catalogo nell'ordine di 350 articoli. L'estensione a più persone con ruoli distinti richiede una gestione di accessi dedicata; non è sostituita dal semplice campo operatore.

L'avvio deve usare un inventario reale e un catalogo verificato. I documenti di progetto non forniscono i 350 articoli, i saldi iniziali, i clienti o i nomi delle aree. Nessuno di questi dati va inventato.

Il pilota implementato prevede una linea e accesso del solo proprietario. Lo stato operativo ha un limite di 2 MB; le ricevute delle richieste sono conservate separatamente in modo permanente. L'estensione dell'archivio e dei ruoli va progettata prima di superare questi limiti.

## Magazzino

Ogni articolo ha codice univoco, descrizione, tipo, unità di misura e confezionamento. Le soglie minime sono definite dall'azienda. Ogni lotto conserva articolo, codice lotto, scadenza e area.

Dal 9 novembre 2026 il catalogo prevede anche categoria commerciale e tre listini distinti, con importazione Excel/CSV, esportazione Excel, inserimento e modifica manuali. La ricerca progressiva include codice, descrizione e lotti associati. Vedere `CATALOGO.md` per formato e regole: importare prodotti non crea quantità a magazzino.

**Disponibile = presente − bloccato − prenotato.** La disponibilità vendibile esclude inoltre i lotti scaduti. I cartoni sono convertiti nell'unità del prodotto con il confezionamento dichiarato; non sommare unità diverse come se fossero omogenee.

| Passaggio | Effetto previsto |
| --- | --- |
| Ricezione o inventario iniziale | Aumenta il fisico della quantità effettivamente contata |
| Prenotazione di un ordine | Riduce il disponibile, non il fisico |
| Preparazione | Mantiene il fisico e l'impegno |
| Partenza con riferimento documento | Riduce il fisico e chiude l'impegno della quantità partita |
| Partenza parziale | Conserva il residuo da consegnare |
| Annullamento del residuo | Libera soltanto la quantità non partita |
| Associazione della fattura successiva | Collega il documento, senza nuovo scarico |
| Trasferimento fra aree | Mantiene il totale dello stabilimento |
| Blocco | Rende indisponibile una quantità che non è già prenotata |
| Rettifica | Varia il fisico con motivo, responsabile e traccia storica |

La merce preparata ma non partita è ancora fisicamente presente. Una fattura arrivata prima della merce non genera una ricezione. Il riferimento documento non equivale all'emissione o alla conservazione fiscale del documento.

Il processo completo prevede anche differenze fra DDT e quantità effettiva, resi bloccati in attesa di controllo, scarti e consumi interni motivati. Dal 13 novembre 2026 sono implementati come operazioni distinte: **reso** (entra come merce bloccata, con motivo e riferimento), **scarto** (dalla merce libera o da quella bloccata, con motivo e responsabile), **consumo interno** (solo merce libera non scaduta) e **motivo obbligatorio** per una partenza inferiore al residuo. Ogni variazione del fisico è registrata come movimento esplicito nell'evento di storico: la somma dei movimenti coincide con la giacenza (verificato nei test).

## Produzione

Il percorso concordato è **identifica articolo → conferma → avvia → conta → chiudi e salva → scegli come ripartire**.

Prima dell'avvio si legge il codice esatto dell'articolo. Un codice sconosciuto o ambiguo non abilita la lavorazione. Si registra una sola sessione attiva per linea, con identificativo, operatore, lotto, scadenza, data/ora e confezionamento conservato nello storico.

Il giorno di produzione deriva dall'avvio nel fuso `Europe/Rome`; una chiusura dopo mezzanotte non sposta retroattivamente la lavorazione al giorno successivo.

Il conteggio è manuale oppure, se è registrato un ponte, «da fotocellule» (scelto all'avvio). Una lavorazione da fotocellule non accetta conteggi manuali e si chiude con il pulsante sulla linea; la chiusura manuale richiede un motivo e resta segnalata. La chiusura conserva cartoni letti ed eventuali scarti e termina la sessione; la lavorazione successiva parte da zero. Il comando non cancella lo storico e non comanda motore o sicurezze della macchina.

Il prodotto successivo richiede una nuova identificazione. Anche riutilizzare lo stesso articolo richiede un nuovo avvio esplicito. Un salvataggio incerto o fallito non deve mostrare una conferma falsa o permettere di perdere la sessione.

Il conteggio è distinto dalla quantità buona da caricare a magazzino. Non esiste un carico automatico finché non sono stati validati hardware, quantità buone, scarti e regole di integrazione.

## Ordini e controlli

Un ordine collega destinazione, data e righe riferite a lotti disponibili. Le quantità prenotate non possono superare il disponibile. La preparazione e la consegna sono passaggi diversi. Il residuo resta visibile in caso di partenza parziale.

Le modifiche contemporanee devono produrre un conflitto comprensibile, non una sovrascrittura silenziosa. Un reinvio con lo stesso identificativo non deve ripetere un movimento già registrato.

## Esclusioni attuali

Nessuna emissione di fatture, contabilità, marginalità o gestione eventi. Nessuna connessione operativa a TeamSystem, etichettatrice o ricette. Nessun funzionamento offline del conteggio industriale garantito dall'app web: il ponte locale persistente è un componente distinto ancora da integrare e collaudare.

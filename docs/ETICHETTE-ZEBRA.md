# Etichette Zebra automatiche (E2–E5): piano

Bozza del 28/11/2026. Scritta dalla sessione cloud dopo il risultato di E1 mandato dalla sessione sul PC del reparto. **Nessun codice è ancora cambiato**: questo documento serve a decidere. Ogni pezzo diventerà una PR separata con test e prova nel browser.

## Cosa è già stato verificato (E1, PC del reparto)

- Dalle etichette di ZebraDesigner della cartella 100×80 sono stati estratti **101 modelli ZPL**, con la «Stampa su file». Nessuna etichetta è stata modificata (impronte SHA-256 controllate) e niente è stato stampato sulla Zebra.
- I modelli restano sul PC del reparto, insieme alla mappa prodotti → etichette: 65 prodotti, di cui 29 ok, 32 con avviso, 2 bloccate e 2 senza etichetta.
- **La cattura è identica byte per byte** a quello che oggi ZebraDesigner manda alla coda «TERMICO DIRETTO».
- Ogni file ha due blocchi:
  - il **blocco 1** (impostazioni, con `^JUS` che salva nella memoria della Zebra) **non si invia mai**;
  - si invia **solo il blocco 2**, cioè l'etichetta, con il suo `^MMT`, come già fa oggi ZebraDesigner.
- I campi che cambiano a ogni lavorazione:
  - **lotto**: un solo campo di 6 cifre, AAMMGG;
  - **scadenza**: oggi la calcola l'orologio della Zebra; la proposta è scriverla come testo, decisa dal gestionale;
  - **IDENT.**: un valore fisso scritto nel modello.

## Risposte del PC del reparto (28/11/2026)

Arrivate dopo la prima versione di questo documento. Cambiano alcune parti del piano: vedi «Conseguenze sul piano».

**I 101 modelli** (contati con PowerShell; lo script della PR0 verrà rilanciato quando sarà pronto)
- Dimensioni da 1.579 a 3.296 byte, in tutto circa 285 kB. **Nessuna grafica**: niente `^GFA`, `^XG`, `^IM`, `~DG`, `~DY`.
- **Un solo campo lotto** `^FD\d{6}^FS` in tutti i 101 file.
- **Scadenza** calcolata dalla Zebra (`^SLS` + `^SO2` + `^FC`) in 98 file: spostamento di 12 mesi in 97, di 15 mesi in 1. Negli altri 3 c'è una data fissa scritta.
- **Riga IDENT.** in tutti i 101 file.
- **Modalità di stampa**: `^MMT` in tutti i 101, nessun altro valore.
- **Codifica**: `^CI28` mai nel blocco 1 e sempre nel blocco 2. Tutti i 101 file contengono caratteri non ASCII (°, è, à, ò) in UTF-8 sotto `^CI28`.

**Stampante e driver**
- La coda «TERMICO DIRETTO» usa il driver ZDesigner ZE511 300 dpi ZPL versione 3, datatype **RAW**, processore winprint. È in stato normale e non è condivisa.
- La porta usa «ZDesigner Port Monitor» ed è **in rete**, non USB.
- L'attività pianificata del ponte gira con lo stesso utente che vede e usa la coda (Interactive, Limited).
- PowerShell è in FullLanguage, senza criteri di esecuzione impostati.
- Prova senza stampa: `Add-Type` con `winspool.drv` compila in circa 0,5 s, `OpenPrinter("TERMICO DIRETTO")` riesce poi `ClosePrinter`, nessun documento creato. Antivirus e AppLocker non bloccano niente.
- La Zebra era spenta (sabato). Modello e firmware (`~HI`), impostazioni dell'applicatore (`^HH`), orologio della Zebra e stato della porta 9100 si leggono a stampante accesa e linea ferma, **solo con comandi di lettura**, prima della prova di stampa.

**Ponte e PC**
- Node.js 24, cartella `bridge\data` scrivibile.
- `intervals.syncMs` 10000, `intervals.heartbeatMs` 6000.
- Nel gestionale c'è **un solo dispositivo** attivo: il ponte del reparto, l'unico collegato alla Zebra.
- Se `taskkill /F` chiude anche i processi PowerShell figli del ponte si verifica dopo la PR9, con un processo di prova.

**Modelli e ripetibilità**
- 132 `.nlbl`: 103 nella cartella 100×80 e 29 in cartelle vecchie, non convertite. Dei 103, 101 sono convertiti; restano fuori il modello vuoto e un'etichetta con EAN di 11 cifre che ZebraDesigner rifiuta.
- **Come rifare un modello dopo che Teo risalva un `.nlbl`:** in ZebraDesigner, pagina Stampa, stampante TERMICO DIRETTO, spunta «Stampa su file» e quantità 1. Il file che esce è identico alla cattura e non si stampa niente; non servono stampante virtuale né permessi di amministratore. Alla fine **si toglie di nuovo la spunta**.

**Schema dei file sul PC**
- `mappa-prodotti-etichette.json`:
  - è indicizzato per **codice articolo del gestionale**;
  - per ogni prodotto: nome, stato, nota, percorso `.nlbl`, file `.zpl`, titolo, codice stampato, formato, supporto, EAN, posizione ed esempio di lotto e IDENT., tipo, posizione e mesi della scadenza;
  - stati: `ok`, `avviso` (si stampa come oggi, ma c'è un dato da far correggere a Teo), `bloccata` (codice o EAN di un altro prodotto: non stampare in automatico), `manca` (nessuna etichetta).
- `elenco-etichette.json`: 132 voci con file, nome, cartella, appartenenza a 100×80, SHA-256 del `.nlbl`, file `.zpl`, codice normalizzato e stampato, titolo, avviso, nome doppio.

**Dati riservati**
- I nomi di cartelle e file `.nlbl`, e alcuni testi delle etichette, contengono **nomi di distributori e clienti**.
- Possono stare nello stato privato del gestionale (D1) e nel backup. **Mai** in Git, nei test, nel pacchetto del ponte o in questo documento.

### Conseguenze sul piano

- **Invio:** si usa la **coda Windows in modo RAW** (`winspool.drv` da PowerShell), già provata senza stampare. La porta 9100 diretta non serve.
- **Codifica:** il blocco 2 si manda **in UTF-8 così com'è**, senza BOM e senza ricodificare, perché contiene già `^CI28`. La sostituzione di lotto e scadenza scrive solo cifre e `/`.
- **Modalità `^MM`:** tutti i modelli hanno `^MMT`, ed è quello che ZebraDesigner manda già oggi. La politica `mmPolicy` diventa «invia il blocco 2 com'è». Resta la lettura di `~HS` e `^HH` prima e dopo la prova a linea ferma.
- **Scadenza:** si sostituisce il costrutto `^SLS`/`^SO2`/`^FC` con un testo fisso nella stessa posizione e con lo stesso carattere. I 3 file con la data fissa vanno trattati a parte: si sostituisce la data scritta, oppure restano «avviso».
- **Catalogo nel gestionale:** lo produce lo script dai due file JSON e porta solo riferimenti e impronte, senza il testo ZPL. Nei test si usano solo modelli **PROVA** sintetici.
- **Ritardo:** con `syncMs` 10000 il ponte vede la lavorazione nuova entro circa 10 s, poi servono circa 0,5 s per `Add-Type` e lo spool. Il tempo tra «Avvia lavorazione» e il primo cartone lo chiede a Teo il PC del reparto.

## Decisioni di Teo (28/11/2026)

1. **IDENT.**
   - L'operatore lo scrive all'avvio. Viene stampato sull'etichetta e salvato nella lavorazione.
   - Durante la lavorazione si può cambiare quando si vuole, senza fermare niente e senza avviare o chiudere. Il nuovo IDENT. viene salvato e l'etichetta aggiornata parte subito verso la stampante.
   - Sostituisce la regola del 17/11.
2. **Continua il lotto di ieri.**
   - «Ieri» è l'ultimo giorno in cui quel prodotto è stato fatto, al massimo 7 giorni prima (va bene il venerdì visto dal lunedì).
   - Si continua con la sua scadenza.
   - Nello stesso giorno, per lo stesso prodotto, un solo lotto.
3. **Ponte:** può ricevere i dati dell'etichetta e dire se la stampante risponde, senza poter avviare o cambiare lavorazioni.
4. **Unione e pubblicazione:** per questo lavoro sulle etichette la sessione cloud unisce e pubblica dopo la propria revisione, senza chiedere ogni volta. La stampa automatica resta spenta fino alla prova finale, che Teo fa con la sessione del PC del reparto.
5. **Altre domande del documento:** le decidono la sessione cloud e quella del PC del reparto.

### Scelte prese sulle altre domande

- **Avvio:** con un modello `avviso`, `bloccata` o `manca` l'avvio resta consentito. Per `bloccata` e `manca` niente stampa automatica, e un messaggio chiaro dice di stampare da ZebraDesigner.
- **Scadenza stampata:** è quella registrata dal gestionale, scritta come testo. Se i mesi del modello sono diversi dalla durata nella scheda del prodotto, vale la scheda e il catalogo segnala la differenza come avviso.
- **Pulsante «Ristampa»:** non c'è. Il cambio di IDENT. manda già un'etichetta nuova; la prova a linea ferma si fa con lo strumento del ponte.
- **Lavorazioni manuali** (senza contapezzi): niente stampa automatica, perché il ponte non le vede.
- **LOGO! non leggibile:** l'etichetta parte lo stesso, perché la stampa non dipende dal conteggio.
- **Pagina Linea:** la fotocamera e la creazione della scheda prodotto dalla foto escono. La fotocamera nella finestra di avvio del gestionale resta.
- **Fasi:** E2 = controllo dei modelli e anteprima senza stampa, E3 = scelta dell'etichetta nella pagina Linea, E4 = invio alla coda Windows, E5 = prova finale a linea ferma e accensione.

## Domande iniziali per Teo (prima versione, ora risposte sopra)

Queste toccano regole che Teo ha fissato in `AGENTS.md`. Senza la sua risposta i pezzi relativi restano in bozza.

1. **IDENT.** Il 17/11 è stato messo da parte: non si chiede, non si salva, non si stampa. I modelli però stampano già un valore fisso. Va tolto dall'etichetta, lasciato com'è nel modello, oppure chiesto all'avvio?
2. **Continua il lotto di ieri.** All'avvio si sceglie «lotto di oggi» oppure «continua il lotto di ieri», con la **stessa scadenza** del lotto di ieri. Che cosa vuol dire «ieri»: il giorno di calendario precedente, o l'ultimo giorno in cui quel prodotto è stato fatto (il venerdì visto dal lunedì)?
3. **Il ponte e l'etichettatrice.** Il ponte riceverebbe nella lettura della lavorazione i dati dell'etichetta fissati all'avvio, e direbbe solo nel segnale di stato se la stampante risponde. Non avrebbe nuovi permessi di scrittura: non può avviare né modificare lavorazioni.
4. **Unione e pubblicazione.** Teo conferma in questa sessione se le PR di questo lavoro si uniscono e si pubblicano senza chiedere ogni volta. La stampa automatica arriva comunque **spenta**.

Altre domande raccolte dall'analisi:

- IDENT.: i modelli stampano già un valore fisso sulla riga IDENT. (26 valori diversi). Lo togliamo (in composizione oppure risalvando i .nlbl) o lo lasciamo stampare come valore fisso del modello, senza mai chiederlo né salvarlo? Finché non decidi, il ponte compone l'etichetta solo in anteprima e non invia niente.
- «Continua il lotto di ieri»: vale solo il giorno di calendario precedente oppure l'ultimo giorno in cui quel prodotto è stato fatto, per esempio il venerdì visto dal lunedì? Sono ammesse continuazioni a catena? Lo stesso giorno possono esserci, per lo stesso prodotto, sia il lotto di oggi sia il lotto continuato?
- Approvi la nuova formulazione della regola del ponte? Il ponte riceverebbe nella lettura della lavorazione attiva i dati dell'etichetta congelati all'avvio e riferirebbe lo stato della stampante solo nel heartbeat, senza nuove scritture.
- L'applicatore ripete l'ultima etichetta. Dopo «Avvia lavorazione» l'operatore deve aspettare che il riquadro dica «inviata alla coda» prima di far partire la linea? E se la stampa non parte (errore, modello bloccato, ponte vecchio), cosa deve fare?
- Prodotti con modello «avviso» (32), «bloccata» (2) o «manca» (2): l'avvio resta consentito senza stampa e con un avviso, come propongo, oppure va impedito?
- La scadenza stampata deve diventare un testo fisso uguale a quella registrata dal gestionale, al posto del calcolo dell'orologio della Zebra? Se lo spostamento in mesi del modello è diverso dalla durata nella scheda del prodotto, quale vale?
- Serve un pulsante «Stampa etichetta» o «Ristampa» sulla pagina Linea? Chi lo può usare (solo l'amministrazione o anche il laboratorio) e serve sempre un motivo? Senza la tua richiesta resta solo lo strumento di prova a linea ferma.
- Se il ponte non legge la LOGO! (PLC irraggiungibile), l'etichetta deve partire lo stesso oppure solo quando il ponte segue davvero la lavorazione?
- Dopo la prova a linea ferma preferisci che il gestionale non mandi mai comandi di modalità (^MM), lasciando la stampante come è impostata dal pannello?
- Va bene togliere dalla pagina Linea anche la creazione e l'aggiornamento della scheda prodotto dalla foto dell'etichetta? La fotocamera nella finestra di avvio del gestionale resta.
- Il catalogo delle etichette (nomi di cartelle e file .nlbl) può stare nell'archivio privato del gestionale, incluso nel backup? Contiene nomi di clienti da tenere solo sul PC?
- Le lavorazioni avviate a mano, senza contapezzi, devono avere l'etichetta automatica? Oggi il ponte non le vede.
- Va bene la doppia chiave (gestionale e ponte) con i gradini anteprima, prova a linea ferma e automatica, con i criteri proposti? Quale ritardo massimo accetti tra l'avvio e «inviata alla coda»? Chi accende la stampa dopo la prova E5?
- Confermi che le fasi E2-E5 corrispondono a: E2 verifica a secco dei modelli, E3 anteprima, E4 prova a linea ferma, E5 stampa automatica?

## Architettura proposta

Analisi in sola lettura. Nessun file modificato: git status pulito, HEAD 9b642e7. Ho ricontrollato che `lastSyncAt = -Infinity` (bridge/core/service.mjs:196) fa ripetere #sync a ogni ciclo di 250 ms quando manca la lettura del PLC. Per questo il gancio di stampa deve prima consultare un elenco in memoria.

BASE SCELTA. La proposta 3, preferita da due giudici su tre.
- I modelli ZPL restano solo sul PC del reparto e li compone il ponte.
- All'avvio il gestionale congela nella lavorazione un riferimento breve: file, SHA-256, lotto, scadenza come testo fisso.
- Il ponte legge questi dati dalla GET che fa già. Il ponte 1.3.1 li ignora.
- L'esito torna solo come diagnostica nel heartbeat.
- Il dispositivo non riceve nessun nuovo POST e nessuna nuova scrittura.
- La stampa è spenta con doppia chiave: Settings.labelPrint nel gestionale e printer.mode nel ponte. Sale per gradini: verifica a secco, anteprima senza invio, prova a linea ferma, stampa automatica.

INNESTI DALLE ALTRE PROPOSTE.
- Prima PR: uno script a secco sui 101 file veri, che riporta solo conteggi. Il compositore si scrive dopo aver visto quei numeri.
- Elenco dei comandi ZPL ammessi, non solo di quelli vietati. Rifiuta ^CC/^CT/^CD, gli oggetti salvati nella stampante e i comandi sconosciuti, e ricontrolla il testo composto.
- ^CI28 deve stare nel blocco 2.
- Il mittente reale non parte finché le politiche per ^MM e IDENT. non sono impostate espressamente. Non c'è nessun valore predefinito «rimuovi».
- offer() controlla prima l'elenco in memoria dei lavori già visti.
- I byte passano a PowerShell con un file e lo SHA si ricalcola sui byte inviati.
- Ogni lavoro ha una scadenza notAfter in ora del server, oltre al controllo maxAgeMs del ponte.
- printerStatus() è separata da liveStatus, e lastJob si ripete in ogni heartbeat.
- La CI controlla l'elenco FILES del pacchetto e vieta spawnSync/execSync.

CONFLITTI RISOLTI.
- La fotocamera esce dalla pagina Linea nella stessa PR del pannello a cartelle, come ha chiesto Teo, non in fondo. Solo la rimozione dell'OCR e delle dipendenze (lockfile) resta una PR separata, alla fine.
- Il pulsante «Stampa etichetta» o ristampa sulla Linea non c'è: Teo non l'ha chiesto. La prova manuale si fa con PROVA-ETICHETTA.cmd a linea ferma. Il pulsante diventa una PR condizionale.
- La correzione «stesso lotto con scadenza diversa accettato a carico spento» si unisce subito, perché applica una regola già esistente. Restano in bozza fino alle decisioni di Teo:
  - «continua il lotto di ieri», finché non definisce «ieri»;
  - la GET con i dati dell'etichetta, finché non approva la nuova formulazione della regola del ponte;
  - la regola sull'IDENT.

PIANO. 12 PR ordinate più 2 condizionali.
- Ogni PR unibile con la CI verde è inerte con gli interruttori spenti. La regola 7 di AGENTS.md le unisce in automatico.
- L'ordine è: prima il server (heartbeat, poi GET), poi il ponte; prima il catalogo, poi il pannello Linea; il mittente reale per ultimo, dopo le risposte del PC del reparto.

PRIMA DI ACCENDERE LA STAMPA SERVONO:
- la decisione di Teo sull'IDENT.: il blocco 2 dei modelli lo stampa già;
- la verifica a linea ferma di ^MM e della ristampa dell'applicatore (^JJ).

LIMITI DELL'ANALISI.
- La corrispondenza E2-E5 con le fasi è presunta: nel repository le fasi non sono definite.
- Restano non verificate alcune informazioni prese dal web: media.printmode, la porta 9100 chiusa sulle unità UE, lo schema Add-Type con winspool.

0. NOMI USATI IN TUTTO IL PIANO
- Gestionale:
  - Settings.labelPrint: se assente, la stampa è spenta; vale «automatica» solo se impostato espressamente. È il contrario di autoLoad.
  - state.labels: catalogo dei riferimenti, caricato con l'azione labels.import.
  - session.label: istantanea presa all'avvio.
  - session.continuedFrom.
  - printerStatus().
- Ponte:
  - printer.mode: spenta, anteprima o automatica.
  - printer.sender: nessuno o coda-windows (tcp solo se scelto dopo le risposte del PC).
  - printer.mmPolicy e printer.identPolicy, senza valore predefinito per l'invio.
  - bridge/core/zpl.mjs (lettore, controllo e compositore puri), bridge/core/printer.mjs (lavoratore), bridge/stampa-raw.ps1, bridge/strumenti/verifica-modelli.mjs, bridge/catalogo-etichette.mjs, bridge/PROVA-ETICHETTA.cmd.

1. DOVE VIVONO I MODELLI
- I 101 file ZPL restano solo sul PC del reparto, nella cartella printer.templatesDir indicata in ponte.local.json, che è esclusa da Git (.gitignore:48). Non vanno mai in Git, nel pacchetto ZIP, in D1 o nello stato.
- Il gestionale conserva solo state.labels, un catalogo di riferimenti senza testo ZPL. Per ogni voce:
  - id breve;
  - cartella e nome del .nlbl;
  - nlblSha256, che serve al browser per riconoscere un .nlbl caricato;
  - zplFile, solo un nome .zpl relativo, senza '..' né percorsi assoluti;
  - zplSha256, che serve al ponte per verificare il file che invierà;
  - codici articolo abbinati;
  - stato, da un elenco chiuso: ok, avviso, bloccata, manca, non-compatibile, da-riestrarre;
  - esito dei controlli a secco: un solo campo lotto, tipo di scadenza, spostamento in mesi di ^SO2, IDENT. presente, ^MM presente, ^CI nel blocco 2.
- Il file da importare lo produce sul PC bridge/catalogo-etichette.mjs. Legge elenco-etichette.json, mappa-prodotti-etichette.json e la cartella ZPL, calcola gli hash e i controlli con zpl.mjs e non copia il contenuto.
- L'amministrazione lo importa in Configurazione con labels.import, un'azione di dominio solo sua, versionata, deduplicata, scritta nello storico e validata in lib/domain.ts. I limiti sono: al massimo 400 voci, stringhe brevi, hash di 64 caratteri esadecimali, nessun campo con ^XA.
- Peso stimato: circa 30-50 kB su 2 MB. Non serve una migrazione. La modalità prova usa un catalogo PROVA costruito nel browser.
- Alternativa da usare solo se Teo non vuole i nomi nello stato: tabella D1 con la migrazione 0003.

2. ISTANTANEA ALL'AVVIO (lib/domain.ts, production.start)
- production.start accetta labelId, facoltativo. Senza labelId si usa l'unica voce utilizzabile abbinata all'articolo.
- Salva session.label = {templateId, folder, name, zplFile, zplSha256, status, lotText, expiryText, job}:
  - lotText è session.lotCode;
  - expiryText è session.expiry in formato gg/mm/aaaa, con una funzione unica di lib/domain.ts;
  - job vale {id: sessionId + ':a', kind: 'auto', requestedAt, notAfter = startedAt + 10 minuti in ora del server} solo se, all'avvio, Settings.labelPrint === 'automatica', la lavorazione è source 'device' e lo stato del modello è ammesso. Altrimenti job vale null.
- session.label non si riscrive mai, come per il confezionamento. Accendere l'interruttore a lavorazione avviata non fa stampare nulla a posteriori.
- Se il modello è bloccata, manca o non c'è, l'avvio resta consentito con un avviso visibile e session.label senza job. La produzione non si ferma.
- L'IDENT. non entra né nella lavorazione né nella GET.
- Continua il lotto di ieri (PR in bozza): production.start {continueFrom: sessionId}. Il server cerca la lavorazione chiusa dello stesso articolo tra le sessioni calde, con la regola su «ieri» decisa da Teo. Ne copia lotCode ed expiry senza ricalcolarli e rifiuta valori inviati diversi. Salva session.continuedFrom e lo scrive nello storico. L'etichetta riceve quindi la scadenza del lotto originale.

3. COSA VEDE IL PONTE (contratto 1.1, sole aggiunte facoltative)
- GET /api/devices/production resta invariata e aggiunge activeSession.label = {templateId, zplFile, zplSha256, lotText, expiryText, job oppure null}.
- label è presente anche con la stampa spenta, così l'anteprima del ponte funziona senza accendere il server. Solo job dipende dall'interruttore del server.
- Il ponte 1.3.1 lo ignora: transmitter.mjs:83-91 e store.mjs:122-128 usano solo id, productCode, lotCode e startedAt.
- La regola source==='device' non cambia. Le lavorazioni manuali restano senza activeSession.

4. CHI COMPONE LO ZPL (bridge/core/zpl.mjs, puro, testato con modelli PROVA sintetici, fallisce chiuso)
- (a) Legge zplFile da templatesDir, accettando solo un nome semplice .zpl, e verifica lo SHA-256 contro zplSha256.
- (b) Toglie il BOM e mantiene il CRLF.
- (c) Pretende esattamente due blocchi ^XA..^XZ e prende solo il secondo. Il blocco 1, con ^JUS, non si invia mai.
- (d) Applica l'elenco dei comandi ammessi: ^XA ^XZ ^FO ^FT ^A ^A@ ^CF ^CI ^FB ^FD ^FS ^FH ^FR ^FW ^FX ^GB ^GC ^GD ^GE ^GFA ^BY ^BC ^BE ^B3 ^BQ ^LH ^LS ^LT ^LR ^PW ^LL ^PQ ^PR ^PO ^MM, più ^SL/^SO/^FC riconosciuti solo come costrutto della scadenza. Rifiuta:
  - ogni comando ~;
  - ^JU, ^JJ, ^KP, ^KN, ^ND/^NS/^NC;
  - i cambi di prefisso ^CC/^CT/^CD;
  - gli oggetti salvati nella stampante ^XG/^IM/^XF/^DF/^DG/^ID/^HZ;
  - qualsiasi comando sconosciuto.
- (e) Richiede esattamente un campo ^FD\d{6}^FS e lo sostituisce con lotText, solo se lotText è un AAMMGG valido.
- (f) Richiede esattamente un campo scadenza calcolato (^FC con ^FD{d/{m/{Y) e lo sostituisce con ^FD<expiryText>^FS, togliendo ^FC e lo ^SO o ^SL collegati. expiryText deve rispettare gg/mm/aaaa.
- (g) Rifiuta un testo non ASCII senza ^CI28 nel blocco 2, perché il blocco 1 non si invia.
- (h) ^MM segue mmPolicy: mantieni, togli, oppure valore esplicito. Se manca, la composizione è ammessa solo in anteprima.
- (i) La riga IDENT. segue identPolicy: 'non-deciso' (predefinito), 'togli' o 'mantieni'. Con 'non-deciso' la composizione è ammessa solo in anteprima.
- (l) Ricontrolla con l'elenco dei comandi ammessi il testo composto e restituisce byte, SHA e un riepilogo delle sostituzioni.

5. COME SI INVIA (bridge/core/printer.mjs, separato dal conteggio)
- Gancio in #sync, subito dopo `const remote = result.activeSession` (service.mjs:188) e prima delle uscite per «già seguita» e «manca PLC»:
  - la chiamata è this.#printer?.offer(remote, result.serverTime), sincrona e dentro try/catch, senza await;
  - offer() guarda prima un Set in memoria dei jobId già visti, senza toccare SQLite, poi accoda e ritorna.
  - Se la stampa debba dipendere dalla lettura del PLC è una domanda per Teo. La proposta è di no.
- Lavoratore: una catena di promesse propria con .catch(), un lavoro alla volta.
  - 1) Se esiste il segno label:<jobId> in ponte_state, in qualsiasi stato, il lavoro si salta.
  - 2) Se serverTime è oltre notAfter, oppure serverTime − requestedAt supera maxAgeMs (predefinito 120 s), l'esito è 'saltata-vecchia'.
  - 3) Compone con zpl.mjs. In modalità anteprima scrive data/etichette-prova/<sessionId>.zpl con esito 'composta-non-inviata' e si ferma.
  - 4) In modalità automatica serve sender coda-windows con mmPolicy e identPolicy impostati espressamente, altrimenti l'esito è 'configurazione-incompleta'.
  - 5) Scrive il segno 'in-invio' prima di spedire.
  - 6) Scrive i byte in un file temporaneo in data/stampa/ e lancia, con child_process.execFile asincrono, powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File stampa-raw.ps1 -Queue <coda> -File <percorso> -Sha <sha>. Lo script usa Add-Type con winspool.drv (OpenPrinter, StartDocPrinter con datatype RAW, WritePrinter, EndDocPrinter), legge il file con ReadAllBytes e ricalcola lo SHA sui byte che passa a WritePrinter. Timeout di circa 15 s, poi kill.
  - 7) Registra un esito chiuso: inviata-alla-coda, errore (messaggio fino a 120 caratteri) oppure incerta. Dopo il passo 5 non si ritenta mai da solo. Un 'in-invio' trovato dopo un riavvio diventa 'incerta'.
- Ogni 60 s circa un processo asincrono a parte legge lo stato della coda: Get-Printer e Get-PrintJob. È lo stato visto dallo spooler, non la conferma della Zebra.
- stop() e dispose() fermano il lavoratore e uccidono il processo figlio prima di store.close().
- In simulazione printer.mode è forzato a spenta o anteprima.
- Niente spawnSync, execSync o execFileSync. counter.mjs, #processCounter, #handleClose e il calcolo dei cartoni non si toccano.

6. STATO VERSO IL GESTIONALE
- #transmit aggiunge al heartbeat il blocco printer, letto dalla memoria: {mode, sender, templatesDirOk, queueFound, queueStatus, checkedAt, lastJob: {jobId, sessionId, outcome, at, error}}.
- lastJob si ripete in ogni heartbeat, perché il server ne salva al massimo uno ogni 5 s.
- Lo stesso blocco va in stato.json e status.mjs.
- recordHeartbeat lo accetta solo con campi in elenco e limitati:
  - outcome da un elenco chiuso: composta-non-inviata, inviata-alla-coda, errore, incerta, saltata-vecchia, configurazione-incompleta, rifiutata;
  - error al massimo 120 caratteri;
  - id al massimo 80 caratteri.
- Se il blocco manca (ponte 1.3.1) il server salva null.
- printerStatus(), separata da liveStatus, espone bridgeVersion e printer in /api/workspace/live, senza id né nome del dispositivo.

7. PAGINA LINEA
- La fotocamera e la foto escono. Al loro posto:
  - il pannello «Scegli etichetta» con cartelle, file e articolo, letto da state.labels;
  - «Carica file .nlbl», che riconosce il file con crypto.subtle.digest SHA-256 nel browser; il file resta sul dispositivo;
  - il campo codice o EAN, che c'è già (findTyped e productByScan).
- L'anteprima mostra prodotto, lotto, scadenza come testo e stato del modello.
- Riquadro «Etichettatrice» dentro BridgeStatusPanel. Mostra uno di questi messaggi:
  - «Stato etichettatrice non disponibile con il ponte 1.3.1»;
  - «Stampa automatica spenta»;
  - «Anteprima pronta, non inviata»;
  - «In attesa del ponte»;
  - «Inviata alla coda di Windows alle hh:mm, non confermata dalla stampante»;
  - «Errore: ...»;
  - «Esito incerto: controlla l'etichetta»;
  - «Etichetta di questa lavorazione non ancora inviata: l'applicatore può ripetere quella precedente».
- Il riquadro non scrive mai «stampata» o «ricevuta».
- In modalità prova nessuna chiamata esce dal browser e la stampa è sempre spenta.

8. FLUSSO
- 1) L'iPad o il PC chiama production.start, con labelId, eventualmente continueFrom, expectedVersion e requestId stabile. Il server congela session.label.
- 2) Il ponte fa la GET entro syncMs (circa 10 s) e trova label.
- 3) offer() accoda il lavoro e il ciclo continua.
- 4) Il lavoratore compone e invia, oppure si ferma all'anteprima, e scrive il segno in ponte_state.
- 5) Il heartbeat porta printer.lastJob al server.
- 6) recordHeartbeat lo salva e printerStatus lo espone in /live.
- 7) Il riquadro sulla Linea si aggiorna ogni 3 s.
- 8) La chiusura dal pulsante della linea resta invariata.

9. FASI E CRITERI (corrispondenza con E2-E5 presunta)
- E2, verifica a secco: verifica-modelli.mjs sui 101 file veri, solo conteggi.
- E3, anteprima. Ponte in modalità anteprima, server spento. Superata se:
  - per tutti i prodotti mappati c'è un elenco di composti e di rifiutati con il motivo;
  - per 3 prodotti, il confronto byte per byte con «Stampa su file» di ZebraDesigner mostra solo le differenze previste;
  - in coda non compare nessun lavoro;
  - per una giornata i cartoni e i tempi di ciclo restano invariati.
- E4, prova a linea ferma con PROVA-ETICHETTA.cmd, con mmPolicy e identPolicy decisi. Prima e dopo si leggono ~HS (campo r), l'etichetta di configurazione e le impostazioni dell'applicatore. Superata se:
  - 10 stampe di 3 prodotti danno lotto, scadenza e IDENT. corretti;
  - la modalità «Stampa 1, poi ripete» non cambia;
  - con la stampante spenta o la coda in pausa l'esito è errore o incerta, mentre il conteggio resta invariato;
  - alla fine si rimanda l'etichetta giusta.
- E5, automatica. Ponte e server su automatica. Superata se:
  - in 5 lavorazioni su 2 giorni il primo cartone ha l'etichetta giusta;
  - il ritardo tra l'avvio e «inviata alla coda» è misurato e accettato;
  - un riavvio a metà lavorazione non provoca ristampe;
  - una lavorazione vista in ritardo viene saltata;
  - un guasto della stampante non cambia i cartoni.

10. PERMESSI
- Il dispositivo continua a fare solo tre cose: legge la lavorazione attiva (ora con i dati dell'etichetta), la chiude una volta e manda un heartbeat diagnostico.
- Tutte le scritture nello stato restano delle persone: avvio, import del catalogo, interruttore.

## Pezzi (PR) in ordine

Ogni PR è piccola. Finché gli interruttori della stampa sono spenti, unirla non cambia niente per gli operatori.

### PR0 - Verifica a secco dei modelli ZPL (nessun effetto per gli operatori)

In bridge/core/zpl.mjs vanno solo le funzioni pure di lettura e controllo, senza composizione e senza invio:
- parseZplFile toglie il BOM, separa i blocchi e identifica quello con ^JU;
- checkLabelBlock applica l'elenco dei comandi ammessi, conta i campi ^FD\d{6}^FS, riconosce il costrutto ^SLS/^SO2/^FC con lo spostamento in mesi, segnala la riga IDENT., ^MM, la posizione di ^CI e ^GFA/^XG/^IM/~DG.

bridge/strumenti/verifica-modelli.mjs è uno script senza dipendenze da lanciare sul PC del reparto: node verifica-modelli.mjs C:\Users\Ufficio\ZPL-etichette. A video stampa solo conteggi e codici d'errore per ciascun file, mai i contenuti.

Il servizio del ponte, il gestionale e lo stato restano intatti. Il risultato decide come proseguire: se molti file hanno ^XG, due campi lotto o una scadenza in forma diversa, il compositore va rivisto prima della PR8.

**File:** `bridge/core/zpl.mjs (nuovo, solo lettura e controllo)`, `bridge/strumenti/verifica-modelli.mjs (nuovo)`, `bridge/tests/zpl-check.test.mjs (nuovo)`, `bridge/tests/fixtures/PROVA-*.zpl (nuovi, sintetici, con BOM e CRLF, nessun dato aziendale)`, `package.json (test:bridge include il nuovo test)`, `scripts/package-logo.py (FILES e testi del MANIFEST)`, `public/downloads/ponte-logo-preparazione.zip (rigenerato)`, `docs/ETICHETTE-ZPL.md (nuovo: formato a due blocchi, comandi ammessi, cosa non si invia mai)`

**Test:** Il blocco 1 con ^JUS viene sempre identificato e scartato. Vengono rifiutati: ~JR, ~DG, ^XG, ^DF, ^IM, ^CC, ^CT, ^ND e ^KP nel blocco 2, un comando sconosciuto, zero o due campi lotto, zero o due campi scadenza. ^SO2 a 12 mesi viene riconosciuto. Testo non ASCII senza ^CI28 nel blocco 2: segnalato. IDENT. segnalato. Lo script, eseguito su una cartella PROVA temporanea, non stampa contenuti. Comandi: npm run test:bridge, npm run bridge:simulate, npm test, npm run check, npm run build.

**Compatibilità:** Non ha effetto: nessun modulo del servizio importa zpl.mjs, BRIDGE_VERSION resta 1.3.1 e i ponte.local.json non cambiano. Lo script si copia a mano sul PC oppure si prende dallo ZIP. Si può unire con la CI verde.

### PR1 - Dominio: stesso lotto con scadenza diversa rifiutato anche a carico spento

Corregge un difetto verificato. Oggi, con autoLoad=false, il server accetta il lotto 261127 con scadenza 2027-11-28 mentre la scadenza giusta è 2027-11-27.

In production.start il controllo sameLot si estende: oltre a state.lots confronta anche le sessioni calde (stesso productId e lotCode, scadenza diversa porta al rifiuto). Facoltativo: un caso production.start in archiveNeeds con lotRef, così diventano visibili anche le righe del lotto già archiviate a quantità 0.

Nessuna interfaccia nuova e nessun campo nuovo.

**File:** `lib/domain.ts`, `lib/archive.ts (facoltativo)`, `tests/production-label.test.ts`, `STATO.md`

**Test:** Stesso lotto con scadenza diversa: rifiutato con autoLoad=false e anche con la riga del lotto archiviata. Stesso lotto con stessa scadenza: accettato, e il carico alla chiusura si somma alla riga esistente (loadInto). I test di production-label.test.ts:30-44 e :85-89 restano verdi, e così tests/trial.test.ts:33. Comandi: npm test, npm run check, npm run build.

**Compatibilità:** Applica una regola che esiste già (un lotto ha una sola scadenza). Il ponte 1.3.1 e la GET non cambiano. Si può unire con la CI verde.

### PR2 - Dominio: catalogo etichette, interruttore spento e istantanea session.label

In lib/domain.ts:
- Settings.labelPrint?: 'automatica'. Se assente la stampa è spenta: polarità opposta ad autoLoad, va scritto nel codice. Il tipo è controllato in settings.update e in validateState, compare nel messaggio dello storico ed è riservato all'amministrazione.
- Azione labels.import, solo per l'amministrazione. Fino a 400 voci, stringhe limitate, hash di 64 caratteri esadecimali, zplFile come nome semplice .zpl, stato da elenco chiuso, nessun ^XA nei campi. Sostituisce il catalogo intero e lascia una riga di storico con il riepilogo.
- production.start accetta labelId? e congela session.label come descritto nell'architettura. job è non nullo solo con labelPrint 'automatica', source 'device' e modello ammesso. Con modello mancante o bloccato l'avvio resta consentito, senza job.
- Funzione unica expiryLabelText(expiry) che restituisce gg/mm/aaaa.

lib/trial.ts riceve un catalogo PROVA, con la stampa sempre spenta. Non c'è ancora interfaccia: la sezione di Configurazione arriva nella PR3.

**File:** `lib/domain.ts`, `lib/permissions.ts (labels.import solo amministrazione)`, `lib/trial.ts`, `tests/labels-catalog.test.ts (nuovo)`, `tests/production-label.test.ts`, `tests/api.test.ts`, `tests/trial.test.ts`

**Test:** Test sull'interruttore: labelPrint assente equivale a spento, un valore fuori elenco viene rifiutato. Test di regressione sulla polarità: nessuna lettura con !== undefined o !== false accende la stampa.

Test su labels.import: rifiuta un hash non valido, un catalogo troppo grande, un percorso con '..' o un campo con ^XA, e rifiuta la richiesta se arriva dal laboratorio.

Test su session.label: resta invariata dopo un nuovo import o dopo l'accensione dell'interruttore. Una lavorazione avviata prima dell'accensione non ha job. Una lavorazione manuale non ha job.

Test di formato e dimensione: expiryLabelText rispetta la regola di fine mese di productionExpiry. Lo stato con 132 voci e 350 articoli resta sotto i 2 MB.

Modalità prova: nessuna chiamata al server e stampa sempre spenta.

Comandi: npm test, npm run check, npm run build.

**Compatibilità:** La GET e il ponte non cambiano. Senza import il catalogo è vuoto e le lavorazioni hanno label null. Gli archivi senza labels restano validi. Si può unire con la CI verde.

### PR3 - Configurazione: importazione del catalogo e script catalogo-etichette.mjs

In Configurazione arriva la sezione «Modelli di etichetta», solo per l'amministrazione:
- scelta del file catalogo-etichette.json;
- riepilogo per stato (ok, avviso, bloccata, manca, non-compatibile, da-riestrarre);
- differenze con il catalogo attuale (nuove, cambiate, sparite);
- conferma, con doppio invio disabilitato;
- in caso di errore il file scelto resta.

Lo script bridge/catalogo-etichette.mjs gira sul PC. Unisce elenco-etichette.json, mappa-prodotti-etichette.json e gli hash e i controlli calcolati con zpl.mjs, senza copiare il testo ZPL. Segnala da-riestrarre quando lo SHA del .nlbl è cambiato ma lo ZPL no, e un avviso quando lo spostamento di ^SO2 non coincide con shelfLifeMonths dell'articolo.

L'interruttore della stampa non si vede ancora: arriva nella PR10.

**File:** `components/labels-import.tsx (nuovo)`, `components/stabilimento-app.tsx (montaggio in Configurazione)`, `bridge/catalogo-etichette.mjs (nuovo)`, `bridge/ELENCO-ETICHETTE.cmd (nuovo)`, `bridge/tests/catalogo.test.mjs (nuovo)`, `scripts/package-logo.py`, `public/downloads/ponte-logo-preparazione.zip`, `tests/ui/smoke.mjs`, `docs/ETICHETTE-ZPL.md`

**Test:** In smoke.mjs:
- import di un catalogo PROVA con riepilogo e differenze;
- errore mostrato senza perdere il file;
- tipografia #000 con peso 400 e pulsanti di almeno 34 px, anche in modalità prova;
- il percorso 138-140 resta verde.

In catalogo.test.mjs, su una cartella PROVA:
- hash corretti;
- nessun contenuto ZPL nell'uscita;
- casi da-riestrarre e di disallineamento della durata.

Comandi: npm test, test:bridge, check, build.

**Compatibilità:** Tocca solo l'interfaccia del gestionale e uno script manuale del ponte. Il servizio del ponte non cambia. Si può unire con la CI verde. Il catalogo reale si importa solo dopo la risposta di Teo sui nomi delle cartelle.

### PR4 - Server: blocco printer facoltativo nel heartbeat, printerStatus e riquadro Etichettatrice

recordHeartbeat accetta printer facoltativo, solo con i campi in elenco e limitati descritti nell'architettura. Se il blocco manca, salva null.

La nuova printerStatus(), separata da liveStatus, porta bridgeVersion e printer in /api/workspace/live, senza id né nome del dispositivo. Il tipo Live in lib/live.ts riceve campi facoltativi.

Nel BridgeStatusPanel della Linea e nella scheda dispositivi in Configurazione arriva il riquadro «Etichettatrice». Con il ponte 1.3.1 mostra «Stato etichettatrice non disponibile con il ponte 1.3.1».

In docs/CONTRATTO-PONTE.md il heartbeat riceve un campo diagnostico facoltativo.

**File:** `lib/server/devices.ts`, `lib/live.ts`, `app/api/workspace/live/route.ts`, `components/line-app.tsx (solo BridgeStatusPanel)`, `components/operations-panels.tsx`, `tests/api.test.ts`, `tests/live.test.ts`, `tests/bridge-e2e.test.ts`, `tests/ui/linea.mjs`, `docs/CONTRATTO-PONTE.md`, `STATO.md`

**Test:** Heartbeat:
- senza printer: risposta 200, printer null;
- con un outcome fuori elenco o un errore troppo lungo: troncato o scartato, risposta 200;
- oltre 16 000 byte: risposta 413 come oggi.

live.test.ts:
- i deepEqual alle righe 54, 69 e 79 restano invariati;
- nuove asserzioni su printerStatus, che non contiene identificativi.

linea.mjs:117, heartbeat del ponte 1.3.1: compare la dicitura «non disponibile», testo nero o bianco con peso 400, dd di almeno 30 px.

Il ciclo in bridge-e2e resta verde.

Comandi: npm test, test:bridge, check, build.

**Compatibilità:** Il ponte 1.3.1 non manda printer: il server lo tollera e la risposta resta {ok:true}. È solo diagnostica e non tocca lo stato operativo. Si può unire con la CI verde e va pubblicata su Cloudflare prima del ponte 1.4.

### PR5 - Contratto ponte 1.1: activeSession.label nella GET (bozza fino al sì di Teo)

GET /api/devices/production aggiunge activeSession.label = {templateId, zplFile, zplSha256, lotText, expiryText, job}. label è presente quando la lavorazione ha un modello utilizzabile; job dipende dall'interruttore congelato all'avvio.

Non cambia nessun altro campo e resta la regola source==='device'.

Documenti:
- docs/CONTRATTO-PONTE.md passa alla 1.1 (sole aggiunte facoltative);
- docs/REQUISITI.md:60 sostituisce «Nessuna connessione operativa a ... etichettatrice» con il perimetro effettivo;
- AGENTS.md riceve la regola del ponte nella formulazione approvata da Teo.

**File:** `app/api/devices/production/route.ts`, `tests/api.test.ts`, `bridge/tests/transmitter.test.mjs`, `bridge/core/sim-gestionale.mjs (label facoltativo)`, `tests/bridge-e2e.test.ts`, `docs/CONTRATTO-PONTE.md`, `docs/REQUISITI.md`, `AGENTS.md`, `STATO.md`

**Test:** In api.test.ts:
- label presente con job null quando la stampa è spenta;
- job presente solo se l'interruttore era acceso all'avvio;
- per una lavorazione manuale activeSession resta null;
- un dispositivo di un'altra linea non riceve niente.

In transmitter.test.mjs:137-139: il ponte 1.3.1 ignora label e followSession salva solo i quattro campi.

In bridge-e2e: il ciclo completo con il ponte attuale e la GET nuova resta invariato.

Comandi: npm test, test:bridge, check, build.

**Compatibilità:** Il ponte 1.3.1 ignora il campo. Con la stampa spenta job vale sempre null, quindi non ci sono effetti. Va tenuta in bozza finché Teo non approva la nuova formulazione della regola del ponte in AGENTS.md: l'unione automatica la metterebbe in main appena la CI è verde.

### PR6 - Pagina Linea: pannello «Scegli etichetta», file .nlbl, avvio con il codice, fotocamera tolta

In StartView di line-app.tsx si tolgono LabelCamera, readFrame, onDetected, cameraOpen, detected, l'input image/*, il confronto tra scheda ed etichetta e NewProduct.

Si aggiungono:
- il pannello a cartelle letto da state.labels, con lo stato del modello visibile;
- «Carica file .nlbl», con SHA-256 calcolato nel browser e cercato in nlblSha256;
- il campo codice o EAN, che c'è già, con il modello predefinito.

L'anteprima mostra prodotto, lotto, scadenza come testo e stato del modello. Per un modello mancante, bloccato o con avviso compare un avviso chiaro. L'IDENT. non compare come dato gestito.

start() invia labelId e il pulsante si chiama «Avvia lavorazione».

Testi da aggiornare: commento di testa e riga 284 di line-app.tsx, stabilimento-app.tsx:554 (foto dell'etichetta, 13 MB), docs/APP-LINEA-IPAD.md:18 e :82, docs/GUIDA-RAPIDA.md:16.

La CameraScan della finestra del gestionale resta.

**File:** `components/line-app.tsx`, `components/label-folders.tsx (nuovo)`, `components/label-preview.tsx`, `components/stabilimento-app.tsx`, `lib/trial.ts (catalogo PROVA nel pannello)`, `app/globals.css (o il foglio della Linea)`, `tests/ui/linea.mjs`, `docs/APP-LINEA-IPAD.md`, `docs/GUIDA-RAPIDA.md`, `STATO.md`

**Test:** In tests/ui/linea.mjs:
- le righe 41-52 si sostituiscono con post({type:'product.add'}) e un catalogo PROVA importato con labels.import;
- le righe 90-109 (fotocamera finta) si tolgono;
- le righe 40, 99 e 170 (titolo) e 59 e 104 (pulsante) si aggiornano.

Scenari da coprire:
- scelta da cartella: session.label.templateId corretto;
- .nlbl sintetico PROVA riconosciuto; .nlbl sconosciuto: messaggio e nessun avvio;
- codice sconosciuto: rifiutato dal server, campi conservati;
- modello bloccato: avviso e avvio possibile.

Regole comuni:
- doppio invio disabilitato;
- pulsanti di almeno 44 px, testo nero o bianco con peso 400;
- in modalità prova nessuna fetch.

smoke.mjs:145-147 resta invariato.

Comandi: npm test, check, build, test UI.

**Compatibilità:** Il ponte non cambia. Va unita solo dopo che il catalogo reale è stato importato in Configurazione (PR3), altrimenti la Linea perde il riconoscimento senza un sostituto. Fino ad allora resta in bozza. Con il ponte 1.3.1 l'avvio resta in modalità device come oggi.

### PR7 - Continua il lotto di ieri (bozza fino alla definizione di «ieri» da parte di Teo)

production.start accetta continueFrom: sessionId. La funzione condivisa previousLotFor(state, productId, today) applica la regola decisa da Teo: giorno di calendario precedente oppure ultimo giorno di produzione dell'articolo, con o senza catene, con o senza due lotti nello stesso giorno.

Il server copia lotCode ed expiry senza ricalcolarli, rifiuta valori inviati diversi, salva session.continuedFrom e lo scrive nello storico.

Nella finestra di avvio, sia della Linea sia del gestionale, si sceglie tra «Lotto di oggi» (predefinito) e «Continua il lotto di ieri (lotto X, scadenza Y)». La seconda scelta compare solo se previousLotFor trova una lavorazione. Una scelta esplicita sostituisce il confirm «lotto diverso da oggi».

session.label prende la scadenza originale.

**File:** `lib/domain.ts`, `components/line-app.tsx`, `components/stabilimento-app.tsx`, `tests/continue-lot.test.ts (nuovo)`, `tests/production-label.test.ts`, `tests/ui/linea.mjs`, `tests/ui/smoke.mjs`, `AGENTS.md (regola del lotto, con data e decisione di Teo)`, `docs/REQUISITI.md`, `STATO.md`

**Test:** Accettata:
- continuazione con la scadenza originale, anche se nel frattempo shelfLifeMonths è cambiato;
- carico sommato alla riga di ieri.

Rifiutata:
- senza lavorazione precedente;
- con lavorazione non chiusa o di un altro articolo;
- con lotto o scadenza diversi.

session.label.expiryText uguale alla scadenza originale.

Controlli che devono restare invariati: in smoke.mjs:156 il predefinito resta il lotto di oggi; trial.test.ts:33 non cambia, perché la prova non continua lotti.

Tipografia e pulsanti a norma anche in modalità prova.

Comandi: npm test, check, build, test UI.

**Compatibilità:** Il ponte 1.3.1 riceve già lotCode ed expiry così come sono. Il campo è facoltativo. Resta in bozza finché Teo non decide il significato di «ieri» e non approva la regola nuova in AGENTS.md.

### PR8 - Ponte 1.4.0 in modalità anteprima: compositore, lavoratore separato, nessun codice di invio

bridge/core/zpl.mjs riceve compose(), con elenco dei comandi ammessi, sostituzione di lotto e scadenza, ^CI28 nel blocco 2, mmPolicy, identPolicy e un nuovo controllo sul risultato.

bridge/core/printer.mjs:
- offer() sincrona con un Set in memoria;
- coda in memoria, un lavoro alla volta;
- segni label:<jobId> in ponte_state;
- controlli notAfter e maxAgeMs;
- in anteprima scrive data/etichette-prova/<sessionId>.zpl;
- stop() e dispose() prima di store.close().

Il codice di invio non esiste ancora.

Gancio in #sync dopo la riga 188, dentro try/catch e senza await. Il blocco printer va in #transmit, in stato.json e in status.mjs.

config.mjs: sezione printer facoltativa {mode (spenta se manca), templatesDir, queue con un pattern che accetta gli spazi, timeoutMs, maxAgeMs, mmPolicy, identPolicy}. Resta fuori da PLANT_REQUIRED e missingPlantFields, e schemaVersion resta 1.

In simulazione la modalità è al massimo anteprima. BRIDGE_VERSION passa a 1.4.0.

Pacchetto: FILES e MANIFEST in package-logo.py, ZIP rigenerato. Nuovo scripts/check-package-files.mjs in CI, che verifica che ogni import del ponte sia elencato in FILES, più un test grep contro spawnSync, execSync ed execFileSync.

**File:** `bridge/core/zpl.mjs`, `bridge/core/printer.mjs (nuovo)`, `bridge/core/service.mjs (solo gancio in #sync, #transmit, status, stop/dispose, BRIDGE_VERSION)`, `bridge/core/config.mjs`, `bridge/service.mjs (iniezione del lavoratore, simulazione)`, `bridge/status.mjs`, `bridge/ponte.config.example.json (printer con mode spenta, senza nomi reali)`, `bridge/tests/zpl.test.mjs (nuovo)`, `bridge/tests/printer.test.mjs (nuovo)`, `bridge/tests/service.test.mjs`, `bridge/tests/config.test.mjs`, `scripts/package-logo.py`, `scripts/check-package-files.mjs (nuovo)`, `.github/workflows/ci.yml`, `public/downloads/ponte-logo-preparazione.zip`, `bridge/README.md`, `docs/CONTRATTO-PONTE.md`

**Test:** zpl.test.mjs:
- nessuna uscita contiene ^JU o ~;
- BOM tolto e CRLF mantenuto;
- lotto e scadenza sostituiti, nessun ^FC o ^SLS nell'uscita;
- hash diverso: rifiuto;
- comando sconosciuto, ^CC o ^XG: rifiuto;
- identPolicy 'non-deciso' o mmPolicy assente: composizione ammessa solo in anteprima.

printer.test.mjs e service.test.mjs, con sim-harness e orologio virtuale:
- un compositore bloccato o in timeout lascia identici cartoni, counterStart/End, closedAt e numero di letture PLC (closeWithButton, sim.cycle(1, 600));
- un'eccezione o una promessa rifiutata non causa unhandledRejection;
- con la stessa GET ripetuta 100 volte, anche nel caso «manca PLC» a 250 ms, si compone una sola volta;
- dopo un riavvio non si ricompone;
- un lavoro oltre notAfter viene saltato;
- con label assente (server vecchio) non parte nessun lavoro;
- dispose() durante un lavoro non scrive ad archivio chiuso.

config.test.mjs:
- un ponte.local.json senza printer si comporta come la 1.3.1;
- un nome di coda con spazi è accettato.

CI: il pacchetto contiene tutti gli import e il grep non trova spawnSync.

Comandi: npm run test:bridge, bridge:simulate.

**Compatibilità:** Con la sezione printer assente o mode spenta il comportamento è identico alla 1.3.1. Contro un server vecchio non fa nulla, e il blocco printer del heartbeat viene scartato in silenzio. Non può stampare: il codice di invio non c'è. Si installa sul PC dopo la pubblicazione delle PR4 e PR5.

### PR9 - Ponte 1.4.1: mittente coda Windows RAW e PROVA-ETICHETTA.cmd a linea ferma (dopo le risposte del PC del reparto)

bridge/stampa-raw.ps1:
- Add-Type con winspool.drv: OpenPrinter, StartDocPrinter con datatype RAW (XPS_PASS solo se il driver è v4), WritePrinter, EndDocPrinter;
- legge il file con ReadAllBytes e ricalcola lo SHA sui byte inviati;
- -Azione Invia oppure Stato.

Mittente coda-windows in printer.mjs:
- execFile asincrono, timeout, kill e nessun nuovo tentativo;
- l'esito massimo è inviata-alla-coda;
- parte solo con mode automatica, sender coda-windows, mmPolicy e identPolicy impostati espressamente; altrimenti l'esito è configurazione-incompleta.

Lettura asincrona dello stato della coda ogni 60 s.

bridge/PROVA-ETICHETTA.cmd e prova-etichetta.mjs, strumento per la fase E4:
- invia una sola etichetta di un modello scelto, con un lotto PROVA;
- chiede una conferma digitata;
- rifiuta di partire mentre il servizio sta seguendo una lavorazione.

Il mittente tcp (node:net, porta 9100, indirizzo solo in ponte.local.json) si aggiunge solo se le risposte del PC lo rendono necessario.

**File:** `bridge/stampa-raw.ps1 (nuovo)`, `bridge/core/printer.mjs`, `bridge/core/config.mjs`, `bridge/PROVA-ETICHETTA.cmd (nuovo)`, `bridge/prova-etichetta.mjs (nuovo)`, `bridge/tests/printer-senders.test.mjs (nuovo, execFile finto)`, `scripts/package-logo.py`, `public/downloads/ponte-logo-preparazione.zip`, `bridge/README.md`, `docs/COLLAUDO.md (procedura E4/E5)`, `docs/FOGLIO-COLLAUDO-LINEA.md`

**Test:** Con execFile finto:
- un processo che non termina viene ucciso al timeout, con verifica del kill e senza processi residui;
- codice di uscita diverso da 0: esito errore;
- timeout dopo l'avvio: esito incerta, senza nuovo tentativo;
- dopo un riavvio con segno in-invio: esito incerta, senza ristampa;
- con mmPolicy o identPolicy mancanti il mittente reale non parte;
- in simulazione il mittente reale non si può selezionare;
- un processo figlio bloccato non cambia la durata di cycle() né i cartoni;
- il test grep contro le chiamate sincrone resta verde.

Sul PC, prima della fase E4, confronto byte per byte tra l'anteprima e «Stampa su file» di ZebraDesigner.

Comandi: npm run test:bridge, bridge:simulate, pacchetto rigenerato.

**Compatibilità:** Resta inerte finché in ponte.local.json non ci sono mode automatica, sender coda-windows e le due politiche. Lato server non cambia nulla. Il codice si può unire con la CI verde; l'uso sul PC avviene solo dopo le risposte del reparto e la decisione sull'IDENT.

### PR10 - Accensione della stampa automatica in Configurazione e documenti E5

In ProductionSettings arriva l'interruttore «Stampa automatica delle etichette»:
- spento per impostazione predefinita;
- testo d'aiuto: «accendere solo dopo la prova E5; vale per le lavorazioni avviate dopo l'accensione e solo con un ponte 1.4.1 configurato»;
- avviso se il ponte collegato ha una versione inferiore.

Nella Linea, quando l'avvio prevede la stampa, compare la dicitura «Etichetta di questa lavorazione non ancora inviata: l'applicatore può ripetere quella precedente» finché l'esito non diventa inviata-alla-coda.

Documenti: esiti E3, E4 ed E5 in docs/COLLAUDO.md e nel foglio di collaudo; aggiornamento di STATO.md e AGENTS.md.

L'accensione vera è un'azione dell'amministrazione, non un cambio di codice.

**File:** `components/production-settings.tsx`, `components/line-app.tsx`, `tests/ui/smoke.mjs`, `tests/ui/linea.mjs`, `tests/api.test.ts`, `docs/COLLAUDO.md`, `docs/FOGLIO-COLLAUDO-LINEA.md`, `AGENTS.md`, `STATO.md`

**Test:** In smoke.mjs:
- interruttore spento di default;
- salvataggio e ricarica;
- il percorso 138-140 resta verde;
- tipografia e pulsanti a norma, anche in modalità prova, dove l'interruttore resta sempre spento.

In linea.mjs:
- la dicitura «non ancora inviata» compare con job senza esito;
- con lastJob inviata-alla-coda compare «inviata alla coda», mai «stampata».

In api.test.ts: con l'interruttore acceso il job compare solo per le lavorazioni avviate dopo l'accensione.

Comandi: npm test, check, build, test UI.

**Compatibilità:** Con l'interruttore spento non ci sono effetti. Il ponte 1.3.1 ignora il job e il riquadro dice «non disponibile». Si unisce con la CI verde, ma l'interruttore si accende solo dopo che i criteri E5 sono stati registrati.

### PR11 - Pulizia: rimozione dell'OCR e delle dipendenze della fotocamera della Linea

Si tolgono lib/label-reader.ts, components/label-camera.tsx, scripts/copy-ocr-assets.mjs con il richiamo in scripts/run-framework.mjs, e le dipendenze tesseract.js e @zxing/library, con aggiornamento del lockfile. Restano lib/label-parse.ts e i suoi test. La CameraScan del gestionale non cambia.

**File:** `lib/label-reader.ts (rimosso)`, `components/label-camera.tsx (rimosso)`, `scripts/copy-ocr-assets.mjs (rimosso)`, `scripts/run-framework.mjs`, `package.json`, `package-lock.json`, `STATO.md`

**Test:** npm ci da un clone pulito con Node 22.13, npm test, npm run check, npm run build, test UI della Linea e di smoke. Un grep conferma che non restano riferimenti a /ocr, label-reader o label-camera.

**Compatibilità:** Nessun effetto funzionale e nessuno sul ponte. È separata perché cambia il lockfile. Si unisce dopo la PR6.

### PR-C1 (condizionale) - Regola IDENT. dopo la decisione di Teo

Si fissa identPolicy secondo la decisione di Teo.
- Con 'togli': la riga IDENT. viene tolta in composizione, oppure i .nlbl vengono risalvati senza IDENT. e il catalogo reimportato. Va verificata l'impaginazione nel confronto della fase E3.
- Con 'mantieni': resta il valore fisso del modello, mai chiesto né salvato dal gestionale.

Si aggiornano la regola del 17/11/2026 in AGENTS.md e lo stato ammesso dei modelli nel catalogo. label-parse.ts non cambia, salvo una nuova richiesta.

**File:** `bridge/core/zpl.mjs`, `bridge/tests/zpl.test.mjs`, `bridge/catalogo-etichette.mjs`, `AGENTS.md`, `docs/ETICHETTE-ZPL.md`, `STATO.md`

**Test:** Test di compose() con la politica scelta. Con 'togli': nessun 'IDENT.' nell'uscita e posizioni degli altri campi invariate. tests/label-parse.test.ts:35 resta verde. Comandi: test:bridge, npm test.

**Compatibilità:** Senza questa PR identPolicy resta 'non-deciso' e il mittente reale non parte. Si unisce solo dopo la decisione scritta e datata di Teo.

### PR-C2 (condizionale) - Pulsante «Stampa etichetta» o ristampa, solo se Teo lo chiede

Azione di una persona production.labelReprint {sessionId, reason, operator}. Scrive un nuovo job {id: sessionId + ':' + n, kind: 'ristampa', requestedAt, notAfter, by} nella lavorazione attiva, con una riga di storico.
- È ammessa solo con la stampa accesa e una lavorazione da contapezzi attiva.
- È riservata all'amministrazione, oppure anche al laboratorio se Teo lo decide.

Il pulsante sta nel riquadro Etichettatrice, con conferma e doppio invio disabilitato, ed è disattivato con un ponte di versione inferiore a 1.4.1.

Il dispositivo non riceve nuovi poteri: vede il job alla GET successiva.

**File:** `lib/domain.ts`, `lib/permissions.ts`, `app/api/devices/production/route.ts`, `components/line-app.tsx`, `tests/production-label.test.ts`, `tests/api.test.ts`, `bridge/tests/printer.test.mjs`, `tests/ui/linea.mjs`, `AGENTS.md`

**Test:** Rifiutata senza motivo, senza lavorazione attiva, con una lavorazione manuale o con la stampa spenta. Lo stesso requestId produce un solo job. Il ponte invia una volta per ogni jobId. In modalità prova non ci sono chiamate al server. Comandi: npm test, test:bridge, test UI.

**Compatibilità:** Il ponte 1.3.1 ignora il job. Per AGENTS.md si aggiunge solo se Teo conferma l'esigenza; fino ad allora la prova manuale usa PROVA-ETICHETTA.cmd.

## Regole di AGENTS.md da approvare

- Proposta da approvare e datare da Teo. Lotto e scadenza: il lotto è la data di produzione AAMMGG. Solo se all'avvio lo si sceglie espressamente («continua il lotto di ieri»), il lotto è invece quello della lavorazione chiusa dello stesso articolo [del giorno di calendario precedente / dell'ultimo giorno di produzione, secondo la decisione], con la sua scadenza originale. Il server ricava questi dati da sé con continueFrom e non li ricalcola. Lo stesso lotto con una scadenza diversa viene sempre rifiutato, anche con il carico spento.
- Proposta da approvare da Teo. Ponte: la frase «il dispositivo può soltanto leggere la lavorazione attiva della sua linea e chiuderla una volta» si completa con questa: «Nella lettura riceve i dati dell'etichetta congelati all'avvio (riferimento al modello, SHA-256, lotto, scadenza come testo) e riferisce lo stato dell'etichettatrice solo come ultimo stato noto nel heartbeat, fuori dallo stato operativo. Non ci sono nuovi tipi di POST né nuove scritture del dispositivo.» Riferimento: docs/CONTRATTO-PONTE.md versione 1.1.
- Proposta da approvare da Teo. Stampa automatica: è spenta per impostazione predefinita. Settings.labelPrint vale 'automatica' solo se impostato espressamente, con polarità opposta ad autoLoad. È riservata all'amministrazione e viene congelata nella lavorazione all'avvio, quindi non stampa mai a posteriori. Serve anche la seconda chiave printer.mode nel ponte. Si accende solo dopo che i criteri E3, E4 ed E5 sono stati registrati nel foglio di collaudo. In modalità prova resta sempre spenta.
- Proposta da approvare da Teo. Composizione ZPL: i modelli restano sul PC del reparto, fuori da Git, dal pacchetto, da D1 e dallo stato. Il blocco delle impostazioni (^JUS) non si invia mai. Ogni testo inviato passa dall'elenco dei comandi ammessi, prima e dopo la composizione. Sono vietati i comandi ~, ^JU, ^JJ, ^KP, i comandi di rete, i cambi di prefisso ^CC/^CT/^CD e gli oggetti salvati nella stampante. Si sostituiscono soltanto il campo lotto (^FD\d{6}^FS) e la scadenza, che diventa testo fisso uguale a session.expiry; non si usa più il calcolo con l'orologio della Zebra. Un modello ambiguo viene rifiutato.
- Proposta da approvare da Teo. ^MM: il gestionale e il ponte non scelgono una modalità di stampa. Il mittente reale parte solo con una politica mmPolicy impostata espressamente dopo la lettura di ~HS prima e dopo, a linea ferma (fase E4).
- Decisione richiesta a Teo. IDENT.: la regola del 17/11/2026 va aggiornata in uno di questi modi: (a) la riga si toglie dal modello o in composizione; (b) resta come valore fisso del modello, stampato ma mai chiesto né salvato. Finché la decisione non c'è, identPolicy vale 'non-deciso' e l'etichetta si può comporre solo in anteprima, senza invio.
- Proposta da approvare da Teo. Esito della stampa: «inviata alla coda di Windows» non equivale a «stampata». Un esito incerto non si ritenta in automatico. Una ristampa è solo esplicita e crea un nuovo jobId. Un problema dell'etichettatrice non ferma la produzione e non rallenta il conteggio.
- Proposta da approvare da Teo. Ponte e conteggio: la stampa è un modulo separato che il ciclo non attende mai (niente await, spawnSync, execSync o execFileSync). Ogni processo esterno ha un timeout con kill. counter.mjs, #processCounter, #handleClose e il calcolo dei cartoni non si toccano per la stampa. In simulazione la stampa reale è disattivata.
- Proposta da approvare da Teo. Pagina Linea: la lettura dell'etichetta con fotocamera o foto è tolta. L'articolo si sceglie dal pannello delle etichette a cartelle, da un file .nlbl riconosciuto con SHA-256 (il file resta sul dispositivo) oppure con il codice o l'EAN. La fotocamera della finestra di avvio del gestionale resta.
- Proposta da approvare da Teo. Dati: il catalogo delle etichette (nomi di cartelle e file, hash, stato) è un dato operativo privato. Sta nello stato in D1, importato dall'amministrazione, ed è incluso nel backup. Non va mai in Git né nei test, dove si usano solo modelli PROVA sintetici. La coda e la cartella dei modelli si configurano solo in ponte.local.json.
- Proposta da approvare da Teo. Pacchetto del ponte: ogni file nuovo va aggiunto a FILES in scripts/package-logo.py, e la CI controlla che ogni import del ponte sia nel pacchetto.
- Da aggiornare insieme alla PR5: docs/REQUISITI.md:60, dove oggi c'è «Nessuna connessione operativa a ... etichettatrice», con il perimetro effettivo: solo la stampa dell'etichetta della lavorazione da contapezzi, spenta per impostazione predefinita.

## Rischi

- Il rischio principale è un'etichetta sbagliata applicata ai cartoni veri. Con l'applicatore in «Stampa 1, poi ripete» (^MMA oppure ristampa ^JJ abilitata, da verificare), l'applicatore continua a mettere l'ultima etichetta ricevuta, quella del prodotto precedente o di una prova, se la nuova arriva in ritardo, fallisce o non parte. Succede con il ponte 1.3.1, con la stampa spenta, con un modello bloccato o con un esito incerto, ed è peggio di un cartone senza etichetta. Le mitigazioni sono la dicitura sulla Linea, la prova a linea ferma che si chiude rimandando l'etichetta giusta e una regola operativa da decidere con Teo.
- Ritardo: il ponte vede la lavorazione solo alla GET successiva, cioè entro syncMs (circa 10 s), a cui si aggiungono la compilazione Add-Type (0,5-2 s) e lo spool. Ridurre syncMs aumenta le letture di readState, fino a 2 MB a ogni GET.
- ^MM e altri parametri persistenti (^PR, ^PO) nel blocco 2 potrebbero cambiare la modalità dell'applicatore fino allo spegnimento; ^JUS li renderebbe permanenti. È un'ipotesi da verificare: ZebraDesigner potrebbe già inviare oggi ^JUS e ^MMT a ogni stampa. Senza la lettura di ~HS prima e dopo, ogni scelta è una supposizione.
- IDENT.: il blocco 2 dei modelli contiene già il valore fisso, quindi inviarlo così com'è vorrebbe dire stamparlo, contro AGENTS.md. Togliere la riga può alterare l'impaginazione.
- «Etichetta ricevuta» non è verificabile con la sola coda Windows, che conferma solo l'accodamento. ~HS richiede la porta 9100 o un canale bidirezionale non verificato, e la Zebra non risponde quando è in errore (testina aperta, carta finita). Lo stato Get-Printer con ZDesigner Port Monitor potrebbe risultare «Normale» anche a stampante spenta.
- Conteggio: un await, una chiamata sincrona o una promessa rifiutata senza catch nel ponte fermano il conteggio, perché in Node 22 un unhandledRejection termina il processo. Un PowerShell senza kill accumula processi. Non è verificato se taskkill /F /IM node.exe chiude anche i processi figli.
- Doppioni e stampe tardive: senza il Set in memoria, il segno in ponte_state, notAfter e maxAgeMs, un riavvio o la GET ripetuta ogni 250 ms nel caso «manca PLC» farebbero ristampare. Il prezzo di questa protezione è che, dopo un esito incerto, l'etichetta resta da rimandare a mano.
- Composizione sui file veri: non conosciamo dimensioni, presenza di ^XG/~DG (grafica nella memoria della stampante, che senza il blocco 1 mancherebbe o sarebbe vecchia), numero di campi lotto, forma della scadenza e posizione di ^CI28. Se molti modelli non passano i controlli, vanno risalvati. La PR0 misura questo prima di tutto il resto.
- Scadenza: sostituire ^SLS/^SO/^FC con testo fisso cambia il modello. Se nel modello lo spostamento ^SO2 è diverso da shelfLifeMonths dell'articolo, la data stampata cambia rispetto a quella di oggi.
- Trasporto non verificato sul PC del reparto:
- driver v3 o v4 (RAW o XPS_PASS);
- coda visibile all'utente dell'attività pianificata (Interactive, Limited);
- Add-Type bloccato da antivirus, AppLocker o modalità di linguaggio limitata;
- ZDesigner Port Monitor e un eventuale collegamento TCP che si contendono la stampante.
Restano solo da fonti web non verificate: media.printmode, porta 9100 chiusa per default sulle unità UE recenti, schema Add-Type con winspool per ZPL.
- Unione automatica (regola 7 di AGENTS.md): una PR con decisioni aperte finirebbe in main appena la CI è verde. Per questo PR5, PR7, PR-C1 e PR-C2 restano in bozza fino al sì di Teo, e la PR6 fino all'importazione del catalogo reale.
- Polarità: labelPrint è acceso solo se vale 'automatica', mentre autoLoad è acceso se assente. Una lettura con !== false o !== undefined accenderebbe la stampa per errore. Servono test di regressione.
- Ordine di pubblicazione: senza le PR4 e PR5 pubblicate su Cloudflare, un ponte 1.4 non ha label e il riquadro resta vuoto. Non c'è danno, ma l'ordine va rispettato.
- Pacchetto: la lista FILES in package-logo.py è scritta a mano. Prima della PR8 la CI non la controlla, quindi un file dimenticato impedisce l'avvio del ponte sul PC.
- liveStatus e printerStatus leggono l'ultimo dispositivo che ha comunicato (LIMIT 1). Con più ponti attivi, fino a 3, lo stato della stampante potrebbe arrivare da un PC diverso da quello collegato alla Zebra.
- Le lavorazioni avviate a mano (source 'manual') non arrivano al ponte e quindi restano senza etichetta automatica. In più 36 prodotti su 65 hanno un modello con avviso, bloccato o mancante.
- Togliere la fotocamera dalla Linea elimina anche la creazione e l'aggiornamento della scheda prodotto da una foto (NewProduct) e obbliga a riscrivere parte di tests/ui/linea.mjs.
- Il catalogo nello stato aggiunge circa 30-50 kB letti a ogni GET e inclusi nel backup. I nomi delle cartelle potrebbero contenere nomi di clienti: vanno bene in D1, mai in Git, nei test o nel pacchetto.

## DOMANDE PER IL PC REPARTO

**Risposte arrivate il 28/11: vedi «Risposte del PC del reparto».** Restano aperte solo le letture a Zebra accesa (`~HI`, `^HH`, `~HS`, orologio) e la prova di `taskkill` dopo la PR9.

Riportare solo ciò che serve, **senza** indirizzi IP, MAC, password o token.

- Eseguire node verifica-modelli.mjs sulla cartella ZPL-etichette (PR0) e riportare solo i conteggi:
- dimensione minima, massima e totale dei file;
- quanti hanno ^GFA, ^XG, ^IM o ~DG;
- quanti hanno esattamente un campo ^FD\d{6}^FS;
- quanti hanno il costrutto ^SLS/^SO2/^FC e con quale spostamento in mesi;
- quanti hanno la riga IDENT.;
- quanti hanno ^MM e con quale valore;
- se ^CI28 sta nel blocco 1 o nel blocco 2;
- se nei testi fissi ci sono lettere accentate.
- Output di `Get-Printer -Name 'TERMICO DIRETTO' | fl Name,DriverName,PortName,PrintProcessor,Datatype,PrinterStatus` e di `Get-PrinterDriver | fl Name,MajorVersion`. Il driver è v3 o v4? Il datatype è RAW? Prima di riportarlo, togliere eventuali indirizzi IP dal nome della porta.
- `Get-PrinterPort | fl Name,Description,PortMonitor`, senza riportare l'indirizzo: la Zebra è collegata via USB o in rete? La porta usa ZDesigner Port Monitor?
- La coda «TERMICO DIRETTO» è visibile e scrivibile dall'utente con cui gira l'attività pianificata del ponte (Interactive, Limited)? Provare Get-Printer in quella sessione, senza stampare.
- Risultato di `$ExecutionContext.SessionState.LanguageMode` e di `Get-ExecutionPolicy -List`. Una prova di Add-Type con winspool.drv, senza stampare, funziona o la bloccano antivirus o AppLocker? Quanto tempo richiede?
- Modello e firmware della Zebra. Impostazioni dell'applicatore lette dal pannello senza cambiarle: modalità di stampa, ristampa (^JJ), segnale di fine stampa. Da dove viene «Stampa 1, poi ripete»?
- Com'è stata fatta l'estrazione dei 101 file ZPL dai 132 .nlbl, e si può ripetere uguale quando Teo risalva un .nlbl? Perché i .nlbl sono 132 e gli ZPL 101?
- Schema di elenco-etichette.json e di mappa-prodotti-etichette.json: nomi dei campi, se la mappa usa il codice articolo del gestionale, se indica il file ZPL o solo il .nlbl, e cosa significano esattamente «avviso» e «bloccata».
- I nomi delle cartelle e dei file .nlbl contengono nomi di clienti o dati riservati?
- Valori effettivi di intervals.syncMs e heartbeatMs nel ponte.local.json del reparto, senza copiare altri campi. Quanto tempo passa oggi tra «Avvia lavorazione» e il primo cartone all'applicatore?
- Versione di Node.js sul PC (serve la 22.13 o superiore). La cartella bridge/data è scrivibile dall'utente del ponte (serve per i file di anteprima e di stampa)? L'orologio della Zebra è giusto?
- Quanti ponti risultano attivi tra i dispositivi? È solo quello del reparto a essere collegato alla Zebra?
- Un taskkill /F /IM node.exe, o il riavvio dell'attività pianificata, chiude anche eventuali processi powershell.exe figli del ponte? Da verificare con un processo di prova dopo la PR9.

Già risposto il 28/11: la «Stampa su file» sulla coda vera è identica alla cattura, compreso il blocco con `^JUS` e `^MMT`.

# Guida rapida

## Il gestionale, ogni giorno

1. **Magazzino → Prodotti**: cerca per codice, descrizione o lotto mentre scrivi. «Nuovo prodotto» o «Modifica» dalla scheda. Importa Excel/CSV con anteprima; esporta tutto o solo i risultati filtrati. Importare prodotti non crea giacenze.
2. **Magazzino → Giacenze e lotti**: «Registra entrata» solo per la merce arrivata davvero (lotto, scadenza, ubicazione). Su ogni lotto: Blocco, Sposta, Scarto, Consumo, Rettifica. «Registra reso» mette la merce bloccata finché non la controlli.
3. **Ordini**: in alto le fasi con i numeri (Da preparare, Pronti alla partenza, Consegne parziali, Completati); clic su una fase per vedere solo quegli ordini. Ogni ordine mostra i passaggi (Prenotato → Pronto → Partito → Documento), le righe con richiesto, partito e da consegnare, e il **prossimo passo** con il pulsante giusto: «Segna pronto» → «Registra partenza» con il DDT (se parte meno del previsto scrivi il motivo) → eventuale «Annulla il residuo» → «Collega documento» per la fattura (nessun nuovo scarico). In rosso le consegne in ritardo.
4. **Produzione**: «Nuova lavorazione» → leggi il codice articolo o l'EAN dell'etichetta (o digitalo) → controlla articolo, confezionamento e anteprima dell'etichetta → scrivi l'operatore e l'**impasto (IDENT.)**, obbligatorio → «Conferma e avvia». **Lotto** (data di produzione AAMMGG, es. 261002) e **scadenza** (produzione + durata del prodotto, di norma 12 mesi) si calcolano da soli; si cambiano solo se l'etichetta è diversa. Aggiungi i cartoni contati, poi «Chiudi / salva lavorazione» (eventuali scarti con nota): **i cartoni buoni entrano subito in magazzino** nel lotto della lavorazione, nell'area di carico scelta in Configurazione (finché l'area non è scelta il carico non avviene e la pagina Produzione lo segnala). Lo stesso succede quando sul contapezzi premono il pulsante di fine lavorazione. Se il ponte è fermo e si chiude a mano una lavorazione da fotocellule, si indicano i cartoni contati a mano.
   - **Correggere i cartoni** (solo amministrazione): in «Produzione del giorno» → «Correggi cartoni» → numero da aggiungere o togliere (es. −3), responsabile e **causale obbligatoria**. Il magazzino del lotto segue la correzione. Tutte le correzioni sono nel riquadro «Correzioni dei cartoni» e nello storico (scheda «Correzioni»).
   - **Etichetta**: nella scheda prodotto → «Modifica prodotto» → sezione «Etichetta del cartone» (EAN, pezzi, peso, durata, testi). Produttore e IDENT. comuni sono in Configurazione → «Produzione ed etichette», insieme all'area di carico e al carico automatico.
5. **Storico attività**: le operazioni sono raggruppate per giorno, dalla più recente. Scegli un giorno con il calendario o con le frecce (◀ ▶), oppure «Oggi» o «Tutti i giorni»; filtra per tipo (Produzione, Magazzino, Ordini, Catalogo) e cerca un codice, un lotto o un cliente. Clic sul titolo di un giorno per vedere solo quel giorno.
6. **Configurazione**: backup completo, dispositivi del conta-cartoni, pacchetto per il PC di linea, modalità prova.

### App Linea sull'iPad

Sull'iPad della linea: Safari → indirizzo del gestionale + `/linea` → Condividi → **Aggiungi alla schermata Home**. Dall'icona **Linea** si inquadra l'etichetta con la fotocamera-lettore, che si chiude da sola appena riconosce il codice a barre (oppure si carica una foto), l'app riconosce l'articolo e calcola lotto e scadenza, poi «Avvia produzione», si contano i cartoni con i pulsanti grandi e si chiude caricando il magazzino. Dettagli in `APP-LINEA-IPAD.md`.

### Menu laterale

Il pulsante in alto a sinistra (accanto a «Stabilimento») nasconde o mostra il menu: con il menu nascosto le schermate usano tutta la larghezza. La scelta resta salvata su quel computer. Si apre anche dalla ricerca (Ctrl K → «menu laterale»). Sul telefono il menu si apre con ☰.

### Modalità prova

Serve per vedere come funzionano produzione e storico senza toccare i dati veri. Si attiva dal menu laterale («Modalità prova»), da Configurazione o dalla ricerca (Ctrl K).

- Genera una settimana di esempio: articoli con «PROVA» nel nome, lavorazioni (anche lo stesso prodotto più volte nello stesso giorno), scarti, carichi a magazzino, consumi, ordini e una lavorazione aperta oggi.
- In **Produzione** premi «Avvia contatore simulato»: aggiunge un cartone al secondo, come farebbero le fotocellule, e registra una lettura ogni 10 cartoni. «Chiudi / salva lavorazione» salva la lavorazione e non carica il magazzino, come nel gestionale vero.
- In **Storico attività** e in «Produzione del giorno» trovi tutto, giorno per giorno.
- Le regole sono le stesse del gestionale vero (stessi controlli, stessi messaggi), ma **nulla viene inviato all'archivio**: i dati restano solo in quel browser. La fascia gialla a righe e il cartellino «Prova» ricordano sempre che sei in prova.
- «Ricomincia» rigenera i dati di esempio; «Esci dalla prova» torna all'archivio vero. Una prova lasciata aperta il giorno prima viene rigenerata con le date di oggi.
- In prova dispositivi e backup non sono mostrati: restano quelli dell'archivio vero.

### In alto a destra

- «Salvato alle …»: il server ha confermato.
- «Da verificare»: la risposta non è arrivata. Premi «Verifica sul server»: se era già salvata non devi ripetere nulla. Altrimenti «Ripeti la stessa operazione» (non crea doppioni) o «Scarta».
- «Non riuscito»: il server ha rifiutato; il messaggio dice perché e i dati del modulo restano.

### Una volta a settimana

Configurazione → **Scarica backup completo** e conservalo in un posto riservato. Procedura completa: `BACKUP-RIPRISTINO.md`.

## Il ponte sul PC di linea (quando arrivano i dati del LOGO!)

Oggi il ponte è provato **solo in simulazione**. Per provarlo senza hardware:

1. Installa Node.js 22.13 o successivo sul PC.
2. Configurazione → scarica il pacchetto, estrailo in una cartella (anche con spazi nel nome).
3. Doppio clic su `bridge\AVVIA-SERVIZIO-SIMULAZIONE.cmd`: vedrai due lavorazioni simulate e il conteggio dei cartoni. Niente viene inviato al gestionale.

Per il collegamento vero, insieme al tecnico (dettagli in `bridge/README.md`, sezione «Messa in servizio»):

1. Gestionale → Configurazione → Dispositivi → «Crea credenziale». Il token si vede **una sola volta**: copialo in `bridge\token.local.json` sul PC di linea. Non mandarlo per chat o e-mail e non includere quel file in copie o zip.
2. Copia `bridge\ponte.config.example.json` in `bridge\ponte.local.json` e compila **con il tecnico** IP, registri e tempi del LOGO!. Il servizio non parte se manca un dato.
3. Prova a linea ferma con `bridge\STATO-PONTE.cmd`, poi `bridge\AVVIA-SERVIZIO-IMPIANTO.cmd`.
4. In Produzione avvia una lavorazione scegliendo «Fotocellule»: avvia la linea solo quando compare «ponte agganciato a questa lavorazione».
5. Collaudo: almeno 100 cartoni contati anche a mano, formati e velocità diversi, sosta, arretramento, riavvio di PLC e PC. Registra l'esito in `COLLAUDO.md`.

Il pulsante di chiusura non ferma la macchina e il conteggio non sostituisce le sicurezze della linea.

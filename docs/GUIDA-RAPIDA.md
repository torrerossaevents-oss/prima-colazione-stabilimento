# Guida rapida

## Il gestionale, ogni giorno

1. **Magazzino → Prodotti**: cerca per codice, descrizione o lotto mentre scrivi. «Nuovo prodotto» o «Modifica» dalla scheda. Importa Excel/CSV con anteprima; esporta tutto o solo i risultati filtrati. Importare prodotti non crea giacenze.
2. **Magazzino → Giacenze e lotti**: «Registra entrata» solo per la merce arrivata davvero (lotto, scadenza, ubicazione). Su ogni lotto: Blocco, Sposta, Scarto, Consumo, Rettifica. «Registra reso» mette la merce bloccata finché non la controlli.
3. **Ordini**: «Nuovo ordine» prenota la merce (il fisico non cambia) → «Segna pronto» → «Registra partenza» con il DDT (se parte meno del previsto scrivi il motivo) → eventuale «Annulla residuo» → «Collega documento» per la fattura (nessun nuovo scarico).
4. **Produzione**: «Nuova lavorazione» → leggi il codice con il lettore (o digitalo) → controlla articolo e confezionamento → operatore, lotto, scadenza → «Conferma e avvia». Aggiungi i cartoni contati, poi «Chiudi / salva lavorazione» (eventuali scarti con nota). Il riepilogo giornaliero è sotto, esportabile in CSV. Il magazzino non viene caricato automaticamente.
5. **Storico attività**: cerca qualunque operazione.
6. **Configurazione**: backup completo, dispositivi del conta-cartoni, pacchetto per il PC di linea.

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

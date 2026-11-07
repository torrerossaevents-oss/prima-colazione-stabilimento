# Verifica della prima versione

Questo documento descrive le prove richieste. Una riga non costituisce un esito positivo: l'esito va registrato dopo l'esecuzione sulla versione effettivamente consegnata. Il collaudo del sito e quello dell'impianto sono distinti.

## Controlli software

```sh
npm test
npm run check
npm run build
```

Usare dati fittizi in un database locale dedicato. Non popolare il database operativo con esempi per rendere la schermata più piena. I test del dominio devono esercitare regole e casi limite, non soltanto ripetere il codice dell'interfaccia.

L'inizializzazione locale con `npm run setup` è stata verificata con compilazione e applicazione delle migrazioni `0000_thankful_microchip.sql` e `0001_omniscient_spirit.sql` nell'anteprima di sviluppo. Questo esito riguarda l'ambiente locale, non il database pubblicato né l'impianto.

| Prova | Risultato atteso |
| --- | --- |
| Codice articolo già presente | Rifiuto comprensibile, nessun doppione |
| Quantità negativa, vuota o non valida | Nessuna modifica salvata |
| Presenti 150, bloccati 2, ordine 30 | Presenti 150, prenotati 30, disponibili 118 |
| Preparazione dell'ordine | Fisico invariato |
| Partenza di 20 su 30 | Presenti 130, residuo 10, disponibili 118 |
| Annullamento del residuo 10 | Presenti 130, prenotati 0, disponibili 128 |
| Associazione fattura della partenza | Nessuna variazione di giacenza |
| Prenotazione oltre il disponibile | Rifiuto, anche dopo modifiche concorrenti |
| Prenotazione di lotto scaduto o bloccato | Rifiuto |
| Trasferimento fra aree | Totale stabilimento invariato |
| Rettifica sotto prenotato + bloccato | Rifiuto |
| Rettifica senza motivo/responsabile | Rifiuto |
| Codice produzione sconosciuto | Avvio impedito |
| Avvio con una lavorazione già attiva | Nessuna seconda sessione |
| Articolo A 200, chiusura; B 150, chiusura | Due sessioni distinte, totale 350, B ripartito da zero |
| Chiusura di una lavorazione | Storico conservato, nessun carico automatico a magazzino |
| Ripetizione dello stesso identificativo richiesta | Nessun movimento duplicato |
| Due modifiche dalla stessa versione | Una riesce; l'altra riceve un conflitto e deve ricaricare |
| Reinvio di una vecchia richiesta già riuscita | La ricevuta persistente impedisce il doppione anche dopo altre operazioni |
| Superamento del limite di archivio di 2 MB | Salvataggio rifiutato con messaggio, nessuna perdita dello stato precedente |
| Modifica confezionamento dopo una lavorazione | Storico conserva il confezionamento originale |
| Avvio prima e chiusura dopo mezzanotte | Giorno della lavorazione ricavato dall'avvio in Europe/Rome |

## Prove nell'interfaccia

- Aprire la panoramica con archivio vuoto: nessun dato fittizio, indicazioni pratiche per iniziare.
- Creare articolo e lotto; ritrovarli con ricerca e filtri, quindi aggiornare la pagina.
- Eseguire prenotazione, preparazione, partenza parziale e annullamento residuo controllando i saldi.
- Eseguire due lavorazioni con articoli diversi e verificare chiusura, nuovo parziale e storico.
- Interrompere la connessione durante un invio: nessuna falsa conferma, dati del modulo mantenuti.
- Provare tastiera, dimensioni tablet e schermo piccolo; controllare etichette, focus e leggibilità.
- Verificare esportazioni e unità: le quantità devono poter essere interpretate senza indovinare il confezionamento.
- Provare un browser senza supporto alla lettura da fotocamera: l'inserimento del codice resta utilizzabile.
- Verificare che una richiesta non autenticata non acceda all'API pubblicata e che il database rimanga riservato.

## Prima dell'uso operativo

Concordare catalogo, unità, confezionamenti, nomi delle aree e inventario iniziale reale. Verificare le procedure di correzione e le responsabilità effettive. Per aggiungere operatori, implementare e provare accessi/ruoli distinti prima di dichiararli disponibili.

## Collaudo hardware separato

Resta da eseguire con tecnico e linea reale: sequenza fotocellule, velocità massima, distanza cartoni, soste, arretramenti, sensori occupati durante chiusura, disconnessione LAN/Internet, riavvio PLC/PC, salvataggio locale incerto, recupero della coda, contatore cumulativo e doppie pressioni.

Il superamento dei test software non abilita il carico automatico di magazzino. L'attivazione richiede un collaudo positivo e documentato dell'intero flusso.

## Verifica della consegna iniziale — 7 novembre 2026

- `npm test`: 19 prove superate, incluse concorrenza, autenticazione API, controllo origine, rollback atomico e deduplica dopo 205 altre operazioni.
- `npm run check`: TypeScript senza errori.
- Compilazione e inizializzazione locale: riuscite; entrambe le migrazioni applicate.
- Browser desktop, archivio locale di prova: creato articolo, caricate 150 confezioni, prenotate 30. Verificati 150 presenti / 30 prenotati / 120 disponibili.
- Browser desktop: avviata lavorazione da codice noto, aggiunti 200 cartoni, chiusa e salvata. Dopo ricarica, postazione libera e lavorazione conservata nello storico con 200 cartoni / 2.400 unità.
- Dati di collaudo soltanto nell'archivio locale ignorato da Git. L'archivio pubblicato parte vuoto.
- Fotocamera su dispositivo reale, smartphone/tablet fisici, hardware e collegamenti esterni non collaudati. La fotocamera dipende dal supporto `BarcodeDetector`; è disponibile l'inserimento con lettore o tastiera.
- Browser desktop: partenza parziale di 20 su 30 prenotati, con riferimento DDT. Risultato verificato: 130 presenti, 10 prenotati, 120 disponibili.
- Il browser conserva la richiesta in attesa in sessionStorage, con versione originale e ID, fino all'esito; un'altra operazione non può sostituirla. Dopo ricarica propone il recupero della stessa richiesta. sessionStorage è soltanto un registro temporaneo di recupero; i dati autorevoli sono nel database.

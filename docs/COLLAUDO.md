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

## Verifica del 13 novembre 2026 — branch `claude/ottimizzazione-stabilimento-20261113`

Ambiente: container Linux 6.18, Node 22.23.4 e Node 22.13.0 (minimo dichiarato), npm 10.9.9, Chromium headless di Playwright. Solo dati fittizi in database di prova. Commit esatti nella PR.

| Controllo | Esito |
| --- | --- |
| `npm test` (dominio, catalogo, API su SQLite **e** runtime D1 locale Miniflare, ponte ↔ API) | 91/91 superati (anche con Node 22.13.0); prima 42/42 |
| `npm run check` | nessun errore |
| `npm run build` | riuscita |
| `npm run test:bridge` | 63/63 superati (anche con Node 22.13.0); prima 18/18 |
| `npm run bridge:simulate` | «SIMULAZIONE SUPERATA: 12 verifiche», A 200 + B 150 = 350 |
| Pacchetto ponte estratto in una cartella con spazi nel percorso | 61/61 test e simulazione superati |
| `npm run setup` (migrazioni 0000–0002 su D1 locale) | riuscito |
| `npm run lint` | 3 errori residui (prima 10), tutti in effetti React preesistenti; non bloccante, escluso dalla CI |
| `tests/ui/smoke.mjs` nel browser, archivio locale vuoto | superato (13 passaggi, dettaglio sotto) |
| GitHub Actions sulla PR | verde (Node 22.13.0) |
| Revisioni indipendenti di correttezza e sicurezza | eseguite; rilievi e correzioni in `STATO.md` |
| Backup scaricato dall'anteprima → `scripts/verify-backup.ts` | «RIPRISTINO VERIFICATO»; file alterato rifiutato |
| `.cmd` su Windows | **non eseguiti** (nessun Windows disponibile) |
| Impianto, LOGO!, fotocamera su dispositivi reali, stampanti | **non eseguiti** |

Scenari dell'incarico coperti da test automatici: 1 (00123 export/reimport, prezzi vuoti ≠ 0, nessuna giacenza), 2 (ricerca per lotto; codice sconosciuto e non finito con messaggi distinti), 3 (import atomico, duplicati nel file e nel catalogo), 4 (150/2/30 → 118; partenza 20 → 130 e residuo 10; annullamento → 128; fattura senza scarico; anche nel browser), 5 (scaduti/bloccati, sopra disponibile, trasferimenti, rettifiche, anche via API), 6 (due client dalla stessa versione, doppio clic, risposta persa dopo commit, vecchia richiesta dopo 205 operazioni), 7 (A 200 + B 150, riepilogo 350, codice sconosciuto, seconda sessione), 8 (mezzanotte e cambio ora Europe/Rome), 9 (ponte: in simulazione e con test), 13 (telefono 390 px, tablet 820 px, desktop 1.440 px; fotocamera non supportata; dati del modulo conservati dopo errore di validazione e di rete), 14 (stato oltre 2 MB rifiutato senza modifiche; migrazione di 3.000 voci storiche; backup → ripristino → stessa impronta; misure in `ARCHITETTURA-ARCHIVIO.md`), 15 (clone nuovo: `npm ci`, `setup`, test, build). Non eseguibili qui: 10 (hardware), 11 (carico automatico non abilitato), 12 (etichette non implementate).

Percorso nel browser (`tests/ui/smoke.mjs`): creazione 00123 e ricerca progressiva per codice e descrizione; entrata 150 e blocco 2; ordine 30, pronto, partenza parziale rifiutata senza motivo con dati del modulo conservati, poi accettata con motivo; annullamento del residuo e fattura successiva → presenti 130, disponibili 128; rete interrotta durante una rettifica → «Da verificare», modulo conservato, ripetizione con lo stesso identificativo salvata una volta; risposta 200 in HTML (accesso scaduto) → mai «Salvato», poi «Scarta» annulla l’identificativo sul server; risposta persa dopo il salvataggio → dopo ricarica la ricevuta del server conferma «già salvata», nessun doppione; scarto dalla merce bloccata; fotocamera non supportata con messaggio e inserimento da tastiera disponibile; lavorazione 200 cartoni chiusa con riepilogo giornaliero e nessun carico di magazzino; ricerca nello storico; Configurazione con backup e dispositivi; su tre larghezze nessuno scorrimento orizzontale della pagina, tutti i testi su superfici chiare in `#000` peso 400 (bianco 400 sulle superfici scure), nessun pulsante sotto 34 px.

Limiti di questa verifica: il ponte è provato contro simulatori e contro le API in un processo locale, non attraverso l'accesso della piattaforma pubblicata; i tempi sono misurati in Node, non nel Worker ospitato; la pubblicazione Sites non è stata eseguita.

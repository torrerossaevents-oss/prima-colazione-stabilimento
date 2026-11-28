# Istruzioni di progetto

Questo repository contiene esclusivamente il gestionale **Prima Colazione · Stabilimento**. Mantenere il progetto autonomo e semplice da aprire in altre app di sviluppo. Non mescolare codice, dati o configurazioni di altri gestionali.

## Perimetro

Le priorità sono magazzino, produzione e ordini. Aggiungere funzioni soltanto in risposta a esigenze confermate. Non introdurre moduli eventi, marginalità, emissione fatture o automatismi presentati come operativi senza una richiesta e una verifica concrete.

Leggere `docs/REQUISITI.md` prima di cambiare le regole di dominio. I documenti correnti distinguono la partenza fisica dalla fatturazione: una fattura associata dopo una consegna non scarica nuovamente la merce.

## Regole non negoziabili

- Il fisico cambia alla ricezione, alla partenza e ai movimenti espliciti; prenotazione e preparazione non sono scarichi.
- Non prenotare merce bloccata, scaduta o già impegnata. Non rendere negativi i saldi.
- Un annullamento libera solo il residuo non partito. Conservare la parte già spedita e la sua storia.
- Una rettifica richiede motivo e responsabile; non sostituire silenziosamente un saldo.
- La chiusura di produzione salva la lavorazione. Il nuovo parziale riparte da zero; lo storico e il totale precedente rimangono.
- Nessuna lavorazione con codice sconosciuto, nessuna seconda sessione attiva sulla stessa linea.
- Conservare nella lavorazione il confezionamento usato all'avvio, anche se il catalogo cambia in seguito.
- Carico della produzione (decisione di Teo del 14/11/2026): alla chiusura di una lavorazione, manuale o dal pulsante del contapezzi, i cartoni buoni (letti − scarti) entrano in magazzino nel lotto della lavorazione, nell'area di produzione scelta, con un movimento esplicito `produce` nello stesso evento. Il carico si può disattivare in Configurazione. Le correzioni dei cartoni (`production.adjust`) sono solo dell'amministrazione, con causale e responsabile obbligatori, restano nella lavorazione e nello storico e correggono anche il lotto (`production-adjust`); non si può togliere merce prenotata, bloccata o partita. Il conteggio delle fotocellule resta da collaudare sulla linea prima di fidarsene.
- Lotto e scadenza (etichetta reale del 14/11/2026): lotto = data di produzione AAMMGG, scadenza = produzione + durata del prodotto (12 mesi se non indicata); un valore diverso si indica solo espressamente all'avvio. Continua il lotto (decisione di Teo del 28/11/2026): all'avvio si può scegliere di continuare il lotto dell'ultimo giorno in cui quel prodotto è stato fatto, al massimo 7 giorni prima, con la sua scadenza; nello stesso giorno, per lo stesso prodotto, c'è un solo lotto. Il lotto scritto a mano (decisione di Teo del 27/11/2026) deve essere una data di produzione vera di 6 cifre AAMMGG, controllata anche dal server in `production.start`; se è diversa da oggi la finestra di avvio chiede conferma. Il lettore riconosce il codice articolo o l'EAN. La durata è 12 mesi per tutti salvo diversa indicazione nella scheda. IDENT. (identificativo dell'impasto, decisione di Teo del 28/11/2026 che sostituisce quella del 17/11): l'operatore lo scrive all'avvio della lavorazione; è salvato nella lavorazione e stampato sull'etichetta. Durante la lavorazione si può cambiare in qualsiasi momento senza fermare niente e senza avviare o chiudere: il cambio resta nella lavorazione e nello storico e, con la stampa delle etichette accesa, l'etichetta aggiornata parte subito verso la stampante. La lettura della foto dell'etichetta continua a ignorare l'IDENT. stampato.
- Ordini (decisione di Teo del 16/11/2026): si indicano prodotto e quantità; i lotti si assegnano in automatico in ordine di scadenza (FEFO), anche su più lotti, escludendo merce scaduta, bloccata o prenotata, e l'assegnazione resta scritta nell'ordine e nello storico. Con un ponte attivo la lavorazione parte con il conteggio del contapezzi e si chiude dal pulsante della linea, con carico automatico: di manuale resta solo l'avvio.
- Il ponte usa solo credenziali di dispositivo (`docs/CONTRATTO-PONTE.md`); il dispositivo può soltanto leggere la lavorazione attiva della sua linea e chiuderla una volta.
- Etichette Zebra (decisioni di Teo del 28/11/2026, piano in `docs/ETICHETTE-ZEBRA.md`): nella lettura della lavorazione attiva il ponte riceve anche i dati dell'etichetta fissati dal gestionale (modello, lotto, scadenza, IDENT.) e nel segnale di stato dice se la stampante risponde; non può avviare né modificare lavorazioni. I modelli ZPL restano solo sul PC del reparto: mai in Git, nei test, nel pacchetto o in D1 come testo. Il blocco delle impostazioni con `^JUS` non si invia mai. La stampa automatica è spenta per impostazione predefinita e si accende in Configurazione solo dopo la prova finale a linea ferma. Un problema della stampante non deve mai fermare o rallentare il conteggio. I nomi di distributori e clienti nei nomi delle etichette restano nello stato privato e nel backup, mai in Git o nei test. Per questo lavoro Teo ha autorizzato a unire e pubblicare dopo la revisione, senza chiedere ogni volta.
- Un errore o una risposta incerta non equivalgono a un salvataggio riuscito. Evitare i doppioni con identificativi stabili.

## Metodo di lavoro

1. Controllare `git status` e leggere i file interessati. Non sovrascrivere modifiche altrui.
2. Aggiornare la logica condivisa in `lib/domain.ts`; non affidare i vincoli alla sola interfaccia.
3. Preservare controllo della versione, deduplicazione e controllo di accesso dell'API.
4. Aggiungere o modificare test mirati per cambiamenti ai conteggi e ai passaggi di stato.
5. Eseguire i test pertinenti e la compilazione; verificare nell'interfaccia il percorso interessato.
6. Aggiornare documentazione e limiti effettivi. Salvare il lavoro nello stesso repository, con commit comprensibili; nessun force push non richiesto.
7. Per decisione di Teo (14/11/2026): dopo ogni modifica verificata, cioè test, controlli e build superati e CI verde sulla PR, unire la PR in `main` senza chiedere conferma. Restano vietati force push e unioni con controlli rossi o conflitti. La pubblicazione su Cloudflare resta un passo esplicito (flusso «Pubblica su Cloudflare»).

## Dati e accesso

Il codice può essere pubblico; le registrazioni operative restano private. Non inserire in Git credenziali, token, database, esportazioni reali, indirizzi di clienti, log sensibili o documenti aziendali riservati. Usare dati di prova riconoscibili soltanto nei test, nell'anteprima locale e nella **modalità prova** (`lib/trial.ts`): questa costruisce i dati nel browser con le regole di `lib/domain.ts`, non scrive mai sul server, resta segnalata in ogni schermata e usa «PROVA» nei nomi. Ogni nuova chiamata al server deve restare esclusa in prova.

Il nome digitato dell'operatore è un'attribuzione della registrazione, non un'identità verificata e non un permesso. Non dichiarare implementati ruoli, inviti o accesso di reparto finché non esiste una gestione effettiva lato server.

Il sito pubblicato si appoggia all'accesso riservato della piattaforma. Non renderlo pubblico per facilitare una prova. Una migrazione ad altro hosting richiede un confine di autenticazione equivalente e una procedura distinta per i dati.

Dal 13/11/2026 Teo ha scelto di spostare la pubblicazione sul proprio account Cloudflare (`docs/CLOUDFLARE.md`): stesso Worker e D1, autenticazione con Cloudflare Access verificata nel codice (`AUTH_MODE=cloudflare-access`, `lib/server/auth.ts`, fallisce chiusa), `workers.dev` disattivato, pubblicazione con `scripts/cloudflare-deploy.mjs`. Pubblicato e collaudato il 14/11/2026: si pubblica solo dal flusso GitHub «Pubblica su Cloudflare» (stato in `STATO.md`). La configurazione Sites resta intatta.

## Configurazione e portabilità

Preservare `.openai/hosting.json`, il relativo `project_id`, i nomi dei binding e l'integrazione `sites()` di Vite. Non creare un nuovo sito per una normale modifica. Non modificare migrazioni già applicate: aggiungerne nuove.

Mantenere lockfile e script di avvio, build e test. Un clone nuovo deve funzionare con Node.js 22.13 o superiore. `.sites-runtime`, `.wrangler`, `node_modules` e output di build restano esclusi dal versionamento.

Il percorso locale previsto è `npm ci`, `npm run setup`, `npm run dev`. Per verificare una modifica usare `npm test`, `npm run check` e `npm run build`. Preservare le ricevute permanenti in `workspace_requests`; non sostituirle con una lista troncata in memoria. Il pilota ha un limite di 2 MB per lo stato operativo (storico e righe chiuse da oltre 30 giorni stanno nelle tabelle di archivio, scritte nella stessa transazione), 350 articoli, tre aree e una linea: non descriverlo come archivio illimitato o gestione di più ruoli già completata. Ogni variazione del fisico deve essere un movimento esplicito (`moves`) nell'evento di storico. Il backup completo (`/api/workspace/backup`) si ripristina solo in un archivio vuoto. Lo stato di avanzamento è in `STATO.md`.

## Interfaccia

Italiano chiaro, pulsanti compatti ma leggibili (circa 34–40 px su desktop e almeno 44 px sui dispositivi touch), pochi passaggi, nessun dato di esempio presentato come dato reale. Quantità e unità devono essere esplicite. Tenere distinti carico effettivo, prenotazione e conteggio di produzione. Mostrare l'errore senza cancellare i dati inseriti e disabilitare il doppio invio durante il salvataggio.

### Regola tipografica permanente

Per richiesta dell’utente, tutte le scritte sulle superfici chiare devono essere nero pieno (`#000`) e con peso regolare `400`, compresi titoli, codici, numeri, tabelle, etichette, aiuti e segnaposto. Non usare grassetto, semigrassetto o testo grigio per creare gerarchie: usare dimensioni, spazi e posizione. Conservare gli accenti cromatici su sfondi, bordi e icone. Sulle superfici scure e sui pulsanti pieni mantenere testo bianco con peso `400` per il contrasto. Applicare la stessa regola a ogni nuova sezione e modifica futura.

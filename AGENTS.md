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
- Non caricare automaticamente a magazzino il conteggio manuale o delle fotocellule. L'integrazione richiede un collaudo specifico.
- Un errore o una risposta incerta non equivalgono a un salvataggio riuscito. Evitare i doppioni con identificativi stabili.

## Metodo di lavoro

1. Controllare `git status` e leggere i file interessati. Non sovrascrivere modifiche altrui.
2. Aggiornare la logica condivisa in `lib/domain.ts`; non affidare i vincoli alla sola interfaccia.
3. Preservare controllo della versione, deduplicazione e controllo di accesso dell'API.
4. Aggiungere o modificare test mirati per cambiamenti ai conteggi e ai passaggi di stato.
5. Eseguire i test pertinenti e la compilazione; verificare nell'interfaccia il percorso interessato.
6. Aggiornare documentazione e limiti effettivi. Salvare il lavoro nello stesso repository, con commit comprensibili; nessun force push non richiesto.

## Dati e accesso

Il codice può essere pubblico; le registrazioni operative restano private. Non inserire in Git credenziali, token, database, esportazioni reali, indirizzi di clienti, log sensibili o documenti aziendali riservati. Usare dati di prova riconoscibili soltanto nei test e nell'anteprima locale.

Il nome digitato dell'operatore è un'attribuzione della registrazione, non un'identità verificata e non un permesso. Non dichiarare implementati ruoli, inviti o accesso di reparto finché non esiste una gestione effettiva lato server.

Il sito pubblicato si appoggia all'accesso riservato della piattaforma. Non renderlo pubblico per facilitare una prova. Una migrazione ad altro hosting richiede un confine di autenticazione equivalente e una procedura distinta per i dati.

## Configurazione e portabilità

Preservare `.openai/hosting.json`, il relativo `project_id`, i nomi dei binding e l'integrazione `sites()` di Vite. Non creare un nuovo sito per una normale modifica. Non modificare migrazioni già applicate: aggiungerne nuove.

Mantenere lockfile e script di avvio, build e test. Un clone nuovo deve funzionare con Node.js 22.13 o superiore. `.sites-runtime`, `.wrangler`, `node_modules` e output di build restano esclusi dal versionamento.

Il percorso locale previsto è `npm ci`, `npm run setup`, `npm run dev`. Per verificare una modifica usare `npm test`, `npm run check` e `npm run build`. Preservare le ricevute permanenti in `workspace_requests`; non sostituirle con una lista troncata in memoria. Il pilota ha un limite di 2 MB per lo stato operativo, 350 articoli, tre aree e una linea: non descriverlo come archivio illimitato o gestione di più ruoli già completata.

## Interfaccia

Italiano chiaro, pulsanti compatti ma leggibili (circa 34–40 px su desktop e almeno 44 px sui dispositivi touch), pochi passaggi, nessun dato di esempio presentato come dato reale. Quantità e unità devono essere esplicite. Tenere distinti carico effettivo, prenotazione e conteggio di produzione. Mostrare l'errore senza cancellare i dati inseriti e disabilitare il doppio invio durante il salvataggio.

### Regola tipografica permanente

Per richiesta dell’utente, tutte le scritte sulle superfici chiare devono essere nero pieno (`#000`) e con peso regolare `400`, compresi titoli, codici, numeri, tabelle, etichette, aiuti e segnaposto. Non usare grassetto, semigrassetto o testo grigio per creare gerarchie: usare dimensioni, spazi e posizione. Conservare gli accenti cromatici su sfondi, bordi e icone. Sulle superfici scure e sui pulsanti pieni mantenere testo bianco con peso `400` per il contrasto. Applicare la stessa regola a ogni nuova sezione e modifica futura.

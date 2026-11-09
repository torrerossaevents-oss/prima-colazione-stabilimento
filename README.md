# Prima Colazione · Stabilimento

Un unico gestionale per catalogo, magazzino, produzione e ordini. Interfaccia italiana, utilizzabile da computer e tablet, pensata per operazioni brevi e comprensibili.

Questa prima versione gestisce registrazioni manuali persistenti. Il catalogo e le giacenze iniziano vuoti: non contiene dati aziendali inventati. Le fotocellule, il PLC, TeamSystem e l'etichettatrice non sono ancora collegati. Un conteggio di produzione non carica automaticamente il magazzino.

## Cosa comprende

- Catalogo con codice univoco, descrizione, categoria, unità, confezionamento e tre listini; inserimento e modifica manuali, importazione Excel/CSV con anteprima ed esportazione Excel.
- Lotti, scadenze, fino a tre aree, ricezioni, quantità bloccate, trasferimenti e rettifiche motivate.
- Ordini con prenotazione, preparazione, partenza anche parziale e annullamento del residuo.
- Associazione del riferimento documento senza un secondo scarico della merce.
- Lavorazioni identificate dall'articolo, conteggio manuale e chiusura con conservazione dello storico.
- Panoramica, ricerca ed esportazione dei dati disponibili nell'interfaccia.

Il sito operativo è riservato al proprietario attraverso l'accesso della piattaforma di pubblicazione. La pubblicazione del codice non pubblica il database. Gestione di più utenti con permessi distinti e inviti richiede un passaggio successivo: scrivere un nome nel campo operatore non assegna un ruolo autenticato.

## Aprire il progetto in un'altra app

Aprire l'intera cartella del repository, non soltanto `app/`. Sono necessari Node.js 22.13 o superiore, npm e Git. Un clone nuovo usa automaticamente il profilo portabile su Windows, macOS e Linux.

```sh
git clone https://github.com/torrerossaevents-oss/prima-colazione-stabilimento.git
cd prima-colazione-stabilimento
npm ci
npm run setup
npm run dev
```

Il lockfile deve restare nel repository. Non è necessario ricreare il progetto o copiare manualmente componenti fra app: l'altra app può modificare lo stesso codice, eseguire i controlli e salvare le modifiche con Git.

Repository pubblico dedicato: https://github.com/torrerossaevents-oss/prima-colazione-stabilimento

Sito riservato: https://prima-colazione-stabilimento.torrerossaevents.chatgpt.site

### Inizializzazione del database locale

`npm run setup` compila il progetto e applica le migrazioni mancanti al database locale. Si può ripetere: Wrangler conserva l'elenco delle migrazioni già applicate. Il comando non modifica il database pubblicato e non richiede credenziali cloud.

Lo script `scripts/local-setup.mjs` genera una configurazione locale ignorata da Git e usa `wrangler d1 migrations apply DB --local`. I dati rimangono in `.wrangler/state`. Dopo la prima inizializzazione basta `npm run dev`; rieseguire `npm run setup` quando vengono aggiunte migrazioni.

Aprire l'indirizzo stampato nel terminale, normalmente `http://localhost:5173`. L'anteprima locale non richiede l'hardware e non legge i dati dello stabilimento. L'anteprima di sviluppo consente operazioni senza login; non è un sistema di accesso da esporre su Internet.

## Dove modificare

| Obiettivo | File |
| --- | --- |
| Schermate, moduli e navigazione | `components/stabilimento-app.tsx` |
| Catalogo, schede prodotto e ricerca progressiva | `components/catalog-panel.tsx` |
| Importazione/esportazione catalogo | `lib/catalog-io.ts` |
| Stile e comportamento responsive | `app/globals.css` |
| Pagina iniziale e metadati | `app/page.tsx`, `app/layout.tsx` |
| Regole di magazzino, ordini e produzione | `lib/domain.ts` |
| Lettura e salvataggio dei dati | `app/api/workspace/route.ts` |
| Schema persistente e migrazioni | `db/schema.ts`, `drizzle/` |
| Test delle regole operative | `tests/domain.test.ts` |
| Configurazione di pubblicazione | `.openai/hosting.json`, `vite.config.ts`, `worker/index.ts` |

React e TypeScript gestiscono l'interfaccia; Vinext e un Worker Cloudflare gestiscono l'applicazione. D1 conserva lo stato operativo. Il salvataggio usa una versione attesa per rilevare modifiche contemporanee e un identificativo di richiesta per evitare duplicazioni durante i tentativi ripetuti. La tabella `workspace_requests` conserva permanentemente le ricevute delle richieste riuscite. Lo storico e i dati operativi appartengono al database, non a Git.

La versione pilota gestisce fino a 350 articoli, tre aree e una linea di produzione. Lo stato operativo ha un limite di 2 MB: è un vincolo esplicito della prima architettura, da rivedere prima di estendere durata e volume dell'archivio. L'accesso resta riservato al proprietario; non sono implementati sei account con ruoli distinti.

## Controlli prima di consegnare una modifica

```sh
npm test
npm run check
npm run build
```

Verificare anche il percorso modificato nell'interfaccia. Le prove da eseguire e i limiti della verifica sono in [docs/COLLAUDO.md](docs/COLLAUDO.md). Il superamento di una compilazione non equivale al collaudo delle fotocellule.

Se cambia lo schema, generare una nuova migrazione con `npm run db:generate`, leggerne il contenuto e provarla localmente. Conservare immutate le migrazioni già applicate. La pubblicazione applica separatamente le migrazioni dell'ambiente ospitato.

## Pubblicazione e portabilità

Conservare l'identificativo in `.openai/hosting.json` quando si aggiorna questo sito. La pubblicazione avviene attraverso il flusso Sites; un commit su un eventuale secondo repository GitHub non implica da solo una pubblicazione automatica. Codice e database devono essere trasferiti separatamente in un'eventuale migrazione verso un altro hosting.

Il codice usa l'accesso riservato della piattaforma. Prima di ospitarlo altrove, predisporre autenticazione e autorizzazione equivalenti: gli header di identità sono affidabili soltanto dietro la piattaforma che li verifica e li inserisce.

Nel repository vanno sorgenti, configurazioni non segrete, lockfile, migrazioni, test e documentazione. Non vanno credenziali, file `.env`, esportazioni operative, documenti dei clienti, database locali, log, `node_modules` o cartelle di build. Questi ultimi sono rigenerabili con i comandi sopra.

Dettagli: [requisiti](docs/REQUISITI.md), [catalogo](docs/CATALOGO.md), [integrazioni](docs/INTEGRAZIONI.md), [collaudo](docs/COLLAUDO.md). Le istruzioni per chi continua lo sviluppo sono in [AGENTS.md](AGENTS.md).

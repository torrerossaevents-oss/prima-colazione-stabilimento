# Prima Colazione · Stabilimento

Un unico gestionale per catalogo, magazzino, produzione e ordini. Interfaccia italiana, utilizzabile da computer e tablet, pensata per operazioni brevi e comprensibili.

Il gestionale registra operazioni persistenti con controllo delle versioni e ricevute permanenti. Il catalogo e le giacenze iniziano vuoti: non contiene dati aziendali inventati. Il ponte per le fotocellule/LOGO! è pronto e provato **solo in simulazione**; PLC, TeamSystem ed etichettatrici non sono collegati. Un conteggio di produzione non carica mai automaticamente il magazzino.

Stato di avanzamento, decisioni e domande aperte: [STATO.md](STATO.md).

## Cosa comprende

- Catalogo con codice univoco, descrizione, categoria, unità, confezionamento e tre listini; inserimento e modifica manuali, importazione Excel/CSV con anteprima ed esportazione Excel.
- Lotti, scadenze, fino a tre aree, ricezioni, quantità bloccate, trasferimenti, rettifiche motivate, scarti, consumi interni e resi da controllare: ogni variazione del fisico è un movimento esplicito nello storico.
- Ordini con prenotazione, preparazione, partenza anche parziale (con motivo della differenza) e annullamento del residuo.
- Associazione del riferimento documento senza un secondo scarico della merce.
- Lavorazioni identificate dall'articolo, conteggio manuale o da ponte (in prova), scarti alla chiusura, riepilogo giornaliero per articolo/lotto esportabile.
- Storico paginato con ricerca; ordini e lavorazioni chiusi da oltre 30 giorni in archivio consultabile.
- Backup completo con ripristino verificato ([procedura](docs/BACKUP-RIPRISTINO.md)).
- Stati di salvataggio visibili («in corso», «salvato», «da verificare», «non riuscito»); una richiesta incerta si verifica sul server con lo stesso identificativo, anche dopo aver chiuso il browser.

Il sito operativo è riservato al proprietario attraverso l'accesso della piattaforma di pubblicazione. La pubblicazione del codice non pubblica il database. Gestione di più utenti con permessi distinti e inviti richiede un passaggio successivo: scrivere un nome nel campo operatore non assegna un ruolo autenticato.

## Preparazione del collegamento LOGO!

In **Configurazione** è disponibile il pacchetto PC del ponte: servizio con archivio SQLite, coda persistente e trasmissione autenticata al gestionale ([contratto](docs/CONTRATTO-PONTE.md)), simulatore di protocollo e lettura Modbus TCP diagnostica. Le credenziali del ponte si creano in Configurazione → Dispositivi (token mostrato una sola volta, revocabile).

`npm run bridge:simulate` esegue la prova con dati fittizi; `npm run test:bridge` verifica il pacchetto. Gli script del ponte usano esclusivamente Node.js 22.13 o successivo, senza installare dipendenze aggiuntive. L’archivio simulato è separato dal gestionale.

Provato solo in simulazione e con test automatici (anche ponte reale ↔ API reali su HTTP locale). Restano da fare: programma LOGO!, conferma della mappa registri, prova dei `.cmd` su Windows, collaudo sulla linea. Il servizio rifiuta di partire in modalità impianto se manca anche un solo dato. Nessun reset del PLC, nessuna scrittura (salvo abilitazione esplicita) e nessun carico di magazzino. Guida: [bridge/README.md](bridge/README.md) e [docs/COLLEGAMENTO-LOGO.md](docs/COLLEGAMENTO-LOGO.md).

Dopo una modifica ai file del ponte, rigenerare il download con `python scripts/package-logo.py` (Python 3.9+; sola libreria standard). Il pacchetto usa un elenco esplicito di sorgenti e test: configurazioni locali, database e chiavi non vengono inclusi.

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
| Riepilogo produzione, storico, archivio, dispositivi, backup | `components/operations-panels.tsx` |
| Richieste dal browser (timeout, richiesta incerta) | `lib/client-api.ts` |
| Catalogo, schede prodotto e ricerca progressiva | `components/catalog-panel.tsx` |
| Importazione/esportazione catalogo | `lib/catalog-io.ts` |
| Stile e comportamento responsive | `app/globals.css` |
| Pagina iniziale e metadati | `app/page.tsx`, `app/layout.tsx` |
| Regole di magazzino, ordini e produzione | `lib/domain.ts` |
| Lettura e salvataggio dei dati | `lib/server/workspace.ts`, `app/api/workspace/**` |
| Archivio (stato operativo / storico) | `lib/archive.ts`, `docs/ARCHITETTURA-ARCHIVIO.md` |
| Backup e ripristino | `lib/server/backup.ts`, `scripts/verify-backup.ts` |
| Credenziali e endpoint del ponte | `lib/server/devices.ts`, `app/api/devices/**` |
| Schema persistente e migrazioni | `db/schema.ts`, `drizzle/` |
| Test delle regole operative | `tests/domain*.test.ts`, `tests/api.test.ts` (SQLite e D1 locale), `tests/bridge-e2e.test.ts`, `tests/ui/smoke.mjs` (browser) |
| Configurazione di pubblicazione | `.openai/hosting.json`, `vite.config.ts`, `worker/index.ts` |

React e TypeScript gestiscono l'interfaccia; Vinext e un Worker Cloudflare gestiscono l'applicazione. D1 conserva lo stato operativo (una riga versionata) e, in tabelle indicizzate, storico (`workspace_audit`) e archivio (`workspace_archive`), scritti nella stessa transazione. Il salvataggio usa una versione attesa per rilevare modifiche contemporanee e un identificativo di richiesta per evitare duplicazioni durante i tentativi ripetuti. La tabella `workspace_requests` conserva permanentemente le ricevute delle richieste riuscite. Lo storico e i dati operativi appartengono al database, non a Git.

La versione pilota gestisce fino a 350 articoli, tre aree e una linea di produzione. Lo **stato operativo** (catalogo, lotti con giacenza, ordini aperti e degli ultimi 30 giorni) ha un limite di 2 MB; storico e righe chiuse più vecchie sono in archivio e non pesano su quel limite (misure in `docs/ARCHITETTURA-ARCHIVIO.md`). L'accesso resta riservato al proprietario; non sono implementati account con ruoli distinti.

## Controlli prima di consegnare una modifica

```sh
npm test
npm run check
npm run build
npm run test:bridge
```

Gli stessi controlli girano in GitHub Actions (`.github/workflows/ci.yml`). Verificare anche il percorso modificato nell'interfaccia: con `npm run dev` attivo e archivio locale vuoto, `node tests/ui/smoke.mjs http://localhost:5173` percorre i flussi principali su telefono, tablet e desktop (richiede Playwright con Chromium). Le prove da eseguire e i limiti della verifica sono in [docs/COLLAUDO.md](docs/COLLAUDO.md). Il superamento di una compilazione non equivale al collaudo delle fotocellule.

Se cambia lo schema, generare una nuova migrazione con `npm run db:generate`, leggerne il contenuto e provarla localmente. Conservare immutate le migrazioni già applicate. La pubblicazione applica separatamente le migrazioni dell'ambiente ospitato.

## Pubblicazione e portabilità

Conservare l'identificativo in `.openai/hosting.json` quando si aggiorna questo sito. La pubblicazione avviene attraverso il flusso Sites; un commit su un eventuale secondo repository GitHub non implica da solo una pubblicazione automatica. Codice e database devono essere trasferiti separatamente in un'eventuale migrazione verso un altro hosting.

Il codice usa l'accesso riservato della piattaforma. Prima di ospitarlo altrove, predisporre autenticazione e autorizzazione equivalenti: gli header di identità sono affidabili soltanto dietro la piattaforma che li verifica e li inserisce.

Nel repository vanno sorgenti, configurazioni non segrete, lockfile, migrazioni, test e documentazione. Non vanno credenziali, file `.env`, esportazioni operative, documenti dei clienti, database locali, log, `node_modules` o cartelle di build. Questi ultimi sono rigenerabili con i comandi sopra.

Dettagli: [requisiti](docs/REQUISITI.md), [catalogo](docs/CATALOGO.md), [integrazioni](docs/INTEGRAZIONI.md), [collaudo](docs/COLLAUDO.md). Le istruzioni per chi continua lo sviluppo sono in [AGENTS.md](AGENTS.md).

# Stato di avanzamento

Ultimo aggiornamento: 13 novembre 2026 · branch `claude/ottimizzazione-stabilimento-20261113` · base `main` 31ecaf5.
Riprendere da «Prossimo passo». Documento operativo: decisioni, comandi, risultati, problemi aperti.

## Baseline registrata prima delle modifiche (31ecaf5, Linux, Node 22.23.4, npm 10.9.9)

| Comando | Esito |
| --- | --- |
| `npm ci` | riuscito, 22 s |
| `npm test` | 42/42 superati |
| `npm run check` | nessun errore |
| `npm run build` | riuscita |
| `npm run test:bridge` | 18/18 superati |
| `npm run bridge:simulate` | riuscita |
| `npm run lint` | **10 errori, 7 avvisi** (non era nel controllo di consegna) |

## Audit iniziale

| # | Problema | File | Conseguenza | Priorità | Stato |
| --- | --- | --- | --- | --- | --- |
| 1 | Tutto lo storico nella riga JSON unica; limite 2 MB raggiunto in ~3 mesi con ritmo sintetico | `app/api/workspace/route.ts`, `db/schema.ts` | blocco dei salvataggi | Alta | Risolto: archivio indicizzato, vedi `docs/ARCHITETTURA-ARCHIVIO.md` |
| 2 | Validazione O(lotti × ordini): 460 ms a un anno sintetico | `lib/domain.ts` `validateState` | lentezza crescente, rischio limiti CPU del Worker | Alta | Risolto: indice prenotazioni, 37 ms → 17,5 ms con archivio |
| 3 | `fetch` senza timeout | `components/stabilimento-app.tsx` | pulsanti bloccati su rete appesa | Alta | Risolto: 15–20 s, stato «da verificare» |
| 4 | Richiesta incerta solo in `sessionStorage` | idem | chiudendo la scheda si perde il promemoria → rischio di doppione inserendo di nuovo | Alta | Risolto: `localStorage` + verifica della ricevuta sul server |
| 5 | Scadenze a 7 giorni con UTC e 24 h | idem | errori a mezzanotte e al cambio ora | Media | Risolto: `expiringLots` su giorni Europe/Rome, giorno ricalcolato ogni minuto |
| 6 | Nessun aggiornamento al ritorno sulla scheda | idem | dati vecchi dopo ore | Media | Risolto: `visibilitychange` e `online` |
| 7 | Totali ricalcolati per ogni riga | idem, `catalog-panel.tsx` | rallentamento con molti lotti | Media | Risolto in `stabilimento-app` (`stockIndex`); `catalog-panel` invariato |
| 8 | Scarti, resi, consumi interni assenti | `lib/domain.ts` | correzioni fatte con rettifiche generiche | Media | Risolto: movimenti espliciti con traccia |
| 9 | Consegna parziale senza motivo | idem | differenze non spiegate | Bassa | Risolto: motivo obbligatorio lato server |
| 10 | Nessun backup verificabile | — | export scambiato per backup | Alta | Risolto: backup completo + ripristino verificato |
| 11 | Ponte senza servizio, trasmettitore, endpoint | `bridge/`, API | conteggio automatico impossibile | Alta | Implementato e provato in simulazione; impianto non collaudato |
| 12 | Test API solo su adattatore SQLite | `tests/` | transazioni D1 non provate | Media | Risolto: stessi test su Miniflare D1 |
| 13 | Export CSV catalogo assente, decimali ambigui accettati, CSV ANSI corrotti | `lib/catalog-io.ts` | perdita di dati in import/export | Media | Risolto |
| 14 | Colonne Tipologia/Scorta assenti sovrascrivono valori in «aggiorna» | `lib/catalog-io.ts`, `lib/domain.ts` | modifiche silenziose | Media | Risolto |
| 15 | Lint con 10 errori | vari | — | Bassa | 3 errori residui (modelli preesistenti negli effetti React) |

## Classificazione delle funzioni

| Stato | Funzioni |
| --- | --- |
| Operativo verificato (test + browser locale) | catalogo con ricerca/modifica/import/export; lotti, blocchi, trasferimenti, rettifiche, scarti, consumi, resi; ordini con preparazione, partenza parziale, annullamento, documento successivo; produzione manuale con riepilogo giornaliero; storico paginato; archivio; backup e ripristino in archivio vuoto; recupero richieste incerte |
| Implementato da verificare | migrazione 0002 sul database pubblicato; endpoint dispositivi attraverso l'accesso della piattaforma; tempi CPU nel Worker ospitato; `.cmd` su Windows; fotocamera su dispositivi reali |
| Simulato | ponte LOGO! (sensori, contatore, chiusura, coda, trasmissione), scenario A 200 + B 150 |
| Non implementato | programma LOGO!; carico automatico a magazzino; utenti e ruoli distinti; TeamSystem; stampa etichette |
| Bloccato da hardware/accessi | collaudo linea (dati LOGO!, PC, rete); pubblicazione Sites (nessun accesso da questa sessione); etichettatrici (modelli/driver) |

## Decisioni

- Stack invariato. Archivio e storico in tabelle D1 indicizzate nella stessa transazione dello stato (`docs/ARCHITETTURA-ARCHIVIO.md`).
- Chiusura dal ponte = operazione di dominio dedicata (`production.deviceClose`) consentita solo con credenziale di dispositivo; deduplica sulle ricevute permanenti esistenti.
- Lavorazioni «da fotocellule» scelte all'avvio: niente conteggi manuali sulla stessa lavorazione; chiusura manuale solo con motivo, segnalata.
- Nessun carico automatico a magazzino: cartoni letti, scarti e quantità buona sono distinti; la regola della quantità buona non è definita.
- KG: il dominio resta a quantità intere. Non introdotte frazioni senza un esempio reale (vedi domande).
- `allowImportingTsExtensions` in `tsconfig.json`: i moduli server sono eseguibili e testabili direttamente da Node.

## Comandi per riprendere

```sh
npm ci
npm run setup
npm test            # dominio, catalogo, API su SQLite e D1 locale, ponte↔API
npm run check
npm run build
npm run test:bridge
npm run bridge:simulate
node --experimental-strip-types scripts/bench-workspace.ts
npm run dev   # poi, in un altro terminale, con archivio locale vuoto:
node tests/ui/smoke.mjs http://localhost:5173
```

## Risultati del 13/11/2026 (Linux, Node 22.23.4, commit indicati in PR)

Vedi `docs/COLLAUDO.md` → «Verifica del 13 novembre 2026».

## Domande aperte (una volta sola, ciascuna legata a un'attività)

1. **LOGO!** (collaudo ponte): modello/codice e firmware, versione Soft Comfort, mappa registri (contatore, richieste di chiusura, riscontro), ritenzione allo spegnimento, IP/unitId, sensori e loro distanza, pulsante.
2. **PC di linea** (installazione servizio): sistema operativo, può restare acceso, utente Windows, percorso di installazione.
3. **Quantità buona** (carico automatico): regola concordata tra cartoni letti, scarti e quantità da caricare.
4. **KG** (precisione): un esempio reale di articolo a peso con le quantità usate in ricezione e consegna.
5. **Etichette** (stampa): modelli delle due stampanti, collegamento, driver/linguaggio (ZPL, EPL, …), file dei modelli attuali.
6. **TeamSystem** (documenti): versione, formati esportabili, un documento d'esempio senza dati non necessari.
7. **Utenti e ruoli** (accessi): quante persone per amministrazione/produzione/magazzino e se la piattaforma di pubblicazione può fornire identità distinte.
8. **Pubblicazione**: chi pubblica sul flusso Sites e quando; prima della pubblicazione scaricare un backup.

## Revisioni indipendenti (13/11/2026) e correzioni

Eseguite con due agenti separati sul diff `31ecaf5..HEAD`, senza conoscere le conclusioni dell'autore. Revisione Codex: non disponibile in questa sessione; la PR è pronta per riceverla.

| Rilievo | Gravità | Esito |
| --- | --- | --- |
| Risposta 200 non JSON (pagina di accesso) presa per salvataggio riuscito | Alta | Corretto: solo JSON con stato e versione vale come esito; altrimenti «da verificare». Test nel browser |
| Backup letto con 5 SELECT separate: un salvataggio contemporaneo poteva produrre un backup incoerente | Alta | Corretto: lettura in un unico batch (transazione). Test |
| Chiunque con l'header della piattaforma è «proprietario» (rischio se l'accesso della piattaforma cambia) | Alta condizionata | Mitigato: `OWNER_USER_IDS` se configurato. **Da impostare prima di cambiare l'accesso del sito o di attivare il ponte** |
| `--dati` della simulazione poteva cancellare una cartella qualsiasi | Media | Corretto con test |
| Ripristino: righe non validate, dati lasciati scritti se la verifica falliva | Media | Corretto: validazione completa prima di scrivere, annullamento automatico, limite 20 MB. Test con backup falsificato |
| «Scarta» non impediva l'arrivo tardivo della richiesta originale | Media-bassa | Corretto: l'identificativo viene annullato sul server. Test API e browser |
| Un solo record di richiesta incerta per tutte le schede | Bassa-media | Corretto: un record per richiesta, con stato «in invio»/«incerta» |
| Trasferimento verso un lotto archiviato creava un doppione di riga | Bassa | Corretto con test |
| Un primo salvataggio rifiutato impediva poi il ripristino | Bassa | Corretto: la riga dello stato nasce solo con un salvataggio valido. Test |
| Lavorazione da ponte chiusa a mano con 0 cartoni | Bassa | Segnalata come «da verificare» nel riepilogo e nel CSV |
| Ordini archiviati senza articolo/unità; doppia comparsa dopo un documento | Bassa | Corretto |
| GET del ponte con lettura completa di storico e conteggi | Bassa | Corretto: solo stato operativo |
| Limiti letti senza streaming; heartbeat senza frequenza minima; linea non verificata alla chiusura | Bassa | Corretti |
| Token del ponte in chiaro accanto al pacchetto | Bassa | Documentato: tenere `token.local.json` fuori da copie e zip; spostamento in `%ProgramData%` con permessi ristretti da fare all'installazione sul PC confermato |
| Anteprima di sviluppo aperta senza login | Bassa | Documentato: usare `npm run dev` solo su macchine e reti fidate, mai con un backup reale |

## Prossimo passo

1. Revisione della PR (anche Codex, se disponibile) e risposta ai rilievi.
2. Pubblicazione tramite il flusso Sites autorizzato, dopo backup; poi verifica della migrazione 0002 e del backup sul sito.
3. Con i dati LOGO!: configurazione `bridge/ponte.local.json`, prova a linea ferma, poi collaudo con almeno 100 cartoni contati anche a mano.

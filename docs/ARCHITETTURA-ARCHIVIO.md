# Decisione: stato operativo + archivio indicizzato (13 novembre 2026)

## Problema misurato

Fino al commit `31ecaf5` tutto (catalogo, lotti, ordini, lavorazioni **e** storico) stava in un'unica riga JSON di D1, letta, validata e riscritta a ogni operazione. Misura con `node --experimental-strip-types scripts/bench-workspace.ts` su dati **sintetici** (ritmo ipotetico: 10 carichi, 20 ordini, 5 lavorazioni al giorno; 350 articoli), Node 22.23, Linux, stesso PC:

| Giorni | Lotti | Ordini | Storico | JSON unico | Validazione prima | Operazione prima |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 30 | 300 | 600 | 1.610 | 638 kB | 6,2 ms | 10,8 ms |
| 90 | 900 | 1.800 | 4.910 | 1.799 kB | 31,4 ms | 49,8 ms |
| 180 | 1.800 | 3.600 | 9.860 | **3.547 kB (oltre 2 MB)** | 101,6 ms | 145,2 ms |
| 365 | 3.650 | 7.300 | 20.035 | **7.151 kB** | 460,6 ms | 573,5 ms |

Conseguenze: con quel ritmo il limite di 2 MB si raggiunge in circa tre mesi e ogni salvataggio diventa più lento in modo quadratico (la validazione ricalcolava le prenotazioni per ogni lotto). Alzare il limite non risolveva nessuno dei due problemi. Il ritmo reale dello stabilimento non è noto: va rimisurato con i dati veri dopo l'avvio.

## Decisione

Restano lo stack (Worker + D1) e il modello «una riga versionata = stato operativo» che garantisce concorrenza e ricevute. Cambia **cosa** sta nella riga:

- **Stato operativo** (`workspaces.payload`): catalogo, lotti con giacenza o blocchi o riferiti da ordini aperti/recenti, ordini aperti e chiusi da meno di 30 giorni, lavorazioni attive e degli ultimi 30 giorni.
- **Archivio** (`workspace_archive`, indici per giorno e per riferimento): ordini e lavorazioni chiusi da oltre 30 giorni, lotti esauriti. Copia JSON identica della riga, nessuna modifica dei saldi.
- **Storico** (`workspace_audit`, indice per data): ogni operazione con dettaglio, autore e movimenti di magazzino espliciti.

Ogni salvataggio è un unico `batch` D1 (transazione): stato + ricevuta + righe di storico + spostamenti in archivio. Le scritture accessorie avvengono solo se `workspaces.version` e `workspaces.last_request_id` corrispondono al salvataggio appena eseguito: o tutto o niente. Provato su SQLite e sul runtime D1 locale (Miniflare), incluso un errore iniettato a metà batch.

Se un'operazione riguarda una riga archiviata (es. fattura di un ordine vecchio, nuovo carico di un lotto esaurito con lo stesso codice) la riga viene ripresa nello stato operativo nella stessa transazione e tolta dall'archivio; i controlli di dominio vedono quindi lo stesso contesto di prima.

Per non allentare i vincoli quando i lotti escono dallo stato operativo: gli articoli usati sono marcati `inUse` (blocco di codice/tipo/unità/confezionamento), le aree sono memorizzate in `areas` (limite di 3).

## Migrazione

`drizzle/0002_archivio_dispositivi.sql` è solo additiva (nuove tabelle, indici, una colonna nullable). Le migrazioni `0000` e `0001` non sono cambiate. Al primo salvataggio dopo l'aggiornamento lo storico contenuto nel vecchio JSON viene copiato in `workspace_audit` e, nella stessa transazione, l'intero JSON precedente è salvato in `workspace_snapshots` come punto di recupero. Provato con 3.000 voci storiche.

## Risultato misurato (stesso script, stessi dati)

| Giorni | Stato operativo | Operazione completa (applica + separa + serializza) | Righe in archivio/storico |
| ---: | ---: | ---: | ---: |
| 30 | 341 kB | 6,7 ms | 1.610 |
| 90 | 416 kB | 8,2 ms | 6.385 |
| 180 | 519 kB | 8,0 ms | 13.585 |
| 365 | 726 kB | 17,5 ms | 28.385 |

La crescita residua dello stato operativo dipende dai lotti che hanno ancora giacenza: nei dati sintetici nessun lotto si esaurisce mai. Con 350 articoli e tre aree il limite di 2 MB corrisponde a circa 13.000 lotti con giacenza contemporanea; il test `state over 2 MB is refused` verifica che oltre il limite il salvataggio sia rifiutato senza modifiche.

## Limiti noti

- Le letture dell'archivio sono paginate (50–500 righe); la ricerca usa `LIKE` su un campo testo, adeguata alle dimensioni del pilota, non a milioni di righe.
- Il backup completo è generato in un'unica risposta: adatto a decine di MB, non a gigabyte.
- I tempi sono misurati in Node su questo PC; il tempo CPU nel Worker ospitato non è stato misurato.

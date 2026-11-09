# Preparazione del collegamento LOGO!

Pacchetto di preparazione per Prima Colazione · Stabilimento, 9 novembre 2026. Si usa sul PC dello stabilimento. Il gestionale online continua a registrare conteggi manuali finché il collegamento reale non è completato e collaudato.

## Cosa puoi provare oggi

La simulazione verifica due lavorazioni di esempio: 200 cartoni dell'articolo A e 150 dell'articolo B. Il totale atteso è 350 cartoni. Controlla il salvataggio locale, la riapertura dell'archivio e le richieste ripetute, senza usare il LOGO!, Internet o i prodotti reali del gestionale.

1. Estrai tutto il pacchetto ZIP in una cartella sul PC. Conserva insieme le cartelle `bridge` e `docs`.
2. Occorre Node.js 22.13 o superiore, installato sul PC e disponibile nel comando `node`.
3. Dentro `bridge`, fai doppio clic su `AVVIA-PROVA.cmd`.
4. Controlla l'esito della prova e il totale di 350 cartoni. La finestra mostra dove si trovano i file temporanei di simulazione.

La prova non installa servizi Windows, non modifica il LOGO! e non carica quantità nel magazzino. I dati simulati sono riconoscibili e separati da quelli operativi. Non occorre eseguire `npm install` per questo pacchetto.

Su altri sistemi, dalla cartella che contiene `bridge`:

```sh
node bridge/simulate.mjs
```

## Prima lettura reale, dopo l'arrivo del materiale

Questa parte è per il tecnico. Il software Siemens LOGO! Soft Comfort permette di creare e trasferire il programma del LOGO!: la licenza acquistata non contiene già il programma conta-cartoni del progetto.

1. Verificare modello e firmware ricevuti, collegamento Ethernet e programma LOGO!.
2. Copiare `bridge/logo.config.example.json` in `bridge/logo.config.local.json`.
3. Compilare la configurazione con la mappa effettivamente programmata e verificata. I campi lasciati a `null` non sono valori da usare. Impostare `mapConfirmed` a `true` soltanto dopo questa verifica.
4. Mettere in pausa gli arrivi secondo la procedura della linea, lasciando liberi entrambi i sensori.
5. Aprire `LEGGI-LOGO.cmd` e confermare che la linea è ferma. Il programma effettua due letture del contatore, che devono coincidere.

Il risultato è una lettura diagnostica: non apre una lavorazione, non cambia il contatore, non conferma il pulsante fisico e non invia il numero al gestionale.

Comando equivalente per il tecnico:

```sh
node bridge/read-logo.mjs --linea-ferma
```

Per una configurazione in un altro percorso:

```sh
node bridge/read-logo.mjs --linea-ferma --config "percorso/logo.config.local.json"
```

La conferma `--linea-ferma` è una dichiarazione dell'operatore. Il programma diagnostico non può accertare da solo che la linea sia ferma o i sensori liberi.

## Configurazione da concordare

| Campo | Significato |
| --- | --- |
| `schemaVersion` | Versione del formato: mantenere `1`. |
| `mapConfirmed` | Conferma esplicita della mappa verificata dal tecnico. Nel modello è `false`. |
| `host` | Indirizzo IPv4 privato del LOGO! sulla rete locale. Nessun nome DNS o indirizzo pubblico. |
| `port` | Porta TCP configurata sul dispositivo; 502 è la porta standard Modbus TCP. |
| `unitId` | Identificativo Modbus da 0 a 255, concordato con la configurazione del LOGO!. |
| `functionCode` | `3` per holding registers oppure `4` per input registers, secondo la mappa. |
| `address` | Indirizzo di partenza zero-based: non copiare direttamente una notazione come `40001`. |
| `wordCount` | `1` per un valore unsigned a 16 bit oppure `2` per unsigned a 32 bit. |
| `wordOrder` | `BE` oppure `LE` per l'ordine delle due parole a 16 bit; con una parola usare `BE`. I byte di ogni registro seguono il protocollo Modbus. |
| `timeoutMs` | Tempo massimo per la singola lettura: da 100 a 10.000 millisecondi; il modello propone 2.000. |

Non dedurre indirizzi, formato o ordine delle parole dal solo modello di LOGO!. La lettura doppia è una prova a linea ferma e non sostituisce il protocollo necessario per acquisire un contatore a 32 bit mentre cambia.

## Cosa è preparato e cosa manca

| Componente | Stato di questo pacchetto |
| --- | --- |
| Archivio SQLite e conteggio per lavorazione | Preparati e usati dalla simulazione. |
| Coda locale con identificativi stabili | Preparata per il successivo invio; non contiene un trasmettitore cloud. |
| Lettura Modbus TCP | Diagnostica in sola lettura, con configurazione obbligatoria. Da provare sul LOGO! reale. |
| Programma LOGO! e gestione delle fotocellule | Da realizzare, trasferire e collaudare. |
| Avvio, chiusura e riscontri tra LOGO!, PC e gestionale | Da integrare e verificare sul campo. |
| Trasmissione autenticata al gestionale | Da implementare e collaudare; nessuna credenziale inclusa nel pacchetto. |
| Avvio automatico sul PC | Da configurare dopo il collaudo; i file `.cmd` sono avvii manuali. |
| Carico automatico a magazzino | Non attivo; occorrono regole validate su quantità buone e scarti. |

La guida per l'arrivo del materiale e il foglio dei parametri sono in [COLLEGAMENTO-LOGO.md](../docs/COLLEGAMENTO-LOGO.md).

Configurazioni locali, database, esportazioni e credenziali non devono essere aggiunti al repository pubblico. I due programmi inclusi non hanno bisogno di credenziali del gestionale.

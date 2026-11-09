# Collegamento LOGO! — preparazione e prima prova

Preparato il 9 novembre 2026 per l'arrivo dell'attrezzatura previsto il 10 novembre. Riferimento funzionale: progetto conta-cartoni Rev. 02. Questa guida accompagna il pacchetto `bridge`; non certifica un impianto già collegato.

## Oggi, prima dell'arrivo

1. Scegliere il PC che rimarrà vicino alla linea e collegato alla rete Ethernet dello stabilimento. Annotare sistema operativo e versione; il pacchetto include avvii manuali per Windows.
2. Estrarre tutto il pacchetto e verificare che sia disponibile Node.js 22.13 o superiore.
3. Avviare `bridge/AVVIA-PROVA.cmd`. Il risultato atteso è: articolo di prova A, 200 cartoni; articolo di prova B, 150 cartoni; totale, 350 cartoni.
4. Conservare l'esito della prova. Si tratta di dati simulati: non vanno importati nella produzione o nel magazzino reali.
5. Preparare una vera etichetta prodotto e un piccolo gruppo di cartoni da usare nel collaudo. Controllare che il codice letto dall'etichetta corrisponda esattamente a un articolo del catalogo.

Il software LOGO! Soft Comfort acquistato serve a programmare il dispositivo. Il programma conta-cartoni, la mappa dei dati e lo scambio con il gestionale sono parti del progetto ancora da completare.

## Domani, con tecnico e materiale disponibile

| Passo | Risultato da ottenere |
| --- | --- |
| Verifica della fornitura | Modello, firmware e versione Soft Comfort effettivamente ricevuti annotati. |
| Installazione hardware | Montaggio e cablaggio secondo il progetto, eseguiti dal tecnico competente. |
| Rete locale | PC e LOGO! raggiungibili sulla LAN con indirizzi concordati; nessuna porta PLC esposta a Internet. |
| Programma LOGO! | Conteggio della sequenza valida dei sensori, memoria e stati di errore verificati. |
| Mappa dati | Indirizzi, tipi e ordine delle parole confermati, senza valori presunti. |
| Lettura diagnostica | Con linea ferma e sensori liberi, `LEGGI-LOGO.cmd` restituisce due letture uguali, coerenti con il display. |
| Prova completa | Conteggio, chiusura, recupero e collegamento al gestionale collaudati dopo aver completato le parti mancanti. |

Il pulsante di chiusura non è un arresto macchina. Le operazioni sulla linea seguono la procedura prevista dall'impianto.

## Foglio parametri del tecnico

Compilare una copia locale. Nessun indirizzo o registro è assegnato da questo documento.

| Parametro | Valore da rilevare e confermare |
| --- | --- |
| Modello e codice articolo del LOGO! | Da compilare |
| Firmware e versione Soft Comfort | Da compilare |
| PC: nome operativo, sistema e versione Node.js | Da compilare |
| Indirizzo IPv4 privato LOGO! / PC | Da compilare |
| Porta TCP e `unitId` | Da compilare |
| Funzione di lettura: 03 oppure 04 | Da compilare |
| Registro iniziale del cumulativo, zero-based | Da compilare |
| Numero registri, formato unsigned 16/32 bit | Da compilare |
| Ordine parole BE/LE e verifica con un valore noto | Da compilare |
| Comportamento del cumulativo a spegnimento e riavvio | Da verificare |
| Limite del contatore e gestione del suo superamento | Da definire e collaudare |
| Tempi di filtraggio, velocità, distanza minima dei cartoni | Da misurare sulla linea |
| Meccanismo di lettura coerente durante il conteggio | Da progettare e verificare |
| Responsabile e data della verifica | Da compilare |

La configurazione `logo.config.example.json` è intenzionalmente incompleta. Creare `logo.config.local.json` e compilarla soltanto dopo la verifica della mappa. Il comando diagnostico è in sola lettura; l'opzione `--linea-ferma` richiede che la pausa sia già stata effettuata e verificata dall'operatore.

## Scambio dei dati da implementare

Questi sono segnali funzionali proposti, non indirizzi già programmati. Il tecnico e chi sviluppa il ponte devono concordare la rappresentazione prima di scrivere registri.

| Informazione | Direzione prevista | Scopo |
| --- | --- | --- |
| Contatore cumulativo conservato | LOGO! verso PC | Riferimento assoluto: non sommare di nuovo lo stesso valore a ogni lettura. |
| Stato sensori liberi e anomalia conteggio | LOGO! verso PC | Verificare se la chiusura può essere accettata. |
| Identificativo riavvio o stato di recupero | LOGO! verso PC | Rilevare riavvii e variazioni inattese senza attribuirle a nuova produzione. |
| Stato di comunicazione e aggiornamento | LOGO! e PC | Riconoscere dati non più aggiornati e perdita del collegamento. |
| Richiesta di avvio identificata e riscontro | PC e LOGO! | Associare una sola lavorazione al prodotto già confermato. |
| Richiesta di chiusura identificata | LOGO! verso PC | Distinguere una richiesta nuova dalla ripetizione del pulsante. |
| Conferma di salvataggio della stessa richiesta | PC verso LOGO! | Autorizzare la ripartenza solo dopo il salvataggio locale riuscito. |

L'associazione comprende almeno identificativo lavorazione, linea, articolo, lotto, scadenza, operatore, confezionamento, inizio e fine. Per i prodotti già espressi in `CRT`, ogni unità è un cartone; i pezzi indicati nel nome non autorizzano una conversione automatica.

Il giorno di produzione segue l'avvio della lavorazione nel fuso `Europe/Rome`. Una lavorazione che termina dopo mezzanotte rimane nel giorno in cui è iniziata, come previsto attualmente dal gestionale.

## Regola di chiusura

1. Sospendere gli arrivi secondo la procedura della linea e lasciare uscire l'ultimo cartone.
2. Accettare una sola richiesta di chiusura identificata quando i sensori risultano liberi.
3. Fissare il riferimento finale e salvare localmente lavorazione e evento da trasmettere, nella stessa operazione persistente.
4. Solo dopo il salvataggio riuscito, inviare il riscontro della richiesta al LOGO!.
5. Azzerare il parziale della lavorazione; mantenere cumulativo e storico. Il prodotto successivo richiede una nuova identificazione e un avvio esplicito.
6. Trasmettere l'evento al gestionale con identificativo stabile; un ritentativo non deve creare una seconda lavorazione o un secondo movimento.

Il pacchetto attuale prova l'archivio locale con dati simulati. Non contiene ancora i comandi e i riscontri LOGO! né il trasmettitore autenticato verso il gestionale. La lettura diagnostica non esegue questa procedura di chiusura.

## Prove prima dell'uso operativo

| Prova | Esito da registrare |
| --- | --- |
| 100 cartoni contati anche manualmente | Il conteggio fisico coincide con quello del LOGO!; ripetere con formati e velocità previsti. |
| Cartone fermo tra i sensori | Nessun incremento ripetuto. |
| Arretramento o passaggio incompleto | Anomalia visibile, nessun conteggio accettato senza verifica. |
| Due articoli successivi, 200 e 150 cartoni | Due lavorazioni distinte; parziale nuovo a zero; totale 350. |
| Pressione ripetuta di chiusura | Una sola chiusura salvata, storico conservato. |
| Internet assente durante una lavorazione già identificata | Quando il ponte completo sarà attivo: salvataggio locale, ripresa degli invii senza doppioni. Nuovi avvii offline restano bloccati. |
| PC o collegamento LOGO! interrotto | Nessuna falsa conferma di salvataggio o reset; anomalia e procedura di recupero. |
| Riavvio con una lavorazione aperta | Recupero controllato senza perdita, riassegnazione o doppio conteggio. |
| Diminuzione inattesa o superamento del limite del contatore | Blocco dell'acquisizione e verifica; nessuna quantità negativa o salto interpretato automaticamente. |
| Invio cloud ripetuto | Quando implementato: stessa registrazione riconosciuta, nessun doppio carico. |

I cartoni contati non diventano automaticamente quantità buone disponibili. Regole su scarti, controlli qualità e carico a magazzino vanno concordate e collaudate prima di attivare quell'automatismo.

## Consegna e conservazione

Conservare codice e documenti generici nel repository del progetto. Il programma LOGO! validato potrà essere versionato dopo aver escluso credenziali e dati riservati. Configurazioni di rete, database, report reali e chiavi di collegamento devono restare negli archivi locali riservati.

Prima dell'uso continuativo vanno completati trasmissione autenticata, riscontri, ripresa dopo errore, avvio automatico del servizio e procedura di backup. Annotare gli esiti del collaudo sul sistema effettivamente installato; una simulazione riuscita non sostituisce questa verifica.

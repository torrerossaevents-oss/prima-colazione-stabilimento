# Collegamento LOGO! — guida semplice

Aggiornata il 13 novembre 2026. Accompagna il pacchetto `bridge` (vedi `bridge/README.md`). Contratto con il gestionale: `docs/CONTRATTO-PONTE.md` nel repository del progetto. Questa guida **non** certifica un impianto collegato: finora il ponte è stato provato solo in simulazione.

## In due righe

Il **LOGO!** conta i cartoni dalle due fotocellule e tiene un totale che non si azzera. Il **ponte** sul PC legge quel totale sulla rete locale, segue la lavorazione aperta nel gestionale e, alla pressione del pulsante di chiusura, salva e invia il numero di cartoni. Fino al collaudo completo il gestionale continua con i conteggi manuali.

## Cosa è pronto e cosa no

| Stato | Parti |
| --- | --- |
| **Simulato e testato** (PC, senza hardware) | Logica dei sensori; contatore e baseline; chiusura con pulsante; archivio SQLite; coda e invio con ritentativi; Internet assente; PLC non raggiungibile o riavviato; PC riavviato; backup e ripristino. |
| **Implementato, da verificare sull'impianto** | Lettura Modbus del LOGO! reale; lettura del contatore a 32 bit durante il moto; riscontro scritto sul LOGO! (spento per default); collegamento al gestionale con token del dispositivo; file `.cmd` su Windows (non provati su Windows); avvio automatico. |
| **Non implementato** | Programma LOGO! conta-cartoni; carico automatico a magazzino; apertura di lavorazioni dal PC. |

## Oggi, senza hardware (Teo)

1. Installare Node.js 22.13 o superiore sul PC della linea.
2. Estrarre tutto lo ZIP in una cartella.
3. Doppio clic su `bridge\AVVIA-PROVA.cmd`. Atteso: `SIMULAZIONE SUPERATA`, A 200 cartoni, B 150, totale 350.
4. Annotare l'esito. Sono dati simulati: non vanno inseriti nel gestionale o nel magazzino.

## Dati da raccogliere (con il tecnico)

Nessun valore è assegnato da questo documento: ogni riga va rilevata sull'impianto e confermata.

| Dato | Valore |
| --- | --- |
| Modello e codice articolo del LOGO!, firmware | Da compilare |
| Versione di LOGO! Soft Comfort | Da compilare |
| Sensori: modello, tipo (barriera/riflessione), distanza tra i due fasci, posizione sul nastro | Da compilare |
| Pulsante di chiusura: modello, ingresso del LOGO!, cablaggio | Da compilare |
| Rete: IPv4 del LOGO!, IPv4 del PC, porta TCP, `unitId` Modbus | Da compilare |
| PC: nome, versione di Windows, versione di Node.js, utente che avvia il ponte | Da compilare |
| Avvio del ponte: all'accesso dell'utente oppure all'accensione | Da decidere |
| Registro contatore cumulativo: funzione 03/04, indirizzo zero-based, 1 o 2 registri, ordine parole BE/LE | Da compilare |
| Limite del contatore (16 o 32 bit) e cosa succede al superamento | Da verificare |
| Registro stato sensori (proposta: bit 0 = A, bit 1 = B, 1 = fascio interrotto) | Da confermare |
| Registro contatore richieste di chiusura (cresce di 1 a ogni pressione) | Da compilare |
| Registro di riscontro scritto dal PC (funzione 06 o 16) e cosa fa il LOGO! quando lo riceve | Da compilare |
| Ritenzione: i contatori restano dopo spegnimento e riavvio del LOGO!? | Da verificare |
| Tempo minimo del filtro sensori (rimbalzi) nel programma LOGO! | Da misurare |
| Tempo con sensori liberi prima di accettare la chiusura | Da misurare |
| Cartoni al secondo massimi possibili sulla linea | Da misurare |
| Intervallo di lettura del ponte | Da concordare |
| Responsabile e data delle verifiche | Da compilare |

Questi dati vanno in `bridge\ponte.local.json` (copia di `ponte.config.example.json`). Se ne manca uno, il servizio in modalità impianto si rifiuta di partire ed elenca i campi mancanti.

## Cosa deve fare il programma LOGO!

La logica di riferimento è in `bridge/core/sensors.mjs` ed è provata dai test: il programma LOGO! deve comportarsi allo stesso modo.

- Stato dei due sensori «AB»: `00` liberi, `10` solo il primo, `11` entrambi, `01` solo il secondo.
- Un cartone vale +1 solo con la sequenza completa `00 → 10 → 11 → 01 → 00`.
- Stesso stato ripetuto (cartone fermo): nessun effetto.
- Arretramento (`10→00`, `11→10`, `01→11`): anomalia, nessun conteggio.
- Salti (`00→11`, `00→01`, …): anomalia, nessun conteggio.
- Filtro rimbalzi: uno stato vale solo se resta uguale per il tempo minimo misurato.
- Totale cumulativo che non si azzera alla chiusura; contatore delle richieste di chiusura; registro di riscontro.

## Chiusura di una lavorazione

1. Fermare gli arrivi secondo la procedura della linea e far uscire l'ultimo cartone.
2. Premere il pulsante di chiusura **una volta**. Pressioni ripetute della stessa richiesta non creano una seconda chiusura.
3. Il ponte aspetta i sensori liberi e stabili, poi salva tutto sul PC in un'unica operazione.
4. Solo dopo il salvataggio, se le scritture sono abilitate, manda il riscontro al LOGO!.
5. Il parziale riparte da zero; il totale del LOGO! non viene azzerato.
6. Il ponte invia la chiusura al gestionale; se manca Internet la conserva e ritenta.
7. Il prodotto successivo si apre nel gestionale. Avviare la linea quando lo stato del ponte mostra la nuova lavorazione seguita.

## Prova sul campo necessaria prima dell'uso

| Prova | Esito da registrare |
| --- | --- |
| Almeno 100 cartoni contati anche a mano | Conteggio a mano = LOGO! = ponte = gestionale. |
| Più formati e velocità previsti | Ripetere la prova per ogni formato e velocità. |
| Cartone fermo tra i sensori (sosta) | Nessun conteggio in più. |
| Cartone che arretra o passa a metà | Anomalia visibile, nessun conteggio. |
| Due lavorazioni di seguito (es. 200 e 150) | Due chiusure distinte, parziale da zero, totale corretto. |
| Pressione ripetuta del pulsante | Una sola chiusura. |
| Cavo di rete del PC staccato durante una lavorazione | Chiusura conservata sul PC e inviata dopo, senza doppioni; nessuna nuova lavorazione offline. |
| Cavo del LOGO! staccato | «PLC non raggiungibile» nel log; nessuna quantità stimata; ripresa corretta. |
| Riavvio del LOGO! con lavorazione aperta | Con ritenzione: conteggio prosegue. Senza: «da verificare», nessuna quantità inventata. |
| Riavvio del PC con lavorazione aperta | Ripresa dall'archivio, nessun doppio conteggio. |
| Token revocato in Configurazione | Allarme, invii fermi, nessun evento perso. |
| Backup e ripristino | Stessi eventi e stessa baseline dopo il ripristino. |
| Chiusura vista nel gestionale | Lavorazione chiusa con il numero giusto e le eventuali anomalie. |

Una simulazione riuscita non sostituisce queste prove. I cartoni contati non diventano merce disponibile a magazzino: il carico automatico non è previsto.

## Riservatezza

Configurazioni di rete, token, archivi, log e rapporti reali restano sul PC o in archivi riservati, mai nel repository. Il programma LOGO! validato potrà essere conservato nel progetto dopo aver tolto dati riservati.

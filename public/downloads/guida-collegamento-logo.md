# Collegamento LOGO! — guida semplice

Aggiornata il 20 novembre 2026. Accompagna il pacchetto `bridge` (vedi `bridge/README.md`). Contratto con il gestionale: `docs/CONTRATTO-PONTE.md` nel repository del progetto. Questa guida **non** certifica l'impianto: il ponte è collegato e ha fatto una prima chiusura corretta, ma il collaudo è in corso.

## Stato al 20 novembre 2026

- Programma conta-cartoni caricato sul LOGO! 24CE (`docs/PROGRAMMA-LOGO-24CE.md`).
- Ingressi I1, I3 e I4 verificati; un filo allentato su I3 è stato trovato e sistemato.
- Lettura Modbus verificata: i registri coincidono con TOT, CHIUS e ANOM del display.
- Ponte collegato al gestionale con il token del dispositivo e il token di servizio di Cloudflare Access.
- Prima chiusura dal pulsante della linea: **6 cartoni**, uguali al conteggio a mano; evento confermato dal gestionale.
- **In corso:** il collaudo con almeno 100 cartoni e i casi particolari (tabella in fondo).

## In due righe

Il **LOGO!** conta i cartoni dalle due fotocellule e tiene un totale che non si azzera. Il **ponte** sul PC legge quel totale sulla rete locale, segue la lavorazione aperta nel gestionale e, alla pressione del pulsante di chiusura, salva e invia il numero di cartoni. Fino al collaudo completo ogni chiusura del ponte va confrontata con un conteggio a mano.

## Cosa è pronto e cosa no

| Stato | Parti |
| --- | --- |
| **Simulato e testato** (PC, senza hardware) | Logica dei sensori; contatore e baseline; chiusura con pulsante; archivio SQLite; coda e invio con ritentativi; Internet assente; PLC non raggiungibile o riavviato; PC riavviato; backup e ripristino. |
| **Verificato sull'impianto (20/11/2026)** | Ingressi I1, I3, I4; lettura Modbus del LOGO! reale; collegamento al gestionale con token del dispositivo e token di servizio di Access; una chiusura dal pulsante (6 cartoni). |
| **Implementato, da verificare sull'impianto** | Lettura del contatore a 32 bit durante il moto; riscontro scritto sul LOGO! (spento per default); Internet assente e ritentativi sull'impianto; tutti i file `.cmd` su Windows; avvio automatico all'accesso e backup giornaliero (`INSTALLA-AVVIO-AUTOMATICO.cmd`, vedi `bridge/README.md`). |
| **Caricato, collaudo in corso** | Programma LOGO! conta-cartoni per il LOGO! 24CE 8.4 (`docs/PROGRAMMA-LOGO-24CE.md`): soste, arretramenti, salti, ritenzione. |
| **Non implementato** | Apertura di lavorazioni dal PC. Il carico a magazzino alla chiusura è fatto dal server (regola del 14/11/2026). |

## Oggi, senza hardware (Teo)

1. Installare Node.js 22.13 o superiore sul PC della linea. Con Node.js portatile (senza installazione): Windows → **Modifica le variabili d'ambiente relative al tuo account** → variabile **Path** dell'utente → **Nuovo** → la cartella che contiene `node.exe`. In un nuovo prompt, `node --version` deve rispondere.
2. Estrarre tutto lo ZIP in una cartella.
3. Doppio clic su `bridge\AVVIA-PROVA.cmd`. Atteso: `SIMULAZIONE SUPERATA`, A 200 cartoni, B 150, totale 350.
4. Annotare l'esito. Sono dati simulati: non vanno inseriti nel gestionale o nel magazzino.

## Dati da raccogliere (con il tecnico)

Ogni riga va rilevata sull'impianto e confermata. Indirizzi IP, MAC e token non si scrivono qui: restano nei file locali del PC (`*.local.json`).

| Dato | Valore |
| --- | --- |
| Modello e codice articolo del LOGO!, firmware | LOGO! 24CE 8.4, `6ED1052-1CC08-0BA2` (progetto PC-CC01); firmware da leggere con LOGO!Soft Comfort |
| Versione di LOGO! Soft Comfort | V9.0 |
| Sensori: modello, tipo (barriera/riflessione), distanza tra i due fasci, posizione sul nastro | Datasensing S100-PR-2-B10-PK a riflessione, PNP, DARK; A su I3, B su I4. Distanza e posizione da misurare |
| Pulsante di chiusura: modello, ingresso del LOGO!, cablaggio | Schneider XB5AA21, NO, su I1 (pressione prolungata 1 s) |
| Rete: IPv4 del LOGO!, IPv4 del PC, porta TCP, `unitId` Modbus | LOGO! con indirizzo statico nella subnet del PC, fuori dall'intervallo DHCP: **riserva nel router da fare**, poi controllo con `arp -a` (`docs/PROGRAMMA-LOGO-24CE.md`, passo 1). Porta trovata provando le porte da 502 a 510: sull'impianto non era la 502. `unitId` nei file locali (modello: 1). Valori solo nei file locali |
| PC: nome, versione di Windows, versione di Node.js, utente che avvia il ponte | Da compilare |
| Avvio del ponte: all'accesso dell'utente oppure all'accensione | Da decidere |
| Registro contatore cumulativo: funzione 03/04, indirizzo zero-based, 1 o 2 registri, ordine parole BE/LE | VD0, funzione 03, parola bassa = registro 1, modulo 65536. Confermato il 20/11/2026: registri 0–5 = `[0, TOT, 0, CHIUS, 0, ANOM]` |
| Limite del contatore (16 o 32 bit) e cosa succede al superamento | Da verificare |
| Registro stato sensori (proposta: bit 0 = A, bit 1 = B, 1 = fascio interrotto) | Ingressi I3 e I4 con la funzione 02, indirizzi 2 e 3. Verificati il 20/11/2026 |
| Registro contatore richieste di chiusura (cresce di 1 a ogni pressione) | VD4, parola bassa = registro 3. Verificato con la prima chiusura dal pulsante |
| Registro di riscontro scritto dal PC (funzione 06 o 16) e cosa fa il LOGO! quando lo riceve | Da compilare |
| Ritenzione: i contatori restano dopo spegnimento e riavvio del LOGO!? | Da verificare |
| Tempo minimo del filtro sensori (rimbalzi) nel programma LOGO! | 0,05 s nel programma; da confermare alla velocità massima |
| Tempo con sensori liberi prima di accettare la chiusura | Da misurare |
| Cartoni al secondo massimi possibili sulla linea | Da misurare |
| Intervallo di lettura del ponte | Da concordare |
| Responsabile e data delle verifiche | Da compilare |

Questi dati vanno in `bridge\ponte.local.json` (copia di `ponte.config.24ce.json`). Se ne manca uno, il servizio in modalità impianto si rifiuta di partire ed elenca i campi mancanti.

## Cosa deve fare il programma LOGO!

Il programma per il LOGO! 24CE dell'impianto, blocco per blocco, è in `docs/PROGRAMMA-LOGO-24CE.md`.

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
2. Premere il pulsante di chiusura **una volta**, tenendolo premuto **almeno 2 secondi**. Il ponte deve essere in funzione: reagisce solo a una richiesta fatta mentre è acceso. Pressioni ripetute della stessa richiesta non creano una seconda chiusura.
3. Il ponte aspetta i sensori liberi e stabili, poi salva tutto sul PC in un'unica operazione.
4. Solo dopo il salvataggio, se le scritture sono abilitate, manda il riscontro al LOGO!.
5. Il parziale riparte da zero; il totale del LOGO! non viene azzerato.
6. Il ponte invia la chiusura al gestionale; se manca Internet la conserva e ritenta.
7. Il prodotto successivo si apre nel gestionale. Avviare la linea quando lo stato del ponte mostra la nuova lavorazione seguita.

## Prova sul campo necessaria prima dell'uso

| Prova | Esito da registrare |
| --- | --- |
| Almeno 100 cartoni contati anche a mano | Conteggio a mano = LOGO! = ponte = gestionale. In corso; prima chiusura di 6 cartoni corretta il 20/11/2026. |
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

Una simulazione riuscita non sostituisce queste prove. Alla chiusura i cartoni contati diventano merce a magazzino: per questo il collaudo con conteggio manuale di confronto è indispensabile prima dell'uso reale.

## Riservatezza

Configurazioni di rete, token, archivi, log e rapporti reali restano sul PC o in archivi riservati, mai nel repository. Il programma LOGO! validato potrà essere conservato nel progetto dopo aver tolto dati riservati.

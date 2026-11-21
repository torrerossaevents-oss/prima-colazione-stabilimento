# Ponte LOGO! ↔ gestionale — pacchetto per il PC dello stabilimento

Versione del 20 novembre 2026, per il LOGO! 24CE 8.4 del progetto PC-CC01 (fotocellule su I3 e I4, pulsante su I1). Il ponte è un programma che gira sul PC vicino alla linea: legge il contatore del LOGO! sulla rete locale e manda le chiusure delle lavorazioni al gestionale.

## Stato sull'impianto al 20 novembre 2026

- Programma conta-cartoni caricato sul LOGO! (`docs/PROGRAMMA-LOGO-24CE.md`).
- Ingressi **I1, I3 e I4 verificati**. Un filo allentato su I3 è stato trovato e sistemato.
- **Lettura Modbus verificata**: i registri letti coincidono con TOT, CHIUS e ANOM del display. La porta Modbus si trova provando le porte da 502 a 510 (sull'impianto non era la 502).
- **Ponte collegato al gestionale** con il token del dispositivo e il token di servizio di Cloudflare Access.
- **Prima chiusura dal pulsante della linea: 6 cartoni**, uguali al conteggio a mano; evento confermato dal gestionale.
- **Collaudo in corso**: almeno 100 cartoni contati anche a mano e i casi particolari di `docs/COLLEGAMENTO-LOGO.md`. Fino al suo esito non ci si fida del conteggio.

Il conteggio dei cartoni lo fa il **LOGO!**, con il programma di `docs/PROGRAMMA-LOGO-24CE.md`. Il ponte non conta i sensori: legge il numero totale del LOGO! e fa le differenze. Il conteggio non sostituisce arresti o sicurezze della macchina, e il pulsante di chiusura non è un arresto.

## Stato, in tre colonne

| Simulato e testato (su PC, senza hardware) | Implementato, da verificare sull'impianto | Non implementato |
| --- | --- | --- |
| Logica dei sensori `00→10→11→01→00`, soste, arretramenti, salti, rimbalzi (`core/sensors.mjs`, riferimento per il programma LOGO!) | Programma LOGO! conta-cartoni: ingressi e prima chiusura verificati il 20/11/2026, soste, arretramenti e salti da collaudare. Lettura Modbus del LOGO! reale: verificata il 20/11/2026 | |
| Contatore cumulativo, baseline, superamento del limite, contatore diminuito, letture corrotte (`core/counter.mjs`) | Lettura del contatore a 32 bit «doppia» durante il moto | |
| Chiusura con pulsante: attesa sensori liberi, salvataggio unico in SQLite, riscontro, nuova baseline, pressione ripetuta ignorata | Scrittura del riscontro sul LOGO! (funzioni 06/16), **spenta per default** | Registrazione come servizio di Windows (si usa l'Utilità di pianificazione) |
| Coda eventi con ritentativi, stesso `eventId`, tabella delle risposte del contratto (`core/transmitter.mjs`) | Collegamento al gestionale reale (`/api/devices/production`, token del dispositivo, token di servizio di Access): prima chiusura confermata il 20/11/2026; Internet assente e ritentativi da provare sull'impianto | Apertura di lavorazioni dal PC (non prevista: si aprono nel gestionale) |
| Internet assente, PLC non raggiungibile, PLC riavviato, PC riavviato (simulati) | File `.cmd` per Windows: scritti e controllati su Linux, da confermare uno per uno sul PC della linea durante il collaudo | |
| Backup e ripristino dell'archivio (`backup.mjs`) | Avvio automatico con l'Utilità di pianificazione (istruzioni sotto, non eseguite) | |

## Prova di oggi: simulazione (nessun hardware)

Serve Node.js 22.13 o superiore. Estrarre tutto lo ZIP in una cartella (vanno bene anche percorsi con spazi).

**Node.js portatile** (cartella estratta, senza installazione): cercare in Windows «variabili d'ambiente» → **Modifica le variabili d'ambiente relative al tuo account** → variabile **Path** dell'utente → **Modifica** → **Nuovo** → la cartella di Node (quella che contiene `node.exe`). Aprire un **nuovo** prompt dei comandi e controllare con `node --version`.

1. Doppio clic su `bridge\AVVIA-PROVA.cmd`. È la simulazione di protocollo completa: lavorazione A da 200 cartoni, B da 150, con sosta, arretramenti, rimbalzi, Internet perso a metà, riavvio del programma, riavvio del PLC. Alla fine deve comparire `SIMULAZIONE SUPERATA` e il totale **350**. Il rapporto `RISULTATO-SIMULAZIONE.json` è marcato `"tipo": "SIMULAZIONE"`.
2. (Facoltativo) Doppio clic su `bridge\AVVIA-SERVIZIO-SIMULAZIONE.cmd`: il servizio gira «dal vivo» con un PLC finto che produce un cartone ogni 0,3 secondi e chiude ogni 20. Si ferma con Ctrl+C. Con `STATO-PONTE.cmd` → `S` si vede lo stato.

Dal terminale, dalla cartella che contiene `bridge`:

```sh
node bridge/simulate.mjs                 # simulazione di protocollo con rapporto finale
node bridge/service.mjs --simulazione    # servizio in simulazione (Ctrl+C per fermare)
node --test bridge/tests/*.test.mjs      # test automatici
```

I dati della simulazione stanno in una cartella temporanea o in `bridge\data\simulazione`, separati dall'impianto: l'archivio di simulazione non può essere aperto in modalità impianto.

## File per Windows

| File | A cosa serve |
| --- | --- |
| `AVVIA-PROVA.cmd` | Simulazione di protocollo con rapporto finale. |
| `AVVIA-SERVIZIO-SIMULAZIONE.cmd` | Servizio con PLC e gestionale finti. |
| `AVVIA-SERVIZIO-IMPIANTO.cmd` | Servizio sull'impianto. Rifiuta di partire se manca un dato. Con `/automatico` è adatto all'Utilità di pianificazione. |
| `STATO-PONTE.cmd` | Mostra l'ultimo stato (PLC, Internet, lavorazione, coda). |
| `BACKUP-ARCHIVIO.cmd` | Copia coerente dell'archivio dell'impianto (`VACUUM INTO`), anche a servizio acceso. |
| `RIPRISTINA-ARCHIVIO.cmd` | Ripristino da un backup (servizio fermo). Si può trascinare il file di backup sopra il `.cmd`. |
| `INSTALLA-AVVIO-AUTOMATICO.cmd` | Avvio automatico del ponte all'accesso a Windows e backup giornaliero (Utilità di pianificazione). |
| `RIMUOVI-AVVIO-AUTOMATICO.cmd` | Toglie l'avvio automatico e il backup giornaliero. |
| `LEGGI-LOGO.cmd` | Lettura diagnostica del solo contatore, a linea ferma (usa `logo.config.local.json`; modello `logo.config.24ce.json`). |
| `PROVA-INGRESSI.cmd` | Mostra dal vivo pulsante (I1) e fotocellule A (I3) e B (I4). Sola lettura, funzione Modbus 02. |

**Importante:** questi `.cmd` sono stati scritti e controllati in un ambiente Linux. Ogni file va confermato sul PC dello stabilimento prima di affidarsi a esso.

## Messa in servizio sull'impianto (con il tecnico)

1. Si ricopia il programma di `docs/PROGRAMMA-LOGO-24CE.md`, lo si prova nella simulazione di LOGO!Soft Comfort e lo si trasferisce; si trova la porta Modbus (prova delle porte 502–510, passo 5 del programma); `PROVA-INGRESSI.cmd` (chiede indirizzo e porta) verifica I1, I3 e I4.
2. Copiare `ponte.config.24ce.json` (mappa del programma del progetto) in `ponte.local.json` e compilare **tutti** i campi `null` con i valori verificati, e `plc.port` con la porta che risponde. Per un altro impianto si parte da `ponte.config.example.json`. Mettere `mapConfirmed` a `true` solo dopo la verifica. Lasciare `writesEnabled` a `false` finché il riscontro non è collaudato.
3. In Configurazione del gestionale creare il dispositivo: il token `pcd_…` compare **una sola volta**. Copiare `token.example.json` in `token.local.json` e incollarlo lì, insieme a Client ID e Client Secret del token di servizio di Cloudflare Access (`docs/CLOUDFLARE.md`). Non mandarli via chat o e-mail.
4. Prima prova a linea ferma con `LEGGI-LOGO.cmd`.
5. Avviare `AVVIA-SERVIZIO-IMPIANTO.cmd`. Se manca anche un solo dato, il servizio elenca i campi mancanti e non parte.

`ponte.local.json`, `token.local.json`, `logo.config.local.json` e la cartella `bridge\data` sono esclusi da Git: non vanno mai pubblicati.

## Come lavora il ponte

- **Lavorazione:** si apre nel gestionale (codice, lotto, scadenza, operatore). Il ponte la vede entro pochi secondi e la segue partendo dal valore attuale del contatore (baseline, parziale 0). Se manca Internet continua la lavorazione già seguita, ma non ne inizia di nuove. Avviare la linea solo quando `STATO-PONTE` mostra la lavorazione seguita: i cartoni passati prima vengono segnalati nel log come «non attribuiti».
- **Parziale:** cumulativo del LOGO! − baseline. Il ponte non somma mai le letture.
- **Chiusura:** il pulsante fa crescere sul LOGO! un contatore di richieste. Il ponte vede il nuovo valore, aspetta i sensori liberi e stabili per il tempo configurato, poi salva in **un'unica transazione** SQLite lavorazione chiusa, evento da inviare e nuova baseline. Solo dopo, se `writesEnabled` è `true`, scrive il riscontro sul LOGO!. La stessa richiesta letta di nuovo non produce una seconda chiusura.
- **Invio:** ogni evento ha un identificativo fisso, creato prima del primo invio. Senza risposta, il ponte ritenta con lo stesso identificativo e attese crescenti (fino a 5 minuti). Risposte 409/422/400/413 → «da verificare» (non ritenta). 401 → invii fermi e allarme, nessun evento perso: sistemare il token e riavviare. Una pagina di accesso al posto della risposta JSON non conta come conferma.
- **Heartbeat:** ogni 30 secondi per impostazione predefinita lo stato del ponte (PLC raggiungibile, coda, parziale). Ne resta solo l'ultimo; non si accumula. Per il conteggio dal vivo sull'iPad impostare `intervals.heartbeatMs` a 6000 in `ponte.local.json` e riavviare il servizio.
- **Contatore diminuito** (PLC riavviato senza memoria, reset esterno): la lavorazione passa a «da verificare», il parziale resta fermo all'ultimo valore valido, nessuna quantità viene ricostruita. La chiusura successiva porta l'anomalia `contatore-diminuito` al gestionale.
- **Letture corrotte:** valori fuori intervallo o salti oltre `maxStepPerSecond` × secondi trascorsi vengono scartati e segnalati.
- **Contatore a 32 bit su due registri:** il ponte legge due volte e accetta solo letture uguali, oppure con la stessa parola alta e valore non diminuito. È una **mitigazione**, non una prova che la lettura sia atomica: va verificata sull'impianto. Meglio ancora se il programma LOGO! offre una copia congelata del contatore.

## Diagnosi

- **«Timeout del collegamento Modbus»**: il LOGO! non accetta connessioni su quella porta. Controllare che l'accesso Modbus sia abilitato sul dispositivo e provare le porte da 502 a 510. **«Timeout della risposta Modbus»**: il collegamento c'è, ma il LOGO! non risponde alla richiesta: provare `unitId` 255.
- Il pulsante CHIUDI va tenuto premuto almeno 2 secondi. Il ponte reagisce solo a una richiesta fatta mentre è in funzione.

- `bridge\data\impianto\stato.json`: ultimo ciclo, ultima lettura PLC, ultimo contatto e heartbeat, lavorazione, coda. `STATO-PONTE.cmd` lo mostra in chiaro e avvisa se è vecchio di oltre 90 secondi.
- `bridge\data\impianto\log\ponte.log`: righe leggibili con data UTC e livello (`INFO`, `AVVISO`, `ALLARME`). Rotazione automatica: 5 file da 1 MB al massimo.
- Messaggi distinti per: Internet/gestionale assente, LAN/PLC non raggiungibile, PLC riavviato (contatore diminuito), ripresa dopo riavvio del PC, token rifiutato.
- Un solo servizio per archivio: un secondo avvio sulla stessa cartella viene rifiutato.

## Avvio automatico (21/11/2026)

`INSTALLA-AVVIO-AUTOMATICO.cmd` registra con l'Utilità di pianificazione di Windows, per l'utente che lo lancia, due attività:

| Attività | Quando | Cosa fa |
| --- | --- | --- |
| «Prima Colazione Ponte» | all'accesso a Windows di quell'utente | avvia `AVVIA-SERVIZIO-IMPIANTO.cmd /automatico` in una finestra ridotta a icona; se il servizio si ferma con errore riprova ogni 60 s |
| «Prima Colazione Backup ponte» | ogni giorno alle 13:10, oppure appena possibile se il PC era spento | `BACKUP-ARCHIVIO.cmd /automatico`: copia verificata dell'archivio, restano gli ultimi 30 |

- Prima di installare chiudere la finestra del ponte aperta a mano (Ctrl+C, poi S): l'installatore si rifiuta se trova un ponte già in funzione.
- In modalità automatica nulla viene scritto nella finestra (un clic non può metterla in pausa): ogni avvio, errore e nuovo tentativo è in `bridge\data\impianto\avvio-automatico.log`, il resto nel log del ponte. L'esito dei backup è in `backup-automatico.log`.
- Il blocco «un solo servizio» (`ponte.lock`) registra anche l'istante di accensione del PC: dopo un'interruzione di corrente o un arresto forzato non impedisce il riavvio.
- `RIMUOVI-AVVIO-AUTOMATICO.cmd` toglie le due attività; non ferma un ponte già in funzione. `powershell -NoProfile -ExecutionPolicy Bypass -File bridge\avvio-automatico.ps1 -Azione Stato` mostra lo stato delle attività.
- **Limite:** l'avvio è all'accesso dell'utente. Se Windows si riavvia di notte (aggiornamenti), il ponte resta fermo finché qualcuno non accede. Impostare le «ore di attività» di Windows Update (vedi sotto). Accesso automatico o avvio senza accesso con un account dedicato sono scelte di sicurezza da decidere con chi gestisce il PC: non sono configurati.

### Verifica dopo l'installazione

1. Entro 30 secondi `STATO-PONTE.cmd` mostra il ponte aggiornato e nel gestionale (Configurazione → Dispositivi) il PC di linea è «Attivo».
2. Riavviare il PC e accedere: entro un minuto di nuovo «Attivo», senza aprire nulla a mano.
3. Da una finestra nera `taskkill /F /IM node.exe`: entro circa 60 secondi il ponte riparte da solo (riga «nuovo tentativo» nel log di avvio).
4. Un doppio clic su `AVVIA-SERVIZIO-IMPIANTO.cmd` mentre il ponte automatico è attivo viene rifiutato con «Servizio già in esecuzione»: corretto.

## PC della linea: impostazioni consigliate

- **Sospensione:** Impostazioni → Sistema → Alimentazione e sospensione → Sospensione: **Mai**. Lo schermo può spegnersi.
- **Windows Update:** Impostazioni → Aggiornamento e sicurezza → Windows Update → **Modifica orario di attività**, coprendo i turni della linea: Windows non si riavvia in quelle ore.
- **Scheda di rete:** Gestione dispositivi → Schede di rete → scheda Ethernet → Proprietà → Risparmio energia → togliere «Consenti al computer di spegnere il dispositivo per risparmiare energia».
- **Finestre nere:** clic destro sulla barra del titolo → Proprietà → Opzioni → togliere «Modalità Modifica rapida». Con la finestra manuale un clic dentro mette in pausa il programma.
- **Non disconnettere l'utente** a fine turno: bloccare lo schermo (Windows + L) va bene, la disconnessione ferma il ponte.

## Backup

`BACKUP-ARCHIVIO.cmd` crea in `bridge\data\impianto\backup` una copia verificata dell'archivio (con l'avvio automatico installato succede ogni giorno da sola). `RIPRISTINA-ARCHIVIO.cmd` richiede il servizio fermo, controlla il file e salva prima una copia dell'archivio attuale (`prima-del-ripristino-…`).

**Copia fuori dal PC (chiavetta o archivio riservato), dopo ogni modifica e almeno una volta al mese:**
- il programma LOGO! (`.lsc` salvato da LOGO!Soft Comfort);
- `bridge\ponte.local.json` e `bridge\logo.config.local.json`;
- la cartella `bridge\data\impianto\backup`.

`token.local.json` **non** va copiato: se il PC si guasta si revoca il dispositivo in Configurazione e se ne crea uno nuovo; il token di servizio di Cloudflare si rigenera nello stesso modo. La chiavetta contiene comunque indirizzi e configurazioni della rete interna: va conservata come documento riservato.

## Dati ancora necessari

Firmware del LOGO!, distanza e posizione delle fotocellule, riserva dell'indirizzo del LOGO! nel router, PC e versione di Windows, modalità di avvio (all'accesso o all'accensione), registro di riscontro, comportamento con ritenzione allo spegnimento, tempi misurati (sensori liberi prima della chiusura, intervallo di lettura) e cartoni al secondo massimi. L'elenco aggiornato è in `docs/COLLEGAMENTO-LOGO.md`. Indirizzi di rete, MAC e token restano solo nei file locali del PC.

## Nota sui file interni

`core/ledger.mjs` è l'archivio della prova del 9 novembre ed è conservato con i suoi test; il servizio usa `core/store.mjs`. I moduli `sim-*.mjs` e `modbus-sim-server.mjs` servono solo alla simulazione e ai test: la loro mappa di registri è di comodo e non va copiata nella configurazione reale.

# Programma LOGO! conta-cartoni — LOGO! 24CE 8.4

Aggiornato il 20 novembre 2026. Vale per l'impianto del progetto **PC-CC01 Rev. 02**, già montato e cablato. È il programma da realizzare in LOGO!Soft Comfort V9: qui ci sono i blocchi, i collegamenti e la mappa letta dal ponte.

**Stato:** programma caricato sul LOGO! dell'impianto fra il 18 e il 20 novembre 2026. Verificati gli ingressi I1, I3 e I4, la lettura Modbus e una prima chiusura dal pulsante della linea (6 cartoni, uguali al conteggio a mano). Il collaudo completo (almeno 100 cartoni e casi particolari, `docs/COLLEGAMENTO-LOGO.md`, tavola 15 del progetto) è in corso: fino al suo esito non ci si fida del conteggio.

I nomi dei menu e dei blocchi sono quelli della versione italiana di LOGO!Soft Comfort V9 usata nella messa in servizio. In un'altra versione possono cambiare leggermente: se una voce non si trova, va cercata con l'aiuto in linea del programma (F1).

## L'impianto

| Sigla | Componente | Collegamento |
| --- | --- | --- |
| A1 | Siemens LOGO! 24CE 8.4, `6ED1052-1CC08-0BA2` | in rete con il PC, cavo Ethernet |
| B1 | Fotocellula **A** (la prima che il cartone incontra), Datasensing S100-PR-2-B10-PK, PNP, DARK | **I3** |
| B2 | Fotocellula **B** (la seconda), stesso modello | **I4** |
| S1 | Pulsante CHIUDI / SALVA, Schneider XB5AA21, contatto NO | **I1** |
| PS1 | LOGO! POWER 24 V / 1,3 A | alimentazione |

Con la modalità DARK un ingresso vale **1 quando il cartone copre il fascio** e 0 quando il fascio è libero. Le uscite Q1–Q4 non sono usate: il LOGO! non comanda il nastro né le sicurezze, e il pulsante non è un arresto.

## Cosa fa il programma

- Conta **+1 cartone** solo con la sequenza completa `00 → 10 → 11 → 01 → 00`, cioè prima solo A, poi A e B, poi solo B, poi entrambe libere. È la stessa regola di `bridge/core/sensors.mjs`.
- Un cartone fermo sotto le fotocellule non conta due volte.
- Un cartone che torna indietro, o una sequenza che salta un passaggio, non conta e aumenta il contatore delle **anomalie**. Il conteggio riparte pulito quando entrambe le fotocellule sono libere.
- All'accensione, se c'è un cartone sotto le fotocellule, quel passaggio non conta e diventa un'anomalia.
- Un filtro di 0,05 s toglie i rimbalzi delle fotocellule.
- La **pressione prolungata** del pulsante (1 s) aumenta di 1 il contatore delle **richieste di chiusura**. Il ponte legge la richiesta, aspetta le fotocellule libere, salva e chiude la lavorazione nel gestionale. Il LOGO! non azzera mai il totale.
- I tre contatori sono **ritentivi**: non si perdono se manca la corrente.
- Il display mostra totale, anomalie e richieste. Il parziale della lavorazione si vede nel gestionale e sull'iPad.

## Passo 1 — Dispositivo e accesso dal PC

1. **File → Nuovo → Progetto di rete**, oppure si continua nella *Vista di rete* già aperta.
2. **Aggiungi nuovo dispositivo** → **LOGO! 8.4** (per `0BA2` scegliere la versione 8.4 o quella più recente proposta). Indirizzo IP: quello statico scelto per il LOGO! (vedi sotto), con la subnet della rete del PC. Il dispositivo `Unknown_1` si può togliere dal progetto.
3. In **Impostazioni offline** → **Generale** attivare **Consenti accesso Modbus**. La verifica sul dispositivo è al passo 5.
4. Lasciare spenta la protezione con password del programma finché il collaudo non è finito, oppure annotarla in un luogo riservato.

### Indirizzo IP del LOGO!

L'indirizzo reale dell'impianto non si scrive in questo documento né nel repository: resta nei file locali del PC (`*.local.json`).

- Dare al LOGO! un **indirizzo statico nella stessa subnet del PC della linea**, ma **fuori dall'intervallo DHCP del router**: ridurre l'intervallo (per esempio farlo finire a `.199`) oppure riservare l'indirizzo nel router. Altrimenti il router può assegnare lo stesso indirizzo a un altro apparecchio.
- Dopo ogni cambio, dal PC: `ping <ip>` e poi `arp -a <ip>`. Il MAC mostrato deve essere quello del LOGO! elencato in LOGO!Soft Comfort. Durante la messa in servizio un conflitto di indirizzo faceva rispondere al ping un altro apparecchio, mentre le porte del LOGO! sembravano chiuse.
- **Cambiare l'indirizzo:** dal menu del display (raggiungibile solo in STOP), oppure da LOGO!Soft Comfort → **Impostazioni** → **Impostazioni online** → selezionare il dispositivo → **Collega** → **Assegna indirizzo IP**.
- Se un conflitto di indirizzo impedisce **Collega**, sul PC (prompt dei comandi come amministratore) si crea una voce temporanea che punta al MAC del LOGO!:

  ```bat
  netsh interface ipv4 add neighbors "Ethernet" <ip> <mac-del-logo>
  ```

  Finita l'operazione la si toglie: `netsh interface ipv4 delete neighbors "Ethernet" <ip>`. `"Ethernet"` è il nome della scheda di rete del PC; se è diverso, usare quello mostrato da `ipconfig`.

## Passo 2 — Blocchi da inserire

Inserire i blocchi **in questo ordine**, così LOGO!Soft Comfort assegna gli stessi numeri (B001, B002, …) e i controlli coincidono. Le porte AND hanno 4 ingressi: quelli non collegati valgono 1. Le porte OR hanno 4 ingressi: quelli non collegati valgono 0.

**Tempi.** Nei blocchi temporizzati si sceglie l'unità **Secondi (s:1/100s)**: il valore si scrive secondi : centesimi. 0,05 s = `0 : 5`; 0,02 s = `0 : 2`; 0,20 s = `0 : 20`; 1,00 s = `1 : 0`.

**Blocchi senza uscita collegata.** Le uscite di B035, B036 e B037 vanno collegate ciascuna a un blocco **Morsetto aperto** (X), in **Costanti** → **Digitale**. Senza, il trasferimento si ferma con l'errore «blocchi senza collegamenti senza un'uscita». L'ingresso di M8 resta non collegato.

**Filtro e stati delle fotocellule**

| Blocco | Funzione | Ingressi | Parametri | Significato |
| --- | --- | --- | --- | --- |
| B001 | Accensione/spegnimento ritardati (due tempi) | Trg = I3 | accensione 0,05 s; spegnimento 0,05 s | **A** filtrata |
| B002 | Accensione/spegnimento ritardati (due tempi) | Trg = I4 | accensione 0,05 s; spegnimento 0,05 s | **B** filtrata |
| B003 | NOT | B001 | | non A |
| B004 | NOT | B002 | | non B |
| B005 | AND | B001, B004 | | stato **10**, solo A |
| B006 | AND | B001, B002 | | stato **11**, A + B |
| B007 | AND | B003, B002 | | stato **01**, solo B |
| B008 | AND | B003, B004 | | stato **00**, entrambe libere |
| B009 | Accensione ritardata | Trg = B008 | T 0,02 s | libere e stabili: azzera i passi |

**Passi del cartone** (blocco **Relè a ritenzione RS**, in **Funzioni speciali** → **Varie**: S imposta, R azzera e ha la precedenza; non ritentivi. Non è il «Relè a impulso di corrente».)

| Blocco | Funzione | Ingressi | Significato |
| --- | --- | --- | --- |
| B010 | Relè a ritenzione RS | S = B005; R = B009 | **P1**: visto solo A |
| B011 | AND | B006, B010 | |
| B012 | Relè a ritenzione RS | S = B011; R = B009 | **P2**: visto A + B dopo P1 |
| B013 | AND | B007, B012 | |
| B014 | Relè a ritenzione RS | S = B013; R = B009 | **P3**: visto solo B dopo P2 |

**Anomalie del passaggio**

| Blocco | Funzione | Ingressi | Caso |
| --- | --- | --- | --- |
| B015 | NOT | B014 | non P3 |
| B016 | NOT | B010 | non P1 |
| B017 | NOT | B012 | non P2 |
| B018 | AND | B005, B012 | solo A dopo P2: il cartone torna indietro |
| B019 | AND | B006, B016 | A + B senza P1: salto |
| B020 | AND | B006, B014 | A + B dopo P3: il cartone torna indietro |
| B021 | AND | B007, B017 | solo B senza P2: salto |
| B022 | AND | B008, B010, B015 | libere dopo P1 senza P3: passaggio incompleto |
| B023 | OR | I3, I4 | un fascio coperto (segnale diretto) |
| B024 | Spegnimento ritardato | Trg = **M8** (merker di avviamento); T 0,20 s | finestra di avvio |
| B025 | AND | B023, B024 | cartone presente all'accensione |
| B026 | OR | B018, B019, B020, B021 | |
| B027 | OR | B022, B025, B026 | **anomalia** |
| B028 | NOT | B024 | avvio terminato |
| B029 | AND | B009, B028 | libere e stabili, dopo l'avvio |
| B030 | Relè a ritenzione RS | S = B027; R = B029 | **X**: passaggio non valido |
| B031 | NOT | B030 | passaggio valido |

**Conteggio**

| Blocco | Funzione | Ingressi | Parametri | Significato |
| --- | --- | --- | --- | --- |
| B032 | AND | B008, B014, B031 | | **+1 cartone** |
| B033 | Contatore avanti/indietro, nome `CARTONI` | Cnt = B032; Dir non collegato (avanti); R = **M1** | On 983040; Off 983040; valore iniziale 0; **ritentivo** | totale cartoni |
| M1 | Merker | ingresso = uscita Q di B033 | | riporta a 0 il totale a 983040 |
| B034 | Accensione ritardata | Trg = I1 | T 1,00 s | pressione prolungata |
| B035 | Contatore avanti/indietro, nome `RICHIESTE` | Cnt = B034 | On e Off 0; **ritentivo** | richieste di chiusura |
| B036 | Contatore avanti/indietro, nome `ANOMALIE` | Cnt = B030 | On e Off 0; **ritentivo** | passaggi non contati |
| B037 | Testi di segnalazione | En = costante **Stato 1 (high)** | vedi sotto | display |

I contatori sono **Contatore avanti/indietro**; sul blocco gli ingressi sono, dall'alto: **R** (azzeramento), **Cnt** (conteggio), **Dir** (direzione). Le uscite di B035, B036 e B037 vanno al Morsetto aperto (X).

Il totale riparte da 0 a 983040 = 15 × 65536. Il ponte legge la parola bassa del contatore, quindi il conteggio prosegue senza salti. Il ponte non ricostruisce mai quantità: lavora sulle differenze.

**Testo del display (B037)**, una riga per voce. Per inserire il valore di un contatore si sceglie il blocco e il parametro **Contatore**:

```
CONTA CARTONI
TOT  [B033 Contatore]
ANOM [B036 Contatore]
CHIUS[B035 Contatore]
```

## Passo 3 — Mappa per il ponte (Mappatura parametri VM)

Con lo schema aperto e attivo, la **Mappatura parametri VM** si trova nel menu **Impostazioni** (o **Strumenti**, secondo la versione). Aggiungere:

| Blocco | Parametro | Tipo | Indirizzo VM | Letto dal ponte |
| --- | --- | --- | --- | --- |
| B033 `CARTONI` | Cnt (valore attuale) | DWord | **VD0** | parola bassa VW2 = registro **1** |
| B035 `RICHIESTE` | Cnt | DWord | **VD4** | parola bassa VW6 = registro **3** |
| B036 `ANOMALIE` | Cnt | DWord | **VD8** | solo diagnosi |

Gli ingressi I3 e I4 si leggono direttamente con la funzione Modbus 02: indirizzi **2** e **3** (base zero). VW20 resta libero per il riscontro, che per ora è spento (`writesEnabled: false`).

La tabella **Area indirizzi Modbus** di LOGO!Soft Comfort conferma la mappa: I1–24 → ingressi digitali 1–24, VW0–848 → holding register 1–425. La tabella conta da 1, il ponte usa la base zero (VW0 = registro 0). Una lettura reale dei registri 0–5 ha dato `[0, TOT, 0, CHIUS, 0, ANOM]`, con i valori del display.

## Passo 4 — Prova in simulazione su PC

Prima di trasferire niente: **Strumenti → Simulazione** (F3). Agendo sugli ingressi simulati:

| Sequenza | Atteso sul display simulato |
| --- | --- |
| I3 = 1, I4 = 1, I3 = 0, I4 = 0 | TOT +1 |
| I3 = 1, poi I3 = 0 | TOT invariato, ANOM +1 |
| I4 = 1, poi I4 = 0 | TOT invariato, ANOM +1 |
| I3 = 1, I4 = 1, I4 = 0 (torna indietro), I3 = 0 | TOT invariato, ANOM +1 |
| I1 tenuto premuto 1 s | CHIUS +1 (una sola volta anche tenendolo di più) |

Lasciare ogni passo almeno mezzo secondo, per superare il filtro.

Con il LOGO! collegato, il **Test online** mostra lo schema con i valori reali: è l'icona nella barra dell'editor dello schema, a destra del pulsante SIM.

## Passo 5 — Trasferimento e prime verifiche sull'impianto

1. **Trasferimento:** Ctrl+D (**Download di rete**). Spuntare **Impostazione del download**, **Avvio automatico del dispositivo** e **Sovrascrivi nome dispositivo**; lasciare senza spunta **Copia scheda SD**. Poi il LOGO! deve essere in **RUN**. Il LOGO! non comanda nulla: il trasferimento non ferma la linea.
2. **Accesso Modbus sul dispositivo:** in **Impostazioni online** → **Impostazioni comando accesso** (serve il LOGO! in STOP) deve comparire «L'accesso Modbus è abilitato». **Modo operativo** offre normale o slave: lasciare **Modalità normale**. Poi rimettere il LOGO! in RUN con **Avvio** dal display, oppure togliendo e ridando alimentazione.
3. **Porta Modbus:** di norma 502, ma il LOGO! può rispondere su un'altra porta (sull'impianto era la 510). Dal PC si provano le porte da 502 a 510:

   ```bat
   powershell -Command "502..510 | % { '{0} {1}' -f $_, (Test-NetConnection <ip> -Port $_ -WarningAction SilentlyContinue).TcpTestSucceeded }"
   ```

   La porta con `True` va in `port` / `plc.port` dei file locali.
4. Sul PC, `bridge\PROVA-INGRESSI.cmd`: chiede indirizzo e porta (Invio = 502). Coprire solo A (deve cambiare solo I3), solo B (solo I4), premere il pulsante (I1). È la prova 01 del collaudo. In alternativa si usa il **Test online**.
5. Copiare `bridge\logo.config.24ce.json` in `bridge\logo.config.local.json`, scrivere l'IP del LOGO! in `host`, la porta trovata in `port` e mettere `mapConfirmed` a `true`. Con la linea ferma lanciare `LEGGI-LOGO.cmd`: il cumulativo letto deve essere uguale a TOT sul display. Se il collegamento non riesce, il messaggio dice quale caso è: «Timeout del collegamento» = il LOGO! non accetta connessioni su quella porta (accesso Modbus, porte 502–510); «Timeout della risposta» = collegato ma senza risposta (provare `unitId` 255).
6. Far passare a mano qualche cartone: TOT sul display e una nuova lettura devono salire insieme.

## Passo 6 — Ponte collegato al gestionale

1. Copiare `bridge\ponte.config.24ce.json` in `bridge\ponte.local.json` e completare: `line`, `server.baseUrl`, `plc.host`, `plc.port` (quella trovata al passo 5), `plc.counter.maxStepPerSecond` (cartoni al secondo massimi, misurati), `close.sensorsFreeStableMs` (proposta 2000) e `mapConfirmed: true` dopo i passi precedenti.
2. In Configurazione del gestionale creare il dispositivo della linea e copiare il token in `bridge\token.local.json`. Il token non va mai in chat o via e-mail.
3. Avviare `AVVIA-SERVIZIO-IMPIANTO.cmd` e seguire il collaudo di `docs/COLLEGAMENTO-LOGO.md`.

**Uso del pulsante CHIUDI.** Tenerlo premuto **almeno 2 secondi**: il programma registra la richiesta dopo 1 s (B034), i 2 s danno margine. Il ponte legge l'aumento del contatore delle richieste. **CHIUDI premuto a ponte spento** (dal ponte 1.3.1): alla ripartenza il ponte chiude la lavorazione **solo se la seguiva già prima dello spegnimento**, con i cartoni contati nel frattempo dal LOGO!. Se invece la lavorazione viene seguita solo da quell'avvio, per esempio perché è stata aperta nel gestionale mentre il ponte era spento, **non** viene chiusa: nel log compare un AVVISO e per chiuderla si preme di nuovo CHIUDI con il ponte acceso.

## Tempi da verificare sulla linea

Il filtro di 0,05 s richiede che ogni fase del passaggio duri di più, anche alla velocità massima: solo A e solo B durano `d / v`, A + B dura `(L − d) / v`, la zona libera fra due cartoni `(g − d) / v` (tavola 05 del progetto). Con un margine prudente ogni fase dovrebbe durare almeno 0,1 s. Se una fase è più breve, si avvicinano le fotocellule o si riduce il filtro, e si ripete il collaudo.

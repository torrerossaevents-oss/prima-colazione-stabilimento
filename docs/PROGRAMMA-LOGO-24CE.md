# Programma LOGO! conta-cartoni — LOGO! 24CE 8.4

Aggiornato il 17 novembre 2026. Vale per l'impianto del progetto **PC-CC01 Rev. 02**, già montato e cablato. È il programma da realizzare in LOGO!Soft Comfort V9: qui ci sono i blocchi, i collegamenti e la mappa letta dal ponte. Nessuna parte è ancora stata provata sull'impianto. Prima di fidarsi del conteggio va superato il collaudo (`docs/COLLEGAMENTO-LOGO.md`, tavola 15 del progetto).

I nomi dei menu di LOGO!Soft Comfort sono indicativi: possono cambiare leggermente fra le versioni. Se una voce non si trova, va cercata con l'aiuto in linea del programma (F1).

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
2. **Aggiungi nuovo dispositivo** → **LOGO! 8.4** (per `0BA2` scegliere la versione 8.4 o quella più recente proposta). Indirizzo IP: lo stesso già visto in rete (192.168.0.3), subnet 255.255.255.0. Il dispositivo `Unknown_1` si può togliere dal progetto.
3. Nelle impostazioni del dispositivo (**Impostazioni offline**), alla voce **Generale** o **Connessioni Ethernet**, attivare **Consenti accesso Modbus** (*Modbus access*). Porta 502.
4. Lasciare spenta la protezione con password del programma finché il collaudo non è finito, oppure annotarla in un luogo riservato.

## Passo 2 — Blocchi da inserire

Inserire i blocchi **in questo ordine**, così LOGO!Soft Comfort assegna gli stessi numeri (B001, B002, …) e i controlli coincidono. Le porte AND hanno 4 ingressi: quelli non collegati valgono 1. Le porte OR hanno 4 ingressi: quelli non collegati valgono 0.

**Filtro e stati delle fotocellule**

| Blocco | Funzione | Ingressi | Parametri | Significato |
| --- | --- | --- | --- | --- |
| B001 | Ritardo all'inserzione/disinserzione | Trg = I3 | TH 0,05 s; TL 0,05 s | **A** filtrata |
| B002 | Ritardo all'inserzione/disinserzione | Trg = I4 | TH 0,05 s; TL 0,05 s | **B** filtrata |
| B003 | NOT | B001 | | non A |
| B004 | NOT | B002 | | non B |
| B005 | AND | B001, B004 | | stato **10**, solo A |
| B006 | AND | B001, B002 | | stato **11**, A + B |
| B007 | AND | B003, B002 | | stato **01**, solo B |
| B008 | AND | B003, B004 | | stato **00**, entrambe libere |
| B009 | Ritardo all'inserzione | Trg = B008 | T 0,02 s | libere e stabili: azzera i passi |

**Passi del cartone** (relè ad autoritenuta: S imposta, R azzera e ha la precedenza; non ritentivi)

| Blocco | Funzione | Ingressi | Significato |
| --- | --- | --- | --- |
| B010 | Relè ad autoritenuta | S = B005; R = B009 | **P1**: visto solo A |
| B011 | AND | B006, B010 | |
| B012 | Relè ad autoritenuta | S = B011; R = B009 | **P2**: visto A + B dopo P1 |
| B013 | AND | B007, B012 | |
| B014 | Relè ad autoritenuta | S = B013; R = B009 | **P3**: visto solo B dopo P2 |

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
| B024 | Ritardo alla disinserzione | Trg = **M8** (merker di avviamento); T 0,20 s | finestra di avvio |
| B025 | AND | B023, B024 | cartone presente all'accensione |
| B026 | OR | B018, B019, B020, B021 | |
| B027 | OR | B022, B025, B026 | **anomalia** |
| B028 | NOT | B024 | avvio terminato |
| B029 | AND | B009, B028 | libere e stabili, dopo l'avvio |
| B030 | Relè ad autoritenuta | S = B027; R = B029 | **X**: passaggio non valido |
| B031 | NOT | B030 | passaggio valido |

**Conteggio**

| Blocco | Funzione | Ingressi | Parametri | Significato |
| --- | --- | --- | --- | --- |
| B032 | AND | B008, B014, B031 | | **+1 cartone** |
| B033 | Contatore avanti/indietro, nome `CARTONI` | Cnt = B032; Dir non collegato (avanti); R = **M1** | On 983040; Off 983040; valore iniziale 0; **ritentivo** | totale cartoni |
| M1 | Merker | ingresso = uscita Q di B033 | | riporta a 0 il totale a 983040 |
| B034 | Ritardo all'inserzione | Trg = I1 | T 1,00 s | pressione prolungata |
| B035 | Contatore avanti/indietro, nome `RICHIESTE` | Cnt = B034 | On e Off 0; **ritentivo** | richieste di chiusura |
| B036 | Contatore avanti/indietro, nome `ANOMALIE` | Cnt = B030 | On e Off 0; **ritentivo** | passaggi non contati |
| B037 | Testi di segnalazione | En = **hi** (livello alto) | vedi sotto | display |

Il totale riparte da 0 a 983040 = 15 × 65536. Il ponte legge la parola bassa del contatore, quindi il conteggio prosegue senza salti. Il ponte non ricostruisce mai quantità: lavora sulle differenze.

**Testo del display (B037)**, una riga per voce, inserendo il valore attuale (Cnt) di ogni contatore:

```
CONTA CARTONI
TOT  [B033 Cnt]
ANOM [B036 Cnt]
CHIUS[B035 Cnt]
```

## Passo 3 — Mappa per il ponte (Mappatura parametri VM)

Nelle impostazioni (**Mappatura parametri VM** / *Parameter VM Mapping*) aggiungere:

| Blocco | Parametro | Tipo | Indirizzo VM | Letto dal ponte |
| --- | --- | --- | --- | --- |
| B033 `CARTONI` | Cnt (valore attuale) | DWord | **VD0** | parola bassa VW2 = registro **1** |
| B035 `RICHIESTE` | Cnt | DWord | **VD4** | parola bassa VW6 = registro **3** |
| B036 `ANOMALIE` | Cnt | DWord | **VD8** | solo diagnosi |

Gli ingressi I3 e I4 si leggono direttamente con la funzione Modbus 02: indirizzi **2** e **3** (base zero). VW20 resta libero per il riscontro, che per ora è spento (`writesEnabled: false`).

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

## Passo 5 — Trasferimento e prime verifiche sull'impianto

1. **Trasferisci → PC → LOGO!**, poi mettere il LOGO! in **RUN**. Il LOGO! è nuovo e non comanda nulla: il trasferimento non ferma la linea.
2. Sul PC, `bridge\PROVA-INGRESSI.cmd` con l'indirizzo del LOGO!: coprire solo A (deve cambiare solo I3), solo B (solo I4), premere il pulsante (I1). È la prova 01 del collaudo. In alternativa si usa il **Test online** di LOGO!Soft Comfort.
3. Copiare `bridge\logo.config.24ce.json` in `bridge\logo.config.local.json`, scrivere l'IP del LOGO! in `host` e mettere `mapConfirmed` a `true`. Con la linea ferma lanciare `LEGGI-LOGO.cmd`: il cumulativo letto deve essere uguale a TOT sul display. Se il LOGO! non risponde, provare `unitId` 255.
4. Far passare a mano qualche cartone: TOT sul display e una nuova lettura devono salire insieme.

## Passo 6 — Ponte collegato al gestionale

1. Copiare `bridge\ponte.config.24ce.json` in `bridge\ponte.local.json` e completare: `line`, `server.baseUrl`, `plc.host`, `plc.counter.maxStepPerSecond` (cartoni al secondo massimi, misurati), `close.sensorsFreeStableMs` (proposta 2000) e `mapConfirmed: true` dopo i passi precedenti.
2. In Configurazione del gestionale creare il dispositivo della linea e copiare il token in `bridge\token.local.json`. Il token non va mai in chat o via e-mail.
3. Avviare `AVVIA-SERVIZIO-IMPIANTO.cmd` e seguire il collaudo di `docs/COLLEGAMENTO-LOGO.md`.

## Tempi da verificare sulla linea

Il filtro di 0,05 s richiede che ogni fase del passaggio duri di più, anche alla velocità massima: solo A e solo B durano `d / v`, A + B dura `(L − d) / v`, la zona libera fra due cartoni `(g − d) / v` (tavola 05 del progetto). Con un margine prudente ogni fase dovrebbe durare almeno 0,1 s. Se una fase è più breve, si avvicinano le fotocellule o si riduce il filtro, e si ripete il collaudo.

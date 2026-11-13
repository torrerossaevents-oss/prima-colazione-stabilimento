# Contratto ponte LOGO! ↔ gestionale (versione 1, 13 novembre 2026)

Stato: **implementato e provato solo con simulatore e test automatici**. Nessun impianto reale è stato collegato. L'attivazione richiede un dispositivo registrato in Configurazione e il collaudo descritto in `COLLAUDO.md`.

## Architettura

```
LOGO! (LAN, Modbus TCP) → ponte sul PC locale (archivio SQLite persistente) → HTTPS → /api/devices/production
```

- Modbus/PLC non sono mai esposti su Internet; il client TCP non è nel browser né nel Worker.
- Il ponte non avvia lavorazioni: l'identificazione (codice esatto, lotto, scadenza, operatore) avviene nel gestionale. Il ponte segue la lavorazione attiva della propria linea.
- Il carico automatico a magazzino **non** è previsto da questo contratto.

## Autenticazione

- Credenziale di dispositivo dedicata: `Authorization: Bearer <token>`.
- Il token (32 byte casuali, base64url, prefisso `pcd_`) è mostrato **una sola volta** alla creazione in Configurazione; il server conserva solo l'hash SHA-256. Revoca immediata da Configurazione.
- Mai usare cookie o token della sessione personale nel ponte o nel codice pubblico.
- Se la piattaforma di pubblicazione blocca le richieste senza login prima che arrivino al Worker, il ponte non può raggiungere l'endpoint: va verificato sul sito ospitato (vedi «Limiti noti»).

## GET /api/devices/production

Risposta `200`:

```json
{ "serverTime": "2026-11-13T08:00:00.000Z", "line": "linea-1", "deviceId": "dev_…",
  "activeSession": { "id": "…", "productCode": "00123", "productName": "…", "lotCode": "…",
                     "expiry": "2027-01-31", "unitsPerBox": 1, "startedAt": "…", "operator": "…",
                     "source": "device" } }
```

`activeSession` è `null` se nessuna lavorazione è aperta, oppure se quella aperta è manuale (`source: "manual"`): il ponte non deve contare per una lavorazione manuale.

## POST /api/devices/production

Corpo JSON, massimo 16 kB. Ogni evento ha un `eventId` stabile (`[A-Za-z0-9_-]{8,128}`) generato e salvato dal ponte **prima** del primo invio; i ritentativi riusano lo stesso `eventId`.

### Chiusura (`session.close`)

```json
{ "eventId": "evt_…", "type": "session.close", "sessionId": "…", "closeRequestId": "req_…",
  "counterStart": 120034, "counterEnd": 120234, "cartons": 200,
  "closedAt": "2026-11-13T09:15:00.000Z", "anomalies": [] }
```

- `cartons` = differenza dalla baseline calcolata dal ponte; il server verifica `cartons === counterEnd − counterStart` (oppure con rollover dichiarato `counterModulo`).
- Il server registra la chiusura una sola volta, con ricevuta permanente sull'`eventId`.
- `anomalies` (facoltativo, max 20 stringhe brevi): es. `"arretramento"`, `"sequenza-incompleta"`, `"contatore-diminuito"`. Vengono salvate nella lavorazione per il controllo.

### Stato (`heartbeat`)

```json
{ "eventId": "hb_…", "type": "heartbeat", "at": "…", "bridgeVersion": "1.0.0",
  "plc": { "reachable": true, "lastReadAt": "…" }, "queueLength": 0,
  "session": { "id": "…", "cartons": 57 } }
```

Il heartbeat non modifica lo stato operativo: aggiorna soltanto la riga di stato del dispositivo (ultimo contatto, PLC raggiungibile, coda, parziale in corso). Il sito mostra «dato non aggiornato» se l'ultimo contatto supera 90 secondi.

### Risposte

| Codice | Significato | Comportamento del ponte |
| --- | --- | --- |
| 200 `{ok:true}` | Registrato | Segna l'evento come confermato |
| 200 `{ok:true,duplicate:true}` | Già registrato con lo stesso `eventId` | Segna come confermato |
| 401 | Token mancante, errato o revocato | Ferma gli invii, segnala, non scarta gli eventi |
| 409 `{code:"session-closed"…}` | Lavorazione già chiusa in altro modo / non attiva | Sposta l'evento in «da verificare», non ritentare all'infinito |
| 409 `{code:"event-id-reused"}` | Stesso `eventId` con contenuto diverso | «da verificare» |
| 422 | Dati non validi | «da verificare» |
| 413, 400 | Richiesta malformata | «da verificare» |
| 5xx, timeout, rete | Esito incerto | Ritenta lo **stesso** evento con attesa crescente |

Un evento confermato non viene mai rinviato con un nuovo identificativo.

## Protocollo di chiusura sul ponte

1. Il pulsante fisico incrementa sul LOGO! un contatore di richieste di chiusura (registro da definire con il tecnico).
2. Il ponte vede un nuovo valore di richiesta (`closeRequestId` = linea + valore + baseline) e attende le condizioni concordate: sensori liberi (`00`) e stabili per il tempo configurato.
3. Salva localmente, in un'unica transazione SQLite, la lavorazione chiusa e l'evento in coda.
4. Solo dopo il salvataggio locale, se le scritture sono abilitate in configurazione, scrive il riscontro della **stessa** richiesta sul LOGO! (registro da definire). Di default le scritture sono disabilitate.
5. Il parziale riparte dalla nuova baseline (= contatore cumulativo al momento della chiusura). Il cumulativo del PLC non viene azzerato.
6. Invia l'evento al gestionale con ritentativi.

Una pressione ripetuta della stessa richiesta non produce una seconda chiusura.

## Limiti noti

- IP, unitId, indirizzi, formato e ordine delle parole del LOGO! **non sono noti**: la configurazione d'esempio non contiene valori reali.
- L'attraversamento dell'accesso riservato della piattaforma da parte di un client senza login non è verificato.
- La lettura coerente del contatore durante il moto dipende dal programma LOGO! (contatore a 32 bit su due registri): va verificata sull'impianto.

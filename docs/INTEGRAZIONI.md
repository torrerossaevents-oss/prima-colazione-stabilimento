# Integrazioni e stato effettivo

## Prima versione

Il sito registra dati manuali in un database centrale. Il lettore barcode che si comporta come una tastiera può compilare il campo codice. L'eventuale lettura da fotocamera dipende dal supporto del browser e dall'autorizzazione dell'utente; deve sempre restare disponibile l'inserimento del codice. Non è un collegamento al PLC.

| Componente | Stato |
| --- | --- |
| Interfaccia web e registrazioni manuali | Perimetro della prima versione |
| Database centrale | D1, separato dal codice Git |
| Accesso riservato | Gestito dalla piattaforma ospitante |
| Ruoli distinti e inviti agli operatori | Da implementare prima dell'uso con più ruoli |
| Fotocellule e programma LOGO! | Da sviluppare/configurare e collaudare sull'impianto |
| Servizio ponte locale | Da realizzare e installare sul PC di stabilimento |
| TeamSystem | Da verificare versione, accessi e formati disponibili |
| Etichettatrice | Da verificare interfaccia e caratteristiche del dispositivo |
| Consumo ingredienti tramite ricette | Da definire e collaudare |

## Conta-cartoni: contratto funzionale previsto

La linea prevista usa due fotocellule e un Siemens LOGO! 24CE. Il PC locale comunica con LOGO! sulla LAN; il servizio locale invia al CRM attraverso HTTPS. La presenza dei dispositivi sulla stessa rete non prova che comunichino correttamente.

Prima dello sviluppo sul campo servono indirizzi e mappa Modbus concordati, tipi di dato, ordine dei byte, contatore cumulativo, stati/riscontri di avvio e chiusura, heartbeat e gestione degli errori. Nessun indirizzo IP o registro va inventato nel codice.

Il conteggio valido segue la sequenza normalizzata `00 → 10 → 11 → 01 → 00`. Tempi, filtri e distanza tra fasci dipendono da cartoni, velocità e spaziatura effettivi. Una sosta non aggiunge conteggi; arretramento o sequenza incompleta richiedono uno stato di anomalia.

### Chiusura e recupero

1. Gli arrivi sono sospesi secondo la procedura della linea e i sensori sono liberi.
2. Il servizio salva localmente quantità e fine della sessione.
3. Solo dopo il salvataggio confermato viene inviato il riscontro al LOGO! e azzerato il parziale.
4. Il cumulativo e lo storico restano conservati.
5. Gli invii cloud sono ritentati con identificativi stabili, senza duplicare sessioni o movimenti.

La sessione già identificata deve poter proseguire localmente se manca Internet. Nuovi avvii offline restano bloccati finché non esiste un'interfaccia/anagrafica locale validata. Con PC ponte fermo o collegamento PLC interrotto, il sito deve segnalare dati non aggiornati e non confermare falsi reset.

Questo comportamento richiede il ponte locale; il sito web da solo non lo garantisce. Il pulsante di chiusura non è un arresto macchina e il progetto di conteggio non sostituisce i dispositivi di sicurezza della linea.

## TeamSystem e documenti

La prima versione conserva riferimenti ai documenti. Non emette, importa automaticamente o conserva fiscalmente fatture. Prima di aggiungere l'acquisizione TeamSystem occorrono la versione installata, i formati esportabili, documenti di esempio privi di informazioni non necessarie e regole di riconciliazione.

Ogni evento fisico deve essere registrato una sola volta. Una consegna già scaricata viene collegata alla fattura successiva senza un secondo decremento. L'importazione deve quindi riconoscere il documento e il movimento già esistenti, gestire quantità parziali e rendere visibili le differenze.

## Portare il codice altrove

Il repository contiene l'applicazione e le migrazioni; non contiene il database operativo. Per cambiare hosting servono separatamente distribuzione dell'app, binding D1 o adattatore dati equivalente, autenticazione, importazione dei dati e prova di recupero. Pubblicare il codice su GitHub non rende il database pubblico e non configura automaticamente questi servizi.

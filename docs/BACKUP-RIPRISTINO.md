# Backup, ripristino e recupero

Esportare non è fare un backup. Le esportazioni (giacenze CSV, catalogo Excel/CSV, stato operativo JSON) servono per consultare i dati. Il **backup completo** comprende stato operativo, storico, archivio, ricevute delle richieste e copie di recupero, ed è l'unico file da usare per ripristinare. GitHub non contiene e non è il backup del database.

## Fare un backup

1. Gestionale → **Configurazione** → **Backup completo** → *Scarica backup completo*.
2. Conserva il file in un luogo riservato (contiene dati aziendali). Mai su GitHub, chat o e-mail non protette.
3. Consigliato: un backup a settimana e prima di ogni aggiornamento del sito.

Il file contiene un'impronta SHA-256 dei dati: qualunque modifica o troncamento viene riconosciuto.

## Provare il backup (senza toccare il gestionale)

Da una copia del repository con `npm ci` già eseguito:

```sh
node --experimental-strip-types --no-warnings scripts/verify-backup.ts percorso/del/backup.json
```

Lo script ricostruisce un database vuoto in memoria con le migrazioni di `drizzle/`, ripristina il backup, lo rilegge, confronta l'impronta e stampa versione, conteggi e totali per articolo. Esito atteso: `RIPRISTINO VERIFICATO`. Un file alterato dà `RIPRISTINO NON VERIFICATO` e codice di uscita 1. Nessun dato viene inviato altrove.

Verifica del 13/11/2026: backup scaricato dall'anteprima locale dopo il percorso di prova nel browser (14 operazioni) → ripristino verificato; lo stesso file con una riga dello storico alterata → rifiutato.

## Ripristinare

Il ripristino via web è consentito **solo in un archivio vuoto** (nessuna operazione registrata): non sovrascrive mai dati esistenti.

1. Ambiente nuovo e vuoto (stesso codice, migrazioni applicate).
2. Configurazione → Backup completo → *Ripristina in questo archivio vuoto* → scegli il file.
3. Il server controlla l'impronta, valida lo stato, scrive tutto in un'unica transazione, rilegge e confronta di nuovo l'impronta. Se qualcosa non torna, risponde con errore.
4. Le credenziali dei dispositivi del ponte **non** sono nel backup: dopo un ripristino vanno create di nuovo in Configurazione e copiate nel PC di linea.

Le ricevute delle richieste vengono ripristinate: un vecchio invio ripetuto dopo il ripristino resta riconosciuto come duplicato (provato nei test).

## Recupero dopo un aggiornamento

- Prima di pubblicare una versione con nuove migrazioni: scarica un backup completo.
- La migrazione `0002` è additiva. Al primo salvataggio successivo, il vecchio JSON viene conservato in `workspace_snapshots` (motivo «Copia prima del trasferimento dello storico in archivio»).
- Se qualcosa va storto: non cancellare tabelle. Ripristina il backup in un ambiente nuovo e confronta; la copia in `workspace_snapshots` è un secondo punto di recupero leggibile con una query in sola lettura.

## Ponte LOGO! (PC di linea)

Archivio locale separato: `bridge\BACKUP-ARCHIVIO.cmd` (copia coerente con `VACUUM INTO`) e `bridge\RIPRISTINA-ARCHIVIO.cmd` (ripristino verificato). Vedi `bridge/README.md`. I `.cmd` non sono ancora stati provati su Windows.

## Collaudo finale prima dell'uso operativo

1. Backup completo dal sito pubblicato → `verify-backup.ts` → `RIPRISTINO VERIFICATO`.
2. Ripristino in un ambiente vuoto di prova → stesse giacenze, stesso numero di operazioni nello storico.
3. Registrare data, commit, esito e chi ha eseguito la prova in `docs/COLLAUDO.md`.

# Pubblicare il gestionale su Cloudflare

Alternativa a Sites, decisa da Teo il 13/11/2026. Il codice è pronto e provato senza account (prova di pubblicazione, test di Cloudflare Access). **Nulla è ancora pubblicato.** Sites resta attivo finché il passaggio non è collaudato.

## Come è protetto

```
Persona ──► Cloudflare Access (login con email) ──► Worker del gestionale ──► database D1
PC di linea ──► Access (token di servizio) ──► /api/devices/production (+ token del dispositivo)
```

- Si entra solo dal tuo dominio, dietro Cloudflare Access. L'indirizzo `workers.dev` è disattivato.
- Il Worker non si fida di nessuna intestazione: verifica la firma di Access a ogni richiesta (`lib/server/auth.ts`). Se Access non è configurato, nega l'accesso, e lo script di pubblicazione si rifiuta di partire.
- `OWNER_USER_IDS` (facoltativo, segreto del Worker) restringe ulteriormente alle email indicate.

## 1. Crea l'account (Teo, circa 10 minuti)

1. Vai su **dash.cloudflare.com/sign-up**, registrati con l'email aziendale e conferma l'email.
2. Attiva la verifica in due passaggi: profilo → Authentication.
3. Facoltativo ma consigliato: Workers → Plans → **Workers Paid** (5 $/mese), che dà più tempo di calcolo per richiesta.

## 2. Dominio (scelta del 13/11/2026: dominio nuovo dedicato)

Consigliato un **dominio nuovo dedicato allo stabilimento**, acquistato direttamente in Cloudflare: Domain Registration → Register, a prezzo di costo, attivo in pochi minuti. Il gestionale va su un sottodominio, ad esempio `gestionale.nuovodominio.com`.

Motivo: usare i domini aziendali esistenti richiede di spostare in Cloudflare i loro nameserver, quindi anche la gestione della posta. Si può fare, ma rischia di interrompere l'email aziendale.

Per gli accessi crea anche **un'email dedicata allo stabilimento** (va bene un Gmail gratuito), separata da quella dell'amministrazione.

## 3. Database D1

Workers & Pages → D1 → Create:

- nome `prima-colazione-stabilimento`;
- posizione Europa occidentale.

Annota il **Database ID**.

## 4. Cloudflare Access e profili (Zero Trust, gratuito fino a 50 utenti)

Le credenziali sono uniche e condivise per profilo; al massimo due profili:

| Profilo | Chi | Cosa può fare |
| --- | --- | --- |
| Amministrazione | email dell'amministrazione | tutto |
| Laboratorio | email dello stabilimento, usata su tutti i dispositivi del laboratorio | entrate e resi, spostamenti, produzione (avvio, conteggio, chiusura), preparazione e partenza degli ordini |

Solo l'amministrazione può gestire catalogo, nuovi ordini e annullamenti, documenti, blocchi, rettifiche, scarti, consumi, dispositivi del ponte e backup. Il server rifiuta comunque le operazioni non permesse (`lib/permissions.ts`): non basta nascondere un pulsante. Con un solo accesso per tutti basta non impostare gli elenchi qui sotto: chi supera Access è amministrazione. Chi ha registrato un'operazione resta indicato dal nome dell'operatore digitato, come oggi.

Dopo la prima pubblicazione: Workers → il Worker → Settings → Variables and Secrets → aggiungi due **Secret**:
- `ADMIN_EMAILS`: email dell'amministrazione;
- `LAB_EMAILS`: email dello stabilimento.

Le email non vanno mai nel codice.


1. Zero Trust: scegli il nome del team. Diventa `nome-team.cloudflareaccess.com`.
2. Settings → Authentication: lascia **One-time PIN**. Chi accede riceve un codice via email; non servono password. Nell'applicazione imposta la durata della sessione a 1 mese, così ogni dispositivo del laboratorio fa il login circa una volta al mese.
3. Access → Applications → Add → **Self-hosted**:
   - dominio `gestionale.tuodominio.it`;
   - policy **Allow** con le due email, amministrazione e stabilimento (Include → Emails).
4. Nella stessa applicazione copia l'**Application Audience (AUD) Tag**.
5. Solo quando colleghi il ponte, segui questi passaggi:
   1. Access → Service Auth: crea un **Service Token** «ponte linea 1».
   2. Aggiungi all'applicazione una policy **Service Auth** che includa quel token.
   3. Copia Client ID e Client Secret in `bridge\token.local.json` sul PC di linea, mai in chat.

## 5. Token API per la pubblicazione

My Profile → API Tokens → Create Token → «Edit Cloudflare Workers». Aggiungi anche:

- **D1: Edit** (account);
- **Workers Routes: Edit** (zona del dominio).

Limita il token al tuo account e alla zona del dominio.

Il token **non va mai in chat né in Git**. Due modi:

- inserirlo nei segreti del repository GitHub (Settings → Secrets and variables → Actions → `CLOUDFLARE_API_TOKEN`, più `CLOUDFLARE_ACCOUNT_ID`);
- darlo all'assistente tramite il modulo sicuro dell'ambiente.

## 6. Valori da inserire in GitHub (Settings → Secrets and variables → Actions → Variables)

| Variabile | Esempio |
| --- | --- |
| `CF_D1_DATABASE_ID` | dal punto 3 |
| `CF_D1_DATABASE_NAME` | `prima-colazione-stabilimento` |
| `CF_CUSTOM_DOMAIN` | `gestionale.tuodominio.it` |
| `ACCESS_TEAM_DOMAIN` | `nome-team.cloudflareaccess.com` |
| `ACCESS_AUD` | dal punto 4 |

Poi: Actions → **Pubblica su Cloudflare** → Run workflow. Il flusso:

1. esegue test e controlli;
2. applica le migrazioni mancanti al database;
3. pubblica il Worker.

Senza account si può provare la configurazione con `node scripts/cloudflare-deploy.mjs --check`, eseguito anche a ogni modifica dalla CI.

## 7. Collaudo prima di usarlo

1. Apri `https://gestionale.tuodominio.it` in una finestra anonima: deve comparire il login di Cloudflare Access.
2. Prova con un'email non autorizzata: l'accesso deve essere negato.
3. Entra con un'email autorizzata: il gestionale si apre, vuoto.
4. Configurazione → Backup completo: scarica un backup e verificalo con `scripts/verify-backup.ts`.

## 8. Trasferimento dei dati da Sites

1. Avvisa tutti di non registrare operazioni durante il passaggio.
2. Su Sites: Storico attività → **Esporta archivio**. Scarichi il file `prima-colazione-archivio-AAAA-MM-GG.json`.
3. Converti il file:
   ```sh
   node --experimental-strip-types --no-warnings scripts/sites-export-to-backup.ts prima-colazione-archivio-AAAA-MM-GG.json backup-per-cloudflare.json
   node --experimental-strip-types --no-warnings scripts/verify-backup.ts backup-per-cloudflare.json
   ```
4. Sul nuovo indirizzo: Configurazione → Backup completo → **Ripristina in questo archivio vuoto**.
5. Controlla articoli, giacenze, ordini aperti e lavorazioni rispetto a Sites. Poi passa tutti al nuovo indirizzo.
6. Lascia Sites invariato qualche giorno come riserva, senza usarlo.

## Costi indicativi

| Voce | Costo |
| --- | --- |
| Account | gratuito |
| Access | gratuito fino a 50 utenti |
| D1 | piano gratuito ampiamente sufficiente per il pilota |
| Workers Paid | 5 $/mese, consigliato |
| Dominio | dal costo del registrar |

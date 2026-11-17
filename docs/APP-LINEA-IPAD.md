# App «Linea» per l'iPad della produzione

Richiesta di Teo del 14/11/2026: un'app sull'iPad della linea che parte dalla foto (o dal file) dell'etichetta del cartone, ricava i dati e avvia la produzione.

## Che cos'è

Un'app web installabile, non un'app dell'App Store. Si trova all'indirizzo del gestionale seguito da `/linea`. Ha la sua icona, si apre a schermo intero e usa **lo stesso archivio e lo stesso accesso** del gestionale (Cloudflare Access, codice via email).

## Installazione sull'iPad

1. Apri **Safari** e vai su `https://<indirizzo del gestionale>/linea`.
2. Entra con l'email autorizzata e il codice ricevuto via email.
3. Tocca **Condividi** (il quadrato con la freccia), poi **Aggiungi alla schermata Home**, poi **Aggiungi**.
4. Apri l'icona **Linea**. Alla prima lettura di un'etichetta l'iPad scarica il lettore (circa 13 MB, una volta sola).

## Uso

1. **Etichetta**: «Inquadra l'etichetta» apre la fotocamera come un **lettore**. Appena riconosce il codice a barre emette un bip, si chiude da sola e:
   - se l'articolo è nel catalogo, passa subito all'avvio (con «Leggi anche il testo e confronta con la scheda» se serve un controllo);
   - se è nuovo, legge il testo dello stesso fotogramma e propone la scheda.

   Se il codice a barre non si legge: avvicina l'iPad, accendi la «Luce» se disponibile, oppure «Scatta adesso» e l'app legge il testo. In alternativa «Carica foto o file» o scrivi codice o EAN. Dalla foto o dal fotogramma l'iPad legge:
   - il **codice a barre EAN**;
   - il **testo**: codice (COD.), nome, descrizione, pezzi e peso netto, lotto stampato, scadenza, ingredienti e conservazione (l'IDENT. stampato viene ignorato).
2. **Calcolati in automatico**:
   - peso del pezzo e peso netto: il peso nel nome («90g») vince sul testo letto male;
   - durata in mesi, dalla differenza tra il lotto stampato (data di produzione AAMMGG) e la scadenza stampata;
   - lotto e scadenza della nuova produzione (oggi AAMMGG, oggi + durata).
3. **Articolo**:
   - se c'è già nel catalogo (riconosciuto da EAN o codice), compare con l'anteprima dell'etichetta;
   - se l'etichetta è diversa dalla scheda (EAN, pezzi, peso, durata), l'amministrazione la aggiorna con un tocco;
   - se manca, l'amministrazione lo crea dai dati letti (unità CRT); il laboratorio vede un avviso.
4. **Avvio**: operatore (ricordato sull'iPad), lotto e scadenza mostrati, «Avvia produzione».
5. **In lavorazione**:
   - contatore grande con +1, +5, +10 o un numero libero;
   - con il contapezzi collegato il conteggio arriva dalla linea.
6. **Chiusura**: scarti con motivo, conferma. I cartoni buoni entrano in magazzino nell'area di carico scelta in Configurazione. Se il contapezzi è fermo si indicano i cartoni contati a mano.

## Dati e sicurezza

- Foto e testo sono letti **sull'iPad** (`@zxing/library` per il codice a barre, `tesseract.js` con il modello italiano per il testo, entrambi Apache-2.0). I file del lettore sono serviti dal nostro dominio protetto (`/ocr`, copiati da `node_modules` a ogni compilazione da `scripts/copy-ocr-assets.mjs`). Nessun servizio esterno, nessuna foto salvata.
- Ogni operazione passa da `/api/workspace` con versione attesa e identificativo stabile. Una risposta persa lascia l'operazione «da verificare»: ripeterla non crea doppioni (ricevuta sul server).
- Valgono i profili: creare o aggiornare articoli è dell'amministrazione; avvio, conteggio e chiusura anche del laboratorio.

## Limiti

- La lettura dipende dalla foto: serve buona luce, etichetta intera e niente riflessi. I campi non letti restano vuoti con un avviso; niente viene inventato.
- Come legge: immagine portata a 3000 px sul lato lungo, prima lettura in grigio con contrasto aumentato, seconda lettura a colori solo se manca qualche dato; i dati si uniscono campo per campo. Le parole tipiche delle etichette sbagliate di una lettera vengono corrette («orudo» → «crudo») e una dicitura già presente nel catalogo viene ripresa identica.
- Sulla foto reale del Fagottino (16/11/2026), sia ridotta sia originale, l'app legge codice, descrizione articolo, dicitura in etichetta, EAN, pezzi, peso, lotto, scadenza e durata senza errori. L'IDENT. stampato viene ignorato.
- I PDF non vengono letti: si carica una foto o un'immagine.
- Non comanda la linea e non stampa etichette.

## Verifiche

- `tests/label-parse.test.ts`: testo dell'etichetta pulito, testo OCR reale della foto (con produttore e indirizzo sostituiti), errori tipici dell'OCR.
- `tests/ui/linea.mjs`: su una vista da iPad (1180×820, tocco) prova questo percorso, con un'etichetta di prova generata dalla modalità prova (il lettore dal vivo con una fotocamera simulata che inquadra l'etichetta: riconoscimento, chiusura automatica, articolo pronto all'avvio):
  1. immagine letta, con il codice a barre;
  2. articolo creato;
  3. avvio con lotto automatico;
  4. +5 e +10;
  5. chiusura con carico di 15 cartoni;
  6. regola tipografica e pulsanti di almeno 44 px.

# Interfaccia — revisione del 7 novembre 2026

La revisione rende il gestionale più leggibile e vivace mantenendo le stesse operazioni.

- Testi più grandi, scuri e contrastati; unità e quantità ben distinte.
- Colori saturi per le azioni principali e gli stati; pulsanti con etichette esplicite.
- Descrizioni più brevi e coerenti con il contenuto: ordini in lavorazione, scadenze da controllare, storico attività.
- Passaggi tra viste e risposta dei pulsanti con animazioni brevi, senza movimenti continui.
- Le preferenze di movimento ridotto del dispositivo disattivano le animazioni.
- Menu compatto su tablet e telefono, con chiusura toccando fuori dal pannello o tramite Escape.
- I caratteri usano i font di sistema, senza caricamenti da servizi esterni.

Le regole di magazzino, produzione e ordini, l'archivio e gli accessi non cambiano.

Verifiche: controllo TypeScript superato; ispezione nel browser della panoramica, del magazzino e del modulo di entrata. Nessuno scorrimento orizzontale della pagina a 1.348 px; la tabella conserva il proprio scorrimento. Contrasto del testo bianco sui pulsanti teal superiore a 5:1. Le verifiche usano esclusivamente dati di collaudo nell'anteprima locale.

## Revisione del 13 novembre 2026

- Barra superiore con stato del salvataggio: «Salvataggio in corso…», «Salvato alle hh:mm», «Da verificare», «Non riuscito». «Salvato» compare solo dopo la conferma del server.
- Operazione incerta: riquadro con descrizione e ora, pulsanti «Verifica sul server», «Ripeti la stessa operazione» (stesso identificativo, nessun doppione) e «Scarta» con conferma. Il riquadro sopravvive a chiusura della scheda e del browser e compare in tutte le schede aperte.
- Dati aggiornati al ritorno sulla scheda e al ritorno della rete, senza cancellare i moduli aperti.
- Magazzino: operazioni di lotto Blocco, Sposta, Scarto, Consumo, Rettifica in righe compatte; «Registra reso»; export delle sole giacenze filtrate quando c'è una ricerca, con indicazione nel nome del file.
- Produzione: messaggi distinti per codice assente o articolo non finito; scelta del conteggio (manuale/fotocellule) solo se esiste un ponte; scarti e nota alla chiusura; stato del ponte («agganciato», ultimo contatto, dato non aggiornato oltre 90 s); riepilogo giornaliero per articolo e lotto con export CSV.
- Storico con ricerca e caricamento a pagine; ordini archiviati su richiesta; Configurazione con dispositivi del ponte e backup completo.
- Su telefono si nasconde l'indicatore «Archivio connesso» quando tutto è regolare, per non tagliare il titolo; resta visibile se offline.
- Regola tipografica verificata automaticamente in `tests/ui/smoke.mjs` su tutte le viste a 390, 820 e 1.440 px.

## Sistema visivo del 13 novembre 2026 (contratto di design)

**Soggetto e lavoro principale.** Stabilimento di prima colazione industriale: una sede, tre aree, una linea. Ufficio da computer, operatori in linea da tablet o telefono. La schermata deve dire che cosa richiede attenzione adesso e permettere di agire in due passaggi.

**Riferimenti studiati** (catalogo 21st.dev, usati come evidenza e non come modello): un guscio applicativo con menu laterale compatto, contatori e ricerca globale in testata; una tabella di magazzino con numeri allineati a destra, indicatori di scorta, stato con punto ed etichetta e riga dei totali. Scartati: grigi per gerarchia, schede tutte uguali, grafici decorativi.

**Colori** (solo per superfici, bordi, icone e stati; il testo resta `#000` su chiaro e bianco su scuro, sempre peso 400):

| Nome | Valore | Uso |
| --- | --- | --- |
| Inchiostro forno | `#10283C` | menu laterale, riquadro della linea di produzione |
| Grano | `#F5B82E` | marchio, indicatore della voce attiva, segnale «oggi» |
| Lievito (operativo) | `#00806F` | azione principale, focus dei campi |
| Tela / Carta | `#F3F5F4` / `#FFFFFF` | fondo / superfici |
| Filo | `#DCE3E0` | bordi e divisori |
| Stati | `#15935A` regolare, `#E2A000` attenzione, `#D63B3B` bloccato o scaduto, `#2F6FDB` in corso | punti, barre, bordi; mai unico veicolo dell'informazione |

**Testo.** Caratteri di sistema (Segoe UI Variable su Windows), nessun font esterno. Scala 13 / 14 / 15 / 17 / 20 / 26 px, contatore di linea 56–72 px. Numeri con cifre tabellari, codici con lo stesso carattere (niente monospazio). Niente maiuscolo spaziato sopra i titoli.

**Struttura.** Menu laterale scuro con gruppi «Lavoro» e «Registro» e contatori. Testata fissa con titolo della vista, ricerca globale (Ctrl K oppure /), stato del salvataggio e aggiornamento. Panoramica come coda di lavoro («Da fare adesso», con un'azione diretta per riga) accanto al riquadro della linea: è l'unico elemento forte della pagina. Tabelle dense (righe di 44–52 px), intestazioni chiare in minuscolo, quantità a destra. Moduli in un pannello laterale a destra su computer e a tutta pagina sul telefono, così il contesto resta visibile.

**Raggi e ombre.** 6 px controlli, 10 px pannelli, 14 px pannello laterale; ombre solo su pannelli sovrapposti (pannello laterale, ricerca, avvisi).

**Movimento.** Solo in risposta a un'azione (apertura del pannello, conferma); ridotto a zero con «riduci movimento».

## Magazzino, scheda prodotto e produzione del giorno (13/11/2026, sera)

- **Produzione del giorno** (Produzione, e dalla Panoramica toccando «Cartoni letti oggi»): giorno scelto con frecce o calendario; flusso cronologico delle lavorazioni con ora di avvio e di conferma, articolo, lotto, operatore e cartoni; lo stesso articolo prodotto più volte è numerato («2ª lavorazione di 2») e segnalato; totali per articolo (quante volte, cartoni, unità) e totale cartoni del giorno; in corso e scarti separati dai confermati. Stampa della scheda ed esportazione CSV. Il giorno è quello di avvio in Europe/Rome; oltre 30 giorni la scheda legge l’archivio.
- **Scheda di modifica del prodotto**: riepilogo dell’articolo con disponibilità e lotti; sezioni «Identificazione», «Unità e confezionamento», «Listini» con spiegazione a lato; tipologia a scelta rapida; campi bloccati indicati nell’etichetta e nell’avviso; scorta minima e listini con unità esplicita («€ … / CRT»); avviso «Modifiche non salvate».
- **Catalogo**: filtri per tipologia e «Solo sotto scorta»; esportazione dei soli risultati filtrati; nessuna colonna fissa sovrapposta: sotto 1.280 px le righe diventano schede con le etichette dei listini.
- **Lotti**: filtri Tutti / Disponibili / In scadenza / Scaduti / Bloccati con conteggi, filtro per area, ordinamento per scadenza (il primo da usare in alto).
- **Allineamento**: `tests/ui/overlap.mjs` controlla tutte le viste e il pannello di modifica a 390, 820, 1.024, 1.280 e 1.440 px e segnala testi sovrapposti o tagliati (tenendo conto delle aree che scorrono). Esito finale: nessuna scritta sovrapposta o tagliata.

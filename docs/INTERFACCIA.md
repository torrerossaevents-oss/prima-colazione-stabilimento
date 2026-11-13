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

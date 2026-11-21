# Foglio di collaudo della linea — conta-cartoni LOGO!

Da stampare e compilare durante la produzione normale. Il conteggio automatico si considera collaudato solo con **almeno 100 cartoni** controllati anche a mano (meglio con 2–3 prodotti diversi) e con le **cinque prove** della parte 3 superate. Fino ad allora ogni differenza si corregge in Produzione con «Correggi cartoni» e causale «collaudo».

Data: ____________  Responsabile: ______________________  Versione del ponte (prima riga della finestra o del log): ________

## 1. Prima di iniziare

- [ ] PC della linea acceso, sospensione disattivata, ponte in funzione (finestra o avvio automatico).
- [ ] Gestionale → Configurazione → Dispositivi: il PC di linea è **Attivo**.
- [ ] iPad: all'avvio di una lavorazione compare la riga verde **«Ponte agganciato»** prima di far partire il nastro.

Regole per tutto il collaudo: fermare gli arrivi e far uscire l'ultimo cartone prima di chiudere; tenere premuto **CHIUDI per 2 secondi**; avviare la lavorazione successiva e aspettare «Ponte agganciato» prima di ripartire.

## 2. Conteggio: una riga per lavorazione

| N. | Ora | Articolo | Cartoni del ponte | Cartoni contati a mano | Differenza | Note (cartoni attaccati, fermi, tolti a mano…) |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | | | | | | |
| 2 | | | | | | |
| 3 | | | | | | |
| 4 | | | | | | |
| 5 | | | | | | |
| 6 | | | | | | |
| 7 | | | | | | |
| 8 | | | | | | |
| 9 | | | | | | |
| 10 | | | | | | |
| | | | **Totale ponte:** | **Totale a mano:** | | |

## 3. Prove dei casi particolari

| Prova | Come si fa | Risultato giusto | Esito |
| --- | --- | --- | --- |
| Pulsante due volte | a fine lavorazione premere CHIUDI, poi di nuovo dopo 5 s | una sola chiusura; la seconda pressione viene ignorata | ☐ OK ☐ NO |
| Cartone sotto le fotocellule | tenere premuto CHIUDI con un cartone che copre una fotocellula | il ponte aspetta: chiude solo 2 s dopo che le fotocellule sono libere | ☐ OK ☐ NO |
| Internet staccato | durante una lavorazione staccare il cavo Internet del router; chiudere; riattaccare dopo qualche minuto | la chiusura arriva al gestionale dopo, una volta sola, con il numero giusto | ☐ OK ☐ NO |
| Ponte riavviato | durante una lavorazione fermare il ponte e riavviarlo (o `taskkill /F /IM node.exe` con l'avvio automatico) | riprende la stessa lavorazione senza perdere cartoni | ☐ OK ☐ NO |
| LOGO! riavviato | durante una lavorazione spegnere e riaccendere il LOGO! | TOT non si azzera; la lavorazione continua oppure è «da verificare», mai numeri inventati | ☐ OK ☐ NO |

## 4. Punti aperti delle prime prove

- [ ] **Differenze già viste** tra ponte e conteggio a mano: motivo trovato? ____________________. Correzione applicata in Produzione (sì/no): ____. Nel log del ponte ogni lavorazione risulta chiusa una sola volta.
- [ ] **Cartoni «non attribuiti»** nel log del ponte (passati senza lavorazione aperta): servono in magazzino? Se sì, entrata a mano: ____.
- [ ] **Catalogo:** articoli nel file importato ____, articoli nel gestionale ____. Se ne mancano, reimportare con «Salta gli esistenti».

## 5. Esito

- [ ] Almeno 100 cartoni controllati, differenze spiegate o corrette.
- [ ] Cinque prove superate.
- [ ] Avvio automatico installato e verificato (riavvio del PC, ponte di nuovo «Attivo» da solo).
- [ ] Copia del programma LOGO! e della configurazione su chiavetta riservata.

Firma del responsabile: ______________________

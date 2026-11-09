import { Cable, Download, FileText, FlaskConical } from 'lucide-react';

export default function LogoPreparationPanel() {
  return <section className="panel logo-preparation" aria-label="Preparazione collegamento LOGO!">
    <div className="panel-head"><h2><Cable size={20}/>Prepariamo il collegamento LOGO!</h2><span className="chip amber">Da collaudare sulla linea</span></div>
    <div className="panel-body stack">
      <p>Il pacchetto per il PC contiene una prova con dati simulati e uno strumento per leggere il contatore. Il collegamento automatico alla produzione del gestionale non è ancora attivo.</p>
      <ol className="logo-preparation-steps">
        <li><span>01</span><div><h3>Oggi · prova sul PC</h3><p>Estrai il pacchetto e avvia AVVIA-PROVA. Verifica il salvataggio di due lavorazioni simulate e il recupero dopo la riapertura.</p></div></li>
        <li><span>02</span><div><h3>All’arrivo · configura il LOGO!</h3><p>Il tecnico prepara il programma di conteggio, conferma la mappa dei dati e collega LOGO! e PC alla rete dello stabilimento.</p></div></li>
        <li><span>03</span><div><h3>Sulla linea · verifica i cartoni</h3><p>Confronta i conteggi con i cartoni reali. Avvio, chiusura, recupero e invio al gestionale richiedono ancora il collaudo e il completamento del collegamento.</p></div></li>
      </ol>
      <div className="notice"><FlaskConical size={19}/><div><p>La prova usa solo articoli fittizi: non cambia prodotti, giacenze o produzione. Lo strumento diagnostico legge il LOGO! e non invia comandi di reset.</p></div></div>
      <div className="page-actions">
        <a className="button primary" href="/downloads/ponte-logo-preparazione.zip" download><Download size={16}/>Scarica pacchetto PC</a>
        <a className="button secondary" href="/downloads/guida-collegamento-logo.md" download><FileText size={16}/>Guida per il collegamento</a>
      </div>
      <p className="form-help">Richiede Node.js 22.13 o successivo. Avvio rapido per Windows; script utilizzabili anche su macOS e Linux. Nessuna installazione sul tuo PC è stata eseguita da qui.</p>
    </div>
  </section>;
}

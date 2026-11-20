import { Cable, Download, FileText, FlaskConical } from 'lucide-react';

export default function LogoPreparationPanel() {
  return <section className="panel logo-preparation" aria-label="Collegamento LOGO!">
    <div className="panel-head"><h2><Cable size={20}/>Collegamento LOGO!</h2><span className="chip amber">Collaudo in corso</span></div>
    <div className="panel-body stack">
      <p>Il pacchetto per il PC contiene il ponte, la prova simulata, la prova degli ingressi e la lettura del contatore, con le configurazioni per il LOGO! 24CE 8.4 dell’impianto. Il ponte è collegato dal 20/11/2026; il collaudo sulla linea è in corso.</p>
      <ol className="logo-preparation-steps">
        <li><span>01</span><div><h3>Prova sul PC</h3><p>Estrai il pacchetto e avvia AVVIA-PROVA. Verifica il salvataggio di due lavorazioni simulate e il recupero dopo la riapertura.</p></div></li>
        <li><span>02</span><div><h3>LOGO! · fatto il 20/11/2026</h3><p>Programma conta-cartoni caricato (fotocellule su I3 e I4, pulsante su I1). Porta Modbus trovata provando da 502 a 510; ingressi I1, I3, I4 e lettura del contatore verificati.</p></div></li>
        <li><span>03</span><div><h3>Sulla linea · collaudo in corso</h3><p>Prima chiusura dal pulsante corretta: 6 cartoni. Restano almeno 100 cartoni contati anche a mano, soste, arretramenti e due lavorazioni di seguito. Tieni premuto CHIUDI almeno 2 secondi.</p></div></li>
      </ol>
      <div className="notice"><FlaskConical size={19}/><div><p>La prova usa solo articoli fittizi: non cambia prodotti, giacenze o produzione. Lo strumento diagnostico legge il LOGO! e non invia comandi di reset.</p></div></div>
      <div className="page-actions">
        <a className="button primary" href="/downloads/ponte-logo-preparazione.zip" download><Download size={16}/>Scarica pacchetto PC</a>
        <a className="button secondary" href="/downloads/guida-collegamento-logo.md" download><FileText size={16}/>Guida per il collegamento</a>
        <a className="button secondary" href="/downloads/programma-logo-24ce.md" download><FileText size={16}/>Programma LOGO! 24CE</a>
      </div>
      <p className="form-help">Richiede Node.js 22.13 o successivo. Avvio rapido per Windows; script utilizzabili anche su macOS e Linux. Nessuna installazione sul tuo PC è stata eseguita da qui.</p>
    </div>
  </section>;
}

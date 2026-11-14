"use client";
/** Configurazione → Produzione ed etichette: carico automatico, area di carico, dati comuni dell'etichetta. */
import { useState, type FormEvent } from 'react';
import { Check, PackageCheck } from 'lucide-react';
import { knownAreas, productionArea, type Settings, type State } from '../lib/domain';

export default function ProductionSettings({ state, canEdit, disabled, onSave }: { state: State; canEdit: boolean; disabled: boolean; onSave: (settings: Settings) => Promise<boolean> }) {
  const current = state.settings ?? {};
  const [autoLoad, setAutoLoad] = useState(current.autoLoad !== false);
  const [area, setArea] = useState(productionArea(state));
  const [producer, setProducer] = useState(current.labelProducer ?? '');
  const [ident, setIdent] = useState(current.labelIdent ?? '');
  const [saving, setSaving] = useState(false);
  const areas = knownAreas(state);
  const dirty = autoLoad !== (current.autoLoad !== false) || area !== productionArea(state) || producer !== (current.labelProducer ?? '') || ident !== (current.labelIdent ?? '');
  async function save(e: FormEvent) {
    e.preventDefault(); if (saving || !dirty) return;
    setSaving(true);
    try { await onSave({ autoLoad, productionArea: area.trim(), labelProducer: producer, labelIdent: ident }); } finally { setSaving(false); }
  }
  return <section className="panel" style={{ margin: "0 0 24px" }} aria-labelledby="production-settings-title">
    <div className="panel-head"><div><h2 id="production-settings-title">Produzione ed etichette</h2><p>Valgono per tutte le lavorazioni. Lotto e scadenza si calcolano dalla data di produzione e dalla durata di ogni prodotto.</p></div></div>
    <form className="panel-body stack" onSubmit={save}>
      <fieldset className="stack" disabled={!canEdit || disabled || saving}>
        <label className="check-label"><input type="checkbox" checked={autoLoad} onChange={e => setAutoLoad(e.target.checked)}/>Carico automatico alla chiusura: i cartoni buoni (letti − scarti) entrano in magazzino quando la lavorazione viene chiusa, anche dal pulsante del contapezzi.</label>
        <div className="form-grid">
          <label className="field"><span>Area di carico della produzione</span><input value={area} list="production-areas" maxLength={60} onChange={e => setArea(e.target.value)} required/><datalist id="production-areas">{areas.map(a => <option key={a} value={a}/>)}</datalist><small>Fino a tre aree in tutto. Ora: {areas.length ? areas.join(', ') : 'nessuna'}.</small></label>
          <label className="field"><span>IDENT. in etichetta</span><input value={ident} maxLength={40} onChange={e => setIdent(e.target.value)} placeholder="Es. 02/F"/><small>Stampato sotto il lotto.</small></label>
          <label className="field span-2"><span>Produttore e indirizzo in etichetta</span><input value={producer} maxLength={300} onChange={e => setProducer(e.target.value)} placeholder="Ragione sociale e indirizzo dello stabilimento"/></label>
        </div>
      </fieldset>
      {canEdit ? <div className="page-actions"><button className="button primary" type="submit" disabled={!dirty || disabled || saving}><Check size={16}/>{saving ? 'Salvataggio…' : 'Salva impostazioni'}</button>{dirty && <span className="dirty-note">Modifiche non salvate</span>}</div>
        : <p className="form-help"><PackageCheck size={15} aria-hidden="true"/> Le impostazioni sono gestite dall’amministrazione.</p>}
    </form>
  </section>;
}

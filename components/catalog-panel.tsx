"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Package, Search, Plus, Upload, Download, X, ChevronRight, Pencil, FileSpreadsheet, Check, CircleAlert, ArrowDownToLine, Layers3, Tag } from 'lucide-react';
import { productTotals, availableForLot, reservedForLot, type Action, type Product, type State } from '../lib/domain';
import { readCatalogFile, exportCatalog, downloadCatalogTemplate } from '../lib/catalog-io';

type ProductInput = Omit<Product, 'id'>;
type Props = {
  state: State;
  busy: boolean;
  disabled: boolean;
  onAction: (action: Action, message?: string) => Promise<boolean | undefined>;
  onReceive: (productId?: string) => void;
  createRequested?: boolean;
  onCreateRequestHandled?: () => void;
  saveError?: string;
  onClearError?: () => void;
};
type Dialog = { mode: 'new' | 'edit' | 'details' | 'import'; id?: string } | null;
type Draft = {code:string;name:string;category:string;kind:Product['kind'];unit:string;unitsPerBox:string;minStock:string;priceGelCor:string;priceGelitria:string;priceDistribution:string};
const kindNames = { finished:'Prodotto finito', raw:'Materia prima', packaging:'Imballaggio' };
const priceFields = [ ['priceGelCor','Listino 3 - Gel.Cor.'], ['priceGelitria','GELITRIA SRL'], ['priceDistribution','Distribuzione'] ] as const;
const count = (value:number) => new Intl.NumberFormat('it-IT').format(value);
const price = (value:number|null|undefined) => value == null ? '—' : new Intl.NumberFormat('it-IT',{style:'currency',currency:'EUR',minimumFractionDigits:2,maximumFractionDigits:3}).format(value);
const normalize = (value:string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('it').trim();
function draftOf(p?:Product):Draft { return { code:p?.code??'',name:p?.name??'',category:p?.category??'',kind:p?.kind??'finished',unit:p?.unit??'CRT',unitsPerBox:String(p?.unitsPerBox??1),minStock:String(p?.minStock??0),priceGelCor:p?.priceGelCor==null?'':String(p.priceGelCor).replace('.',','),priceGelitria:p?.priceGelitria==null?'':String(p.priceGelitria).replace('.',','),priceDistribution:p?.priceDistribution==null?'':String(p.priceDistribution).replace('.',',') }; }
function Field({label,hint,wide,children}:{label:string;hint?:string;wide?:boolean;children:ReactNode}) { return <label className={'field '+(wide?'span-2':'')}><span>{label}</span>{children}{hint&&<small>{hint}</small>}</label>; }
function parsePrice(value:string,label:string):number|null { if(!value.trim())return null; if(!/^\d+(?:[.,]\d{1,3})?$/.test(value.trim()))throw new Error(`${label}: inserisci un prezzo positivo o zero, con massimo 3 decimali.`);const amount=Number(value.trim().replace(',','.'));if(amount>999999.999)throw new Error(`${label}: prezzo troppo alto.`);return amount; }

export default function CatalogPanel({state,busy,disabled,onAction,onReceive,createRequested,onCreateRequestHandled,saveError,onClearError}:Props) {
  const [query,setQuery]=useState('');
  const [category,setCategory]=useState('');
  const [suggestionsOpen,setSuggestionsOpen]=useState(false);
  const [activeSuggestion,setActiveSuggestion]=useState(-1);
  const [dialog,setDialog]=useState<Dialog>(null);
  const [draft,setDraft]=useState<Draft>(draftOf());
  const [localError,setLocalError]=useState('');
  const [working,setWorking]=useState(false);
  const [actionFailed,setActionFailed]=useState(false);
  const [imported,setImported]=useState<{products:ProductInput[];warnings:string[]}|null>(null);
  const [filename,setFilename]=useState('');
  const [importMode,setImportMode]=useState<'skip'|'update'>('skip');
  const [showAllImport,setShowAllImport]=useState(false);
  const dialogRef=useRef<HTMLElement>(null);
  const searchRef=useRef<HTMLInputElement>(null);
  const uploadSequence=useRef(0);
  const lock=busy||working;
  const lockRef=useRef(lock);lockRef.current=lock;
  const categories=useMemo(()=>[...new Set(state.products.map(p=>p.category||'').filter(Boolean))].sort((a,b)=>a.localeCompare(b,'it')), [state.products]);
  const words=normalize(query).split(/\s+/).filter(Boolean);
  const matches=useMemo(()=>state.products.filter(p=>{
    if(category&&p.category!==category)return false;
    const related=state.lots.filter(l=>l.productId===p.id).map(l=>l.code).join(' ');
    const text=normalize(`${p.code} ${p.name} ${related}`);
    return words.every(word=>text.includes(word));
  }).sort((a,b)=>a.name.localeCompare(b.name,'it')), [state.products,state.lots,query,category]);
  const suggestions=matches.slice(0,6);
  const selected=dialog?.id?state.products.find(p=>p.id===dialog.id):undefined;
  const selectedLots=selected?state.lots.filter(l=>l.productId===selected.id):[];
  const selectedTotals=selected?productTotals(state,selected.id):null;
  const referenced=selected?state.lots.some(l=>l.productId===selected.id)||state.sessions.some(s=>s.productId===selected.id):false;
  const existingCodes=new Set(state.products.map(p=>p.code.toLocaleUpperCase('it')));
  const existingImport=imported?.products.filter(p=>existingCodes.has(p.code.toLocaleUpperCase('it'))).length??0;
  const newImport=(imported?.products.length??0)-existingImport;
  const toSave=importMode==='skip'?newImport:imported?.products.length??0;
  const canImport=!!imported&&toSave>0&&state.products.length+newImport<=350;
  const error=localError||saveError||(actionFailed?'Il salvataggio non è stato confermato. I dati inseriti sono ancora disponibili: controlla e riprova.':'');

  function open(mode:NonNullable<Dialog>['mode'],p?:Product) { onClearError?.();setActionFailed(false);setLocalError('');setSuggestionsOpen(false);setActiveSuggestion(-1);if(mode==='new'||mode==='edit')setDraft(draftOf(p));if(mode==='import'){setImported(null);setFilename('');setImportMode('skip');setShowAllImport(false);}setDialog({mode,id:p?.id}); }
  function close() { if(lock)return;uploadSequence.current++;setDialog(null);setLocalError(''); }
  useEffect(()=>{if(createRequested){open('new');onCreateRequestHandled?.();}},[createRequested]);
  useEffect(()=>{
    if(!dialog)return;
    const before=document.activeElement as HTMLElement|null;
    const el=dialogRef.current;
    const fields=()=>Array.from(el?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]')??[]).filter(x=>x.getClientRects().length>0);
    (el?.querySelector<HTMLElement>('[data-autofocus]')??fields()[0]??el)?.focus();
    const key=(e:KeyboardEvent)=>{
      if(e.key==='Escape'){e.preventDefault();if(!lockRef.current){setDialog(null);setLocalError('');}return;}
      if(e.key!=='Tab')return;
      const list=fields(),first=list[0],last=list[list.length-1];if(!first){e.preventDefault();return;}
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
    };
    document.addEventListener('keydown',key);const old=document.body.style.overflow;document.body.style.overflow='hidden';
    return()=>{document.removeEventListener('keydown',key);document.body.style.overflow=old;before?.focus();};
  },[dialog?.mode,dialog?.id]);
  function change<K extends keyof Draft>(key:K,value:Draft[K]) {setDraft(d=>({...d,[key]:value,...(key==='unit'&&String(value).trim().toUpperCase()==='CRT'?{unitsPerBox:'1'}:{})}));}
  async function saveProduct(e:FormEvent) {
    e.preventDefault();if(lock||disabled)return;onClearError?.();setActionFailed(false);setLocalError('');
    try {
      const p:ProductInput={code:draft.code.trim(),name:draft.name.trim(),category:draft.category.trim(),kind:draft.kind,unit:draft.unit.trim(),unitsPerBox:Number(draft.unitsPerBox),minStock:Number(draft.minStock),priceGelCor:parsePrice(draft.priceGelCor,priceFields[0][1]),priceGelitria:parsePrice(draft.priceGelitria,priceFields[1][1]),priceDistribution:parsePrice(draft.priceDistribution,priceFields[2][1])};
      if(!p.code||!p.name||!p.unit)throw new Error('Compila codice, descrizione e unità di misura.');
      if(!Number.isSafeInteger(p.unitsPerBox)||p.unitsPerBox<1||!Number.isSafeInteger(p.minStock)||p.minStock<0)throw new Error('Unità per cartone e scorta minima devono essere numeri interi validi.');
      const ok=await onAction(dialog?.mode==='edit'&&selected?{type:'product.update',productId:selected.id,product:p}:{type:'product.add',product:p},dialog?.mode==='edit'?'Prodotto aggiornato':'Prodotto aggiunto al catalogo');
      if(ok){setDialog(null);}else setActionFailed(true);
    }catch(e){setLocalError(e instanceof Error?e.message:'Impossibile salvare il prodotto.');}
  }
  async function readFile(file?:File) {
    if(!file||lock)return;onClearError?.();setActionFailed(false);const request=++uploadSequence.current;setWorking(true);setLocalError('');setImported(null);setFilename(file.name);
    try{const result=await readCatalogFile(file);if(request===uploadSequence.current)setImported(result);}catch(e){if(request===uploadSequence.current)setLocalError(e instanceof Error?e.message:'Non riesco a leggere questo file.');}finally{if(request===uploadSequence.current)setWorking(false);}
  }
  async function runImport() {
    if(lock||disabled||!imported||!canImport)return;onClearError?.();setActionFailed(false);setLocalError('');
    const ok=await onAction({type:'product.import',products:imported.products,mode:importMode},`Catalogo importato: ${newImport} nuovi prodotti${importMode==='update'?`, ${existingImport} aggiornati`:''}`);
    if(ok){setDialog(null);setQuery('');setCategory('');}else setActionFailed(true);
  }
  async function download(kind:'catalog'|'template') {if(lock)return;onClearError?.();setActionFailed(false);setWorking(true);setLocalError('');try{if(kind==='catalog')await exportCatalog(state.products);else await downloadCatalogTemplate();}catch(e){setLocalError(e instanceof Error?e.message:'Esportazione non riuscita. Riprova.');}finally{setWorking(false);}}
  function showProduct(p:Product){open('details',p);}

  return <section className="catalog-panel" aria-label="Catalogo prodotti">
    <div className="catalog-heading">
      <div className="catalog-heading-copy"><span className="catalog-heading-icon"><Package size={24}/></span><div><h2>Il tuo catalogo <span>{state.products.length}</span></h2><p>Prodotti, listini e disponibilità. Tutto a portata di ricerca.</p></div></div>
      <div className="catalog-actions"><button className="button secondary" onClick={()=>open('import')} disabled={disabled||lock}><Upload size={17}/>Importa</button><button className="button secondary" onClick={()=>download('catalog')} disabled={disabled||lock||!state.products.length}><Download size={17}/>Esporta Excel</button><button className="button primary" onClick={()=>open('new')} disabled={disabled||lock}><Plus size={18}/>Nuovo prodotto</button></div>
    </div>
    {!dialog&&error&&<div className="catalog-error" role="alert"><CircleAlert size={19}/><span>{error}</span></div>}
    <div className="catalog-searchbar">
      <div className="catalog-search-area" onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setSuggestionsOpen(false);}}>
        <div className="catalog-search-input"><Search size={21}/><input ref={searchRef} value={query} onChange={e=>{setQuery(e.target.value);setSuggestionsOpen(true);setActiveSuggestion(-1);}} onFocus={()=>setSuggestionsOpen(true)} placeholder="Cerca per codice, descrizione o lotto…" aria-label="Cerca prodotti per codice, descrizione o lotto" role="combobox" aria-expanded={!!query&&suggestionsOpen&&suggestions.length>0} aria-controls="catalog-suggestions" aria-autocomplete="list" aria-activedescendant={suggestionsOpen&&activeSuggestion>=0?`catalog-suggestion-${activeSuggestion}`:undefined} onKeyDown={e=>{if(e.key==='Escape'){setSuggestionsOpen(false);setActiveSuggestion(-1);}if(e.key==='ArrowDown'&&suggestions.length){e.preventDefault();setSuggestionsOpen(true);setActiveSuggestion(i=>(i+1)%suggestions.length);}if(e.key==='ArrowUp'&&suggestions.length){e.preventDefault();setSuggestionsOpen(true);setActiveSuggestion(i=>(i-1+suggestions.length)%suggestions.length);}if(e.key==='Enter'&&suggestionsOpen&&activeSuggestion>=0&&suggestions[activeSuggestion]){e.preventDefault();showProduct(suggestions[activeSuggestion]);}}}/>{query&&<button className="icon-button" onClick={()=>{setQuery('');setActiveSuggestion(-1);searchRef.current?.focus();}} aria-label="Cancella ricerca"><X size={17}/></button>}</div>
        {!!query&&suggestionsOpen&&suggestions.length>0&&<div className="catalog-suggestions" id="catalog-suggestions" role="listbox" aria-label="Prodotti suggeriti"><div className="catalog-suggestions-title">Apri una scheda prodotto</div>{suggestions.map((p,i)=>{const lot=state.lots.find(l=>l.productId===p.id&&normalize(l.code).includes(normalize(query)));return <button key={p.id} id={`catalog-suggestion-${i}`} type="button" role="option" aria-selected={i===activeSuggestion} onClick={()=>showProduct(p)} className={i===activeSuggestion?'selected':''}><span className="catalog-suggestion-code">{p.code}</span><span><b>{p.name}</b><small>{lot?`Lotto ${lot.code}`:p.category||kindNames[p.kind]}</small></span><ChevronRight size={17}/></button>;})}</div>}
      </div>
      <label className="catalog-filter"><span>Categoria</span><select value={category} onChange={e=>{setCategory(e.target.value);setActiveSuggestion(-1);setSuggestionsOpen(false);}} aria-label="Filtra prodotti per categoria"><option value="">Tutte le categorie</option>{categories.map(c=><option key={c} value={c}>{c}</option>)}</select></label>
    </div>
    <div className="catalog-results"><span aria-live="polite"><b>{matches.length}</b> {matches.length===1?'prodotto':'prodotti'}{query||category?` su ${state.products.length}`:' nel catalogo'}</span><span>Ricerca immediata mentre scrivi</span>{(query||category)&&<button className="text-button" onClick={()=>{setQuery('');setCategory('');setSuggestionsOpen(false);}}>Azzera filtri</button>}</div>
    {matches.length>0?<div className="catalog-table-scroll"><table className="catalog-table"><caption className="sr-only">Catalogo con codici, descrizioni, categorie, unità e tre listini</caption><thead><tr><th>Codice</th><th>Descrizione e categoria</th><th>U.m.</th><th className="catalog-price">Listino 3 -<br/>Gel.Cor.</th><th className="catalog-price">GELITRIA<br/>SRL</th><th className="catalog-price">Distribuzione</th><th className="catalog-price">Disponibili</th><th><span className="sr-only">Azioni</span></th></tr></thead><tbody>{matches.map(p=>{const totals=productTotals(state,p.id);const hasLots=state.lots.some(l=>l.productId===p.id);return <tr key={p.id}><td><button className="catalog-code" onClick={()=>showProduct(p)}>{p.code}</button></td><td><button className="catalog-product-name" onClick={()=>showProduct(p)}>{p.name}</button><div className="catalog-product-meta">{p.category?<span className="catalog-category">{p.category}</span>:<span>Senza categoria</span>}<span>{kindNames[p.kind]}</span></div></td><td><span className="catalog-unit">{p.unit}</span></td>{priceFields.map(([key])=><td key={key} className={'catalog-price '+(p[key]==null?'catalog-price-empty':'')}>{price(p[key])}</td>)}<td className="catalog-price"><b>{hasLots?`${count(totals.available)} ${p.unit}`:'—'}</b>{!hasLots&&<small>Nessun lotto</small>}</td><td><div className="catalog-row-actions"><button type="button" className="catalog-edit-button" aria-label={`Modifica prodotto ${p.code}`} disabled={disabled||lock} onClick={()=>open('edit',p)}><Pencil size={16}/>Modifica</button><button type="button" className="catalog-detail-button" aria-label={`Apri scheda ${p.code}`} onClick={()=>showProduct(p)}>Scheda<ChevronRight size={16}/></button></div></td></tr>;})}</tbody></table></div>:<div className="catalog-empty"><span><Package size={32}/></span><h3>{state.products.length?'Nessun prodotto trovato':'Inizia dal tuo catalogo'}</h3><p>{state.products.length?'Prova con una parte della descrizione, il codice o un lotto registrato.':'Importa un file Excel o CSV, oppure aggiungi il primo prodotto manualmente.'}</p>{!state.products.length&&<button className="button primary" disabled={disabled||lock} onClick={()=>open('import')}><Upload size={17}/>Importa prodotti</button>}</div>}
    <div className="catalog-footnote"><span><Tag size={15}/>Listini in euro per unità di misura indicata. “—” significa prezzo non inserito.</span><span>Giacenze aggiornate dai movimenti di magazzino.</span></div>

    {dialog&&<div className="modal-backdrop catalog-modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)close();}}><section ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="catalog-dialog-title" className={'modal catalog-modal '+(dialog.mode==='import'?'catalog-modal-import':'')}>
      <header><div><span className="eyebrow">CATALOGO PRODOTTI</span><h2 id="catalog-dialog-title">{dialog.mode==='new'?'Nuovo prodotto':dialog.mode==='edit'?'Modifica prodotto':dialog.mode==='import'?'Importa il tuo catalogo':'Scheda prodotto'}</h2><p>{dialog.mode==='import'?'Carica il file, controlla i dati e conferma l’importazione.':dialog.mode==='details'?selected?.code:'Tutte le informazioni dell’articolo in un’unica scheda.'}</p></div><button type="button" className="modal-close" onClick={close} disabled={lock} aria-label="Chiudi scheda prodotti"><X size={20}/></button></header>
      {error&&<div className="catalog-error" role="alert"><CircleAlert size={20}/><span>{error}</span></div>}
      {(dialog.mode==='new'||dialog.mode==='edit')&&<form onSubmit={saveProduct}>
        <fieldset className="catalog-form-fields" disabled={lock||disabled}><div className="catalog-section-label"><Package size={18}/> Dati del prodotto</div>
        {referenced&&<div className="catalog-info">Questo articolo ha già lotti o lavorazioni. Codice, tipologia, unità e confezionamento restano collegati allo storico.</div>}
        <div className="form-grid"><Field label="Codice articolo *"><input data-autofocus value={draft.code} maxLength={80} required readOnly={referenced} onChange={e=>change('code',e.target.value)} autoComplete="off" placeholder="Es. 001"/></Field><Field label="Categoria"><input value={draft.category} maxLength={120} onChange={e=>change('category',e.target.value)} list="catalog-categories" placeholder="Scegli o scrivi una categoria"/><datalist id="catalog-categories">{categories.map(c=><option key={c} value={c}/>)}</datalist></Field><Field label="Descrizione *" wide><textarea rows={2} value={draft.name} maxLength={160} required onChange={e=>change('name',e.target.value)} placeholder="Nome e descrizione completa del prodotto"/></Field><Field label="Tipologia"><select value={draft.kind} disabled={referenced} onChange={e=>change('kind',e.target.value as Draft['kind'])}>{Object.entries(kindNames).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></Field><Field label="Unità di misura *" hint="CRT = cartoni. Le quantità di magazzino usano questa unità."><input value={draft.unit} required maxLength={40} readOnly={referenced} onChange={e=>change('unit',e.target.value)} list="catalog-units"/><datalist id="catalog-units"><option value="CRT"/><option value="PZ"/><option value="KG"/></datalist></Field><Field label="Unità per cartone *" hint={draft.unit.trim().toUpperCase()==='CRT'?'Con unità CRT, un cartone corrisponde a 1 unità di magazzino.':'Quante unità di magazzino contiene un cartone.'}><input value={draft.unitsPerBox} type="number" min="1" max="1000000000" step="1" required readOnly={referenced||draft.unit.trim().toUpperCase()==='CRT'} onChange={e=>change('unitsPerBox',e.target.value)}/></Field><Field label="Scorta minima" hint={`Quantità espressa in ${draft.unit||'unità'}. Zero disattiva la soglia.`}><input value={draft.minStock} type="number" min="0" max="1000000000" step="1" required onChange={e=>change('minStock',e.target.value)}/></Field></div>
        <div className="catalog-section-label"><Tag size={18}/> Listini <small>€ / {draft.unit||'unità'}</small></div><p className="catalog-section-hint">Lascia vuoto un prezzo non disponibile. Puoi inserire fino a 3 decimali; zero rimane un valore esplicito.</p>
        <div className="catalog-price-fields">{priceFields.map(([key,label])=><Field key={key} label={label}><div className="catalog-money-input"><span>€</span><input value={draft[key]} inputMode="decimal" onChange={e=>change(key,e.target.value)} placeholder="Non inserito" aria-label={label}/></div></Field>)}</div>
        </fieldset><footer><button type="button" className="button secondary" onClick={close} disabled={lock}>Annulla</button><button type="submit" className="button primary" disabled={disabled||lock}><Check size={18}/>{busy?'Salvataggio…':dialog.mode==='edit'?'Salva modifiche':'Crea prodotto'}</button></footer>
      </form>}
      {dialog.mode==='details'&&selected&&<><div className="catalog-detail-title"><span className="catalog-category">{selected.category||'Senza categoria'}</span><h3>{selected.name}</h3><span className="catalog-detail-type">{kindNames[selected.kind]} · {selected.unit}</span></div><div className="catalog-detail-prices">{priceFields.map(([key,label])=><div key={key}><span>{label}</span><b>{price(selected[key])}</b><small>per {selected.unit}</small></div>)}</div><dl className="catalog-detail-facts"><div><dt>Codice</dt><dd className="mono">{selected.code}</dd></div><div><dt>Unità per cartone</dt><dd>{count(selected.unitsPerBox)} {selected.unit}</dd></div><div><dt>Scorta minima</dt><dd>{selected.minStock?`${count(selected.minStock)} ${selected.unit}`:'Non impostata'}</dd></div></dl><div className="catalog-section-label"><Layers3 size={18}/> Lotti e disponibilità <small>{selectedLots.length} lotti</small></div>{selectedLots.length?<><div className="catalog-stock-summary"><span>Presenti <b>{count(selectedTotals!.present)} {selected.unit}</b></span><span>Prenotati <b>{count(selectedTotals!.reserved)} {selected.unit}</b></span><span>Disponibili <b>{count(selectedTotals!.available)} {selected.unit}</b></span></div><div className="catalog-detail-lots"><table className="catalog-table"><thead><tr><th>Lotto / ubicazione</th><th>Scadenza</th><th>Presenti</th><th>Prenotati</th><th>Bloccati</th><th>Disponibili</th></tr></thead><tbody>{selectedLots.map(l=><tr key={l.id}><td><b>{l.code}</b><small>{l.area}</small></td><td>{l.expiry?l.expiry.split('-').reverse().join('/'):'—'}</td><td>{count(l.quantity)}</td><td>{count(reservedForLot(state,l.id))}</td><td>{count(l.blocked)}</td><td><b>{count(availableForLot(state,l.id))}</b></td></tr>)}</tbody></table></div><p className="catalog-section-hint">Quantità in {selected.unit}. Il disponibile esclude merce prenotata, bloccata o scaduta.</p></>:<div className="catalog-no-lots"><Package size={23}/><div><b>Nessuna giacenza registrata</b><p>Il prodotto è nel catalogo. Registra un’entrata per aggiungere quantità, lotto, scadenza e ubicazione.</p></div></div>}<footer><button className="button secondary" disabled={disabled||lock} onClick={()=>open('edit',selected)}><Pencil size={17}/>Modifica prodotto</button><button className="button primary" disabled={disabled||lock} onClick={()=>{setDialog(null);onReceive(selected.id);}}><ArrowDownToLine size={18}/>Registra entrata</button></footer></>}
      {dialog.mode==='import'&&<><div className="catalog-upload-box"><FileSpreadsheet size={36}/><div><h3>{filename||'Scegli un file Excel o CSV'}</h3><p>{working?'Lettura e controllo del file…':'Formato .xlsx o .csv · massimo 5 MB · fino a 350 prodotti'}</p></div><label className={'button primary '+(lock?'catalog-file-disabled':'')}><Upload size={17}/>{filename?'Cambia file':'Scegli file'}<input type="file" accept=".xlsx,.csv" disabled={lock||disabled} aria-label="Seleziona file prodotti Excel o CSV" onChange={e=>{readFile(e.target.files?.[0]);e.target.value='';}}/></label></div><button className="text-button catalog-template" onClick={()=>download('template')} disabled={lock}><Download size={16}/>Scarica modello Excel</button><p className="catalog-section-hint">Le intestazioni riconosciute sono: Categoria, Cod., Descrizione, U.m., i tre listini, Tipologia, Unità per cartone e Scorta minima. L’importazione riguarda il catalogo; i saldi si registrano nelle entrate.</p>
      {imported&&<><div className="catalog-import-counts"><div><strong>{imported.products.length}</strong><span>Prodotti letti</span></div><div><strong>{newImport}</strong><span>Nuovi prodotti</span></div><div><strong>{existingImport}</strong><span>Codici già presenti</span></div></div>{imported.warnings.length>0&&<div className="catalog-import-warnings"><b>Da sapere prima di importare</b><ul>{imported.warnings.map((warning,i)=><li key={i}>{warning}</li>)}</ul></div>}{existingImport>0&&<fieldset className="catalog-import-mode"><legend>Per i codici già presenti</legend><label><input type="radio" name="import-mode" checked={importMode==='skip'} onChange={()=>setImportMode('skip')} disabled={lock}/><span><b>Mantieni i prodotti esistenti</b><small>Aggiungi soltanto i {newImport} nuovi prodotti.</small></span></label><label><input type="radio" name="import-mode" checked={importMode==='update'} onChange={()=>setImportMode('update')} disabled={lock}/><span><b>Aggiorna i prodotti esistenti</b><small>Sostituisce i dati con quelli del file, compresi prezzi e campi vuoti. Lotti e movimenti restano collegati.</small></span></label></fieldset>}{state.products.length+newImport>350&&<div className="catalog-error" role="alert">Il catalogo arriverebbe a {state.products.length+newImport} prodotti. Il limite attuale è 350: riduci il file prima di importare.</div>}<div className="catalog-import-preview-head"><h3>Anteprima</h3><span>{showAllImport?imported.products.length:Math.min(5,imported.products.length)} di {imported.products.length} righe</span></div><div className="catalog-import-preview"><table className="catalog-table"><thead><tr><th>Codice</th><th>Descrizione / categoria</th><th>U.m.</th>{priceFields.map(([key,label])=><th key={key}>{label}</th>)}<th>Operazione</th></tr></thead><tbody>{(showAllImport?imported.products:imported.products.slice(0,5)).map(p=><tr key={p.code}><td className="mono">{p.code}</td><td>{p.name}<small>{p.category||'Senza categoria'}</small></td><td>{p.unit}</td>{priceFields.map(([key])=><td key={key}>{price(p[key])}</td>)}<td><span className={'catalog-category '+(!existingCodes.has(p.code.toUpperCase())?'catalog-new':'')}>{existingCodes.has(p.code.toUpperCase())?importMode==='skip'?'Mantieni':'Aggiorna':'Nuovo'}</span></td></tr>)}</tbody></table></div>{imported.products.length>5&&<button type="button" className="text-button catalog-show-all" onClick={()=>setShowAllImport(v=>!v)}>{showAllImport?'Mostra prime 5 righe':`Mostra tutti i ${imported.products.length} prodotti`}</button>}</>}
      <footer><button type="button" className="button secondary" onClick={close} disabled={lock}>Chiudi</button><button type="button" className="button primary" disabled={disabled||lock||!canImport} onClick={runImport}><Check size={18}/>{busy?'Importazione…':`Importa${imported?` ${toSave} prodotti`:''}`}</button></footer></>}
    </section></div>}
  </section>;
}

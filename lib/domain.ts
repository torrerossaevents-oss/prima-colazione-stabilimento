/** Domain rules for the Prima Colazione pilot. Quantities are always base units. */
export type Product = { id:string; code:string; name:string; kind:'finished'|'raw'|'packaging'; unit:string; unitsPerBox:number; minStock:number; category?:string; priceGelCor?:number|null; priceGelitria?:number|null; priceDistribution?:number|null };
export type ProductInput = Omit<Product,'id'>;
export type Lot = { id:string; productId:string; code:string; expiry:string; area:string; quantity:number; blocked:number };
export type OrderLine = { lotId:string; quantity:number; shipped:number };
export type Order = { id:string; customer:string; destination:string; date:string; status:'reserved'|'prepared'|'partial'|'dispatched'|'cancelled'; lines:OrderLine[]; documentRef?:string; documents:{reference:string;at:string;quantities:{lotId:string;quantity:number}[]}[] };
export type Session = { id:string; productId:string; productCode:string; productName:string; unitsPerBox:number; day:string; operator:string; lotCode:string; expiry:string; status:'active'|'closed'; cartons:number; startedAt:string; closedAt?:string; source:'manual'; stockLoaded:false };
export type Audit = {id:string;at:string;action:string;detail:string;actor?:string};
export type State = {products:Product[];lots:Lot[];orders:Order[];sessions:Session[];audit:Audit[]};
export type Action =
 | {type:'product.add';product:Omit<Product,'id'>}
 | {type:'product.update';productId:string;product:Omit<Product,'id'>}
 | {type:'product.import';products:Omit<Product,'id'>[];mode:'skip'|'update'}
 | {type:'lot.receive';lot:Omit<Lot,'id'|'blocked'>}
 | {type:'lot.block';lotId:string;blocked:number}
 | {type:'lot.transfer';lotId:string;quantity:number;area:string}
 | {type:'lot.adjust';lotId:string;delta:number;reason:string;responsible:string}
 | {type:'order.create';order:{customer:string;destination:string;date:string;lines:{lotId:string;quantity:number}[]}}
 | {type:'order.prepare'|'order.cancel';orderId:string}
 | {type:'order.dispatch';orderId:string;documentRef:string;quantities?:{lotId:string;quantity:number}[]}
 | {type:'order.document';orderId:string;documentRef:string}
 | {type:'production.start';code:string;operator:string;lotCode:string;expiry:string}
 | {type:'production.count';sessionId:string;cartons:number}
 | {type:'production.close';sessionId:string};
export type Context = {now?:string;id?:()=>string;actor?:string};
export class DomainError extends Error { constructor(message:string){super(message);this.name='DomainError';} }
const fail=(message:string):never=>{throw new DomainError(message);};
export function initialState():State{return {products:[],lots:[],orders:[],sessions:[],audit:[]};}
export function todayRome(value:string|Date=new Date()):string{
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value));
 return ['year','month','day'].map(type=>parts.find(p=>p.type===type)!.value).join('-');
}
function text(value:unknown,name:string,max=160):string{
 if(typeof value!=='string'||!value.trim()||value.trim().length>max)fail(`${name}: inserisci un valore valido (massimo ${max} caratteri).`);
 return (value as string).trim();
}
function number(value:unknown,name:string,min=0):number{
 if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min||value>1_000_000_000)fail(`${name}: inserisci un numero intero valido, almeno ${min}.`);
 return value as number;
}
function category(value:unknown):string{
 if(value===undefined)return '';
 if(typeof value!=='string'||value.trim().length>120)fail('Categoria: inserisci un testo di massimo 120 caratteri.');
 return (value as string).trim();
}
function price(value:unknown,name:string):number|null{
 if(value===undefined||value===null)return null;
 if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>999_999.999)fail(`${name}: inserisci un prezzo da 0 a 999.999,999 oppure lascia vuoto.`);
 const scaled=(value as number)*1000;
 // Permit binary floating-point representation noise, never silently drop a fourth decimal.
 if(Math.abs(scaled-Math.round(scaled))>Math.max(1e-9,Number.EPSILON*Math.abs(scaled)*4))fail(`${name}: sono consentiti al massimo 3 decimali.`);
 return Math.round(scaled)/1000;
}
/** One validator for manual entry, editing and import. Missing optional update fields retain their values. */
export function normalizeProduct(input:ProductInput,previous?:Product):ProductInput{
 if(!input||typeof input!=='object'||Array.isArray(input))fail('Dati articolo mancanti o non validi.');
 if(!['finished','raw','packaging'].includes(input.kind))fail('Tipologia articolo non valida.');
 const enteredUnit=text(input.unit,'Unità di misura',40);
 const unit=enteredUnit.toUpperCase()==='CRT'?'CRT':enteredUnit;
 const unitsPerBox=number(input.unitsPerBox,'Unità di magazzino per cartone',1);
 if(unit==='CRT'&&unitsPerBox!==1)fail('Con unità CRT la giacenza è già in cartoni: imposta 1 unità di magazzino per cartone.');
 return {
  code:text(input.code,'Codice articolo',80).toUpperCase(),name:text(input.name,'Nome articolo'),kind:input.kind,unit,unitsPerBox,minStock:number(input.minStock,'Scorta minima'),
  category:category(input.category===undefined?previous?.category:input.category),
  priceGelCor:price(input.priceGelCor===undefined?previous?.priceGelCor:input.priceGelCor,'Prezzo GelCor'),
  priceGelitria:price(input.priceGelitria===undefined?previous?.priceGelitria:input.priceGelitria,'Prezzo Gelitria'),
  priceDistribution:price(input.priceDistribution===undefined?previous?.priceDistribution:input.priceDistribution,'Prezzo distribuzione'),
 };
}
function assertProductUpdateAllowed(state:State,previous:Product,next:ProductInput):void{
 const referenced=state.lots.some(lot=>lot.productId===previous.id)||state.sessions.some(session=>session.productId===previous.id);
 if(referenced&&(['code','unit','unitsPerBox','kind'] as const).some(key=>previous[key]!==next[key]))fail(`L’articolo ${previous.code} ha lotti o lavorazioni registrati: codice, tipo, unità e confezionamento non possono essere modificati. Puoi aggiornare descrizione, categoria, listini e scorta minima.`);
}
function date(value:unknown,name:string,allowEmpty=false):string{
 if(allowEmpty&&value==='')return '';
 const s=text(value,name,10); const parsed=new Date(s);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==s)fail(`${name}: data non valida.`);
 return s;
}
function array(value:unknown,name:string,max:number):asserts value is unknown[]{if(!Array.isArray(value)||!value.length||value.length>max)fail(`${name}: inserisci da 1 a ${max} righe.`);}
function activeOrder(order:Order){return order.status!=='cancelled'&&order.status!=='dispatched';}
export function reservedForLot(state:State,lotId:string):number{return state.orders.filter(activeOrder).reduce((sum,order)=>sum+order.lines.filter(line=>line.lotId===lotId).reduce((n,line)=>n+line.quantity-line.shipped,0),0);}
export function availableForLot(state:State,lotId:string,today=todayRome()):number{
 const lot=state.lots.find(row=>row.id===lotId);if(!lot||(lot.expiry&&lot.expiry<today))return 0;
 return lot.quantity-lot.blocked-reservedForLot(state,lotId);
}
export function productTotals(state:State,productId:string,today=todayRome()){
 return state.lots.filter(lot=>lot.productId===productId).reduce((t,lot)=>({present:t.present+lot.quantity,blocked:t.blocked+lot.blocked,reserved:t.reserved+reservedForLot(state,lot.id),available:t.available+availableForLot(state,lot.id,today),expired:t.expired+(lot.expiry&&lot.expiry<today?lot.quantity:0)}),{present:0,blocked:0,reserved:0,available:0,expired:0});
}
export function activeSession(state:State){return state.sessions.find(row=>row.status==='active');}
function ensureArea(state:State,area:string):string{
 const known=[...new Set(state.lots.map(lot=>lot.area))];const existing=known.find(name=>name.toLocaleLowerCase('it')===area.toLocaleLowerCase('it'));
 if(existing)return existing;if(known.length>=3)fail('Sono previste al massimo 3 aree. Scegli una delle aree già presenti.');return area;
}
export function validateState(state:State):void{
 if(!state||typeof state!=='object')fail('Archivio non valido.');
 for(const key of ['products','lots','orders','sessions','audit'] as const){if(!Array.isArray(state[key]))fail('Archivio non valido.');if(new Set(state[key].map(row=>row.id)).size!==state[key].length)fail('Identificativi duplicati nell’archivio.');}
 if(new Set(state.products.map(p=>p.code)).size!==state.products.length)fail('Codici articolo duplicati.');
 for(const product of state.products){category(product.category);price(product.priceGelCor,'Prezzo GelCor');price(product.priceGelitria,'Prezzo Gelitria');price(product.priceDistribution,'Prezzo distribuzione');}
 if(state.sessions.filter(s=>s.status==='active').length>1)fail('Può esserci una sola lavorazione attiva.');
 for(const lot of state.lots){if(!state.products.some(p=>p.id===lot.productId))fail('Articolo del lotto inesistente.');number(lot.quantity,'Giacenza');number(lot.blocked,'Quantità bloccata');if(lot.blocked+reservedForLot(state,lot.id)>lot.quantity)fail('Giacenza insufficiente per blocchi e prenotazioni.');}
 for(const order of state.orders)for(const line of order.lines){if(!state.lots.some(l=>l.id===line.lotId))fail('Lotto ordine inesistente.');number(line.quantity,'Quantità richiesta',1);number(line.shipped,'Quantità spedita');if(line.shipped>line.quantity)fail('La quantità spedita supera quella richiesta.');}
}
/** Returns a new state; never mutates input. Every operation appends an audit event. */
export function applyAction(previous:State,action:Action,context:Context={}):State{
 if(!action||typeof action!=='object'||typeof action.type!=='string')fail('Operazione non valida.');
 const state=structuredClone(previous);const now=context.now??new Date().toISOString();const today=todayRome(now);const id=context.id??(()=>crypto.randomUUID());
 const lotById=(lotId:string)=>state.lots.find(row=>row.id===lotId)??fail('Lotto non trovato.');
 const orderById=(orderId:string)=>state.orders.find(row=>row.id===orderId)??fail('Ordine non trovato.');let detail='';
 switch(action.type){
 case 'product.add':{
  if(state.products.length>=350)fail('Il catalogo pilota prevede fino a 350 articoli.');const input=normalizeProduct(action.product);
  if(state.products.some(row=>row.code===input.code))fail('Questo codice articolo esiste già.');
  const product:Product={id:id(),...input};state.products.push(product);detail=`Articolo ${product.code} · ${product.name} creato.`;break;
 }
 case 'product.update':{
  const previous=state.products.find(product=>product.id===action.productId)??fail('Articolo non trovato.');
  const input=normalizeProduct(action.product,previous);
  if(state.products.some(product=>product.id!==previous.id&&product.code===input.code))fail('Questo codice articolo esiste già.');
  assertProductUpdateAllowed(state,previous,input);
  Object.assign(previous,input);detail=`Articolo ${previous.code} · ${previous.name} aggiornato. Giacenze, riferimenti e lavorazioni conservati.`;break;
 }
 case 'product.import':{
  if(action.mode!=='skip'&&action.mode!=='update')fail('Modalità di importazione non valida.');
  array(action.products,'Importazione articoli',350);
  const seen=new Set<string>();
  const products=action.products.map((product,index)=>{
   try{
    if(!product||typeof product!=='object'||Array.isArray(product))fail('Dati articolo mancanti o non validi.');
    const code=text(product.code,'Codice articolo',80).toUpperCase();
    if(seen.has(code))fail(`Codice ${code} duplicato nel file: ogni articolo deve comparire una sola volta.`);
    seen.add(code);
    return normalizeProduct(product,state.products.find(existing=>existing.code===code));
   }catch(error){if(error instanceof DomainError)fail(`Riga ${index+1}: ${error.message}`);throw error;}
  });
  const newCount=products.filter(product=>!state.products.some(existing=>existing.code===product.code)).length;
  if(state.products.length+newCount>350)fail('Il catalogo pilota prevede fino a 350 articoli. Nessuna riga è stata importata.');
  let added=0,updated=0,skipped=0;
  for(const input of products){
   const previous=state.products.find(product=>product.code===input.code);
   if(!previous){state.products.push({id:id(),...input});added++;}
   else if(action.mode==='skip'){skipped++;}
   else{assertProductUpdateAllowed(state,previous,input);Object.assign(previous,input);updated++;}
  }
  detail=`Importazione catalogo: ${added} aggiunti, ${updated} aggiornati, ${skipped} già presenti e ignorati. Giacenze e riferimenti conservati.`;break;
 }
 case 'lot.receive':{
  const l=action.lot??fail('Dati lotto mancanti.');const p=state.products.find(p=>p.id===l.productId)??fail('Articolo non trovato.');const expiry=date(l.expiry,'Scadenza',p.kind==='packaging');
  const lot:Lot={id:id(),productId:p.id,code:text(l.code,'Codice lotto',80),expiry,area:ensureArea(state,text(l.area,'Area',60)),quantity:number(l.quantity,'Quantità',1),blocked:0};
  if(state.lots.some(row=>row.productId===lot.productId&&row.code===lot.code&&row.expiry!==lot.expiry))fail('Questo lotto è già presente con una scadenza diversa. Verifica i dati.');
  const existing=state.lots.find(row=>row.productId===lot.productId&&row.code===lot.code&&row.area===lot.area);
  if(existing){number(existing.quantity+lot.quantity,'Giacenza');existing.quantity+=lot.quantity;}else state.lots.push(lot);detail=`Carico manuale: ${lot.quantity} ${p.unit} · ${p.code} · lotto ${lot.code} · ${lot.area}.`;break;
 }
 case 'lot.block':{
  const lot=lotById(action.lotId);const blocked=number(action.blocked,'Quantità bloccata');if(blocked>lot.quantity-reservedForLot(state,lot.id))fail('La quantità bloccata comprende merce già prenotata. Libera prima la prenotazione.');lot.blocked=blocked;detail=`Lotto ${lot.code}: quantità bloccata impostata a ${blocked}.`;break;
 }
 case 'lot.transfer':{
  const lot=lotById(action.lotId);const quantity=number(action.quantity,'Quantità trasferita',1);const area=ensureArea(state,text(action.area,'Area di destinazione',60));if(area===lot.area)fail('Scegli un’area diversa da quella di partenza.');
  if(quantity>lot.quantity-lot.blocked-reservedForLot(state,lot.id))fail('Puoi trasferire soltanto merce non bloccata e non prenotata.');
  const target=state.lots.find(row=>row.productId===lot.productId&&row.code===lot.code&&row.expiry===lot.expiry&&row.area===area);lot.quantity-=quantity;if(target)target.quantity+=quantity;else state.lots.push({...lot,id:id(),area,quantity,blocked:0});detail=`Trasferimento lotto ${lot.code}: ${quantity} unità da ${lot.area} a ${area}.`;break;
 }
 case 'lot.adjust':{
  const lot=lotById(action.lotId);if(!Number.isSafeInteger(action.delta)||action.delta===0||Math.abs(action.delta)>1_000_000_000)fail('La rettifica deve essere un numero intero diverso da zero.');const reason=text(action.reason,'Motivo della rettifica',300);const responsible=text(action.responsible,'Responsabile',100);
  if(lot.quantity+action.delta<lot.blocked+reservedForLot(state,lot.id))fail('La rettifica ridurrebbe la giacenza sotto la quantità bloccata o prenotata.');lot.quantity+=action.delta;detail=`Rettifica lotto ${lot.code}: ${action.delta>0?'+':''}${action.delta}. Motivo: ${reason}. Responsabile: ${responsible}.`;break;
 }
 case 'order.create':{
  const input=action.order??fail('Dati ordine mancanti.');array(input.lines,'Ordine',350);if(input.lines.some(line=>!line||typeof line!=='object'))fail('Riga ordine non valida.');if(new Set(input.lines.map(l=>l.lotId)).size!==input.lines.length)fail('Ogni lotto può comparire una sola volta nell’ordine.');
  const lines=input.lines.map(line=>{const lot=lotById(line.lotId);const quantity=number(line.quantity,'Quantità richiesta',1);if(lot.expiry&&lot.expiry<today)fail(`Il lotto ${lot.code} è scaduto.`);if(quantity>availableForLot(state,lot.id,today))fail(`Disponibilità insufficiente per il lotto ${lot.code}.`);return {lotId:lot.id,quantity,shipped:0};});
  const order:Order={id:id(),customer:text(input.customer,'Cliente'),destination:text(input.destination,'Destinazione'),date:date(input.date,'Data ordine'),status:'reserved',lines,documents:[]};state.orders.push(order);detail=`Ordine ${order.customer} · ${order.destination}: merce prenotata, giacenza fisica invariata.`;break;
 }
 case 'order.prepare':{const order=orderById(action.orderId);if(order.status!=='reserved')fail('Puoi preparare soltanto un ordine prenotato.');order.status='prepared';detail=`Ordine ${order.customer}: preparazione completata.`;break;}
 case 'order.dispatch':{
  const order=orderById(action.orderId);if(!['prepared','partial'].includes(order.status))fail('Prepara l’ordine prima della spedizione. Un ordine chiuso non può essere spedito di nuovo.');const reference=text(action.documentRef,'Riferimento documento di uscita',120);
  const quantities=action.quantities??order.lines.filter(line=>line.quantity>line.shipped).map(line=>({lotId:line.lotId,quantity:line.quantity-line.shipped}));array(quantities,'Spedizione',350);if(quantities.some(line=>!line||typeof line!=='object'))fail('Riga spedizione non valida.');if(new Set(quantities.map(line=>line.lotId)).size!==quantities.length)fail('La spedizione contiene lotti duplicati.');
  for(const input of quantities){const line=order.lines.find(row=>row.lotId===input.lotId)??fail('Il lotto non appartiene all’ordine.');const quantity=number(input.quantity,'Quantità spedita',1);const lot=lotById(line.lotId);if(quantity>line.quantity-line.shipped)fail('La quantità supera il residuo dell’ordine.');if(lot.expiry&&lot.expiry<today)fail(`Il lotto ${lot.code} è scaduto: non puoi spedirlo.`);if(lot.quantity-lot.blocked<quantity)fail('Giacenza insufficiente per la spedizione.');line.shipped+=quantity;lot.quantity-=quantity;}
  order.status=order.lines.every(line=>line.shipped===line.quantity)?'dispatched':'partial';order.documentRef=reference;order.documents.push({reference,at:now,quantities});detail=`Ordine ${order.customer}: uscita ${order.status==='partial'?'parziale':'completa'}, documento ${reference}. Giacenza aggiornata una sola volta.`;break;
 }
 case 'order.cancel':{const order=orderById(action.orderId);if(!activeOrder(order))fail('Questo ordine è già chiuso.');order.status='cancelled';detail=`Ordine ${order.customer}: residuo annullato, prenotazioni liberate. Le uscite già registrate rimangono nello storico.`;break;}
 case 'order.document':{const order=orderById(action.orderId);const documentRef=text(action.documentRef,'Riferimento documento',120);if(!order.lines.some(line=>line.shipped>0))fail('Registra prima l’uscita della merce.');order.documentRef=documentRef;order.documents.push({reference:documentRef,at:now,quantities:[]});detail=`Ordine ${order.customer}: collegato documento ${documentRef}. Nessun nuovo scarico di magazzino.`;break;}
 case 'production.start':{
  if(activeSession(state))fail('Chiudi e salva la lavorazione attiva prima di iniziarne un’altra.');const code=text(action.code,'Codice articolo',80).toUpperCase();const p=state.products.find(row=>row.code===code&&row.kind==='finished')??fail('Codice sconosciuto o articolo non finito: avvio non consentito.');const expiry=date(action.expiry,'Scadenza');if(expiry<today)fail('La scadenza della produzione non può essere passata.');
  const session:Session={id:id(),productId:p.id,productCode:p.code,productName:p.name,unitsPerBox:p.unitsPerBox,day:today,operator:text(action.operator,'Operatore',100),lotCode:text(action.lotCode,'Codice lotto',80),expiry,status:'active',cartons:0,startedAt:now,source:'manual',stockLoaded:false};state.sessions.push(session);detail=`Lavorazione manuale avviata: ${p.code} · ${p.name} · lotto ${session.lotCode} · ${session.operator}.`;break;
 }
 case 'production.count':{const session=state.sessions.find(row=>row.id===action.sessionId)??fail('Lavorazione non trovata.');if(session.status!=='active')fail('La lavorazione è chiusa.');const cartons=number(action.cartons,'Cartoni da aggiungere',1);number(session.cartons+cartons,'Totale cartoni');session.cartons+=cartons;detail=`Conteggio manuale ${session.productCode}: +${cartons} cartoni, parziale ${session.cartons}.`;break;}
 case 'production.close':{const session=state.sessions.find(row=>row.id===action.sessionId)??fail('Lavorazione non trovata.');if(session.status!=='active')fail('La lavorazione è già stata salvata.');session.status='closed';session.closedAt=now;detail=`Lavorazione salvata: ${session.productCode} · ${session.cartons} cartoni. Storico conservato; la prossima lavorazione parte da zero. Nessun carico automatico a magazzino.`;break;}
 default:fail('Operazione non riconosciuta.');
 }
 state.audit.push({id:id(),at:now,action:action.type,detail,...(context.actor?{actor:context.actor}:{})});validateState(state);return state;
}

/** Domain rules for the Prima Colazione pilot. Quantities are always base units. */
export type Product = { id:string; code:string; name:string; kind:'finished'|'raw'|'packaging'; unit:string; unitsPerBox:number; minStock:number; category?:string; priceGelCor?:number|null; priceGelitria?:number|null; priceDistribution?:number|null; inUse?:boolean };
export type ProductInput = Omit<Product,'id'>;
export type Lot = { id:string; productId:string; code:string; expiry:string; area:string; quantity:number; blocked:number };
export type OrderLine = { lotId:string; quantity:number; shipped:number };
export type OrderDocument = {reference:string;at:string;quantities:{lotId:string;quantity:number}[];note?:string};
export type Order = { id:string; customer:string; destination:string; date:string; status:'reserved'|'prepared'|'partial'|'dispatched'|'cancelled'; lines:OrderLine[]; documentRef?:string; documents:OrderDocument[]; closedAt?:string };
export const PRODUCTION_LINE='linea-1';
export type DeviceClose = {eventId:string;deviceId:string;counterStart:number;counterEnd:number;counterModulo?:number;deviceClosedAt:string;anomalies:string[]};
/** cartons = cartoni letti; scrapCartons = scarti dichiarati alla chiusura. La quantità buona non viene caricata a magazzino. */
export type Session = { id:string; productId:string; productCode:string; productName:string; unitsPerBox:number; unit?:string; line?:string; day:string; operator:string; lotCode:string; expiry:string; status:'active'|'closed'; cartons:number; startedAt:string; closedAt?:string; source:'manual'|'device'; stockLoaded:false; scrapCartons?:number; closeNote?:string; closedBy?:'manual'|'device'|'manual-override'; device?:DeviceClose };
/** Variazione esplicita del fisico di un lotto, registrata nell'evento che la causa. */
export type Move = {lotId:string;delta:number;kind:'receive'|'return'|'dispatch'|'transfer'|'adjust'|'scrap'|'consume'};
export type Audit = {id:string;at:string;action:string;detail:string;actor?:string;moves?:Move[]};
export type State = {products:Product[];lots:Lot[];orders:Order[];sessions:Session[];audit:Audit[];areas?:string[]};
export type Action =
 | {type:'product.add';product:Omit<Product,'id'>}
 | {type:'product.update';productId:string;product:Omit<Product,'id'>}
 | {type:'product.import';products:Omit<Product,'id'>[];mode:'skip'|'update'}
 | {type:'lot.receive';lot:Omit<Lot,'id'|'blocked'>}
 | {type:'lot.block';lotId:string;blocked:number}
 | {type:'lot.transfer';lotId:string;quantity:number;area:string}
 | {type:'lot.adjust';lotId:string;delta:number;reason:string;responsible:string}
 | {type:'lot.scrap';lotId:string;quantity:number;fromBlocked:boolean;reason:string;responsible:string}
 | {type:'lot.consume';lotId:string;quantity:number;reason:string;responsible:string}
 | {type:'lot.return';lot:Omit<Lot,'id'|'blocked'>;reason:string;reference:string}
 | {type:'order.create';order:{customer:string;destination:string;date:string;lines:{lotId:string;quantity:number}[]}}
 | {type:'order.prepare'|'order.cancel';orderId:string}
 | {type:'order.dispatch';orderId:string;documentRef:string;quantities?:{lotId:string;quantity:number}[];note?:string}
 | {type:'order.document';orderId:string;documentRef:string}
 | {type:'production.start';code:string;operator:string;lotCode:string;expiry:string;counting?:'manual'|'device'}
 | {type:'production.count';sessionId:string;cartons:number}
 | {type:'production.close';sessionId:string;scrapCartons?:number;note?:string;override?:string}
 | {type:'production.deviceClose';sessionId:string;eventId:string;cartons:number;counterStart:number;counterEnd:number;counterModulo?:number;closedAt:string;anomalies?:string[]};
/** device: richiesta autenticata da credenziale di dispositivo; devicesEnabled: esiste almeno un dispositivo attivo per la linea. */
export type Context = {now?:string;id?:()=>string;actor?:string;device?:{id:string};devicesEnabled?:boolean};
export class DomainError extends Error { code?:string; constructor(message:string,code?:string){super(message);this.name='DomainError';this.code=code;} }
const fail=(message:string,code?:string):never=>{throw new DomainError(message,code);};
export function initialState():State{return {products:[],lots:[],orders:[],sessions:[],audit:[]};}
/** Calendar arithmetic on YYYY-MM-DD days, independent of the local clock and of DST. */
export function addDays(day:string,days:number):string{
 const [y,m,d]=day.split('-').map(Number);return new Date(Date.UTC(y,m-1,d+days)).toISOString().slice(0,10);
}
let romeFormat:Intl.DateTimeFormat|undefined;
export function todayRome(value:string|Date=new Date()):string{
 romeFormat??=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit'});
 const parts=romeFormat.formatToParts(new Date(value));
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
 if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>999_999.999)fail(`Prezzo «${name}»: inserisci un valore da 0 a 999.999,999 oppure lascia vuoto.`);
 const scaled=(value as number)*1000;
 // Permit binary floating-point representation noise, never silently drop a fourth decimal.
 if(Math.abs(scaled-Math.round(scaled))>Math.max(1e-9,Number.EPSILON*Math.abs(scaled)*4))fail(`Prezzo «${name}»: sono consentiti al massimo 3 decimali.`);
 return Math.round(scaled)/1000;
}
/** One validator for manual entry, editing and import. Missing optional update fields retain their values. */
export function normalizeProduct(input:ProductInput,previous?:Product):ProductInput{
 if(!input||typeof input!=='object'||Array.isArray(input))fail('Dati articolo mancanti o non validi.');
 // Absent kind/minStock (e.g. column missing from an import) keep the stored value; new articles default to finished / 0.
 const kind=input.kind===undefined?(previous?.kind??'finished'):input.kind;const minStock=input.minStock===undefined?(previous?.minStock??0):input.minStock;
 if(!['finished','raw','packaging'].includes(kind))fail('Tipologia articolo non valida.');
 const enteredUnit=text(input.unit,'Unità di misura',40);
 const unit=enteredUnit.toUpperCase()==='CRT'?'CRT':enteredUnit;
 const unitsPerBox=number(input.unitsPerBox,'Unità di magazzino per cartone',1);
 if(unit==='CRT'&&unitsPerBox!==1)fail('Con unità CRT la giacenza è già in cartoni: imposta 1 unità di magazzino per cartone.');
 return {
  code:text(input.code,'Codice articolo',80).toUpperCase(),name:text(input.name,'Nome articolo'),kind,unit,unitsPerBox,minStock:number(minStock,'Scorta minima'),
  category:category(input.category===undefined?previous?.category:input.category),
  priceGelCor:price(input.priceGelCor===undefined?previous?.priceGelCor:input.priceGelCor,'Listino 3 - Gel.Cor.'),
  priceGelitria:price(input.priceGelitria===undefined?previous?.priceGelitria:input.priceGelitria,'GELITRIA SRL'),
  priceDistribution:price(input.priceDistribution===undefined?previous?.priceDistribution:input.priceDistribution,'Distribuzione'),
 };
}
function assertProductUpdateAllowed(state:State,previous:Product,next:ProductInput):void{
 const referenced=previous.inUse||state.lots.some(lot=>lot.productId===previous.id)||state.sessions.some(session=>session.productId===previous.id);
 if(referenced&&(['code','unit','unitsPerBox','kind'] as const).some(key=>previous[key]!==next[key]))fail(`L’articolo ${previous.code} ha lotti o lavorazioni registrati: codice, tipo, unità e confezionamento non possono essere modificati. Puoi aggiornare descrizione, categoria, listini e scorta minima.`);
}
function date(value:unknown,name:string,allowEmpty=false):string{
 if(allowEmpty&&value==='')return '';
 const s=text(value,name,10); const parsed=new Date(s);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==s)fail(`${name}: data non valida.`);
 return s;
}
function array(value:unknown,name:string,max:number):asserts value is unknown[]{if(!Array.isArray(value)||!value.length||value.length>max)fail(`${name}: inserisci da 1 a ${max} righe.`);}
export function activeOrder(order:Order){return order.status!=='cancelled'&&order.status!=='dispatched';}
/** One pass over open orders: reserved (= requested − shipped) per lot. */
export function reservationIndex(state:State):Map<string,number>{
 const index=new Map<string,number>();
 for(const order of state.orders){if(!activeOrder(order))continue;for(const line of order.lines){const open=line.quantity-line.shipped;if(open)index.set(line.lotId,(index.get(line.lotId)??0)+open);}}
 return index;
}
export function reservedForLot(state:State,lotId:string,index?:Map<string,number>):number{return (index??reservationIndex(state)).get(lotId)??0;}
function lotAvailable(lot:Lot,reserved:number,today:string){return lot.expiry&&lot.expiry<today?0:lot.quantity-lot.blocked-reserved;}
export function availableForLot(state:State,lotId:string,today=todayRome(),index?:Map<string,number>):number{
 const lot=state.lots.find(row=>row.id===lotId);if(!lot)return 0;
 return lotAvailable(lot,reservedForLot(state,lotId,index),today);
}
export type Totals={present:number;blocked:number;reserved:number;available:number;expired:number};
const emptyTotals=():Totals=>({present:0,blocked:0,reserved:0,available:0,expired:0});
/** Per-lot and per-product balances computed once, for screens that list many rows. */
export function stockIndex(state:State,today=todayRome()){
 const reservations=reservationIndex(state);const lots=new Map<string,{reserved:number;available:number;expired:boolean}>();const products=new Map<string,Totals>();
 for(const lot of state.lots){
  const reserved=reservations.get(lot.id)??0;const expired=Boolean(lot.expiry&&lot.expiry<today);const available=lotAvailable(lot,reserved,today);
  lots.set(lot.id,{reserved,available,expired});
  const t=products.get(lot.productId)??emptyTotals();t.present+=lot.quantity;t.blocked+=lot.blocked;t.reserved+=reserved;t.available+=available;if(expired)t.expired+=lot.quantity;products.set(lot.productId,t);
 }
 return {lots,products,totals:(productId:string)=>products.get(productId)??emptyTotals(),lot:(lotId:string)=>lots.get(lotId)??{reserved:0,available:0,expired:false}};
}
export function productTotals(state:State,productId:string,today=todayRome(),index?:Map<string,number>):Totals{
 const reservations=index??reservationIndex(state);const t=emptyTotals();
 for(const lot of state.lots){if(lot.productId!==productId)continue;const reserved=reservations.get(lot.id)??0;t.present+=lot.quantity;t.blocked+=lot.blocked;t.reserved+=reserved;t.available+=lotAvailable(lot,reserved,today);if(lot.expiry&&lot.expiry<today)t.expired+=lot.quantity;}
 return t;
}
/** Lots whose expiry falls within the next `days` calendar days in Europe/Rome, or already passed. */
export function expiringLots(state:State,today=todayRome(),days=7):Lot[]{
 const limit=addDays(today,days);return state.lots.filter(lot=>lot.quantity>0&&lot.expiry&&lot.expiry<=limit);
}
export function activeSession(state:State){return state.sessions.find(row=>row.status==='active');}
export function knownAreas(state:State):string[]{
 const areas:string[]=[];for(const name of [...(state.areas??[]),...state.lots.map(lot=>lot.area)])if(!areas.some(a=>a.toLocaleLowerCase('it')===name.toLocaleLowerCase('it')))areas.push(name);return areas;
}
function ensureArea(state:State,area:string):string{
 const known=knownAreas(state);const existing=known.find(name=>name.toLocaleLowerCase('it')===area.toLocaleLowerCase('it'));
 if(existing)return existing;if(known.length>=3)fail('Sono previste al massimo 3 aree. Scegli una delle aree già presenti.');state.areas=[...known,area];return area;
}
/**
 * Brings a stored workspace to the current shape without changing balances:
 * remembers areas and products already used, so archiving old rows never relaxes
 * the 3-area limit or the structural lock on referenced products. Idempotent.
 */
export function upgradeState(input:State):State{
 const state=structuredClone(input);
 const used=new Set([...state.lots.map(l=>l.productId),...state.sessions.map(s=>s.productId)]);
 for(const product of state.products)if(used.has(product.id))product.inUse=true;
 if(state.lots.length||state.areas)state.areas=knownAreas(state);
 for(const session of state.sessions){session.line??=PRODUCTION_LINE;session.source??='manual';}
 return state;
}
/** Whole-workspace invariants. Linear in the number of rows (indexes, no nested scans). */
export function validateState(state:State):void{
 if(!state||typeof state!=='object')fail('Archivio non valido.');
 for(const key of ['products','lots','orders','sessions','audit'] as const){if(!Array.isArray(state[key]))fail('Archivio non valido.');if(new Set(state[key].map(row=>row.id)).size!==state[key].length)fail('Identificativi duplicati nell’archivio.');}
 if(new Set(state.products.map(p=>p.code)).size!==state.products.length)fail('Codici articolo duplicati.');
 for(const product of state.products){category(product.category);price(product.priceGelCor,'Listino 3 - Gel.Cor.');price(product.priceGelitria,'GELITRIA SRL');price(product.priceDistribution,'Distribuzione');}
 if(state.sessions.filter(s=>s.status==='active').length>1)fail('Può esserci una sola lavorazione attiva.');
 if(knownAreas(state).length>3)fail('Sono previste al massimo 3 aree.');
 const productIds=new Set(state.products.map(p=>p.id));const lotIds=new Set(state.lots.map(l=>l.id));const reservations=reservationIndex(state);
 for(const lot of state.lots){if(!productIds.has(lot.productId))fail('Articolo del lotto inesistente.');number(lot.quantity,'Giacenza');number(lot.blocked,'Quantità bloccata');if(lot.blocked+(reservations.get(lot.id)??0)>lot.quantity)fail('Giacenza insufficiente per blocchi e prenotazioni.');}
 for(const order of state.orders)for(const line of order.lines){if(!lotIds.has(line.lotId))fail('Lotto ordine inesistente.');number(line.quantity,'Quantità richiesta',1);number(line.shipped,'Quantità spedita');if(line.shipped>line.quantity)fail('La quantità spedita supera quella richiesta.');}
 for(const session of state.sessions){number(session.cartons,'Cartoni');if(session.scrapCartons!==undefined&&(number(session.scrapCartons,'Scarti')>session.cartons))fail('Gli scarti superano i cartoni letti.');}
}
export type ProductionRow={day:string;productId:string;productCode:string;productName:string;lotCode:string;unit:string;unitsPerBox:number;sessions:number;confirmedCartons:number;activeCartons:number;scrapCartons:number;deviceSessions:number};
/**
 * Daily production by day/article/lot. The day is the Europe/Rome start day of each
 * session. Confirmed = closed sessions; active = session still open (not final).
 * Cartons are never summed across different articles into one figure.
 */
export function productionSummary(sessions:Session[],from?:string,to?:string):ProductionRow[]{
 const rows=new Map<string,ProductionRow>();
 for(const s of sessions){
  if((from&&s.day<from)||(to&&s.day>to))continue;
  const key=[s.day,s.productId,s.lotCode].join('\u0000');
  const row=rows.get(key)??{day:s.day,productId:s.productId,productCode:s.productCode,productName:s.productName,lotCode:s.lotCode,unit:s.unit??'',unitsPerBox:s.unitsPerBox,sessions:0,confirmedCartons:0,activeCartons:0,scrapCartons:0,deviceSessions:0};
  row.sessions++;if(s.status==='closed')row.confirmedCartons+=s.cartons;else row.activeCartons+=s.cartons;row.scrapCartons+=s.scrapCartons??0;if(s.source==='device')row.deviceSessions++;
  rows.set(key,row);
 }
 return [...rows.values()].sort((a,b)=>b.day.localeCompare(a.day)||a.productCode.localeCompare(b.productCode)||a.lotCode.localeCompare(b.lotCode));
}
function optionalText(value:unknown,name:string,max=300):string{
 if(value===undefined||value===null||value==='')return '';
 if(typeof value!=='string'||value.trim().length>max)fail(`${name}: massimo ${max} caratteri.`);
 return (value as string).trim();
}
/** Returns a new state; never mutates input. Every operation appends an audit event; physical changes carry explicit moves. */
export function applyAction(previous:State,action:Action,context:Context={}):State{
 if(!action||typeof action!=='object'||typeof action.type!=='string')fail('Operazione non valida.');
 const state=structuredClone(previous);const now=context.now??new Date().toISOString();const today=todayRome(now);const id=context.id??(()=>crypto.randomUUID());
 const reservations=()=>reservationIndex(state);
 const lotById=(lotId:string)=>state.lots.find(row=>row.id===lotId)??fail('Lotto non trovato.');
 const orderById=(orderId:string)=>state.orders.find(row=>row.id===orderId)??fail('Ordine non trovato.');
 const productOf=(lot:Lot)=>state.products.find(p=>p.id===lot.productId)!;
 const moves:Move[]=[];const move=(lot:Lot,delta:number,kind:Move['kind'])=>{lot.quantity+=delta;moves.push({lotId:lot.id,delta,kind});};
 const free=(lot:Lot)=>lot.quantity-lot.blocked-(reservations().get(lot.id)??0);
 let detail='';
 if(action.type==='production.deviceClose'&&!context.device)fail('Chiusura da dispositivo consentita solo al ponte autenticato.');
 if(context.device&&action.type!=='production.deviceClose')fail('Il dispositivo può registrare soltanto la chiusura della lavorazione.');
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
 case 'lot.receive':
 case 'lot.return':{
  const l=action.lot??fail('Dati lotto mancanti.');const p=state.products.find(p=>p.id===l.productId)??fail('Articolo non trovato.');const expiry=date(l.expiry,'Scadenza',p.kind==='packaging');
  const isReturn=action.type==='lot.return';
  const reason=isReturn?text(action.reason,'Motivo del reso',300):'';const reference=isReturn?text(action.reference,'Riferimento del reso',120):'';
  const lot:Lot={id:id(),productId:p.id,code:text(l.code,'Codice lotto',80),expiry,area:ensureArea(state,text(l.area,'Area',60)),quantity:0,blocked:0};
  const quantity=number(l.quantity,'Quantità',1);
  if(state.lots.some(row=>row.productId===lot.productId&&row.code===lot.code&&row.expiry!==lot.expiry))fail('Questo lotto è già presente con una scadenza diversa. Verifica i dati.');
  const target=state.lots.find(row=>row.productId===lot.productId&&row.code===lot.code&&row.area===lot.area)??(state.lots.push(lot),lot);
  number(target.quantity+quantity,'Giacenza');move(target,quantity,isReturn?'return':'receive');if(isReturn)target.blocked+=quantity;p.inUse=true;
  detail=isReturn?`Reso da controllare: ${quantity} ${p.unit} · ${p.code} · lotto ${target.code} · ${target.area}, bloccato fino alla verifica. Motivo: ${reason}. Riferimento: ${reference}.`:`Carico manuale: ${quantity} ${p.unit} · ${p.code} · lotto ${target.code} · ${target.area}.`;break;
 }
 case 'lot.block':{
  const lot=lotById(action.lotId);const blocked=number(action.blocked,'Quantità bloccata');if(blocked>lot.quantity-(reservations().get(lot.id)??0))fail('La quantità bloccata comprende merce già prenotata. Libera prima la prenotazione.');lot.blocked=blocked;detail=`Lotto ${lot.code}: quantità bloccata impostata a ${blocked}.`;break;
 }
 case 'lot.transfer':{
  const lot=lotById(action.lotId);const quantity=number(action.quantity,'Quantità trasferita',1);const area=ensureArea(state,text(action.area,'Area di destinazione',60));if(area===lot.area)fail('Scegli un’area diversa da quella di partenza.');
  if(quantity>free(lot))fail('Puoi trasferire soltanto merce non bloccata e non prenotata.');
  let target=state.lots.find(row=>row.productId===lot.productId&&row.code===lot.code&&row.expiry===lot.expiry&&row.area===area);
  if(!target){target={...lot,id:id(),area,quantity:0,blocked:0};state.lots.push(target);}
  move(lot,-quantity,'transfer');move(target,quantity,'transfer');detail=`Trasferimento lotto ${lot.code}: ${quantity} unità da ${lot.area} a ${area}.`;break;
 }
 case 'lot.adjust':{
  const lot=lotById(action.lotId);if(!Number.isSafeInteger(action.delta)||action.delta===0||Math.abs(action.delta)>1_000_000_000)fail('La rettifica deve essere un numero intero diverso da zero.');const reason=text(action.reason,'Motivo della rettifica',300);const responsible=text(action.responsible,'Responsabile',100);
  if(lot.quantity+action.delta<lot.blocked+(reservations().get(lot.id)??0))fail('La rettifica ridurrebbe la giacenza sotto la quantità bloccata o prenotata.');move(lot,action.delta,'adjust');detail=`Rettifica lotto ${lot.code}: ${action.delta>0?'+':''}${action.delta}. Motivo: ${reason}. Responsabile: ${responsible}.`;break;
 }
 case 'lot.scrap':{
  const lot=lotById(action.lotId);const quantity=number(action.quantity,'Quantità scartata',1);const reason=text(action.reason,'Motivo dello scarto',300);const responsible=text(action.responsible,'Responsabile',100);
  if(action.fromBlocked===true){if(quantity>lot.blocked)fail('Lo scarto supera la quantità bloccata del lotto.');lot.blocked-=quantity;}
  else if(action.fromBlocked===false){if(quantity>free(lot))fail('Puoi scartare soltanto merce non bloccata e non prenotata, oppure scegli lo scarto dalla quantità bloccata.');}
  else fail('Indica se lo scarto riguarda merce bloccata.');
  move(lot,-quantity,'scrap');const p=productOf(lot);detail=`Scarto lotto ${lot.code}: −${quantity} ${p.unit} · ${p.code}${action.fromBlocked?' dalla quantità bloccata':''}. Motivo: ${reason}. Responsabile: ${responsible}.`;break;
 }
 case 'lot.consume':{
  const lot=lotById(action.lotId);const quantity=number(action.quantity,'Quantità consumata',1);const reason=text(action.reason,'Motivo del consumo',300);const responsible=text(action.responsible,'Responsabile',100);
  if(lot.expiry&&lot.expiry<today)fail(`Il lotto ${lot.code} è scaduto: registra uno scarto, non un consumo.`);
  if(quantity>free(lot))fail('Puoi consumare soltanto merce non bloccata e non prenotata.');
  move(lot,-quantity,'consume');const p=productOf(lot);detail=`Consumo interno lotto ${lot.code}: −${quantity} ${p.unit} · ${p.code}. Motivo: ${reason}. Responsabile: ${responsible}.`;break;
 }
 case 'order.create':{
  const input=action.order??fail('Dati ordine mancanti.');array(input.lines,'Ordine',350);if(input.lines.some(line=>!line||typeof line!=='object'))fail('Riga ordine non valida.');if(new Set(input.lines.map(l=>l.lotId)).size!==input.lines.length)fail('Ogni lotto può comparire una sola volta nell’ordine.');
  const index=reservations();
  const lines=input.lines.map(line=>{const lot=lotById(line.lotId);const quantity=number(line.quantity,'Quantità richiesta',1);if(lot.expiry&&lot.expiry<today)fail(`Il lotto ${lot.code} è scaduto.`);if(quantity>lotAvailable(lot,index.get(lot.id)??0,today))fail(`Disponibilità insufficiente per il lotto ${lot.code}.`);return {lotId:lot.id,quantity,shipped:0};});
  const order:Order={id:id(),customer:text(input.customer,'Cliente'),destination:text(input.destination,'Destinazione'),date:date(input.date,'Data ordine'),status:'reserved',lines,documents:[]};state.orders.push(order);detail=`Ordine ${order.customer} · ${order.destination}: merce prenotata, giacenza fisica invariata.`;break;
 }
 case 'order.prepare':{const order=orderById(action.orderId);if(order.status!=='reserved')fail('Puoi preparare soltanto un ordine prenotato.');order.status='prepared';detail=`Ordine ${order.customer}: preparazione completata. Giacenza fisica invariata.`;break;}
 case 'order.dispatch':{
  const order=orderById(action.orderId);if(!['prepared','partial'].includes(order.status))fail('Prepara l’ordine prima della spedizione. Un ordine chiuso non può essere spedito di nuovo.');const reference=text(action.documentRef,'Riferimento documento di uscita',120);
  const quantities=action.quantities??order.lines.filter(line=>line.quantity>line.shipped).map(line=>({lotId:line.lotId,quantity:line.quantity-line.shipped}));array(quantities,'Spedizione',350);if(quantities.some(line=>!line||typeof line!=='object'))fail('Riga spedizione non valida.');if(new Set(quantities.map(line=>line.lotId)).size!==quantities.length)fail('La spedizione contiene lotti duplicati.');
  const note=optionalText(action.note,'Motivo della consegna parziale');
  for(const input of quantities){const line=order.lines.find(row=>row.lotId===input.lotId)??fail('Il lotto non appartiene all’ordine.');const quantity=number(input.quantity,'Quantità spedita',1);const lot=lotById(line.lotId);if(quantity>line.quantity-line.shipped)fail('La quantità supera il residuo dell’ordine.');if(lot.expiry&&lot.expiry<today)fail(`Il lotto ${lot.code} è scaduto: non puoi spedirlo.`);if(lot.quantity-lot.blocked<quantity)fail('Giacenza insufficiente per la spedizione.');line.shipped+=quantity;move(lot,-quantity,'dispatch');}
  const partial=!order.lines.every(line=>line.shipped===line.quantity);
  if(partial&&!note)fail('Consegna parziale: indica il motivo della differenza fra richiesto e partito.');
  order.status=partial?'partial':'dispatched';if(!partial)order.closedAt=now;order.documentRef=reference;order.documents.push({reference,at:now,quantities,...(note?{note}:{})});detail=`Ordine ${order.customer}: uscita ${partial?'parziale':'completa'}, documento ${reference}. Giacenza aggiornata una sola volta.${note?` Motivo: ${note}.`:''}`;break;
 }
 case 'order.cancel':{const order=orderById(action.orderId);if(!activeOrder(order))fail('Questo ordine è già chiuso.');order.status='cancelled';order.closedAt=now;detail=`Ordine ${order.customer}: residuo annullato, prenotazioni liberate. Le uscite già registrate rimangono nello storico.`;break;}
 case 'order.document':{const order=orderById(action.orderId);const documentRef=text(action.documentRef,'Riferimento documento',120);if(!order.lines.some(line=>line.shipped>0))fail('Registra prima l’uscita della merce.');order.documentRef=documentRef;order.documents.push({reference:documentRef,at:now,quantities:[]});detail=`Ordine ${order.customer}: collegato documento ${documentRef}. Nessun nuovo scarico di magazzino.`;break;}
 case 'production.start':{
  if(activeSession(state))fail('Chiudi e salva la lavorazione attiva prima di iniziarne un’altra.');const code=text(action.code,'Codice articolo',80).toUpperCase();const p=state.products.find(row=>row.code===code&&row.kind==='finished')??fail('Codice sconosciuto o articolo non finito: avvio non consentito.');const expiry=date(action.expiry,'Scadenza');if(expiry<today)fail('La scadenza della produzione non può essere passata.');
  const counting=action.counting??'manual';if(counting!=='manual'&&counting!=='device')fail('Modalità di conteggio non valida.');
  if(counting==='device'&&!context.devicesEnabled)fail('Nessun ponte conta-cartoni attivo: avvia la lavorazione con conteggio manuale.');
  const session:Session={id:id(),productId:p.id,productCode:p.code,productName:p.name,unitsPerBox:p.unitsPerBox,unit:p.unit,line:PRODUCTION_LINE,day:today,operator:text(action.operator,'Operatore',100),lotCode:text(action.lotCode,'Codice lotto',80),expiry,status:'active',cartons:0,startedAt:now,source:counting,stockLoaded:false};state.sessions.push(session);p.inUse=true;
  detail=`Lavorazione ${counting==='device'?'con conteggio fotocellule':'manuale'} avviata: ${p.code} · ${p.name} · lotto ${session.lotCode} · ${session.operator}.`;break;
 }
 case 'production.count':{const session=state.sessions.find(row=>row.id===action.sessionId)??fail('Lavorazione non trovata.');if(session.status!=='active')fail('La lavorazione è chiusa.');if(session.source==='device')fail('Questa lavorazione è contata dalle fotocellule: non aggiungere cartoni a mano.');const cartons=number(action.cartons,'Cartoni da aggiungere',1);number(session.cartons+cartons,'Totale cartoni');session.cartons+=cartons;detail=`Conteggio manuale ${session.productCode}: +${cartons} cartoni, parziale ${session.cartons}.`;break;}
 case 'production.close':{
  const session=state.sessions.find(row=>row.id===action.sessionId)??fail('Lavorazione non trovata.');if(session.status!=='active')fail('La lavorazione è già stata salvata.');
  const override=optionalText(action.override,'Motivo della chiusura manuale');
  if(session.source==='device'&&!override)fail('Lavorazione contata dalle fotocellule: chiudila con il pulsante sulla linea oppure indica il motivo della chiusura manuale.');
  const scrap=action.scrapCartons===undefined?0:number(action.scrapCartons,'Cartoni scartati');if(scrap>session.cartons)fail('Gli scarti non possono superare i cartoni letti.');
  const note=optionalText(action.note,'Nota di chiusura');if(scrap>0&&!note)fail('Indica il motivo degli scarti.');
  session.status='closed';session.closedAt=now;session.closedBy=session.source==='device'?'manual-override':'manual';if(scrap)session.scrapCartons=scrap;const closeNote=[override,note].filter(Boolean).join(' · ');if(closeNote)session.closeNote=closeNote;
  detail=`Lavorazione salvata: ${session.productCode} · ${session.cartons} cartoni letti${scrap?`, ${scrap} scartati`:''}.${override?` Chiusura manuale di una lavorazione da fotocellule: ${override}.`:''} Storico conservato; la prossima lavorazione parte da zero. Nessun carico automatico a magazzino.`;break;
 }
 case 'production.deviceClose':{
  const session=state.sessions.find(row=>row.id===action.sessionId)??fail('Lavorazione non trovata.','session-unknown');
  if(session.status!=='active')fail('La lavorazione è già chiusa: verifica il conteggio del ponte.','session-closed');
  if(session.source!=='device')fail('La lavorazione attiva è manuale: il ponte non può chiuderla.','session-manual');
  const eventId=text(action.eventId,'Identificativo evento',128);
  const counter=(value:unknown,name:string)=>{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)fail(`${name}: valore del contatore non valido.`);return value as number;};
  const start=counter(action.counterStart,'Contatore iniziale');const end=counter(action.counterEnd,'Contatore finale');const cartons=number(action.cartons,'Cartoni');
  let modulo:number|undefined;if(action.counterModulo!==undefined){modulo=counter(action.counterModulo,'Modulo contatore');if(modulo<2)fail('Modulo contatore non valido.');if(start>=modulo||end>=modulo)fail('Contatore fuori dal modulo dichiarato.');}
  const expected=modulo?(end-start+modulo)%modulo:end-start;if(expected!==cartons||cartons<0)fail('Cartoni non coerenti con i valori del contatore.','counter-mismatch');
  const closedAt=text(action.closedAt,'Ora di chiusura',40);if(!Number.isFinite(Date.parse(closedAt)))fail('Ora di chiusura non valida.');
  const anomalies=(action.anomalies??[]);if(!Array.isArray(anomalies)||anomalies.length>20||anomalies.some(a=>typeof a!=='string'||!a.trim()||a.length>60))fail('Anomalie non valide.');
  session.cartons=cartons;session.status='closed';session.closedAt=now;session.closedBy='device';
  session.device={eventId,deviceId:context.device!.id,counterStart:start,counterEnd:end,...(modulo?{counterModulo:modulo}:{}),deviceClosedAt:closedAt,anomalies:anomalies.map(a=>a.trim())};
  detail=`Lavorazione chiusa dal ponte: ${session.productCode} · ${cartons} cartoni letti (contatore ${start} → ${end}).${anomalies.length?` Anomalie da verificare: ${anomalies.join(', ')}.`:''} Nessun carico automatico a magazzino.`;break;
 }
 default:fail('Operazione non riconosciuta.');
 }
 state.audit.push({id:id(),at:now,action:action.type,detail,...(context.actor?{actor:context.actor}:{}),...(moves.length?{moves}:{})});validateState(state);return state;
}

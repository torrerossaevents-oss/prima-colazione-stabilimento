/** Domain rules for the Prima Colazione pilot. Quantities are always base units. */
export type Product = { id:string; code:string; name:string; kind:'finished'|'raw'|'packaging'; unit:string; unitsPerBox:number; minStock:number; category?:string; priceGelCor?:number|null; priceGelitria?:number|null; priceDistribution?:number|null; inUse?:boolean;
 /** Etichetta: EAN-13/EAN-8, pezzi e peso per cartone, durata in mesi (scadenza = produzione + mesi), testi. */
 ean?:string; piecesPerCarton?:number; pieceWeightG?:number; shelfLifeMonths?:number; labelDescription?:string; ingredients?:string; storage?:string };
export type ProductInput = Omit<Product,'id'>;
export type Lot = { id:string; productId:string; code:string; expiry:string; area:string; quantity:number; blocked:number };
export type OrderLine = { lotId:string; quantity:number; shipped:number };
export type OrderDocument = {reference:string;at:string;quantities:{lotId:string;quantity:number}[];note?:string};
export type Order = { id:string; customer:string; destination:string; date:string; status:'reserved'|'prepared'|'partial'|'dispatched'|'cancelled'; lines:OrderLine[]; documentRef?:string; documents:OrderDocument[]; closedAt?:string };
export const PRODUCTION_LINE='linea-1';
export type DeviceClose = {eventId:string;deviceId:string;counterStart:number;counterEnd:number;counterModulo?:number;deviceClosedAt:string;anomalies:string[]};
/** cartons = cartoni letti; scrapCartons = scarti dichiarati alla chiusura. La quantità buona non viene caricata a magazzino. */
export type Session = { id:string; productId:string; productCode:string; productName:string; unitsPerBox:number; unit?:string; line?:string; day:string; operator:string; lotCode:string; expiry:string; status:'active'|'closed'; cartons:number; startedAt:string; closedAt?:string; source:'manual'|'device'; stockLoaded:boolean; autoLoad?:boolean; loadedLotId?:string; loadedQuantity?:number; piecesPerCarton?:number; pieceWeightG?:number; corrections?:SessionCorrection[]; scrapCartons?:number; closeNote?:string; closedBy?:'manual'|'device'|'manual-override'; device?:DeviceClose };
/** Rettifica dei cartoni di una lavorazione (solo amministrazione): causale e responsabile obbligatori. */
export type SessionCorrection = {id:string;at:string;delta:number;before:number;after:number;reason:string;responsible:string;actor?:string;stockDelta:number};
/** Variazione esplicita del fisico di un lotto, registrata nell'evento che la causa. */
export type Move = {lotId:string;delta:number;kind:'receive'|'return'|'dispatch'|'transfer'|'adjust'|'scrap'|'consume'|'produce'|'production-adjust'};
export type Audit = {id:string;at:string;action:string;detail:string;actor?:string;moves?:Move[]};
/** Impostazioni di produzione ed etichetta. autoLoad: carico automatico alla chiusura (predefinito sì). */
export type Settings = {productionArea?:string;autoLoad?:boolean;labelProducer?:string};
export type State = {products:Product[];lots:Lot[];orders:Order[];sessions:Session[];audit:Audit[];areas?:string[];settings?:Settings};
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
 | {type:'order.create';order:{customer:string;destination:string;date:string;lines:({lotId:string;quantity:number}|{productId:string;quantity:number})[]}}
 | {type:'order.prepare'|'order.cancel';orderId:string}
 | {type:'order.dispatch';orderId:string;documentRef:string;quantities?:{lotId:string;quantity:number}[];note?:string}
 | {type:'order.document';orderId:string;documentRef:string}
 | {type:'production.start';code:string;operator:string;lotCode?:string;expiry?:string;counting?:'manual'|'device'}
 | {type:'production.adjust';sessionId:string;delta:number;reason:string;responsible:string}
 | {type:'settings.update';settings:Settings}
 | {type:'production.count';sessionId:string;cartons:number}
 | {type:'production.close';sessionId:string;scrapCartons?:number;note?:string;override?:string;cartons?:number}
 | {type:'production.deviceClose';sessionId:string;eventId:string;cartons:number;counterStart:number;counterEnd:number;counterModulo?:number;closedAt:string;anomalies?:string[]};
/** device: richiesta autenticata da credenziale di dispositivo; devicesEnabled: esiste almeno un dispositivo attivo per la linea. */
export type Context = {now?:string;id?:()=>string;actor?:string;device?:{id:string;line?:string};devicesEnabled?:boolean};
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
/** UTC instant of 00:00 in Rome on `day` (exact on DST change days). */
export function romeDayStart(day:string):string{
 const base=Date.parse(day+'T00:00:00Z');
 for(const hours of [1,2]){const t=base-hours*3_600_000;if(todayRome(new Date(t))===day&&todayRome(new Date(t-1))!==day)return new Date(t).toISOString();}
 return new Date(base).toISOString();
}
/** Lotto di produzione: la data di produzione AAMMGG (2 ottobre 2026 → 261002), come sull'etichetta. */
export function productionLot(day:string):string{return day.slice(2).replaceAll('-','');}
/** Messaggio unico per un lotto scritto a mano non valido (decisione di Teo del 27/11/2026). */
export const PRODUCTION_LOT_FORMAT='Il lotto deve essere la data di produzione, 6 cifre: AAMMGG, es. 261127';
/** Giorno AAAA-MM-GG di un lotto AAMMGG (anni 2000–2099), oppure undefined se non sono 6 cifre o non è una data vera. */
export function productionLotDay(code:string):string|undefined{
 if(!/^\d{6}$/.test(code))return undefined;
 const year=2000+Number(code.slice(0,2)),month=Number(code.slice(2,4)),day=Number(code.slice(4,6));
 const date=new Date(Date.UTC(year,month-1,day));
 if(month<1||month>12||day<1||date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day)return undefined;
 return `${year}-${code.slice(2,4)}-${code.slice(4,6)}`;
}
/** Scadenza: stesso giorno dopo N mesi; se quel giorno non esiste (29/02, 31) l'ultimo giorno del mese. */
export function productionExpiry(day:string,months:number):string{
 const [y,m,d]=day.split('-').map(Number);const total=m-1+months;const year=y+Math.floor(total/12);const month=((total%12)+12)%12;
 const last=new Date(Date.UTC(year,month+1,0)).getUTCDate();
 return `${year}-${String(month+1).padStart(2,'0')}-${String(Math.min(d,last)).padStart(2,'0')}`;
}
export const DEFAULT_SHELF_LIFE_MONTHS=12;
/** EAN-13 o EAN-8 con cifra di controllo corretta. */
export function eanValid(code:string):boolean{
 if(!/^(\d{8}|\d{13})$/.test(code))return false;
 const digits=[...code].map(Number);const check=digits.pop()!;
 const sum=digits.reverse().reduce((total,digit,i)=>total+digit*(i%2===0?3:1),0);
 return (10-sum%10)%10===check;
}
/** Articolo finito letto dal lettore: codice articolo oppure EAN dell'etichetta. */
export function productByScan(state:State,scanned:string){
 const value=scanned.trim().toUpperCase();
 // An exact article code wins over an EAN (EANs are unique and never equal to a code: see validateState).
 return state.products.find(p=>p.kind==='finished'&&p.code===value)??state.products.find(p=>p.kind==='finished'&&!!p.ean&&p.ean===value);
}
/** Area in cui la chiusura carica la produzione: solo quella scelta in Configurazione (nessuna scelta implicita). */
export function productionArea(state:State):string|undefined{return state.settings?.productionArea||undefined;}
/** History filters: days are Rome calendar days, both ends included. */
export type AuditGroup='corrections'|'production'|'inventory'|'orders'|'catalog';
/** Operation prefixes per history tab. «Correzioni» = carton corrections and stock adjustments (also listed in their own tab). */
export const AUDIT_GROUP_PREFIX:Record<AuditGroup,string[]>={corrections:['production.adjust','lot.adjust'],production:['production.'],inventory:['lot.'],orders:['order.'],catalog:['product.','settings.']};
export type AuditFilter={from?:string;to?:string;q?:string;group?:AuditGroup};
export function auditGroupOf(action:string):AuditGroup|undefined{
 return (Object.keys(AUDIT_GROUP_PREFIX) as AuditGroup[]).find(g=>AUDIT_GROUP_PREFIX[g].some(prefix=>action.startsWith(prefix)));
}
export function auditBounds(filter:Pick<AuditFilter,'from'|'to'>):{fromAt?:string;toAt?:string}{
 if(filter.from)date(filter.from,'Dal giorno');if(filter.to)date(filter.to,'Al giorno');
 if(filter.from&&filter.to&&filter.from>filter.to)fail('Il primo giorno deve essere precedente o uguale all’ultimo.');
 return {...(filter.from?{fromAt:romeDayStart(filter.from)}:{}),...(filter.to?{toAt:romeDayStart(addDays(filter.to,1))}:{})};
}
/** Predicate for a filter: bounds computed once, then applied to many entries. */
export function auditFilter(filter:AuditFilter):(entry:Audit)=>boolean{
 const {fromAt,toAt}=auditBounds(filter);const q=filter.q?.trim().toLocaleLowerCase('it');const prefixes=filter.group?AUDIT_GROUP_PREFIX[filter.group]:[];
 return entry=>(!fromAt||entry.at>=fromAt)&&(!toAt||entry.at<toAt)&&(!prefixes.length||prefixes.some(prefix=>entry.action.startsWith(prefix)))&&(!q||entry.detail.toLocaleLowerCase('it').includes(q));
}
export function auditMatches(entry:Audit,filter:AuditFilter):boolean{return auditFilter(filter)(entry);}
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
  ...labelFields(input,previous),
 };
}
/** Campi dell'etichetta: facoltativi; se mancano (es. import senza colonne) restano quelli salvati; vuoto o null li cancella. */
function labelFields(input:ProductInput,previous?:Product):Partial<ProductInput>{
 const pick=<K extends keyof ProductInput>(key:K)=>input[key]===undefined?previous?.[key]:input[key];
 const out:Partial<ProductInput>={};
 const cleared=(key:keyof ProductInput)=>{const value=pick(key);if(value===null||(value as unknown)===''){(out as Record<string,unknown>)[key]=undefined;return true;}return value===undefined;};
 const ean=pick('ean');if(!cleared('ean')){if(typeof ean!=='string'||!eanValid(ean.trim()))fail('EAN: inserisci 13 (o 8) cifre con la cifra di controllo corretta, come sotto il codice a barre.');out.ean=(ean as string).trim();}
 const positive=(key:'piecesPerCarton'|'pieceWeightG'|'shelfLifeMonths',name:string,max:number)=>{const value=pick(key);if(cleared(key))return;if(typeof value!=='number'||!Number.isSafeInteger(value)||value<1||value>max)fail(`${name}: inserisci un numero intero da 1 a ${max}.`);out[key]=value as number;};
 positive('piecesPerCarton','Pezzi per cartone',100_000);positive('pieceWeightG','Peso di un pezzo (g)',100_000);positive('shelfLifeMonths','Durata (mesi)',120);
 const longText=(key:'labelDescription'|'ingredients'|'storage',name:string,max:number)=>{if(cleared(key))return;const t=optionalText(pick(key),name,max);out[key]=t||undefined;};
 // Limits sized for the 2 MB operating state (350 products are never archived).
 longText('labelDescription','Descrizione in etichetta',160);longText('ingredients','Ingredienti e allergeni',700);longText('storage','Conservazione e uso',250);
 return out;
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
/**
 * FEFO (first expired, first out — decisione di Teo, 16/11/2026): the quantity of a product is taken from
 * the lots that expire first, across several lots if needed; expired, blocked and reserved goods are never used.
 * Lots without an expiry (packaging) come last. `missing` > 0 when the free stock is not enough.
 */
export function allocateFefo(state:State,productId:string,quantity:number,today=todayRome(),index=reservationIndex(state)){
 const lots=state.lots.filter(l=>l.productId===productId).map(l=>({lot:l,free:Math.max(0,lotAvailable(l,index.get(l.id)??0,today))})).filter(x=>x.free>0)
  .sort((a,b)=>(a.lot.expiry||'9999-12-31').localeCompare(b.lot.expiry||'9999-12-31')||a.lot.code.localeCompare(b.lot.code)||a.lot.area.localeCompare(b.lot.area));
 const lines:{lotId:string;quantity:number}[]=[];let left=quantity;
 for(const {lot,free} of lots){if(left<=0)break;const take=Math.min(free,left);lines.push({lotId:lot.id,quantity:take});left-=take;}
 return {lines,available:lots.reduce((t,x)=>t+x.free,0),missing:Math.max(0,left)};
}
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
 const codes=new Set(state.products.map(p=>p.code));const eans=new Map<string,string>();
 for(const p of state.products){if(!p.ean)continue;if(codes.has(p.ean))fail(`L’EAN ${p.ean} coincide con un codice articolo: il lettore non saprebbe quale scegliere.`);const other=eans.get(p.ean);if(other)fail(`L’EAN ${p.ean} è già usato dall’articolo ${other}: ogni EAN deve identificare un solo articolo.`);eans.set(p.ean,p.code);}
 if(state.settings){if(state.settings.autoLoad!==undefined&&typeof state.settings.autoLoad!=='boolean')fail('Impostazioni non valide.');if(state.settings.productionArea&&!knownAreas(state).includes(state.settings.productionArea))fail('Area di carico della produzione sconosciuta.');}
 for(const product of state.products){category(product.category);price(product.priceGelCor,'Listino 3 - Gel.Cor.');price(product.priceGelitria,'GELITRIA SRL');price(product.priceDistribution,'Distribuzione');}
 if(state.sessions.filter(s=>s.status==='active').length>1)fail('Può esserci una sola lavorazione attiva.');
 if(knownAreas(state).length>3)fail('Sono previste al massimo 3 aree.');
 const productIds=new Set(state.products.map(p=>p.id));const lotIds=new Set(state.lots.map(l=>l.id));const reservations=reservationIndex(state);
 for(const lot of state.lots){if(!productIds.has(lot.productId))fail('Articolo del lotto inesistente.');number(lot.quantity,'Giacenza');number(lot.blocked,'Quantità bloccata');if(lot.blocked+(reservations.get(lot.id)??0)>lot.quantity)fail('Giacenza insufficiente per blocchi e prenotazioni.');}
 for(const order of state.orders)for(const line of order.lines){if(!lotIds.has(line.lotId))fail('Lotto ordine inesistente.');number(line.quantity,'Quantità richiesta',1);number(line.shipped,'Quantità spedita');if(line.shipped>line.quantity)fail('La quantità spedita supera quella richiesta.');}
 for(const session of state.sessions){number(session.cartons,'Cartoni');if(session.scrapCartons!==undefined&&(number(session.scrapCartons,'Scarti')>session.cartons))fail('Gli scarti superano i cartoni letti.');}
}
export type ProductionRun={id:string;productId:string;productCode:string;productName:string;lotCode:string;unit:string;unitsPerBox:number;operator:string;startedAt:string;closedAt?:string;status:'active'|'closed';cartons:number;scrapCartons:number;source:Session['source'];closedBy?:Session['closedBy'];runOfProduct:number;runsOfProduct:number;toVerify:boolean};
export type ProductionDayProduct={productId:string;productCode:string;productName:string;unit:string;unitsPerBox:number;runs:number;confirmedCartons:number;activeCartons:number;scrapCartons:number;firstStart:string;lastEnd?:string;lots:string[]};
/**
 * Production sheet of one Europe/Rome day: every session in chronological order of start
 * (the flow of the day), the repetitions of the same article (run 1 of 2…), and totals per
 * article and for the day. Confirmed = closed sessions; the open one is shown apart.
 */
export function productionDay(sessions:Session[],day:string){
 const runs=sessions.filter(s=>s.day===day).sort((a,b)=>a.startedAt.localeCompare(b.startedAt)||a.id.localeCompare(b.id));
 const count=new Map<string,number>();for(const s of runs)count.set(s.productId,(count.get(s.productId)??0)+1);
 const seen=new Map<string,number>();
 const flow:ProductionRun[]=runs.map(s=>{const n=(seen.get(s.productId)??0)+1;seen.set(s.productId,n);return {id:s.id,productId:s.productId,productCode:s.productCode,productName:s.productName,lotCode:s.lotCode,unit:s.unit??'',unitsPerBox:s.unitsPerBox,operator:s.operator,startedAt:s.startedAt,...(s.closedAt?{closedAt:s.closedAt}:{}),status:s.status,cartons:s.cartons,scrapCartons:s.scrapCartons??0,source:s.source,...(s.closedBy?{closedBy:s.closedBy}:{}),runOfProduct:n,runsOfProduct:count.get(s.productId)!,toVerify:s.closedBy==='manual-override'||(s.device?.anomalies.length??0)>0};});
 const products=new Map<string,ProductionDayProduct>();
 for(const r of flow){
  const p=products.get(r.productId)??{productId:r.productId,productCode:r.productCode,productName:r.productName,unit:r.unit,unitsPerBox:r.unitsPerBox,runs:0,confirmedCartons:0,activeCartons:0,scrapCartons:0,firstStart:r.startedAt,lots:[]};
  p.runs++;if(r.status==='closed')p.confirmedCartons+=r.cartons;else p.activeCartons+=r.cartons;p.scrapCartons+=r.scrapCartons;
  if(r.closedAt&&(!p.lastEnd||r.closedAt>p.lastEnd))p.lastEnd=r.closedAt;if(!p.lots.includes(r.lotCode))p.lots.push(r.lotCode);
  products.set(r.productId,p);
 }
 const byProduct=[...products.values()].sort((a,b)=>b.confirmedCartons-a.confirmedCartons||a.productCode.localeCompare(b.productCode));
 return {day,flow,byProduct,totals:{runs:flow.length,products:byProduct.length,repeated:byProduct.filter(p=>p.runs>1).length,confirmedCartons:byProduct.reduce((n,p)=>n+p.confirmedCartons,0),activeCartons:byProduct.reduce((n,p)=>n+p.activeCartons,0),scrapCartons:byProduct.reduce((n,p)=>n+p.scrapCartons,0)}};
}
export type ProductionRow={day:string;productId:string;productCode:string;productName:string;lotCode:string;unit:string;unitsPerBox:number;sessions:number;confirmedCartons:number;activeCartons:number;scrapCartons:number;deviceSessions:number;toVerify:number};
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
  const row=rows.get(key)??{day:s.day,productId:s.productId,productCode:s.productCode,productName:s.productName,lotCode:s.lotCode,unit:s.unit??'',unitsPerBox:s.unitsPerBox,sessions:0,confirmedCartons:0,activeCartons:0,scrapCartons:0,deviceSessions:0,toVerify:0};
  row.sessions++;if(s.status==='closed')row.confirmedCartons+=s.cartons;else row.activeCartons+=s.cartons;row.scrapCartons+=s.scrapCartons??0;if(s.source==='device')row.deviceSessions++;
  // Manual close of a bridge-counted session, or bridge anomalies: the figure needs a check.
  if(s.closedBy==='manual-override'||(s.device?.anomalies.length??0)>0)row.toVerify++;
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
 /** Carico della produzione (decisione di Teo, 14/11/2026): solo con carico attivo e area scelta; movimento esplicito. */
 const loadInto=(session:Session,quantity:number,kind:Move['kind']):string=>{
  const product=state.products.find(p=>p.id===session.productId)!;const unit=session.unit??product.unit;
  if(quantity<=0)return 'Nessun cartone buono da caricare.';
  const area=ensureArea(state,state.settings!.productionArea!);
  const target=state.lots.find(l=>l.productId===session.productId&&l.code===session.lotCode&&l.area===area&&l.expiry===session.expiry)??(()=>{const lot:Lot={id:id(),productId:session.productId,code:session.lotCode,expiry:session.expiry,area,quantity:0,blocked:0};state.lots.push(lot);return lot;})();
  number(target.quantity+quantity,'Giacenza');move(target,quantity,kind);product.inUse=true;
  session.stockLoaded=true;session.loadedLotId=target.id;session.loadedQuantity=(session.loadedQuantity??0)+quantity;
  return `Magazzino: caricati ${quantity} ${unit} nel lotto ${target.code} (scadenza ${target.expiry}) in ${area}.`;
 };
 const loadProduction=(session:Session):string=>{
  if(state.settings?.autoLoad===false)return 'Carico automatico disattivato: registra l’entrata a mano.';
  if(!productionArea(state))return 'Area di carico non impostata (Configurazione → Produzione ed etichette): carico non eseguito, registra l’entrata a mano.';
  session.autoLoad=true;
  return loadInto(session,(session.cartons-(session.scrapCartons??0))*session.unitsPerBox,'produce');
 };
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
  const running=activeSession(state);if(running&&running.productId===lot.productId&&running.lotCode===lot.code&&running.expiry!==lot.expiry)fail(`Il lotto ${lot.code} è in produzione con scadenza ${running.expiry}: usa la stessa scadenza.`);
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
  const input=action.order??fail('Dati ordine mancanti.');array(input.lines,'Ordine',350);if(input.lines.some(line=>!line||typeof line!=='object'))fail('Riga ordine non valida.');
  // Product lines are turned into lot lines by FEFO; explicit lot lines are kept as they are.
  const byProduct=input.lines.filter((l):l is {productId:string;quantity:number}=>'productId' in l&&typeof l.productId==='string');
  if(new Set(byProduct.map(l=>l.productId)).size!==byProduct.length)fail('Ogni prodotto può comparire una sola volta nell’ordine: indica la quantità totale.');
  const fefo:string[]=[];const expanded:{lotId:string;quantity:number}[]=[];
  for(const line of input.lines){
   if('productId' in line&&typeof line.productId==='string'){
    const p=state.products.find(x=>x.id===line.productId)??fail('Articolo dell’ordine non trovato.');const quantity=number(line.quantity,'Quantità richiesta',1);
    const plan=allocateFefo(state,p.id,quantity,today);if(plan.missing)fail(`${p.code} · ${p.name}: disponibili solo ${plan.available} ${p.unit} (esclusi scaduti, bloccati e prenotati).`);
    expanded.push(...plan.lines);fefo.push(`${p.code} ${plan.lines.map(l=>`lotto ${lotById(l.lotId).code} × ${l.quantity}`).join(', ')}`);
   }else expanded.push(line as {lotId:string;quantity:number});
  }
  if(new Set(expanded.map(l=>l.lotId)).size!==expanded.length)fail('Ogni lotto può comparire una sola volta nell’ordine.');
  const index=reservations();
  const lines=expanded.map(line=>{const lot=lotById(line.lotId);const quantity=number(line.quantity,'Quantità richiesta',1);if(lot.expiry&&lot.expiry<today)fail(`Il lotto ${lot.code} è scaduto.`);if(quantity>lotAvailable(lot,index.get(lot.id)??0,today))fail(`Disponibilità insufficiente per il lotto ${lot.code}.`);return {lotId:lot.id,quantity,shipped:0};});
  const order:Order={id:id(),customer:text(input.customer,'Cliente'),destination:text(input.destination,'Destinazione'),date:date(input.date,'Data ordine'),status:'reserved',lines,documents:[]};state.orders.push(order);detail=`Ordine ${order.customer} · ${order.destination}: merce prenotata, giacenza fisica invariata.${fefo.length?` Lotti assegnati per scadenza più vicina: ${fefo.join('; ')}.`:''}`;break;
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
  if(activeSession(state))fail('Chiudi e salva la lavorazione attiva prima di iniziarne un’altra.');const p=productByScan(state,text(action.code,'Codice articolo',80))??fail('Codice sconosciuto o articolo non finito: avvio non consentito.');
  // Lotto e scadenza dalla data di produzione (regola dell'etichetta), salvo valori indicati espressamente.
  // Un lotto scritto a mano deve essere una data di produzione vera AAMMGG; la conferma di una data diversa da oggi è nella finestra di avvio.
  const manualLot=action.lotCode===undefined||action.lotCode===''?undefined:text(action.lotCode,'Codice lotto',80);
  if(manualLot!==undefined&&!productionLotDay(manualLot))fail(`${PRODUCTION_LOT_FORMAT}.`);
  const lotCode=manualLot??productionLot(today);
  const expiry=action.expiry===undefined||action.expiry===''?productionExpiry(today,p.shelfLifeMonths??DEFAULT_SHELF_LIFE_MONTHS):date(action.expiry,'Scadenza');if(expiry<today)fail('La scadenza della produzione non può essere passata.');
  const sameLot=state.lots.find(l=>l.productId===p.id&&l.code===lotCode&&l.expiry!==expiry);if(sameLot)fail(`Il lotto ${lotCode} è già in magazzino con scadenza ${sameLot.expiry}: usa la stessa scadenza o un altro lotto.`);
  const counting=action.counting??'manual';if(counting!=='manual'&&counting!=='device')fail('Modalità di conteggio non valida.');
  if(counting==='device'&&!context.devicesEnabled)fail('Nessun ponte conta-cartoni attivo: avvia la lavorazione con conteggio manuale.');
  const session:Session={id:id(),productId:p.id,productCode:p.code,productName:p.name,unitsPerBox:p.unitsPerBox,unit:p.unit,line:PRODUCTION_LINE,day:today,operator:text(action.operator,'Operatore',100),lotCode,expiry,status:'active',cartons:0,startedAt:now,source:counting,stockLoaded:false,...(p.piecesPerCarton?{piecesPerCarton:p.piecesPerCarton}:{}),...(p.pieceWeightG?{pieceWeightG:p.pieceWeightG}:{})};state.sessions.push(session);p.inUse=true;
  detail=`Lavorazione ${counting==='device'?'con conteggio fotocellule':'manuale'} avviata: ${p.code} · ${p.name} · lotto ${session.lotCode}, scadenza ${session.expiry} · ${session.operator}.`;break;
 }
 case 'production.count':{const session=state.sessions.find(row=>row.id===action.sessionId)??fail('Lavorazione non trovata.');if(session.status!=='active')fail('La lavorazione è chiusa.');if(session.source==='device')fail('Questa lavorazione è contata dalle fotocellule: non aggiungere cartoni a mano.');const cartons=number(action.cartons,'Cartoni da aggiungere',1);number(session.cartons+cartons,'Totale cartoni');session.cartons+=cartons;detail=`Conteggio manuale ${session.productCode}: +${cartons} cartoni, parziale ${session.cartons}.`;break;}
 case 'production.close':{
  const session=state.sessions.find(row=>row.id===action.sessionId)??fail('Lavorazione non trovata.');if(session.status!=='active')fail('La lavorazione è già stata salvata.');
  const override=optionalText(action.override,'Motivo della chiusura manuale');
  if(session.source==='device'&&!override)fail('Lavorazione contata dalle fotocellule: chiudila con il pulsante sulla linea oppure indica il motivo della chiusura manuale.');
  // A manual close of a photocell run (bridge down) records the cartons counted by hand: the server never received them.
  if(session.source==='device')session.cartons=number(action.cartons,'Cartoni contati a mano');
  const scrap=action.scrapCartons===undefined?0:number(action.scrapCartons,'Cartoni scartati');if(scrap>session.cartons)fail('Gli scarti non possono superare i cartoni letti.');
  const note=optionalText(action.note,'Nota di chiusura');if(scrap>0&&!note)fail('Indica il motivo degli scarti.');
  session.status='closed';session.closedAt=now;session.closedBy=session.source==='device'?'manual-override':'manual';if(scrap)session.scrapCartons=scrap;const closeNote=[override,note].filter(Boolean).join(' · ');if(closeNote)session.closeNote=closeNote;
  detail=`Lavorazione salvata: ${session.productCode} · ${session.cartons} cartoni letti${scrap?`, ${scrap} scartati`:''}.${override?` Chiusura manuale di una lavorazione da fotocellule: ${override}.`:''} ${loadProduction(session)} La prossima lavorazione parte da zero.`;break;
 }
 case 'production.deviceClose':{
  const session=state.sessions.find(row=>row.id===action.sessionId)??fail('Lavorazione non trovata.','session-unknown');
  if(session.status!=='active')fail('La lavorazione è già chiusa: verifica il conteggio del ponte.','session-closed');
  if(session.source!=='device')fail('La lavorazione attiva è manuale: il ponte non può chiuderla.','session-manual');
  if((session.line??PRODUCTION_LINE)!==(context.device!.line??PRODUCTION_LINE))fail('La lavorazione appartiene a un’altra linea.','session-other-line');
  const eventId=text(action.eventId,'Identificativo evento',128);
  const counter=(value:unknown,name:string)=>{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)fail(`${name}: valore del contatore non valido.`);return value as number;};
  const start=counter(action.counterStart,'Contatore iniziale');const end=counter(action.counterEnd,'Contatore finale');const cartons=number(action.cartons,'Cartoni');
  let modulo:number|undefined;if(action.counterModulo!==undefined){modulo=counter(action.counterModulo,'Modulo contatore');if(modulo<2)fail('Modulo contatore non valido.');if(start>=modulo||end>=modulo)fail('Contatore fuori dal modulo dichiarato.');}
  const expected=modulo?(end-start+modulo)%modulo:end-start;if(expected!==cartons||cartons<0)fail('Cartoni non coerenti con i valori del contatore.','counter-mismatch');
  const closedAt=text(action.closedAt,'Ora di chiusura',40);if(!Number.isFinite(Date.parse(closedAt)))fail('Ora di chiusura non valida.');
  const anomalies=(action.anomalies??[]);if(!Array.isArray(anomalies)||anomalies.length>20||anomalies.some(a=>typeof a!=='string'||!a.trim()||a.length>60))fail('Anomalie non valide.');
  session.cartons=cartons;session.status='closed';session.closedAt=now;session.closedBy='device';
  session.device={eventId,deviceId:context.device!.id,counterStart:start,counterEnd:end,...(modulo?{counterModulo:modulo}:{}),deviceClosedAt:closedAt,anomalies:anomalies.map(a=>a.trim())};
  detail=`Lavorazione chiusa dal ponte: ${session.productCode} · ${cartons} cartoni letti (contatore ${start} → ${end}).${anomalies.length?` Anomalie da verificare: ${anomalies.join(', ')}.`:''} ${loadProduction(session)}`;break;
 }
 case 'production.adjust':{
  const session=state.sessions.find(row=>row.id===action.sessionId)??fail('Lavorazione non trovata.');
  if(typeof action.delta!=='number'||!Number.isSafeInteger(action.delta)||action.delta===0||Math.abs(action.delta)>1_000_000)fail('Cartoni da correggere: inserisci un numero intero diverso da zero (negativo per togliere).');
  if(session.source==='device'&&session.status==='active')fail('Lavorazione contata dalle fotocellule: correggila dopo la chiusura.');
  const reason=text(action.reason,'Causale della correzione',300);const responsible=text(action.responsible,'Responsabile',100);
  const before=session.cartons;const after=before+action.delta;
  if(after<0)fail('La correzione porterebbe i cartoni sotto zero.');if(after<(session.scrapCartons??0))fail('I cartoni non possono scendere sotto gli scarti registrati.');
  let stockDelta=0;const unit=session.unit??'';
  if(session.status==='closed'&&session.autoLoad&&!session.loadedLotId&&action.delta>0&&productionArea(state)){
   // Closed with auto-load but nothing loaded (e.g. 0 good cartons): the cartons added now enter stock.
   stockDelta=action.delta*session.unitsPerBox;loadInto(session,stockDelta,'production-adjust');
  }else if(session.status==='closed'&&session.stockLoaded&&session.loadedLotId){
   const lot=lotById(session.loadedLotId);stockDelta=action.delta*session.unitsPerBox;
   if(stockDelta<0&&-stockDelta>free(lot))fail(`Del lotto ${lot.code} in ${lot.area} sono disponibili solo ${Math.max(0,free(lot))} ${unit}: la merce prenotata, bloccata, partita o spostata in un’altra area non si può togliere con una correzione di produzione.`);
   move(lot,stockDelta,'production-adjust');session.loadedQuantity=(session.loadedQuantity??0)+stockDelta;
  }
  session.cartons=after;
  (session.corrections??=[]).push({id:id(),at:now,delta:action.delta,before,after,reason,responsible,...(context.actor?{actor:context.actor}:{}),stockDelta});
  detail=`Correzione produzione ${session.productCode} · lotto ${session.lotCode}: ${before} → ${after} cartoni (${action.delta>0?'+':''}${action.delta}). Causale: ${reason}. Responsabile: ${responsible}.${stockDelta?` Magazzino ${stockDelta>0?'+':''}${stockDelta} ${unit} sul lotto.`:session.status==='closed'&&!session.stockLoaded?' Lavorazione chiusa senza carico: magazzino invariato.':''}`;break;
 }
 case 'settings.update':{
  const input=action.settings??fail('Impostazioni mancanti.');const next:Settings={...(state.settings??{})};
  if(input.productionArea!==undefined)next.productionArea=ensureArea(state,text(input.productionArea,'Area di carico della produzione',60));
  if(input.autoLoad!==undefined){if(typeof input.autoLoad!=='boolean')fail('Carico automatico: valore non valido.');next.autoLoad=input.autoLoad;}
  if(input.labelProducer!==undefined)next.labelProducer=optionalText(input.labelProducer,'Produttore in etichetta',300);
  state.settings=next;
  detail=`Impostazioni di produzione aggiornate: carico automatico ${next.autoLoad===false?'disattivato':'attivo'}, area ${productionArea(state)}.`;break;
 }
 default:fail('Operazione non riconosciuta.');
 }
 state.audit.push({id:id(),at:now,action:action.type,detail,...(context.actor?{actor:context.actor}:{}),...(moves.length?{moves}:{})});validateState(state);return state;
}

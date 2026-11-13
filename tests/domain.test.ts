import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, applyAction, availableForLot, productTotals, reservedForLot, activeSession, todayRome, validateState, type State, type Action, type ProductInput } from '../lib/domain.ts';
let sequence=0;
const context={now:'2026-11-07T10:00:00.000Z',id:()=>`id-${++sequence}`};
const act=(state:State,action:Action)=>applyAction(state,action,context);
function fixture(){
 let state=act(initialState(),{type:'product.add',product:{code:'PC001',name:'Articolo di prova',kind:'finished',unit:'confezioni',unitsPerBox:12,minStock:20}});
 state=act(state,{type:'lot.receive',lot:{productId:state.products[0].id,code:'LOT-A',expiry:'2026-12-31',area:'Area A',quantity:150}});
 return state;
}
function reserve(state:State,quantity=30){return act(state,{type:'order.create',order:{customer:'Cliente di prova',destination:'Destinazione di prova',date:'2026-11-07',lines:[{lotId:state.lots[0].id,quantity}]}});}
test('reservations reduce promiseable stock and leave physical stock unchanged',()=>{
 const start=fixture();const state=reserve(start);assert.equal(state.lots[0].quantity,150);assert.equal(availableForLot(state,state.lots[0].id,'2026-11-07'),120);assert.equal(start.orders.length,0);assert.equal(start.audit.length,2);
});
test('blocked stock cannot be reserved or double counted',()=>{
 let state=fixture();state=act(state,{type:'lot.block',lotId:state.lots[0].id,blocked:130});assert.throws(()=>reserve(state,30),/Disponibilità insufficiente/);state=reserve(state,20);assert.throws(()=>act(state,{type:'lot.block',lotId:state.lots[0].id,blocked:131}),/già prenotata/);
});
test('dispatch and later invoice never deduct twice',()=>{
 let state=reserve(fixture());const orderId=state.orders[0].id;assert.throws(()=>act(state,{type:'order.dispatch',orderId,documentRef:'DDT-1'}),/Prepara/);
 state=act(state,{type:'order.prepare',orderId});state=act(state,{type:'order.dispatch',orderId,documentRef:'DDT-1'});assert.equal(state.lots[0].quantity,120);assert.equal(state.orders[0].status,'dispatched');
 state=act(state,{type:'order.document',orderId,documentRef:'FATTURA-1'});assert.equal(state.lots[0].quantity,120);assert.equal(reservedForLot(state,state.lots[0].id),0);assert.throws(()=>act(state,{type:'order.dispatch',orderId,documentRef:'DDT-1'}),/chiuso/);
});
test('partial dispatch keeps residual reserved, cancellation releases only residual',()=>{
 let state=reserve(fixture(),50);const orderId=state.orders[0].id;const lotId=state.lots[0].id;state=act(state,{type:'order.prepare',orderId});
 assert.throws(()=>act(state,{type:'order.dispatch',orderId,documentRef:'DDT-P1',quantities:[{lotId,quantity:20}]}),/motivo/);state=act(state,{type:'order.dispatch',orderId,documentRef:'DDT-P1',quantities:[{lotId,quantity:20}],note:'Mezzo pieno'});assert.equal(state.orders[0].status,'partial');assert.equal(state.orders[0].documents[0].note,'Mezzo pieno');assert.equal(state.lots[0].quantity,130);assert.equal(reservedForLot(state,lotId),30);assert.equal(availableForLot(state,lotId,'2026-11-07'),100);
 state=act(state,{type:'order.cancel',orderId});assert.equal(state.lots[0].quantity,130);assert.equal(state.orders[0].lines[0].shipped,20);assert.equal(availableForLot(state,lotId,'2026-11-07'),130);
});
test('partial dispatch can complete remaining quantity exactly',()=>{
 let state=reserve(fixture(),50);const orderId=state.orders[0].id;const lotId=state.lots[0].id;state=act(state,{type:'order.prepare',orderId});state=act(state,{type:'order.dispatch',orderId,documentRef:'DDT-P1',quantities:[{lotId,quantity:20}],note:'Consegna in due viaggi'});state=act(state,{type:'order.dispatch',orderId,documentRef:'DDT-P2'});assert.equal(state.lots[0].quantity,100);assert.equal(state.orders[0].status,'dispatched');assert.equal(state.orders[0].documents.length,2);
});
test('expired lots cannot be promised or dispatched even if previously reserved',()=>{
 let state=fixture();state.lots[0].expiry='2026-11-06';assert.equal(availableForLot(state,state.lots[0].id,'2026-11-07'),0);assert.throws(()=>reserve(state),/scaduto/);
 state=reserve(fixture());state=act(state,{type:'order.prepare',orderId:state.orders[0].id});assert.throws(()=>applyAction(state,{type:'order.dispatch',orderId:state.orders[0].id,documentRef:'DDT-1'},{...context,now:'2027-01-01T00:00:00.000Z'}),/scaduto/);
});
test('unknown code or concurrent production session cannot start',()=>{
 let state=fixture();const start={type:'production.start' as const,code:'UNKNOWN',operator:'Operatore prova',lotCode:'PROD-A',expiry:'2026-12-31'};assert.throws(()=>act(state,start),/Codice sconosciuto/);state=act(state,{...start,code:'PC001'});assert.throws(()=>act(state,{...start,code:'PC001'}),/Chiudi e salva/);
});
test('close retains immutable session and next start resets only the partial',()=>{
 let state=fixture();const start={type:'production.start' as const,code:'PC001',operator:'Operatore prova',lotCode:'PROD-A',expiry:'2026-12-31'};
 state=act(state,start);const first=activeSession(state)!.id;state=act(state,{type:'production.count',sessionId:first,cartons:200});state=act(state,{type:'production.close',sessionId:first});assert.equal(activeSession(state),undefined);assert.equal(state.sessions[0].cartons,200);assert.equal(state.lots[0].quantity,150);assert.equal(state.sessions[0].stockLoaded,false);
 state=act(state,{...start,lotCode:'PROD-B'});assert.equal(activeSession(state)!.cartons,0);assert.equal(state.sessions[0].cartons,200);assert.equal(state.sessions[0].productCode,'PC001');assert.equal(state.sessions[0].unitsPerBox,12);assert.throws(()=>act(state,{type:'production.count',sessionId:first,cartons:1}),/chiusa/);
});
test('Roman calendar day is used across UTC midnight and DST',()=>{
 assert.equal(todayRome('2026-11-07T23:30:00Z'),'2026-11-08');assert.equal(todayRome('2026-07-07T22:30:00Z'),'2026-07-08');
});
test('transfers conserve physical stock and cannot transfer reservations',()=>{
 let state=reserve(fixture(),30);const lotId=state.lots[0].id;assert.throws(()=>act(state,{type:'lot.transfer',lotId,quantity:121,area:'Area B'}),/non prenotata/);state=act(state,{type:'lot.transfer',lotId,quantity:20,area:'Area B'});assert.equal(state.lots.length,2);assert.equal(productTotals(state,state.products[0].id,'2026-11-07').present,150);assert.equal(state.lots[0].quantity,130);assert.equal(state.lots[1].quantity,20);
});
test('adjustments require reason and cannot remove reserved or blocked stock',()=>{
 let state=reserve(fixture(),30);const lotId=state.lots[0].id;assert.throws(()=>act(state,{type:'lot.adjust',lotId,delta:-121,reason:'Conteggio',responsible:'Responsabile prova'}),/sotto/);assert.throws(()=>act(state,{type:'lot.adjust',lotId,delta:1,reason:' ',responsible:'Responsabile prova'}),/Motivo/);state=act(state,{type:'lot.adjust',lotId,delta:-1,reason:'Riconto verificato',responsible:'Responsabile prova'});assert.equal(state.lots[0].quantity,149);assert.match(state.audit.at(-1)!.detail,/Riconto verificato/);
});
test('codes normalize and reject duplicates, quantities reject fractions/negatives',()=>{
 const state=fixture();assert.throws(()=>act(state,{type:'product.add',product:{...state.products[0],code:' pc001 '}}),/esiste già/);assert.throws(()=>reserve(state,1.5),/intero/);assert.throws(()=>reserve(state,-1),/intero/);
});
test('duplicate lines cannot bypass reservation limits',()=>{
 const state=fixture();const lotId=state.lots[0].id;assert.throws(()=>act(state,{type:'order.create',order:{customer:'C',destination:'D',date:'2026-11-07',lines:[{lotId,quantity:100},{lotId,quantity:100}]}}),/una sola volta/);
});
test('invalid dates and conflicting expiration for same lot are rejected',()=>{
 const state=fixture();assert.throws(()=>act(state,{type:'lot.receive',lot:{...state.lots[0],code:'B',expiry:'2026-02-30'}}),/data non valida/);assert.throws(()=>act(state,{type:'lot.receive',lot:{...state.lots[0],area:'Area B',expiry:'2027-01-01'}}),/scadenza diversa/);
});
test('dispatch without a document is rejected without mutation',()=>{
 let state=reserve(fixture());state=act(state,{type:'order.prepare',orderId:state.orders[0].id});assert.throws(()=>act(state,{type:'order.dispatch',orderId:state.orders[0].id,documentRef:''}),/Riferimento documento/);assert.equal(state.lots[0].quantity,150);
});
test('workspace integrity checker detects impossible stock',()=>{
 const state=reserve(fixture());state.lots[0].quantity=20;assert.throws(()=>validateState(state),/Giacenza insufficiente/);
});
test('maximum three areas with consistent case normalization',()=>{
 let state=fixture();const lotId=state.lots[0].id;state=act(state,{type:'lot.transfer',lotId,quantity:1,area:'Area B'});state=act(state,{type:'lot.transfer',lotId,quantity:1,area:'Area C'});assert.throws(()=>act(state,{type:'lot.transfer',lotId,quantity:1,area:'Area D'}),/massimo 3/);state=act(state,{type:'lot.transfer',lotId,quantity:1,area:'area b'});assert.equal(state.lots.find(l=>l.area==='Area B')!.quantity,2);
});

test('another genuine receipt of the same lot increments stock and preserves blocks',()=>{
 let state=fixture();const id=state.lots[0].id;state=act(state,{type:'lot.block',lotId:id,blocked:10});state=act(state,{type:'lot.receive',lot:{...state.lots[0],quantity:20}});assert.equal(state.lots.length,1);assert.equal(state.lots[0].quantity,170);assert.equal(state.lots[0].blocked,10);assert.equal(state.lots[0].id,id);
});

// The API test (authentication, CAS conflicts, permanent retries, atomic rollback)
// moved to tests/api.test.ts, where it runs on both SQLite and the local D1 runtime.

function catalogProduct(code='0000123'):ProductInput{return {code,name:'Prodotto di prova 50 x 80 g',kind:'finished',unit:'CRT',unitsPerBox:1,minStock:0,category:'Croissanteria',priceGelCor:null,priceGelitria:0,priceDistribution:12.345};}

test('product prices preserve missing, free and three-decimal values separately',()=>{
 const state=act(initialState(),{type:'product.add',product:catalogProduct()});
 assert.equal(state.products[0].priceGelCor,null);assert.equal(state.products[0].priceGelitria,0);assert.equal(state.products[0].priceDistribution,12.345);
 assert.equal(state.products[0].code,'0000123');assert.equal(state.products[0].unitsPerBox,1);
 for(const invalid of [-0.001,1.2345,1_000_000,NaN,Infinity])assert.throws(()=>act(initialState(),{type:'product.add',product:{...catalogProduct(),priceGelCor:invalid}}),/Listino 3 - Gel\.Cor\./);
 const edge=act(initialState(),{type:'product.add',product:{...catalogProduct(),priceGelCor:999_999.999,priceGelitria:0.001,priceDistribution:1.005}});
 assert.equal(edge.products[0].priceGelCor,999_999.999);assert.equal(edge.products[0].priceGelitria,0.001);assert.equal(edge.products[0].priceDistribution,1.005);
});

test('old products without optional fields still validate and work',()=>{
 const state=fixture();delete state.products[0].category;delete state.products[0].priceGelCor;delete state.products[0].priceGelitria;delete state.products[0].priceDistribution;
 assert.doesNotThrow(()=>validateState(state));
 const next=reserve(state);assert.equal(next.lots[0].quantity,150);assert.equal(reservedForLot(next,next.lots[0].id),30);assert.equal(next.products[0].priceGelCor,undefined);
 const updated=act(next,{type:'product.update',productId:next.products[0].id,product:{...next.products[0],name:'Descrizione aggiornata'}});
 assert.equal(updated.products[0].category,'');assert.equal(updated.products[0].priceGelCor,null);assert.equal(updated.products[0].id,state.products[0].id);
});

test('CRT means stock in cartons and never infers pieces from the product name',()=>{
 const state=act(initialState(),{type:'product.add',product:{...catalogProduct(),unit:' crt '}});assert.equal(state.products[0].unit,'CRT');assert.equal(state.products[0].unitsPerBox,1);
 assert.throws(()=>act(initialState(),{type:'product.add',product:{...catalogProduct(),unitsPerBox:50}}),/già in cartoni/);
});

test('catalog import is atomic, normalizes codes and retains leading zeroes',()=>{
 const before=initialState();const products=[catalogProduct(' 00abc '),catalogProduct('000abc')];
 const state=act(before,{type:'product.import',products,mode:'skip'});
 assert.deepEqual(state.products.map(p=>p.code),['00ABC','000ABC']);assert.equal(before.products.length,0);assert.equal(state.audit.length,1);assert.equal(state.lots.length,0);
 const snapshot=structuredClone(state);
 assert.throws(()=>act(state,{type:'product.import',products:[catalogProduct('NEW'),{...catalogProduct('BAD'),priceGelCor:0.0001}],mode:'update'}),/Riga 2.*3 decimali/);
 assert.deepEqual(state,snapshot);
});

test('duplicate normalized codes in an import reject every row',()=>{
 const before=fixture();const snapshot=structuredClone(before);
 assert.throws(()=>act(before,{type:'product.import',products:[catalogProduct(' new '),catalogProduct('NEW')],mode:'skip'}),/Riga 2.*duplicato/);
 assert.deepEqual(before,snapshot);
});

test('skip imports are repeatable and leave existing product values untouched',()=>{
 const product=catalogProduct();let state=act(initialState(),{type:'product.import',products:[product],mode:'skip'});const first=structuredClone(state.products);
 state=act(state,{type:'product.import',products:[{...product,name:'Non sostituire',priceDistribution:99}],mode:'skip'});assert.deepEqual(state.products,first);
 state=act(state,{type:'product.import',products:[product],mode:'skip'});assert.deepEqual(state.products,first);assert.match(state.audit.at(-1)!.detail,/0 aggiunti, 0 aggiornati, 1/);
});

test('import updates preserve IDs, stock, order references and production snapshots',()=>{
 let state=reserve(fixture());state=act(state,{type:'production.start',code:'PC001',operator:'Prova',lotCode:'PROD',expiry:'2026-12-31'});
 const original=structuredClone(state);const product=state.products[0];
 state=act(state,{type:'product.import',products:[{...product,code:' pc001 ',name:'Nuova descrizione',category:'Nuova categoria',priceGelCor:0,priceGelitria:null,priceDistribution:8.765,minStock:30}],mode:'update'});
 assert.equal(state.products[0].id,product.id);assert.equal(state.products[0].name,'Nuova descrizione');assert.equal(state.products[0].priceDistribution,8.765);assert.deepEqual(state.lots,original.lots);assert.deepEqual(state.orders,original.orders);assert.deepEqual(state.sessions,original.sessions);
 const once=structuredClone(state.products);state=act(state,{type:'product.import',products:[{...state.products[0]}],mode:'update'});assert.deepEqual(state.products,once);
});

test('referenced product edits block identity and stock-unit changes, including zero-stock lots',()=>{
 const state=fixture();state.lots[0].quantity=0;const product=state.products[0];
 const changes:Partial<ProductInput>[]=[{code:'NEWCODE'},{unit:'pacchi'},{unitsPerBox:6},{kind:'raw'}];
 for(const change of changes)assert.throws(()=>act(state,{type:'product.update',productId:product.id,product:{...product,...change}}),/ha lotti o lavorazioni/);
 const updated=act(state,{type:'product.update',productId:product.id,product:{...product,name:'Nuovo nome',category:'Nuova',minStock:22,priceGelCor:2.345}});assert.equal(updated.products[0].id,product.id);assert.equal(updated.products[0].name,'Nuovo nome');assert.deepEqual(updated.lots,state.lots);
});

test('a closed production session also protects product structure',()=>{
 let state=act(initialState(),{type:'product.add',product:catalogProduct()});state=act(state,{type:'production.start',code:'0000123',operator:'Prova',lotCode:'PROD',expiry:'2026-12-31'});state=act(state,{type:'production.close',sessionId:state.sessions[0].id});
 assert.equal(state.lots.length,0);assert.throws(()=>act(state,{type:'product.update',productId:state.products[0].id,product:{...state.products[0],code:'NEW'}}),/ha lotti o lavorazioni/);
});

test('an import with a forbidden referenced update does not partially add or update products',()=>{
 const state=fixture();const snapshot=structuredClone(state);
 assert.throws(()=>act(state,{type:'product.import',products:[catalogProduct('NEW'),{...state.products[0],unitsPerBox:6}],mode:'update'}),/ha lotti o lavorazioni/);
 assert.deepEqual(state,snapshot);
});

test('unreferenced products may change structure but never collide with another code',()=>{
 let state=act(initialState(),{type:'product.import',products:[catalogProduct('001'),catalogProduct('002')],mode:'skip'});const product=state.products[0];
 state=act(state,{type:'product.update',productId:product.id,product:{...product,code:' 00a ',unit:'confezioni',unitsPerBox:20,kind:'raw'}});assert.equal(state.products[0].id,product.id);assert.equal(state.products[0].code,'00A');assert.equal(state.products[0].unitsPerBox,20);
 assert.throws(()=>act(state,{type:'product.update',productId:product.id,product:{...state.products[0],code:' 002 '}}),/esiste già/);
});

test('omitted optional fields preserve metadata while explicit null or empty clear it',()=>{
 let state=act(initialState(),{type:'product.add',product:catalogProduct()});const legacy={code:'0000123',name:'Nome cambiato',kind:'finished' as const,unit:'CRT',unitsPerBox:1,minStock:0};
 state=act(state,{type:'product.update',productId:state.products[0].id,product:legacy});assert.equal(state.products[0].priceDistribution,12.345);assert.equal(state.products[0].category,'Croissanteria');assert.equal(state.products[0].priceGelitria,0);
 state=act(state,{type:'product.import',products:[{...legacy,category:'',priceDistribution:null}],mode:'update'});assert.equal(state.products[0].priceDistribution,null);assert.equal(state.products[0].category,'');assert.equal(state.products[0].priceGelitria,0);
});

test('350-article catalog allows existing updates but rejects additions atomically',()=>{
 let state=act(initialState(),{type:'product.import',products:Array.from({length:350},(_,i)=>catalogProduct(String(i).padStart(6,'0'))),mode:'skip'});assert.equal(state.products.length,350);
 state=act(state,{type:'product.import',products:[{...state.products[0],name:'Aggiornato'}],mode:'update'});assert.equal(state.products.length,350);assert.equal(state.products[0].name,'Aggiornato');
 const snapshot=structuredClone(state);assert.throws(()=>act(state,{type:'product.import',products:[{...state.products[0],name:'Non salvato'},catalogProduct('EXTRA')],mode:'update'}),/fino a 350/);assert.deepEqual(state,snapshot);
});

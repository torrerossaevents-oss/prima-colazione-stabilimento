import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, applyAction, availableForLot, productTotals, reservedForLot, stockIndex, expiringLots, addDays, productionSummary, upgradeState, validateState, DomainError, type State, type Action } from '../lib/domain.ts';

let sequence=0;
const context={now:'2026-11-07T10:00:00.000Z',id:()=>`id-${++sequence}`};
const act=(state:State,action:Action,extra={})=>applyAction(state,action,{...context,...extra});
const today='2026-11-07';
function fixture(quantity=150){
 let state=act(initialState(),{type:'product.add',product:{code:'00123',name:'Prodotto fittizio',kind:'finished',unit:'CRT',unitsPerBox:1,minStock:0}});
 state=act(state,{type:'lot.receive',lot:{productId:state.products[0].id,code:'LOT-A',expiry:'2026-12-31',area:'Area A',quantity}});
 return state;
}
/** Physical balance must always equal the sum of explicit moves since the empty workspace. */
function assertLedger(state:State){
 const sums=new Map<string,number>();
 for(const entry of state.audit)for(const m of entry.moves??[])sums.set(m.lotId,(sums.get(m.lotId)??0)+m.delta);
 for(const lot of state.lots)assert.equal(sums.get(lot.id)??0,lot.quantity,`lotto ${lot.code} ${lot.area}`);
}

test('scenario 4: 150 present, 2 blocked, order 30 → 118; prepare; ship 20; cancel; invoice',()=>{
 let state=fixture();const lotId=state.lots[0].id;
 state=act(state,{type:'lot.block',lotId,blocked:2});
 state=act(state,{type:'order.create',order:{customer:'Cliente prova',destination:'Destinazione prova',date:today,lines:[{lotId,quantity:30}]}});
 assert.equal(availableForLot(state,lotId,today),118);assert.equal(state.lots[0].quantity,150);
 const orderId=state.orders[0].id;
 state=act(state,{type:'order.prepare',orderId});assert.equal(state.lots[0].quantity,150);assert.equal(availableForLot(state,lotId,today),118);
 state=act(state,{type:'order.dispatch',orderId,documentRef:'DDT-1',quantities:[{lotId,quantity:20}],note:'Residuo con il prossimo giro'});
 assert.equal(state.lots[0].quantity,130);assert.equal(reservedForLot(state,lotId),10);assert.equal(availableForLot(state,lotId,today),118);
 state=act(state,{type:'order.cancel',orderId});assert.equal(availableForLot(state,lotId,today),128);assert.equal(state.orders[0].lines[0].shipped,20);
 state=act(state,{type:'order.document',orderId,documentRef:'FATT-1'});assert.equal(state.lots[0].quantity,130);assert.equal(availableForLot(state,lotId,today),128);
 assertLedger(state);
});

test('stockIndex equals per-lot and per-product functions',()=>{
 let state=fixture();const lotId=state.lots[0].id;
 state=act(state,{type:'lot.transfer',lotId,quantity:40,area:'Area B'});
 state=act(state,{type:'order.create',order:{customer:'C',destination:'D',date:today,lines:[{lotId,quantity:25},{lotId:state.lots[1].id,quantity:5}]}});
 state=act(state,{type:'lot.block',lotId:state.lots[1].id,blocked:3});
 const index=stockIndex(state,today);
 for(const lot of state.lots){assert.equal(index.lot(lot.id).available,availableForLot(state,lot.id,today));assert.equal(index.lot(lot.id).reserved,reservedForLot(state,lot.id));}
 assert.deepEqual(index.totals(state.products[0].id),productTotals(state,state.products[0].id,today));
 assert.deepEqual(index.totals(state.products[0].id),{present:150,blocked:3,reserved:30,available:117,expired:0});
});

test('scrap, internal consumption and returns are explicit moves; no hidden balance change',()=>{
 let state=fixture();const lotId=state.lots[0].id;
 state=act(state,{type:'lot.block',lotId,blocked:10});
 assert.throws(()=>act(state,{type:'lot.scrap',lotId,quantity:11,fromBlocked:true,reason:'Danneggiato',responsible:'Resp'}),/bloccata/);
 state=act(state,{type:'lot.scrap',lotId,quantity:4,fromBlocked:true,reason:'Cartoni schiacciati',responsible:'Resp'});
 assert.equal(state.lots[0].quantity,146);assert.equal(state.lots[0].blocked,6);
 assert.throws(()=>act(state,{type:'lot.scrap',lotId,quantity:1,fromBlocked:false,reason:'',responsible:'Resp'}),/Motivo/);
 state=act(state,{type:'order.create',order:{customer:'C',destination:'D',date:today,lines:[{lotId,quantity:100}]}});
 assert.throws(()=>act(state,{type:'lot.consume',lotId,quantity:41,reason:'Assaggi',responsible:'Resp'}),/non prenotata/);
 state=act(state,{type:'lot.consume',lotId,quantity:40,reason:'Prove di laboratorio',responsible:'Resp'});
 assert.equal(state.lots[0].quantity,106);assert.equal(availableForLot(state,lotId,today),0);
 state=act(state,{type:'lot.return',lot:{productId:state.products[0].id,code:'LOT-A',expiry:'2026-12-31',area:'Area A',quantity:5},reason:'Reso cliente',reference:'Reso 1'});
 assert.equal(state.lots[0].quantity,111);assert.equal(state.lots[0].blocked,11);assert.equal(availableForLot(state,lotId,today),0);
 assert.throws(()=>act(state,{type:'lot.scrap',lotId,quantity:1,fromBlocked:undefined as unknown as boolean,reason:'x',responsible:'y'}),/bloccata/);
 assert.deepEqual(state.audit.filter(a=>a.moves).map(a=>a.moves![0].kind),['receive','scrap','consume','return']);
 assertLedger(state);
});

test('expired lots: no reservation, no consumption, scrap allowed',()=>{
 const state=fixture();const lotId=state.lots[0].id;const later={now:'2027-02-01T10:00:00.000Z'};
 assert.throws(()=>act(state,{type:'order.create',order:{customer:'C',destination:'D',date:'2027-02-01',lines:[{lotId,quantity:1}]}},later),/scaduto/);
 assert.throws(()=>act(state,{type:'lot.consume',lotId,quantity:1,reason:'x',responsible:'y'},later),/scaduto/);
 const scrapped=act(state,{type:'lot.scrap',lotId,quantity:150,fromBlocked:false,reason:'Scaduto',responsible:'Resp'},later);assert.equal(scrapped.lots[0].quantity,0);
});

test('transfers keep the plant total and are recorded as paired moves',()=>{
 let state=fixture();const lotId=state.lots[0].id;
 state=act(state,{type:'lot.transfer',lotId,quantity:50,area:'Area B'});state=act(state,{type:'lot.transfer',lotId:state.lots[1].id,quantity:20,area:'Area A'});
 assert.equal(productTotals(state,state.products[0].id,today).present,150);assertLedger(state);
});

test('Europe/Rome calendar: expiring lots within 7 days use calendar days, not UTC 24h windows',()=>{
 assert.equal(addDays('2026-10-24',7),'2026-10-31');assert.equal(addDays('2026-03-28',1),'2026-03-29');assert.equal(addDays('2026-12-31',1),'2027-01-01');
 let state=fixture();
 state=act(state,{type:'lot.receive',lot:{productId:state.products[0].id,code:'LOT-B',expiry:'2026-11-14',area:'Area A',quantity:1}});
 state=act(state,{type:'lot.receive',lot:{productId:state.products[0].id,code:'LOT-C',expiry:'2026-11-15',area:'Area A',quantity:1}});
 // 23:30 UTC on 6 Nov is already 7 Nov in Rome: limit is 14 Nov (included), 15 Nov excluded.
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Rome'}).format(new Date('2026-11-06T23:30:00Z'));
 assert.equal(day,'2026-11-07');
 assert.deepEqual(expiringLots(state,day).map(l=>l.code),['LOT-B']);
 // DST end (25 Oct 2026): a day of 25 hours does not shift the window.
 assert.deepEqual(expiringLots(state,'2026-11-08').map(l=>l.code).sort(),['LOT-B','LOT-C']);
});

test('scenario 7: production A 200 and B 150, totals per article, history kept, no unknown code or second session',()=>{
 let state=act(initialState(),{type:'product.import',mode:'skip',products:[{code:'A1',name:'Articolo A',kind:'finished',unit:'CRT',unitsPerBox:1,minStock:0},{code:'B1',name:'Articolo B',kind:'finished',unit:'confezioni',unitsPerBox:12,minStock:0}]});
 const start=(code:string,lotCode:string)=>({type:'production.start' as const,code,operator:'Operatore prova',lotCode,expiry:'2026-12-31'});
 assert.throws(()=>act(state,start('ZZZ','L')),/Codice sconosciuto/);
 state=act(state,start('A1','PA'));assert.throws(()=>act(state,start('B1','PB')),/Chiudi e salva/);
 state=act(state,{type:'production.count',sessionId:state.sessions[0].id,cartons:200});state=act(state,{type:'production.close',sessionId:state.sessions[0].id});
 state=act(state,start('B1','PB'));assert.equal(state.sessions[1].cartons,0);
 state=act(state,{type:'production.count',sessionId:state.sessions[1].id,cartons:150});state=act(state,{type:'production.close',sessionId:state.sessions[1].id,scrapCartons:3,note:'Cartoni aperti'});
 const rows=productionSummary(state.sessions,today,today);
 assert.equal(rows.length,2);assert.equal(rows.reduce((n,r)=>n+r.confirmedCartons,0),350);
 assert.deepEqual(rows.map(r=>[r.productCode,r.confirmedCartons,r.scrapCartons,r.unit]),[['A1',200,0,'CRT'],['B1',150,3,'confezioni']]);
 assert.equal(state.lots.length,0,'no automatic stock load');
 assert.throws(()=>act(state,{type:'production.close',sessionId:state.sessions[1].id}),/già stata salvata/);
});

test('scenario 8: session day comes from the Rome start, also across midnight and DST',()=>{
 let state=act(initialState(),{type:'product.add',product:{code:'A1',name:'A',kind:'finished',unit:'CRT',unitsPerBox:1,minStock:0}});
 state=applyAction(state,{type:'production.start',code:'A1',operator:'O',lotCode:'L',expiry:'2026-12-31'},{...context,now:'2026-10-24T21:50:00.000Z'});
 assert.equal(state.sessions[0].day,'2026-10-24');
 state=applyAction(state,{type:'production.close',sessionId:state.sessions[0].id},{...context,now:'2026-10-25T01:30:00.000Z'});
 assert.equal(state.sessions[0].day,'2026-10-24');assert.equal(productionSummary(state.sessions,'2026-10-25').length,0);
 state=applyAction(state,{type:'production.start',code:'A1',operator:'O',lotCode:'L2',expiry:'2026-12-31'},{...context,now:'2026-10-24T22:10:00.000Z'});
 assert.equal(state.sessions[1].day,'2026-10-25');
});

test('device sessions: only the authenticated bridge closes them once; manual counts and silent closes refused',()=>{
 let state=act(initialState(),{type:'product.add',product:{code:'A1',name:'A',kind:'finished',unit:'CRT',unitsPerBox:1,minStock:0}});
 const start={type:'production.start' as const,code:'A1',operator:'O',lotCode:'L',expiry:'2026-12-31',counting:'device' as const};
 assert.throws(()=>act(state,start),/Nessun ponte/);
 state=act(state,start,{devicesEnabled:true});const sessionId=state.sessions[0].id;assert.equal(state.sessions[0].source,'device');
 assert.throws(()=>act(state,{type:'production.count',sessionId,cartons:1}),/fotocellule/);
 assert.throws(()=>act(state,{type:'production.close',sessionId}),/motivo della chiusura manuale/);
 const close:Action={type:'production.deviceClose',sessionId,eventId:'evt_000001',cartons:200,counterStart:4294967200,counterEnd:104,counterModulo:4294967296,closedAt:'2026-11-07T10:00:00.000Z',anomalies:['arretramento']};
 assert.throws(()=>act(state,close),/ponte autenticato/);
 assert.throws(()=>act(state,{...close,cartons:199} as Action,{device:{id:'dev_1'}}),/non coerenti/);
 assert.throws(()=>act(state,{type:'lot.block',lotId:'x',blocked:0},{device:{id:'dev_1'}}),/soltanto la chiusura/);
 const closed=act(state,close,{device:{id:'dev_1'}});
 assert.equal(closed.sessions[0].cartons,200);assert.equal(closed.sessions[0].closedBy,'device');assert.deepEqual(closed.sessions[0].device!.anomalies,['arretramento']);assert.equal(closed.lots.length,0);
 try{act(closed,close,{device:{id:'dev_1'}});assert.fail('expected');}catch(error){assert.ok(error instanceof DomainError);assert.equal(error.code,'session-closed');}
 const override=act(state,{type:'production.close',sessionId,override:'Ponte guasto, conteggio a mano su foglio'});
 assert.equal(override.sessions[0].closedBy,'manual-override');
 try{act(override,close,{device:{id:'dev_1'}});assert.fail('expected');}catch(error){assert.equal((error as DomainError).code,'session-closed');}
});

test('upgradeState keeps structural locks and area limits when old rows leave the hot state',()=>{
 let state=act(initialState(),{type:'product.add',product:{code:'A1',name:'A',kind:'finished',unit:'CRT',unitsPerBox:1,minStock:0}});
 const lot={productId:state.products[0].id,code:'L',expiry:'2026-12-31',quantity:1};
 for(const area of ['A','B','C'])state=act(state,{type:'lot.receive',lot:{...lot,area}});
 const legacy=structuredClone(state);for(const p of legacy.products)delete p.inUse;delete legacy.areas;
 const upgraded=upgradeState(legacy);assert.equal(upgraded.products[0].inUse,true);assert.deepEqual(upgraded.areas,['A','B','C']);
 assert.deepEqual(upgradeState(upgraded),upgraded,'idempotent');
 upgraded.lots=[];validateState(upgraded);
 assert.throws(()=>act(upgraded,{type:'lot.receive',lot:{...lot,area:'D'}}),/massimo 3/);
 assert.throws(()=>act(upgraded,{type:'product.update',productId:upgraded.products[0].id,product:{...upgraded.products[0],unit:'pezzi'}}),/ha lotti o lavorazioni/);
});

test('import update without kind/minStock columns keeps stored values; new rows default to finished/0',()=>{
 let state=act(initialState(),{type:'product.add',product:{code:'R1',name:'Materia prima',kind:'raw',unit:'KG',unitsPerBox:1,minStock:40}});
 state=act(state,{type:'product.import',mode:'update',products:[{code:'R1',name:'Materia prima rinominata',unit:'KG',unitsPerBox:1} as never,{code:'N1',name:'Nuovo',unit:'CRT',unitsPerBox:1} as never]});
 assert.equal(state.products[0].kind,'raw');assert.equal(state.products[0].minStock,40);assert.equal(state.products[0].name,'Materia prima rinominata');
 assert.equal(state.products[1].kind,'finished');assert.equal(state.products[1].minStock,0);
});

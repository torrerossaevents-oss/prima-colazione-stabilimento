import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore Node's native type stripping requires a .ts extension.
import { initialState, applyAction, availableForLot, productTotals, reservedForLot, activeSession, todayRome, validateState, type State, type Action } from '../lib/domain.ts';
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
 state=act(state,{type:'order.dispatch',orderId,documentRef:'DDT-P1',quantities:[{lotId,quantity:20}]});assert.equal(state.orders[0].status,'partial');assert.equal(state.lots[0].quantity,130);assert.equal(reservedForLot(state,lotId),30);assert.equal(availableForLot(state,lotId,'2026-11-07'),100);
 state=act(state,{type:'order.cancel',orderId});assert.equal(state.lots[0].quantity,130);assert.equal(state.orders[0].lines[0].shipped,20);assert.equal(availableForLot(state,lotId,'2026-11-07'),130);
});
test('partial dispatch can complete remaining quantity exactly',()=>{
 let state=reserve(fixture(),50);const orderId=state.orders[0].id;const lotId=state.lots[0].id;state=act(state,{type:'order.prepare',orderId});state=act(state,{type:'order.dispatch',orderId,documentRef:'DDT-P1',quantities:[{lotId,quantity:20}]});state=act(state,{type:'order.dispatch',orderId,documentRef:'DDT-P2'});assert.equal(state.lots[0].quantity,100);assert.equal(state.orders[0].status,'dispatched');assert.equal(state.orders[0].documents.length,2);
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

// Exercise the actual route and its SQL against SQLite. Only the platform env
// import is replaced; API validation, batching and conflict handling are unchanged.
test('API authentication, CAS conflicts, permanent retries and atomic receipt rollback',async()=>{
 const {DatabaseSync}=await import('node:sqlite');
 const {readFile}=await import('node:fs/promises');
 const {stripTypeScriptTypes}=await import('node:module');
 const sql=new DatabaseSync(':memory:');
 sql.exec('CREATE TABLE workspaces (id TEXT PRIMARY KEY, payload TEXT NOT NULL, version INTEGER NOT NULL, request_ids TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE TABLE workspace_requests (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, digest TEXT NOT NULL, version INTEGER NOT NULL, created_at TEXT NOT NULL);');
 let failReceipt=false;
 function prepare(query:string){
  let values:unknown[]=[];
  return {
   query,
   bind(...args:unknown[]){values=args;return this;},
   async first(){return sql.prepare(query).get(...values as (string|number)[])??null;},
   async run(){if(failReceipt&&query.startsWith('INSERT OR IGNORE INTO workspace_requests'))throw new Error('Injected receipt write failure');const result=sql.prepare(query).run(...values as (string|number)[]);return {meta:{changes:Number(result.changes)}};},
  };
 }
 const db={prepare,async batch(statements:ReturnType<typeof prepare>[]){sql.exec('BEGIN');try{const result=[];for(const stmt of statements)result.push(await stmt.run());sql.exec('COMMIT');return result;}catch(error){sql.exec('ROLLBACK');throw error;}}};
 const scope=globalThis as typeof globalThis & {__testD1Env?:{DB:typeof db}};scope.__testD1Env={DB:db};
 let source=await readFile(new URL('../app/api/workspace/route.ts',import.meta.url),'utf8');
 source=source.replace("import { env } from 'cloudflare:workers';",'const env = globalThis.__testD1Env;').replace("'@/lib/domain'",JSON.stringify(new URL('../lib/domain.ts',import.meta.url).href)).replace('import.meta.env.DEV','false');
 const js=stripTypeScriptTypes(source,{mode:'strip'});
 const route=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`) as {GET:(r:Request)=>Promise<Response>;POST:(r:Request)=>Promise<Response>};
 const origin='https://stabilimento.example';
 const headers={'origin':origin,'oai-authenticated-user-id':'test-owner','content-type':'application/json'};
 const post=(action:Action,expectedVersion:number,requestId:string,overrides:Record<string,string>={})=>route.POST(new Request(origin+'/api/workspace',{method:'POST',headers:{...headers,...overrides},body:JSON.stringify({action,expectedVersion,requestId})}));
 assert.equal((await route.GET(new Request(origin+'/api/workspace'))).status,401);
 const add:Action={type:'product.add',product:{code:'TEST-API',name:'API test',kind:'finished',unit:'pezzi',unitsPerBox:12,minStock:0}};
 assert.equal((await post(add,0,'request-one',{'origin':'https://other.example'})).status,403);
 assert.equal((await post(add,0,'request-one')).status,200);
 const repeated=await post(add,0,'request-one');assert.equal(repeated.status,200);assert.equal((await repeated.json() as {duplicate:boolean}).duplicate,true);
 assert.equal((await post({...add,product:{...add.product,code:'DIFFERENT'}},1,'request-one')).status,409);
 assert.equal((await post({...add,product:{...add.product,code:'SECOND'}},0,'request-two')).status,409);
 failReceipt=true;
 const originalError=console.error;console.error=()=>{};
 try{assert.equal((await post({...add,product:{...add.product,code:'SECOND'}},1,'request-failure')).status,500);}finally{console.error=originalError;}
 const unchanged=await (await route.GET(new Request(origin+'/api/workspace',{headers}))).json() as {state:State;version:number};assert.equal(unchanged.version,1);assert.equal(unchanged.state.products.length,1);assert.equal(sql.prepare('SELECT count(*) AS n FROM workspace_requests').get()!.n,1);
 failReceipt=false;
 const start:Action={type:'production.start',code:'TEST-API',operator:'Test',lotCode:'TEST',expiry:'2099-12-31'};
 const started=await (await post(start,1,'request-start')).json() as {state:State;version:number};
 for(let n=0;n<205;n++){assert.equal((await post({type:'production.count',sessionId:started.state.sessions[0].id,cartons:1},n+2,`request-count-${n}`)).status,200);}
 const retryOld=await post(start,1,'request-start');assert.equal(retryOld.status,200);const snapshot=await retryOld.json() as {duplicate:boolean;state:State;version:number};assert.equal(snapshot.duplicate,true);assert.equal(snapshot.state.sessions.length,1);assert.equal(snapshot.state.sessions[0].cartons,205);assert.equal(snapshot.version,207);
 delete scope.__testD1Env;sql.close();
});

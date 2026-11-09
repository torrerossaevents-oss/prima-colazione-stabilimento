import { env } from 'cloudflare:workers';
import { applyAction, DomainError, initialState, validateState, type Action, type State } from '@/lib/domain';
export const dynamic = 'force-dynamic';
const WORKSPACE_ID='prima-colazione';
const MAX_BYTES=2_000_000;
type Row={payload:string;version:number};
type Receipt={id:string;digest:string;version:number};
function json(body:unknown,status=200){return Response.json(body,{status,headers:{'Cache-Control':'no-store'}});}
function authorized(request:Request){return Boolean(request.headers.get('oai-authenticated-user-id'))||import.meta.env.DEV;}
function database(){if(!env.DB)throw new Error('Archivio non disponibile.');return env.DB;}
async function read(db:D1Database):Promise<Row|null>{return db.prepare('SELECT payload, version FROM workspaces WHERE id = ?').bind(WORKSPACE_ID).first<Row>();}
async function receipt(db:D1Database,id:string){return db.prepare('SELECT id, digest, version FROM workspace_requests WHERE id = ? AND workspace_id = ?').bind(id,WORKSPACE_ID).first<Receipt>();}
function parse(row:Row|null){const state=row?JSON.parse(row.payload) as State:initialState();validateState(state);return {state,version:row?.version??0};}
function errorResponse(error:unknown){
 if(error instanceof DomainError)return json({error:error.message},422);
 console.error('Workspace operation failed:',error instanceof Error?error.message:'unknown');
 return json({error:'Il salvataggio non è riuscito. Riprova: non verranno duplicate le operazioni già salvate.'},500);
}
export async function GET(request:Request){
 if(!authorized(request))return json({error:'Accedi per consultare lo stabilimento.'},401);
 try{return json(parse(await read(database())));}catch(error){return errorResponse(error);}
}
export async function POST(request:Request){
 if(!authorized(request))return json({error:'Accedi prima di salvare.'},401);
 const origin=request.headers.get('origin');if(!origin||origin!==new URL(request.url).origin)return json({error:'Origine della richiesta non autorizzata.'},403);
 try{
  const raw=await request.text();if(new TextEncoder().encode(raw).length>500_000)return json({error:'Richiesta troppo grande.'},413);
  let input:{action:Action;expectedVersion:number;requestId:string};try{input=JSON.parse(raw);}catch{return json({error:'Richiesta non valida.'},400);}
  if(!input||!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<0||typeof input.requestId!=='string'||!/^[a-zA-Z0-9_-]{8,128}$/.test(input.requestId)||!input.action)return json({error:'Richiesta incompleta o versione non valida.'},400);
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(input.action))))).map(b=>b.toString(16).padStart(2,'0')).join('');
  const db=database();
  const repeated=await receipt(db,input.requestId);
  if(repeated)return repeated.digest===digest?json({...parse(await read(db)),duplicate:true}):json({error:'Identificativo operazione già utilizzato. Ricarica e riprova.'},409);
  let row=await read(db);
  if(!row){await db.prepare('INSERT OR IGNORE INTO workspaces (id, payload, version, request_ids, updated_at) VALUES (?, ?, 0, ?, ?)').bind(WORKSPACE_ID,JSON.stringify(initialState()),'[]',new Date().toISOString()).run();row=await read(db);}
  if(!row)throw new Error('Workspace initialization failed');
  if(row.version!==input.expectedVersion)return json({error:'Un altro dispositivo ha aggiornato i dati. Sono stati ricaricati: controlla e ripeti l’operazione.',...parse(row)},409);
  const now=new Date().toISOString();
  const state=applyAction(parse(row).state,input.action,{now,actor:request.headers.get('oai-authenticated-user-id')??'anteprima-locale'});const payload=JSON.stringify(state);
  if(new TextEncoder().encode(payload).length>MAX_BYTES)return json({error:'Archivio pilota al limite: esporta lo storico e richiedi l’estensione prima di continuare.'},413);
  const version=row.version+1;
  // D1 batch is a transaction. Either both state and receipt commit, or neither does.
  // The payload check binds the receipt to this exact CAS result; conflicting actions
  // have different immutable audit IDs. A competing retry is caught by receipt PK.
  const results=await db.batch([
   db.prepare('UPDATE workspaces SET payload = ?, version = ?, updated_at = ? WHERE id = ? AND version = ? AND NOT EXISTS (SELECT 1 FROM workspace_requests WHERE id = ?)').bind(payload,version,now,WORKSPACE_ID,row.version,input.requestId),
   db.prepare('INSERT OR IGNORE INTO workspace_requests (id, workspace_id, digest, version, created_at) SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM workspaces WHERE id = ? AND version = ? AND payload = ?)').bind(input.requestId,WORKSPACE_ID,digest,version,now,WORKSPACE_ID,version,payload),
  ]);
  if(results[0].meta.changes!==1){
   const completed=await receipt(db,input.requestId);const latest=await read(db);
   if(completed)return completed.digest===digest?json({...parse(latest),duplicate:true}):json({error:'Identificativo operazione già utilizzato.'},409);
   return json({error:'Dati aggiornati da un altro dispositivo. Controlla le quantità e riprova.',...parse(latest)},409);
  }
  if(results[1].meta.changes!==1)throw new Error('Durable receipt was not committed');
  return json({state,version});
 }catch(error){return errorResponse(error);}
}

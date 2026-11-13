/**
 * Synthetic growth benchmark. Builds fictitious workspaces of increasing size and
 * measures JSON size, parse+validate and one applyAction (clone+validate+serialize).
 * Usage: node --experimental-strip-types scripts/bench-workspace.ts
 * Columns: kB/parseValidateMs/applyActionMs = everything in one JSON row (before);
 * hotKB/hotApplyMs = hot state after partition (after). Synthetic rhythm, not real data.
 */
import { addDays, applyAction, initialState, validateState, type State } from '../lib/domain.ts';
import { partition } from '../lib/archive.ts';

function synthetic(days:number):State{
 const state=initialState();
 for(let p=0;p<350;p++)state.products.push({id:`p${p}`,code:`PRV${String(p).padStart(5,'0')}`,name:`Articolo fittizio ${p} 12 x 50 g`,kind:p%3===0?'raw':'finished',unit:'CRT',unitsPerBox:1,minStock:10,category:'Prova',priceGelCor:1.5,priceGelitria:null,priceDistribution:2.25});
 let a=0;
 const audit=(day:string,action:string,detail:string)=>state.audit.push({id:`a${a++}`,at:`${day}T08:00:00.000Z`,action,detail,actor:'utente-prova'});
 for(let d=0;d<days;d++){
  const day=new Date(Date.UTC(2026,0,1)+d*86400000).toISOString().slice(0,10);
  for(let r=0;r<10;r++){const id=`l${d}-${r}`;state.lots.push({id,productId:`p${(d*10+r)%350}`,code:`L${d}${r}`,expiry:'2099-12-31',area:['Area A','Area B','Area C'][r%3],quantity:500,blocked:0});audit(day,'lot.receive','Carico manuale: 500 CRT · PRV00001 · lotto L1 · Area A.');}
  for(let o=0;o<20;o++){const lotId=`l${d}-${o%10}`;const shipped=d<days-2?20:0;state.orders.push({id:`o${d}-${o}`,customer:'Cliente fittizio',destination:'Destinazione fittizia',date:day,status:shipped?'dispatched':'reserved',lines:[{lotId,quantity:20,shipped}],documents:shipped?[{reference:'DDT-PROVA',at:`${day}T09:00:00.000Z`,quantities:[{lotId,quantity:20}]}]:[] ,...(shipped?{documentRef:'DDT-PROVA'}:{})});if(shipped)state.lots.find(l=>l.id===lotId)!.quantity-=20;audit(day,'order.create','Ordine Cliente fittizio · Destinazione fittizia: merce prenotata, giacenza fisica invariata.');if(shipped)audit(day,'order.dispatch','Ordine Cliente fittizio: uscita completa, documento DDT-PROVA. Giacenza aggiornata una sola volta.');}
  for(let s=0;s<5;s++){state.sessions.push({id:`s${d}-${s}`,productId:'p1',productCode:'PRV00001',productName:'Articolo fittizio 1',unitsPerBox:1,day,operator:'Operatore prova',lotCode:`PL${d}${s}`,expiry:'2099-12-31',status:'closed',cartons:200,startedAt:`${day}T06:00:00.000Z`,closedAt:`${day}T07:00:00.000Z`,source:'manual',stockLoaded:false});audit(day,'production.close','Lavorazione salvata: PRV00001 · 200 cartoni.');}
 }
 return state;
}
const time=(fn:()=>void,runs=3)=>{let best=Infinity;for(let i=0;i<runs;i++){const t=performance.now();fn();best=Math.min(best,performance.now()-t);}return best;};
const rows=[];
for(const days of [5,30,90,180,365]){
 const state=synthetic(days);const payload=JSON.stringify(state);
 const parseValidate=time(()=>validateState(JSON.parse(payload)));
 const act=time(()=>JSON.stringify(applyAction(state,{type:'lot.block',lotId:state.lots[0].id,blocked:0},{now:'2026-06-01T10:00:00.000Z'})));
 const today=addDays('2026-01-01',days-1);const split=partition(state,today);const hot=JSON.stringify(split.hot);
 const hotApply=time(()=>JSON.stringify(partition(applyAction(split.hot,{type:'lot.block',lotId:split.hot.lots[0].id,blocked:0},{now:`${today}T10:00:00.000Z`}),today).hot));
 rows.push({days,lots:state.lots.length,orders:state.orders.length,sessions:state.sessions.length,audit:state.audit.length,kB:Math.round(payload.length/1024),overLimit:payload.length>2_000_000,parseValidateMs:+parseValidate.toFixed(1),applyActionMs:+act.toFixed(1),hotKB:Math.round(hot.length/1024),archivedRows:split.rows.length+split.audit.length,hotApplyMs:+hotApply.toFixed(1)});
}
console.table(rows);

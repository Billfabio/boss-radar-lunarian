import {ensureOperational,appendOperationalEvent} from './operational-state.mjs';
const PRIORITY={CRITICAL:0,HIGH:1,NORMAL:2,LOW:3};
const id=()=>Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10);
export function enqueueOutbox(state,kind,payload,{priority='NORMAL',idempotencyKey='',correlationId='',maxAttempts=5,at=Date.now()}={}){
 const o=ensureOperational(state),key=String(idempotencyKey||'');if(key){const existing=o.outbox.find(x=>x.idempotencyKey===key)||o.outboxHistory.find(x=>x.idempotencyKey===key&&x.status==='DELIVERED');if(existing)return {item:existing,duplicate:true};}
 const item={id:'out-'+id(),kind:String(kind),payload,priority:PRIORITY[priority]!=null?priority:'NORMAL',idempotencyKey:key,correlationId:String(correlationId||''),status:'PENDING',attempts:0,maxAttempts:Math.max(1,Math.min(10,Number(maxAttempts)||5)),createdAt:at,nextAttemptAt:at,lastError:'',deliveredAt:null};
 o.outbox.push(item);appendOperationalEvent(state,'OUTBOX_ENQUEUED',{outboxId:item.id,kind:item.kind,priority:item.priority},{at,correlationId:item.correlationId,idempotencyKey:key?('outbox-event:'+key):''});return {item,duplicate:false};
}
export function outboxStats(state,at=Date.now()){
 const o=ensureOperational(state),pending=o.outbox.filter(x=>x.status==='PENDING'),due=pending.filter(x=>x.nextAttemptAt<=at),oldest=pending.length?Math.min(...pending.map(x=>x.createdAt)):null;return {pending:pending.length,due:due.length,oldestAgeMs:oldest==null?0:Math.max(0,at-oldest),byPriority:Object.fromEntries(Object.keys(PRIORITY).map(p=>[p,pending.filter(x=>x.priority===p).length])),delivered:o.outboxHistory.filter(x=>x.status==='DELIVERED').length};
}
export async function processOutbox(state,handlers,{persist=async()=>{},deadLetters=[],limit=25,at=Date.now()}={}){
 const o=ensureOperational(state),due=o.outbox.filter(x=>x.status==='PENDING'&&x.nextAttemptAt<=at).sort((a,b)=>(PRIORITY[a.priority]??2)-(PRIORITY[b.priority]??2)||a.createdAt-b.createdAt).slice(0,limit),results=[];
 for(const item of due){const handler=handlers[item.kind];if(typeof handler!=='function'){item.attempts=item.maxAttempts;item.lastError='Handler não registrado';}
  else try{item.attempts++;const result=await handler(item.payload,item);item.status='DELIVERED';item.deliveredAt=Date.now();o.outboxHistory.unshift({...item,payload:undefined,result:result??null});o.outbox=o.outbox.filter(x=>x.id!==item.id);appendOperationalEvent(state,'OUTBOX_DELIVERED',{outboxId:item.id,kind:item.kind,attempts:item.attempts},{at:item.deliveredAt,correlationId:item.correlationId,idempotencyKey:item.idempotencyKey?('outbox-delivered:'+item.idempotencyKey):''});results.push({id:item.id,ok:true});await persist();continue;}catch(e){item.lastError=String(e?.message||e).slice(0,500);}
  if(item.attempts>=item.maxAttempts){item.status='DEAD_LETTER';const failedAt=Date.now(),dlq={id:'dlq-'+item.id,name:item.kind,payload:item.payload,error:item.lastError,stack:'',attempts:item.attempts,at:failedAt,origin:'persistent_outbox',status:'failed',correlationId:item.correlationId,idempotencyKey:item.idempotencyKey,priority:item.priority};if(!deadLetters.some(x=>x.id===dlq.id))deadLetters.unshift(dlq);o.outbox=o.outbox.filter(x=>x.id!==item.id);appendOperationalEvent(state,'OUTBOX_DEAD_LETTER',{outboxId:item.id,kind:item.kind,error:item.lastError,attempts:item.attempts},{at:failedAt,correlationId:item.correlationId});results.push({id:item.id,ok:false,deadLetter:true});}
  else{const delay=Math.min(30*60000,Math.pow(2,item.attempts-1)*30000);item.nextAttemptAt=Date.now()+delay;appendOperationalEvent(state,'OUTBOX_RETRY_SCHEDULED',{outboxId:item.id,kind:item.kind,attempt:item.attempts,nextAttemptAt:item.nextAttemptAt,error:item.lastError},{at:Date.now(),correlationId:item.correlationId});results.push({id:item.id,ok:false,nextAttemptAt:item.nextAttemptAt});}
  await persist();
 }
 if(o.outboxHistory.length>10000)o.outboxHistory.length=10000;return results;
}
export function requeueDeadLetter(state,deadLetters,id,at=Date.now()){
 const row=deadLetters.find(x=>x.id===id&&x.status==='failed');if(!row)throw new Error('DLQ não encontrada ou já processada');if(row.origin!=='persistent_outbox')throw new Error('Esta DLQ não pertence à outbox persistente');
 const result=enqueueOutbox(state,row.name,row.payload,{priority:row.priority||'HIGH',idempotencyKey:row.idempotencyKey?row.idempotencyKey+':retry:'+at:'dlq-retry:'+row.id,correlationId:row.correlationId||'',maxAttempts:5,at});row.status='reprocessed';row.reprocessedAt=at;appendOperationalEvent(state,'DLQ_REPROCESSED',{deadLetterId:row.id,outboxId:result.item.id,kind:row.name},{at,correlationId:row.correlationId||''});return result.item;
}
export function discardDeadLetter(state,deadLetters,id,reason='',at=Date.now()){
 const row=deadLetters.find(x=>x.id===id&&x.status==='failed');if(!row)throw new Error('DLQ não encontrada ou já processada');row.status='discarded';row.discardedAt=at;row.discardReason=String(reason||'').slice(0,300);appendOperationalEvent(state,'DLQ_DISCARDED',{deadLetterId:row.id,kind:row.name,reason:row.discardReason},{at,correlationId:row.correlationId||''});return row;
}

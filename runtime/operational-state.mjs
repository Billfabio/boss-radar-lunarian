import {createHash} from 'node:crypto';

export const HEALTH_STATES=new Set(['HEALTHY','DEGRADED','UNAVAILABLE','RECOVERING','FAILED','UNKNOWN']);
const STATUS_SCORE={HEALTHY:1,RECOVERING:.72,DEGRADED:.55,UNKNOWN:.35,UNAVAILABLE:.12,FAILED:0};
const clamp=(n,a=0,b=1)=>Math.max(a,Math.min(b,n));
const stable=value=>{if(value===null||typeof value!=='object')return JSON.stringify(value);if(Array.isArray(value))return '['+value.map(stable).join(',')+']';return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}';};
const hash=value=>createHash('sha256').update(String(value)).digest('hex');

export function ensureOperational(state){
 state.operational ||= {version:1,components:{},events:[],incidents:[],incidentSequence:0,recovery:{},safeMode:{active:false,reasons:[],level:'NORMAL',confidenceCap:null,updatedAt:0},integrity:{lastRunAt:0,lastResult:null},backups:{lastBackupAt:0,lastRestoreTestAt:0,lastRestoreTest:null,slots:{}},reports:[],configVersions:[],outbox:[],outboxHistory:[],idempotency:{},startedAt:Date.now()};
 const o=state.operational;o.version=1;o.components||={};o.events||=[];o.incidents||=[];o.recovery||={};o.safeMode||={active:false,reasons:[],level:'NORMAL',confidenceCap:null,updatedAt:0};o.integrity||={lastRunAt:0,lastResult:null};o.backups||={lastBackupAt:0,lastRestoreTestAt:0,lastRestoreTest:null,slots:{}};o.reports||=[];o.configVersions||=[];o.outbox||=[];o.outboxHistory||=[];o.idempotency||={};o.incidentSequence=Number(o.incidentSequence)||0;o.startedAt=Number(o.startedAt)||Date.now();return o;
}
export function appendOperationalEvent(state,type,payload={},options={}){
 const o=ensureOperational(state),at=Number(options.at)||Date.now(),previousHash=o.events.at(-1)?.hash||'GENESIS',sequence=(o.events.at(-1)?.sequence||0)+1,correlationId=String(options.correlationId||payload.correlationId||''),idempotencyKey=String(options.idempotencyKey||'');
 if(idempotencyKey){const existing=o.events.find(x=>x.idempotencyKey===idempotencyKey);if(existing)return existing;}
 const entry={sequence,type:String(type),at,correlationId,idempotencyKey,payload,previousHash};entry.hash=hash(previousHash+'|'+stable({sequence:entry.sequence,type:entry.type,at:entry.at,correlationId,idempotencyKey,payload}));
 o.events.push(entry);if(o.events.length>50000)o.events.splice(0,o.events.length-50000);return entry;
}
export function verifyOperationalEvents(state){
 const rows=ensureOperational(state).events;let previous='GENESIS';for(let i=0;i<rows.length;i++){const e=rows[i],expected=hash(previous+'|'+stable({sequence:e.sequence,type:e.type,at:e.at,correlationId:e.correlationId||'',idempotencyKey:e.idempotencyKey||'',payload:e.payload}));if(e.previousHash!==previous||e.hash!==expected)return {valid:false,index:i,expected,actual:e.hash};previous=e.hash;}return {valid:true,entries:rows.length,lastHash:previous};
}
export function traceEvents(state,correlationId){
 const id=String(correlationId||'');if(!id)return [];return ensureOperational(state).events.filter(x=>x.correlationId===id).map(x=>({sequence:x.sequence,type:x.type,at:x.at,correlationId:x.correlationId,payload:x.payload,hash:x.hash}));
}
export function heartbeat(state,id,input={},at=Date.now()){
 const o=ensureOperational(state),key=String(id),prev=o.components[key]||{},status=HEALTH_STATES.has(input.status)?input.status:'UNKNOWN',expectedIntervalMs=Math.max(1000,Number(input.expectedIntervalMs)||prev.expectedIntervalMs||60000),staleAfterMs=Math.max(expectedIntervalMs,Number(input.staleAfterMs)||prev.staleAfterMs||Math.max(expectedIntervalMs*3,90000)),activityAt=Number(input.activityAt)||prev.lastActivityAt||at;
 const row={...prev,id:key,status,reportedStatus:status,reason:String(input.reason||''),critical:input.critical??prev.critical??false,expectedIntervalMs,staleAfterMs,lastHeartbeatAt:at,lastActivityAt:activityAt,lastHealthyAt:status==='HEALTHY'?at:prev.lastHealthyAt||0,metrics:input.metrics??prev.metrics??{},details:input.details??prev.details??{},updatedAt:at};
 o.components[key]=row;return row;
}
export function componentView(state,id,now=Date.now()){
 const row=ensureOperational(state).components[id];if(!row)return {id,status:'UNKNOWN',effectiveStatus:'UNKNOWN',reason:'Sem heartbeat registrado.',lastHeartbeatAt:null,lastActivityAt:null,critical:false,stale:true};
 const age=now-(row.lastHeartbeatAt||0),stale=!row.lastHeartbeatAt||age>row.staleAfterMs,effectiveStatus=stale?(row.status==='FAILED'?'FAILED':'UNAVAILABLE'):row.status,reason=stale?'Heartbeat atrasado há '+Math.max(0,Math.round(age/1000))+'s.':row.reason;
 return {...row,effectiveStatus,reason,stale,heartbeatAgeMs:row.lastHeartbeatAt?Math.max(0,age):null};
}
export function componentViews(state,now=Date.now()){const o=ensureOperational(state);return Object.keys(o.components).sort().map(id=>componentView(state,id,now));}
function incidentId(o,at){o.incidentSequence++;const d=new Date(at).toISOString().slice(0,10).replaceAll('-','');return 'INC-'+d+'-'+String(o.incidentSequence).padStart(4,'0');}
export function openIncident(state,{component,kind='COMPONENT_FAILURE',severity='medium',reason='',startedAt=null,correlationId='',metadata={}}={},at=Date.now()){
 const o=ensureOperational(state),fingerprint=String(component)+'|'+String(kind),existing=o.incidents.find(x=>x.status==='OPEN'&&x.fingerprint===fingerprint);
 if(existing){existing.lastSeenAt=at;existing.occurrences=(existing.occurrences||1)+1;if(reason)existing.reason=String(reason).slice(0,500);return {incident:existing,created:false};}
 const incident={id:incidentId(o,at),fingerprint,component:String(component),kind:String(kind),severity,status:'OPEN',startedAt:Number(startedAt)||at,detectedAt:at,lastSeenAt:at,resolvedAt:null,reason:String(reason).slice(0,500),rootCause:null,resolution:null,autoRecovered:false,recoveryAttempts:0,correlationId:String(correlationId||''),metadata,occurrences:1};
 o.incidents.unshift(incident);if(o.incidents.length>5000)o.incidents.length=5000;appendOperationalEvent(state,'INCIDENT_OPENED',{incidentId:incident.id,component:incident.component,kind:incident.kind,severity:incident.severity,reason:incident.reason},{at,correlationId});return {incident,created:true};
}
export function resolveIncident(state,id,{autoRecovered=false,resolution='',rootCause=''}={},at=Date.now()){
 const o=ensureOperational(state),x=o.incidents.find(r=>r.id===id);if(!x)return null;if(x.status==='RESOLVED')return x;x.status='RESOLVED';x.resolvedAt=at;x.autoRecovered=!!autoRecovered;x.resolution=String(resolution||'').slice(0,500);x.rootCause=String(rootCause||x.rootCause||'').slice(0,500);appendOperationalEvent(state,'INCIDENT_RESOLVED',{incidentId:x.id,component:x.component,autoRecovered:x.autoRecovered,resolution:x.resolution},{at,correlationId:x.correlationId});return x;
}
export function recoveryState(state,component){
 const o=ensureOperational(state),id=String(component);o.recovery[id] ||= {attempts:0,nextAttemptAt:0,lastAttemptAt:0,lastSuccessAt:0,lastError:'',manualRequired:false};return o.recovery[id];
}
export function recoveryAllowed(state,component,at=Date.now()){
 const r=recoveryState(state,component);return !r.manualRequired&&r.attempts<3&&at>=r.nextAttemptAt;
}
export function noteRecoveryAttempt(state,component,{ok=false,error='',correlationId=''}={},at=Date.now()){
 const r=recoveryState(state,component);r.attempts++;r.lastAttemptAt=at;r.lastError=ok?'':String(error||'').slice(0,300);if(ok){r.lastSuccessAt=at;r.nextAttemptAt=0;r.manualRequired=false;}else{const delays=[30000,120000,600000];r.nextAttemptAt=at+delays[Math.min(delays.length-1,r.attempts-1)];if(r.attempts>=3)r.manualRequired=true;}appendOperationalEvent(state,'RECOVERY_ATTEMPT',{component,attempt:r.attempts,ok,error:r.lastError,nextAttemptAt:r.nextAttemptAt,manualRequired:r.manualRequired},{at,correlationId});return r;
}
export function resetRecovery(state,component,at=Date.now()){const r=recoveryState(state,component);if(r.attempts||r.manualRequired)appendOperationalEvent(state,'RECOVERY_RESET',{component,attempts:r.attempts},{at});Object.assign(r,{attempts:0,nextAttemptAt:0,lastAttemptAt:r.lastAttemptAt||0,lastSuccessAt:at,lastError:'',manualRequired:false});return r;}
export function incidentMetrics(state,now=Date.now()){
 const rows=ensureOperational(state).incidents,resolved=rows.filter(x=>x.status==='RESOLVED'),open=rows.filter(x=>x.status==='OPEN'),mttd=resolved.map(x=>Math.max(0,x.detectedAt-x.startedAt)),mttr=resolved.map(x=>Math.max(0,x.resolvedAt-x.detectedAt)),mean=a=>a.length?a.reduce((n,x)=>n+x,0)/a.length:null,auto=resolved.filter(x=>x.autoRecovered).length;
 return {open:open.length,total:rows.length,resolved:resolved.length,autoRecovered:auto,selfHealingPct:resolved.length?Math.round(auto/resolved.length*1000)/10:null,mttdMs:mean(mttd),mttrMs:mean(mttr),manualAttention:open.filter(x=>recoveryState(state,x.component).manualRequired).length};
}
export function evaluateSafeMode(state,{sources=[],coveragePct=null,integrity=null,prediction=null}={},now=Date.now()){
 const o=ensureOperational(state),components=componentViews(state,now),reasons=[];let level='NORMAL';
 for(const c of components.filter(x=>x.critical)){if(['FAILED','UNAVAILABLE'].includes(c.effectiveStatus)){reasons.push(c.id+': '+(c.reason||c.effectiveStatus));level='CRITICAL';}else if(['DEGRADED','RECOVERING','UNKNOWN'].includes(c.effectiveStatus)){reasons.push(c.id+': '+(c.reason||c.effectiveStatus));if(level!=='CRITICAL')level='DEGRADED';}}
 if(integrity?.criticalIssues>0){reasons.push('Integridade: '+integrity.criticalIssues+' problema(s) crítico(s).');level='CRITICAL';}
 if(prediction?.status==='FAILED'||prediction?.status==='UNAVAILABLE'){reasons.push('Prediction Engine indisponível.');level='CRITICAL';}
 const activeSources=(sources||[]).filter(x=>x.active!==false&&x.eventEvidence!==false),healthySources=activeSources.filter(x=>x.circuitState!=='OPEN'&&(!x.lastError||x.lastSuccess>=x.lastAttempt));
 if(activeSources.length&&healthySources.length===0){reasons.push('Nenhuma fonte de evento saudável disponível.');level='CRITICAL';}
 if(Number.isFinite(coveragePct)&&coveragePct<50){reasons.push('Cobertura Lunarian muito reduzida ('+coveragePct+'%).');if(level!=='CRITICAL')level='DEGRADED';}
 const active=level!=='NORMAL',confidenceCap=level==='CRITICAL'?55:level==='DEGRADED'?75:null;
 o.safeMode={active,reasons,level,confidenceCap,updatedAt:now,policyVersion:'safe-mode-v1',note:active?'Safety cap operacional; não representa recalibração estatística.':'Operação normal.'};return o.safeMode;
}
export function reliabilitySummary(state,now=Date.now()){
 const components=componentViews(state,now),known=components.filter(x=>x.effectiveStatus!=='UNKNOWN'),critical=components.filter(x=>x.critical),scores=known.map(x=>STATUS_SCORE[x.effectiveStatus]??0),raw=known.length?100*scores.reduce((a,b)=>a+b,0)/known.length:null,criticalFailures=critical.filter(x=>['FAILED','UNAVAILABLE'].includes(x.effectiveStatus)).length,score=raw==null||known.length<4?null:Math.round(clamp((raw-(criticalFailures?20:0))/100)*1000)/10;
 return {score,status:score==null?'INSUFFICIENT_DATA':score>=90?'HEALTHY':score>=70?'DEGRADED':'UNAVAILABLE',measuredComponents:known.length,totalComponents:components.length,criticalFailures,components,incidents:incidentMetrics(state,now),safeMode:ensureOperational(state).safeMode,eventStore:verifyOperationalEvents(state)};
}

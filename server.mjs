import http from 'node:http';
import {fetchBossMaps} from './boss-maps.mjs';
import {createWhatsAppSync} from './whatsapp-sync.mjs';
import {buildBossDictionary} from './whatsapp-dictionary.mjs';
import {validateGroupRows,checkKey,groupPatterns,brasiliaDate} from './group-checks.mjs';
import {entryFor,resolvedProgress} from './bosstiary.mjs';
import {PUBLIC_SOURCE,normalizePublic} from './public-source.mjs';
import {officialURL,mergeOfficial} from './official-source.mjs';
import {fetchCharacter,validateCharacterName,CHARACTER_NAME} from './character-source.mjs';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { WORLDS, uniqueHistory, dueAlert,status } from './logic.mjs';
import { createVapid, sendPush, allowedEndpoint } from './push.mjs';
import { createIntelligence } from './intelligence/service.mjs';
import { TaskQueue } from './runtime/task-queue.mjs';
import { buildHealth } from './runtime/health.mjs';
import { createStructuredLogger } from './observability/logger.mjs';
import { issueSession,validSession,validPassword,loginHtml } from './security/session.mjs';
import { RateLimiter } from './security/rate-limit.mjs';
import { createInvestigationEngine } from './investigation/engine.mjs';
import { buildExtensionPackage } from './extension-package.mjs';
import {ensureOperational,appendOperationalEvent,traceEvents,componentView,setOperationalControls,recordConfigVersion} from './runtime/operational-state.mjs';
import {createWatchdog} from './runtime/watchdog.mjs';
import {enqueueOutbox,processOutbox,outboxStats,requeueDeadLetter,discardDeadLetter} from './runtime/outbox.mjs';
import {auditIntegrity,safeRepair} from './runtime/integrity.mjs';
import {createBackupManager} from './runtime/backup.mjs';
import {ensureReliabilityTelemetry,recordReliabilitySample,detectOperationalRegressions,buildDailySystemReport,buildWeeklyReview} from './runtime/reliability-report.mjs';
import {validateStartupState,validatePendingOutboxHandlers,recordStartupRecovery} from './runtime/startup.mjs';
import {replayCorrelation} from './runtime/replay.mjs';
import {ensureOperations,runDecisionCycle,markDecisionAlertDispatched,applyAttentionAction,recordActionOutcome,operationsMetrics,operationsReplay} from './operations/engine.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4317);
const HOST = process.env.HOST || '127.0.0.1';
const ORIGIN = process.env.PUBLIC_ORIGIN || `http://${HOST==='0.0.0.0'?'127.0.0.1':HOST}:${PORT}`;
const PUBLIC_URL=new URL(ORIGIN);
const ALLOWED_HOSTS=new Set((process.env.ALLOWED_HOSTS||PUBLIC_URL.host).split(',').map(x=>x.trim()).filter(Boolean));
if(!['http:','https:'].includes(PUBLIC_URL.protocol))throw new Error('PUBLIC_ORIGIN deve usar http ou https');
if(HOST!=='127.0.0.1'&&HOST!=='localhost'&&!process.env.PUBLIC_ORIGIN)throw new Error('Defina PUBLIC_ORIGIN ao expor o servidor fora do localhost');
const AUTH_REQUIRED=process.env.REQUIRE_AUTH==='true'||!['127.0.0.1','localhost'].includes(PUBLIC_URL.hostname);
const SITE_PASSWORD=process.env.SITE_PASSWORD||'';
if(AUTH_REQUIRED&&SITE_PASSWORD.length<12)throw new Error('SITE_PASSWORD deve ter pelo menos 12 caracteres quando o painel estiver exposto fora do localhost');
const loginLimiter=new RateLimiter({windowMs:10*60000,max:10});
const apiLimiter=new RateLimiter({windowMs:60000,max:180});
const DATA = join(ROOT, 'data');
const bosstiary=JSON.parse(await readFile(join(ROOT,'bosstiary.json'),'utf8'));
const outfitCache=new Map();
const mapCache=new Map();
let extensionPackageCache=null;
await mkdir(DATA, { recursive:true });
await mkdir(join(DATA,'group-images'), { recursive:true });
let state;
try { state = JSON.parse(await readFile(join(DATA,'state.json'),'utf8')); }
catch (e) { if (e.code !== 'ENOENT') throw e; state={ settings:{world:'Lunarian', leadMinutes:30, enabled:false, favoritesOnly:false, progress:{}}, subscriptions:[], sent:{}, log:[], checks:[] }; }
state.settings.progress=Object.fromEntries(Object.entries(state.settings.progress).map(([name,p])=>[name,resolvedProgress(name,p,bosstiary)]));
ensureOperational(state);ensureReliabilityTelemetry(state);ensureOperations(state);const startupValidation=validateStartupState(state,{worlds:WORLDS,authRequired:AUTH_REQUIRED,sitePassword:SITE_PASSWORD});if(!startupValidation.ok)throw new Error('Startup validation falhou: '+startupValidation.issues.map(x=>x.code).join(', '));
let vapid;
try { vapid=JSON.parse(await readFile(join(DATA,'vapid.json'),'utf8')); }
catch (e) { if (e.code !== 'ENOENT') throw e; vapid=createVapid(); await writeFile(join(DATA,'vapid.json'),JSON.stringify(vapid),{mode:0o600}); }
import {recordConfiguration} from './discovery/history.mjs';
const sessionToken = randomBytes(32).toString('hex');
state.pipelineDeadLetters ||= [];
const heavyQueue=new TaskQueue({concurrency:1,maxPending:8,deadLetters:state.pipelineDeadLetters,onDeadLetter:()=>persist()});
const performanceStats={lastPersistMs:0,maxPersistMs:0,lastPersistBytes:0,lastSerializeMs:0,lastStateMs:0,lastRefreshMs:0};
const storageHealth={lastSuccessAt:0,lastError:'',lastFailureAt:0,recoveryCount:0};
let watchdog=null,backupManager=null,lastFrontendAt=0,lastInvestigationTickAt=0,lastIntegrityRunAt=0,lastBackupRunAt=0,lastReliabilitySampleAt=0;
let persistPromise=null,pendingSnapshot=null;
function persist() {
  if(state.intelligence?.discovery)recordConfiguration(state.intelligence.discovery,state.settings.world,state.settings);
  const serializeStart=performance.now();pendingSnapshot=JSON.stringify(state);performanceStats.lastSerializeMs=Math.round((performance.now()-serializeStart)*10)/10;performanceStats.lastPersistBytes=Buffer.byteLength(pendingSnapshot);
  if(persistPromise)return persistPromise;
  persistPromise=(async()=>{const started=performance.now(),hadError=!!storageHealth.lastError;try{while(pendingSnapshot!==null){const snapshot=pendingSnapshot;pendingSnapshot=null;await writeFile(join(DATA,'state.tmp'),snapshot);await rename(join(DATA,'state.tmp'),join(DATA,'state.json'));}performanceStats.lastPersistMs=Math.round((performance.now()-started)*10)/10;performanceStats.maxPersistMs=Math.max(performanceStats.maxPersistMs,performanceStats.lastPersistMs);storageHealth.lastSuccessAt=Date.now();if(hadError)storageHealth.recoveryCount++;storageHealth.lastError='';if(watchdog)await watchdog.beat('storage',{status:'HEALTHY',reason:'Persistência validada por gravação atômica.',critical:true,expectedIntervalMs:60000,staleAfterMs:10*60000,activityAt:storageHealth.lastSuccessAt,metrics:{lastPersistMs:performanceStats.lastPersistMs,lastPersistBytes:performanceStats.lastPersistBytes,recoveryCount:storageHealth.recoveryCount}});}catch(e){storageHealth.lastError=String(e?.message||e).slice(0,300);storageHealth.lastFailureAt=Date.now();if(watchdog)await watchdog.beat('storage',{status:'FAILED',reason:storageHealth.lastError,critical:true,expectedIntervalMs:60000,staleAfterMs:10*60000,activityAt:storageHealth.lastFailureAt});throw e;}})().finally(()=>{persistPromise=null;});
  return persistPromise;
}
backupManager=createBackupManager({state,readFile,writeFile,rename,mkdir,dataDir:DATA});
const cache=new Map();
let refreshPromise=null, lastError=null, monitoring=false, lastPoll=null, lastCollectionAt=null;
let catalog=[];
try {catalog=JSON.parse(await readFile(join(DATA,'catalog.json'),'utf8'));} catch(e) {if(e.code!=='ENOENT') throw e;}
const clients=new Set();
state.characters ||= [CHARACTER_NAME];
state.groupChecks ||= [];
const characterCache=new Map(Object.entries(state.characterProfiles||{})),characterErrors=new Map(),characterPromises=new Map();
async function refreshCharacter(input=CHARACTER_NAME,force=false){
 const name=validateCharacterName(input),key=name.toLowerCase(),old=characterCache.get(key);
 if(!force && old && Date.now()-old.fetchedAt<300000)return old;
 if(characterPromises.has(key))return characterPromises.get(key);
 const promise=fetchCharacter(name).then(async result=>{characterCache.set(key,result);characterErrors.delete(key);state.characterProfiles ||= {};state.characterProfiles[key]=result;await persist();return result;}).catch(e=>{characterErrors.set(key,e.message);throw e;}).finally(()=>{characterPromises.delete(key);});
 characterPromises.set(key,promise);return promise;
}
function broadcast(type, data) { for (const res of clients) res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`); }
const intelligence=createIntelligence({state,persist,broadcast});
let investigation=null;
const structured=createStructuredLogger({state,persist});
await intelligence.bootstrapChecks([...state.checks,...state.groupChecks]);
async function refresh(force=false,cacheTtlMs=240000) {
  const world=state.settings.world;
  const old=cache.get(world),ttl=Math.max(60000,Math.min(15*60000,Number(cacheTtlMs)||240000));
  if (!force && old && !old.catalogOnly && Date.now()-old.fetchedAt < ttl) return old;
  if (refreshPromise) { await refreshPromise; if (cache.get(world)) return cache.get(world); }
  refreshPromise=(async()=>{
    const refreshStarted=performance.now(),capturedWorld=world;
    let catalogFallback=null;
    if(!catalog.length) {
      const started=Date.now();
      if(intelligence.sourceReady('rubinot-catalog'))try{
        const response=await fetch('https://cdn.rubinottools.com/json/bosses.json',{signal:AbortSignal.timeout(20000)});
        if(!response.ok)throw new Error(`HTTP ${response.status}`);
        const raw=await response.json();if(!Array.isArray(raw))throw new Error('Formato do catálogo desconhecido');
        catalog=raw.filter(b=>b&&typeof b.name==='string').map(b=>({...b,history:[]}));
        if(!catalog.length)throw new Error('Catálogo vazio');
        intelligence.sourceAttempt('rubinot-catalog',{ok:true,records:catalog.length,latencyMs:Date.now()-started});
        await writeFile(join(DATA,'catalog.json'),JSON.stringify(catalog));
      }catch(e){catalogFallback=`Catálogo externo indisponível: ${e.message}`;intelligence.sourceAttempt('rubinot-catalog',{ok:false,error:e.message,latencyMs:Date.now()-started});}
      else catalogFallback='Catálogo externo temporariamente suspenso pelo circuit breaker.';
      if(!catalog.length){
        const seen=new Set();catalog=bosstiary.filter(b=>b&&typeof b.name==='string'&&!seen.has(b.name)&&(seen.add(b.name),true)).map(b=>({name:b.name,history:[],localFallback:true}));
        if(!catalog.length)throw new Error('Nenhum catálogo de bosses disponível');
      }
    }
    if(!cache.has(capturedWorld))cache.set(capturedWorld,{world:capturedWorld,pending:[],bosses:catalog,fetchedAt:Date.now(),catalogOnly:true,catalogFallback});
    let result,publicError=null;const previous=cache.get(capturedWorld),publicStarted=Date.now();
    if(!intelligence.sourceReady('otbosstracker')){
      publicError='Histórico público temporariamente suspenso pelo circuit breaker.';
      result=previous?{...previous,pending:[...(previous.pending||[])],bosses:(previous.bosses||catalog).map(b=>({...b,history:[...(b.history||[])]})),stale:true,staleFrom:previous.staleFrom||previous.fetchedAt,fetchedAt:Date.now(),publicError}:{world:capturedWorld,pending:[],bosses:catalog.map(b=>({...b,history:[]})),fetchedAt:Date.now(),catalogOnly:true,stale:true,publicError};
    }else try{
      const response=await fetch(PUBLIC_SOURCE,{signal:AbortSignal.timeout(20000),headers:{Accept:'application/json'}});
      if(!response.ok)throw new Error(`HTTP ${response.status}`);
      result=normalizePublic(await response.json(),capturedWorld,catalog);intelligence.sourceAttempt('otbosstracker',{ok:true,records:result.bosses.reduce((n,b)=>n+(b.history?.length||0),0),latencyMs:Date.now()-publicStarted});await intelligence.ingestPublic(result);
    }catch(e){
      publicError=`Histórico público indisponível: ${e.message}`;intelligence.sourceAttempt('otbosstracker',{ok:false,error:e.message,latencyMs:Date.now()-publicStarted});
      result=previous?{...previous,pending:[...(previous.pending||[])],bosses:(previous.bosses||catalog).map(b=>({...b,history:[...(b.history||[])]})),stale:true,staleFrom:previous.staleFrom||previous.fetchedAt,fetchedAt:Date.now(),publicError}:{world:capturedWorld,pending:[],bosses:catalog.map(b=>({...b,history:[]})),fetchedAt:Date.now(),catalogOnly:true,stale:true,publicError};
    }
    if(!intelligence.sourceReady('rubinot-official')){result.officialError='Estatísticas oficiais temporariamente suspensas pelo circuit breaker.';}else try {
      const officialStarted=Date.now();const official=await fetch(officialURL(capturedWorld),{signal:AbortSignal.timeout(15000),headers:{Accept:'application/json'}});
      if(!official.ok)throw new Error(`HTTP ${official.status}`);
      state.officialSnapshots ||= {};
      const snapshot=mergeOfficial(result,await official.json(),state.officialSnapshots[capturedWorld]);intelligence.sourceAttempt('rubinot-official',{ok:true,records:result.officialCoverage||0,latencyMs:Date.now()-officialStarted});await intelligence.ingestOfficial(result);
      state.officialSnapshots[capturedWorld]=snapshot;
      state.officialHistory ||= {};
      const history=state.officialHistory[capturedWorld] ||= [];
      if(!history.length || snapshot.at-history.at(-1).at>=240000)history.push(snapshot);
      state.officialHistory[capturedWorld]=history.slice(-10800);
      await persist();
    }catch(e){intelligence.sourceAttempt('rubinot-official',{ok:false,error:e.message});result.officialError=`Estatísticas oficiais indisponíveis: ${e.message}`;}
    cache.set(capturedWorld,result);lastCollectionAt=Date.now();lastError=publicError;performanceStats.lastRefreshMs=Math.round((performance.now()-refreshStarted)*10)/10;await persist();if(investigation)await investigation.reconcileConfirmed(intelligence.snapshot(capturedWorld));broadcast('update',{world:capturedWorld});return result;
  })();
  try { return await refreshPromise; } catch(e) { lastError=e.message;await persist().catch(()=>{});throw e; } finally { refreshPromise=null; }
}
function log(entry) { state.log.unshift({...entry,at:Date.now()}); state.log=state.log.slice(0,200); }
async function poll() {
  if (monitoring) return;
  monitoring=true;
  try {
    await drainOutbox(50);
    const adaptiveTtl=Math.max(60000,Math.min(15*60000,Number(state.operations?.current?.polling?.globalIntervalMs)||240000)),data=await refresh(false,adaptiveTtl);lastPoll=Date.now();
    if(!state.operational.controls.automationsPaused){
      await heavyQueue.enqueue('discovery-tick:'+data.world,()=>intelligence.discoveryTick(data.world),{priority:'LOW',idempotencyKey:'discovery-tick:'+data.world+':'+Math.floor(lastPoll/60000)});
      if(investigation&&!state.operational.controls.investigationDisabled){await investigation.tick();lastInvestigationTickAt=Date.now();}
      if(intelligence.discoveryDue(data.world)){try{await heavyQueue.enqueue('discovery:'+data.world,()=>intelligence.discoveryWrite('run',{world:data.world}),{priority:'LOW',idempotencyKey:'discovery:'+data.world+':'+new Date().toISOString().slice(0,10)});}catch(e){log({world:data.world,kind:'signal-discovery',result:e.message});}}
    }
    const now=Date.now(),decision=runDecisionCycle(state,{world:data.world,intelligence:intelligence.snapshot(data.world),investigation:investigation?.publicState(data.world)||{},whatsapp:whatsapp?.publicState()||{},system:{safeMode:state.operational.safeMode},settings:state.settings},now);
    if(state.settings.enabled&&!state.operational.controls.maintenanceMode){
      for(const alert of decision.alertsToSend||[]){if(state.settings.favoritesOnly&&!state.settings.progress?.[alert.boss]?.favorite)continue;const change=alert.change?.priority?(' Prioridade '+(alert.previousPriority??'—')+' → '+alert.priorityScore+'.'):'';const message={title:(alert.level==='CRITICAL'?'🔥 ':'')+alert.boss+' — '+alert.level,body:'Priority '+alert.priorityScore+'/100'+(alert.modelProbability==null?'':', probability '+alert.modelProbability+'%')+', decision confidence '+alert.decisionConfidence+'%, miss risk '+(alert.missedDetectionRisk??'—')+'/100.'+change,tag:alert.id,url:'/',boss:alert.boss};for(const sub of state.subscriptions)enqueueOutbox(state,'push_alert',{endpoint:sub.endpoint,message,sentKey:alert.id,alertMeta:{world:alert.world,boss:alert.boss,key:alert.id,kind:'decision_'+alert.level.toLowerCase()}},{priority:alert.level==='CRITICAL'?'CRITICAL':'HIGH',idempotencyKey:'push:'+alert.id+':'+sub.endpoint,correlationId:'decision:'+alert.id,maxAttempts:5});markDecisionAlertDispatched(state,alert.id,now);broadcast('update',{kind:'decision-alert',boss:alert.boss,level:alert.level});}}
    const nowAfterDecision=Date.now();
    if(!lastIntegrityRunAt||nowAfterDecision-lastIntegrityRunAt>=5*60000){const audit=auditIntegrity(state,nowAfterDecision);safeRepair(state,audit,nowAfterDecision);lastIntegrityRunAt=nowAfterDecision;await persist();}
    if(!lastBackupRunAt||nowAfterDecision-lastBackupRunAt>=6*3600000){try{const meta=await backupManager.backup(nowAfterDecision);await backupManager.restoreTest(meta.slot,Date.now());lastBackupRunAt=nowAfterDecision;}catch(e){await watchdog.beat('backup',{status:'FAILED',reason:String(e.message||e),critical:false,expectedIntervalMs:6*3600000,staleAfterMs:12*3600000,activityAt:now});watchdog.markManualIncident({component:'backup',kind:'BACKUP_VALIDATION_FAILED',severity:'high',reason:String(e.message||e),startedAt:nowAfterDecision,correlationId:'health:backup'});}}
    await syncOperationalHealth(nowAfterDecision);await watchdog.check(nowAfterDecision);await sampleReliability(nowAfterDecision);
    if(state.operational.controls.maintenanceMode||state.operational.controls.automationsPaused||state.settings.world!==data.world||!state.settings.enabled||lastError){await persist();return;}
    for (const prediction of data.pending) {
      const alert=dueAlert(prediction,state.settings,nowAfterDecision);if(!alert)continue;
      const sent=state.sent[alert.key]||[],when=alert.start?new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit'}).format(new Date(alert.start)):'';
      const message={title:prediction.boss_name+' • '+prediction.world,body:alert.kind==='round'?'Dia favorável segundo o histórico. Sua rodada está marcada para '+when+'; prepare a checagem. Não é uma previsão de hora de spawn.':'Histórico indica um dia favorável para procurar. Horário de spawn desconhecido.',tag:alert.key,url:'/',boss:prediction.boss_name};
      intelligence.recordAlert({world:prediction.world,boss:prediction.boss_name,key:alert.key,kind:alert.kind,status:'planned',message});
      for(const sub of state.subscriptions){if(sent.includes(sub.endpoint))continue;enqueueOutbox(state,'push_alert',{endpoint:sub.endpoint,message,sentKey:alert.key,alertMeta:{world:prediction.world,boss:prediction.boss_name,key:alert.key,kind:alert.kind}},{priority:'HIGH',idempotencyKey:'push:'+alert.key+':'+sub.endpoint,correlationId:'alert:'+alert.key,maxAttempts:5});}
    }
    await persist();await drainOutbox(50);
    const keys=Object.keys(state.sent);for(const key of keys.slice(0,Math.max(0,keys.length-5000)))delete state.sent[key];
    await persist();await syncOperationalHealth(Date.now());
  } catch(e) {
    lastError=e.message;appendOperationalEvent(state,'POLL_FAILURE',{error:String(e.message||e).slice(0,500)},{correlationId:'health:poll'});if(watchdog){watchdog.markManualIncident({component:'collection',kind:'POLL_FAILURE',severity:'high',reason:String(e.message||e),startedAt:Date.now(),correlationId:'health:poll'});await syncOperationalHealth(Date.now()).catch(()=>{});await watchdog.check(Date.now()).catch(()=>{});}broadcast('source-error',{error:e.message});
  } finally { monitoring=false; }
}
function json(res,code,value) { res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(value)); }
async function body(req) {
  let text=''; for await(const chunk of req) { text+=chunk; if(text.length>400000) throw new Error('Arquivo grande demais'); }
  return JSON.parse(text || '{}');
}
function validSettings(input) {
  const result={...state.settings};
  if ('world' in input) { if(!WORLDS.includes(input.world)) throw new Error('Mundo inválido'); result.world=input.world; }
  if ('leadMinutes' in input) { const n=Number(input.leadMinutes); if(!Number.isInteger(n)||n<5||n>120) throw new Error('Antecedência deve ser entre 5 e 120 minutos'); result.leadMinutes=n; }
  for(const k of ['enabled','favoritesOnly']) if(k in input) { if(typeof input[k]!=='boolean') throw new Error('Preferência inválida'); result[k]=input[k]; }
  if ('checkTime' in input) {if(input.checkTime!=='' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.checkTime))throw new Error('Horário inválido');result.checkTime=input.checkTime;}
  if ('progress' in input) {
    if (!input.progress || Array.isArray(input.progress) || typeof input.progress!=='object' || Object.keys(input.progress).length>1000) throw new Error('Progresso inválido');
    const progress=Object.create(null);
    for(const [name,v] of Object.entries(input.progress)) {
      if(name.length>120 || ['__proto__','constructor','prototype'].includes(name) || !v || typeof v!=='object') throw new Error('Boss inválido');
      const kills=Math.max(0,Math.min(100000,Math.trunc(Number(v.kills)||0)));
      const target=Math.max(1,Math.min(100000,Math.trunc(Number(v.target)||100)));
      progress[name]=resolvedProgress(name,{kills,target,known:v.known!==false,targetConfirmed:!!v.targetConfirmed,favorite:!!v.favorite,muted:!!v.muted},bosstiary);
    }
    result.progress=progress;
  }
  return result;
}
async function deliverPush(payload,item){
  const sub=state.subscriptions.find(x=>x.endpoint===payload.endpoint);if(!sub)return {skipped:true,reason:'subscription_missing'};
  const response=await sendPush(sub,payload.message,vapid);
  if(response.status===404||response.status===410){state.subscriptions=state.subscriptions.filter(x=>x.endpoint!==payload.endpoint);return {removed:true,status:response.status};}
  if(!response.ok)throw new Error('Entrega recusada (HTTP '+response.status+')');
  if(payload.sentKey){const sent=state.sent[payload.sentKey]||[];if(!sent.includes(payload.endpoint))sent.push(payload.endpoint);state.sent[payload.sentKey]=sent;}
  if(payload.alertMeta)intelligence.recordAlert({...payload.alertMeta,status:'delivered',message:payload.message});
  log({boss:payload.message?.boss||payload.alertMeta?.boss||'',world:payload.alertMeta?.world||state.settings.world,kind:payload.alertMeta?.kind||'notification',result:'Enviado ao serviço de push'});
  appendOperationalEvent(state,'NOTIFICATION_DELIVERED',{tag:payload.message?.tag||'',endpointHash:randomBytes(4).toString('hex'),outboxId:item.id},{correlationId:item.correlationId});
  broadcast('alert',payload.message);return {ok:true};
}
function outboxHandlers(){
 return {
  intelligence_ingest_checks:async(payload,item)=>{const result=await intelligence.ingestChecks(payload.records||[]);appendOperationalEvent(state,'INTELLIGENCE_INGESTED',{records:(payload.records||[]).map(x=>x.id),added:result},{correlationId:item.correlationId,idempotencyKey:'intel-ingested:'+item.idempotencyKey});const snap=intelligence.snapshot(state.settings.world);appendOperationalEvent(state,'PREDICTION_UPDATED',{world:state.settings.world,predictions:(snap.predictions||[]).length,lastPredictionAt:intelligence.healthState(state.settings.world).lastPredictionAt||null},{correlationId:item.correlationId,idempotencyKey:'prediction-updated:'+item.idempotencyKey});return result;},
  investigation_start:async(payload,item)=>{if(state.operational.controls.investigationDisabled)throw new Error('Investigation Engine desativado pelo kill switch');const result=await investigation.investigate(payload.candidate,{forceSources:true});lastInvestigationTickAt=Date.now();appendOperationalEvent(state,'INVESTIGATION_PROCESSED',{candidateId:payload.candidate.id,caseId:result.id||null},{correlationId:item.correlationId,idempotencyKey:'investigation-processed:'+item.idempotencyKey});return {caseId:result.id||null};},
  intelligence_remove_checks:async(payload,item)=>{await intelligence.removeChecks(payload.records||[]);appendOperationalEvent(state,'INTELLIGENCE_REMOVAL_PROCESSED',{records:(payload.records||[]).map(x=>x.id)},{correlationId:item.correlationId,idempotencyKey:'intel-remove:'+item.idempotencyKey});return {removed:(payload.records||[]).length};},
  investigation_decision:async(payload,item)=>{if(state.operational.controls.investigationDisabled)throw new Error('Investigation Engine desativado pelo kill switch');const result=await investigation.recordDecision(payload.candidate,payload.decision);appendOperationalEvent(state,'INVESTIGATION_DECISION_PROCESSED',{candidateId:payload.candidate.id,decisionId:result.id||null,outcome:payload.decision.outcome},{correlationId:item.correlationId,idempotencyKey:'investigation-decision-processed:'+item.idempotencyKey});return {decisionId:result.id||null};},
  push_alert:deliverPush
 };
}
async function drainOutbox(limit=25){return processOutbox(state,outboxHandlers(),{persist,deadLetters:state.pipelineDeadLetters,limit});}
async function reliableIngestChecks(records=[]){
 const ids=records.map(x=>x.id).sort(),correlationId=records.find(x=>x.correlationId)?.correlationId||'trace-checks-'+Buffer.from(ids.join('|')).toString('base64url').slice(0,24),key='intelligence-checks:'+ids.join('|');
 enqueueOutbox(state,'intelligence_ingest_checks',{records},{priority:'CRITICAL',idempotencyKey:key,correlationId,maxAttempts:5});appendOperationalEvent(state,'CONFIRMED_EVENT_QUEUED_FOR_INTELLIGENCE',{recordIds:ids},{correlationId,idempotencyKey:'event-queued:'+key});await persist();await drainOutbox(10);return {queued:true};
}
async function reliableRemoveChecks(records=[]){
 const ids=records.map(x=>x.id).sort(),correlationId=records.find(x=>x.correlationId)?.correlationId||'trace-remove-'+Buffer.from(ids.join('|')).toString('base64url').slice(0,24),key='intelligence-remove:'+ids.join('|');
 enqueueOutbox(state,'intelligence_remove_checks',{records},{priority:'CRITICAL',idempotencyKey:key,correlationId,maxAttempts:5});appendOperationalEvent(state,'EVENT_REMOVAL_QUEUED',{recordIds:ids},{correlationId,idempotencyKey:'remove-queued:'+key});await persist();await drainOutbox(10);return {queued:true};
}
async function reliableInvestigationStart(candidate){
 const correlationId=candidate.correlationId||'trace-candidate-'+candidate.id,key='investigation-start:'+candidate.id,opsPriority=state.operations?.current?.bosses?.find(x=>x.boss===candidate.boss)?.priorityScore,queuePriority=Number(opsPriority)>=85?'CRITICAL':'HIGH';enqueueOutbox(state,'investigation_start',{candidate},{priority:queuePriority,idempotencyKey:key,correlationId,maxAttempts:5});appendOperationalEvent(state,'CANDIDATE_INVESTIGATION_QUEUED',{candidateId:candidate.id,boss:candidate.boss},{correlationId,idempotencyKey:'candidate-investigation:'+candidate.id});await persist();await drainOutbox(10);const found=investigation.publicState(candidate.world).cases.find(x=>x.candidateId===candidate.id);if(found)return found;const pending=state.operational.outbox.find(x=>x.idempotencyKey===key);if(pending)throw new Error(pending.lastError||'Investigação preservada na fila para retry');throw new Error('Investigação ainda não disponível');
}
async function reliableInvestigationDecision(candidate,decision){
 const correlationId=candidate.correlationId||'trace-candidate-'+candidate.id,key='investigation-decision:'+candidate.id+':'+decision.outcome;enqueueOutbox(state,'investigation_decision',{candidate,decision},{priority:'CRITICAL',idempotencyKey:key,correlationId,maxAttempts:5});appendOperationalEvent(state,'HUMAN_DECISION_QUEUED',{candidateId:candidate.id,outcome:decision.outcome},{correlationId,idempotencyKey:'human-decision:'+key});await persist();await drainOutbox(10);return {queued:true};
}
async function notifyCommunityCandidate(candidate){
  const correlationId=candidate.correlationId||'trace-candidate-'+candidate.id,message={title:'🔥 Lunarian detectou possível '+candidate.boss,body:(candidate.participants||0)+' participantes · '+(candidate.messages||0)+' mensagens · revisar antes de confirmar.',tag:'wa-candidate-'+candidate.id,url:'/',boss:candidate.boss};
  appendOperationalEvent(state,'CANDIDATE_NOTIFICATION_PLANNED',{candidateId:candidate.id,boss:candidate.boss},{correlationId,idempotencyKey:'candidate-notification:'+candidate.id});broadcast('alert',message);
  for(const sub of state.subscriptions)enqueueOutbox(state,'push_alert',{endpoint:sub.endpoint,message,sentKey:'candidate:'+candidate.id},{priority:'HIGH',idempotencyKey:'push:candidate:'+candidate.id+':'+sub.endpoint,correlationId,maxAttempts:5});
  await persist();await drainOutbox(20);
}
investigation=createInvestigationEngine({state,persist,broadcast,getSnapshot:world=>intelligence.snapshot(world),getKnowledgeContext:(world,boss,at)=>intelligence.knowledgeContext(world,boss,at),refreshSources:async()=>{await refresh(true);}});
const whatsapp=createWhatsAppSync({state,persist,broadcast,dictionary:()=>buildBossDictionary({catalog,bosstiary,aliases:state.whatsapp?.aliases||{}}),names:()=>[...new Set([...catalog.map(b=>b.name),...bosstiary.map(b=>b.name)])],worlds:WORLDS,readBody:body,onRecords:reliableIngestChecks,onCandidate:notifyCommunityCandidate,investigate:reliableInvestigationStart,onDecision:reliableInvestigationDecision,onEvidence:async(evidence,candidate)=>{const correlationId=candidate.correlationId||evidence.correlationId||'trace-candidate-'+candidate.id;appendOperationalEvent(state,'EVIDENCE_CREATED',{evidenceId:evidence.id,candidateId:candidate.id,boss:candidate.boss,world:candidate.world,source:'whatsapp-lunarian'},{correlationId,idempotencyKey:'evidence:'+evidence.id});appendOperationalEvent(state,(candidate.evidence||[]).length<=1?'CANDIDATE_CREATED':'CANDIDATE_UPDATED',{candidateId:candidate.id,boss:candidate.boss,world:candidate.world,evidenceCount:(candidate.evidence||[]).length},{correlationId,idempotencyKey:'candidate-state:'+candidate.id+':'+(candidate.evidence||[]).length});await persist();},saveImage:async(id,image)=>writeFile(join(DATA,'group-images',id),image.bytes),favorable:row=>{const data=cache.get(row.world);if(row.date!==brasiliaDate()||!data||data.catalogOnly||Date.now()-data.fetchedAt>300000||lastError)return 'unknown';const p=data.pending.find(p=>p.boss_name===row.boss);return status(p)==='high'?'yes':'unknown';}});
function operationalContext(){
 const h=intelligence.healthState(state.settings.world),w=whatsapp.publicState(),prediction=componentView(state,'prediction-engine');return {sources:h.sources,coveragePct:w.coverage?.coveragePct??null,integrity:state.operational.integrity.lastResult,prediction:{status:prediction.effectiveStatus}};
}
watchdog=createWatchdog({state,persist,broadcast,context:operationalContext,recoveries:{
 storage:async()=>{await persist();return {ok:!storageHealth.lastError,healthy:!storageHealth.lastError,reason:'Persistência revalidada.'};},
 collection:async()=>{await refresh(true);return {ok:true,healthy:true,reason:'Coleta externa executada novamente com sucesso.'};},
 'investigation-engine':async()=>{if(state.operational.controls.investigationDisabled)return {ok:false,error:'Kill switch ativo'};await investigation.tick();lastInvestigationTickAt=Date.now();return {ok:true,healthy:true,reason:'Investigation Engine executou tick de recuperação.'};},
 'prediction-engine':async()=>{if(state.operational.controls.predictionDisabled)return {ok:false,error:'Kill switch ativo'};intelligence.snapshot(state.settings.world);return {ok:true,healthy:true,reason:'Prediction Engine respondeu ao snapshot de validação.'};},
 'persistent-outbox':async()=>{await drainOutbox(50);const q=outboxStats(state);return {ok:true,healthy:q.due===0||q.oldestAgeMs<5*60000,reason:'Outbox reprocessada.',metrics:q};},
 backup:async()=>{const meta=await backupManager.backup();const test=await backupManager.restoreTest(meta.slot);lastBackupRunAt=Date.now();return {ok:true,healthy:test.ok,reason:'Backup recriado e restore test validado.'};},
 'integrity-audit':async()=>{const result=auditIntegrity(state);lastIntegrityRunAt=Date.now();safeRepair(state,result);return {ok:true,healthy:result.criticalIssues===0,reason:result.criticalIssues?'Integridade ainda possui problemas críticos.':'Auditoria de integridade validada.',metrics:{criticalIssues:result.criticalIssues,totalIssues:result.totalIssues}};}
}});
async function syncOperationalHealth(at=Date.now()){
 const w=whatsapp.publicState(),h=intelligence.healthState(state.settings.world),q=heavyQueue.stats(),oq=outboxStats(state,at),cacheRow=cache.get(state.settings.world),backup=backupManager.publicState(),integrity=state.operational.integrity.lastResult;
 await watchdog.beat('backend',{status:'HEALTHY',reason:'Processo backend respondeu ao watchdog.',critical:true,expectedIntervalMs:60000,staleAfterMs:180000,activityAt:at,metrics:{errors24h:structured.errorsSince(86400000).length}});
 await watchdog.beat('frontend',{status:lastFrontendAt&&at-lastFrontendAt<120000?'HEALTHY':'UNKNOWN',reason:lastFrontendAt?'Último carregamento do painel registrado.':'Nenhum cliente do painel observado desde o startup.',critical:false,expectedIntervalMs:60000,staleAfterMs:180000,activityAt:lastFrontendAt||at,details:{lastSeenAt:lastFrontendAt||null}});
 await watchdog.beat('database',{status:'UNKNOWN',reason:'Runtime atual usa storage persistente próprio; PostgreSQL está apenas preparado/validado no CI.',critical:false,expectedIntervalMs:300000,staleAfterMs:900000,activityAt:at,details:{configured:false}});
 await watchdog.beat('storage',{status:storageHealth.lastError?'FAILED':storageHealth.lastSuccessAt?'HEALTHY':'UNKNOWN',reason:storageHealth.lastError||'Persistência por snapshot atômico.',critical:true,expectedIntervalMs:60000,staleAfterMs:10*60000,activityAt:storageHealth.lastSuccessAt||storageHealth.lastFailureAt||at,metrics:{...storageHealth,lastPersistMs:performanceStats.lastPersistMs,lastPersistBytes:performanceStats.lastPersistBytes}});
 const collectionAge=lastCollectionAt?at-lastCollectionAt:null,collectionStatus=lastError?(lastCollectionAt?'DEGRADED':'UNAVAILABLE'):lastCollectionAt&&collectionAge<15*60000?'HEALTHY':lastCollectionAt?'DEGRADED':'UNKNOWN';
 await watchdog.beat('collection',{status:collectionStatus,reason:lastError||(!lastCollectionAt?'Coleta ainda não executada.':collectionStatus==='DEGRADED'?'Última coleta está atrasada.':'Coleta recente.'),critical:true,expectedIntervalMs:240000,staleAfterMs:15*60000,activityAt:lastCollectionAt||at,metrics:{lastPoll,lastCollectionAt}});
 const heartbeatAge=w.lastHeartbeat?at-w.lastHeartbeat:null,collectorConfigured=!!w.connected;let collectorStatus='UNKNOWN',collectorReason='Collector não conectado.';
 if(collectorConfigured){const skew=Number(w.clockSkewMs)||0,scanAt=Number(w.diagnostics?.lastScanAt),adjustedScanAt=Number.isFinite(scanAt)?scanAt+skew:null,scanAge=adjustedScanAt==null?null:Math.max(0,at-adjustedScanAt),observerKnown=w.diagnostics?.observerAttached!=null;if(!w.lastHeartbeat||heartbeatAge>90000){collectorStatus='UNAVAILABLE';collectorReason='Heartbeat do Collector ausente ou atrasado.';}else if(w.status==='WHATSAPP_WEB_STRUCTURE_CHANGED'){collectorStatus='FAILED';collectorReason='Estrutura do WhatsApp Web mudou; parser não é confiável.';}else if(observerKnown&&w.diagnostics.observerAttached===false){collectorStatus='FAILED';collectorReason='POSSIBLE_COLLECTION_FAILURE: heartbeat ativo, mas MutationObserver não está anexado ao WhatsApp Web.';}else if(scanAge!=null&&scanAge>120000){collectorStatus='DEGRADED';collectorReason='POSSIBLE_COLLECTION_FAILURE: heartbeat ativo, porém o último scan do parser está atrasado.';}else if(Math.abs(skew)>120000){collectorStatus='DEGRADED';collectorReason='Relógio do Collector diverge do servidor em mais de 2 minutos; latências e timestamps exigem cautela.';}else if(w.status==='CONNECTED'&&w.health?.whatsappDetected&&w.health?.lunarianDetected&&w.diagnostics?.domOk!==false){collectorStatus='HEALTHY';collectorReason='Heartbeat, observer/scan, WhatsApp Web e Lunarian validados.';}else if(['ERROR','DISCONNECTED'].includes(w.status)){collectorStatus='UNAVAILABLE';collectorReason=w.statusMessage||w.status;}else{collectorStatus='DEGRADED';collectorReason=w.statusMessage||w.status||'Collector parcialmente disponível.';}}
 await watchdog.beat('lunarian-collector',{status:collectorStatus,reason:collectorReason,critical:collectorConfigured,expectedIntervalMs:15000,staleAfterMs:90000,activityAt:w.lastHeartbeat||at,metrics:{coveragePct:w.coverage?.coveragePct??null,uptimePct:w.coverage?.uptimePct??null,lastRelevantMessage:w.lastRelevantMessage||null,clockSkewMs:w.clockSkewMs??null,lastScanAt:w.diagnostics?.lastScanAt??null,lastObserverEventAt:w.diagnostics?.lastObserverEventAt??null,observerAttached:w.diagnostics?.observerAttached??null}});
 await watchdog.beat('whatsapp-web',{status:collectorConfigured?(w.health?.whatsappDetected?'HEALTHY':collectorStatus==='FAILED'?'FAILED':'DEGRADED'):'UNKNOWN',reason:collectorConfigured?(w.health?.whatsappDetected?'WhatsApp Web detectado pelo adapter.':'WhatsApp Web não foi confirmado pelo último heartbeat.'):'Collector não configurado.',critical:collectorConfigured,expectedIntervalMs:15000,staleAfterMs:90000,activityAt:w.lastHeartbeat||at});
 await watchdog.beat('realtime',{status:'HEALTHY',reason:'Canal de atualização disponível; SSE local ou polling na hospedagem.',critical:false,expectedIntervalMs:60000,staleAfterMs:180000,activityAt:at,metrics:{clients:clients.size}});
 await watchdog.beat('queue-worker',{status:q.stalled.length?'DEGRADED':q.saturationPct>=90?'DEGRADED':'HEALTHY',reason:q.stalled.length?'Job ativo excedeu o tempo esperado.':q.saturationPct>=90?'Fila pesada próxima da capacidade.':'Fila pesada operacional.',critical:false,expectedIntervalMs:60000,staleAfterMs:180000,activityAt:q.lastCompletedAt||q.lastStartedAt||at,metrics:q});
 await watchdog.beat('persistent-outbox',{status:oq.oldestAgeMs>=10*60000||state.pipelineDeadLetters.some(x=>x.status==='failed'&&x.origin==='persistent_outbox')?'DEGRADED':'HEALTHY',reason:oq.oldestAgeMs>=10*60000?'Há trabalho crítico pendente há mais de 10 minutos.':'Outbox persistente operacional.',critical:true,expectedIntervalMs:60000,staleAfterMs:180000,activityAt:at,metrics:oq});
 let investigationStatus='HEALTHY',investigationReason='Investigation Engine respondeu ao snapshot.';try{investigation.publicState(state.settings.world);}catch(e){investigationStatus='FAILED';investigationReason=e.message;}if(state.operational.controls.investigationDisabled){investigationStatus='UNAVAILABLE';investigationReason='Kill switch ativo.';}
 await watchdog.beat('investigation-engine',{status:investigationStatus,reason:investigationReason,critical:true,expectedIntervalMs:60000,staleAfterMs:180000,activityAt:lastInvestigationTickAt||at});
 let predictionStatus='HEALTHY',predictionReason='Prediction Engine respondeu ao snapshot.';try{intelligence.snapshot(state.settings.world);}catch(e){predictionStatus='FAILED';predictionReason=e.message;}if(state.operational.controls.predictionDisabled){predictionStatus='UNAVAILABLE';predictionReason='Kill switch ativo.';}
 await watchdog.beat('prediction-engine',{status:predictionStatus,reason:predictionReason,critical:true,expectedIntervalMs:60000,staleAfterMs:180000,activityAt:h.lastPredictionAt||at,metrics:{lastPredictionAt:h.lastPredictionAt,eventCount:h.eventCount,forecastCount:h.forecastCount,models:h.models}});
 await watchdog.beat('cache',{status:cacheRow?(at-cacheRow.fetchedAt<15*60000?'HEALTHY':'DEGRADED'):'UNKNOWN',reason:cacheRow?'Cache em memória disponível.':'Cache ainda não populado.',critical:false,expectedIntervalMs:240000,staleAfterMs:20*60000,activityAt:cacheRow?.fetchedAt||at});
 const backupStatus=backup.lastBackupAt?(backup.lastRestoreTest?.ok&&at-backup.lastBackupAt<12*3600000?'HEALTHY':'DEGRADED'):'UNKNOWN';
 await watchdog.beat('backup',{status:backupStatus,reason:backup.lastBackupAt?(backup.lastRestoreTest?.ok?'Backup recente com restore test.':'Backup existe, mas restore test ainda não foi validado.'):'Backup automático ainda não executado.',critical:false,expectedIntervalMs:6*3600000,staleAfterMs:12*3600000,activityAt:backup.lastRestoreTestAt||backup.lastBackupAt||at,metrics:backup});
 await watchdog.beat('integrity-audit',{status:integrity?(integrity.criticalIssues?'FAILED':integrity.highIssues?'DEGRADED':'HEALTHY'):'UNKNOWN',reason:integrity?(integrity.criticalIssues?'Auditoria encontrou problema crítico.':integrity.highIssues?'Auditoria encontrou inconsistências não críticas.':'Integridade validada.'):'Auditoria ainda não executada.',critical:true,expectedIntervalMs:5*60000,staleAfterMs:15*60000,activityAt:state.operational.integrity.lastRunAt||at,metrics:integrity?{criticalIssues:integrity.criticalIssues,highIssues:integrity.highIssues,totalIssues:integrity.totalIssues}:{}});
 for(const src of h.sources||[]){const status=!src.active?'UNKNOWN':src.circuitState==='OPEN'?'UNAVAILABLE':src.circuitState==='HALF_OPEN'?'RECOVERING':src.lastError?'DEGRADED':src.lastSuccess?'HEALTHY':'UNKNOWN';await watchdog.beat('source:'+src.id,{status,reason:src.lastError||(!src.active?'Fonte desativada.':'Estado derivado das consultas reais.'),critical:false,expectedIntervalMs:240000,staleAfterMs:20*60000,activityAt:src.lastAttempt||src.lastSuccess||at,metrics:{reliability:src.reliability,latencyMs:src.averageLatencyMs,circuitState:src.circuitState,successRate:src.successRate}});}
 return {w,h,q,oq};
}
async function sampleReliability(at=Date.now()){
 if(lastReliabilitySampleAt&&at-lastReliabilitySampleAt<5*60000)return;const health=watchdog.publicState(at),w=whatsapp.publicState(),q=heavyQueue.stats(),oq=outboxStats(state,at),snap=intelligence.snapshot(state.settings.world),components=health.components||[],known=components.filter(x=>x.effectiveStatus!=='UNKNOWN'),healthy=known.filter(x=>x.effectiveStatus==='HEALTHY').length;
 recordReliabilitySample(state,{reliabilityScore:health.score,healthyComponentPct:known.length?Math.round(1000*healthy/known.length)/10:null,coveragePct:w.coverage?.coveragePct??null,errorCount:structured.errorsSince(86400000).length,captureLatencyP95:w.metrics?.backendDeliveryLatency?.p95??null,predictionLatencyMs:snap.observability?.prediction_latency??null,queueOldestAgeMs:q.oldestPendingAgeMs||0,outboxOldestAgeMs:oq.oldestAgeMs||0,candidates:w.candidates?.length??w.metrics?.candidateEvents??0,confirmedEvents:(snap.events||[]).filter(x=>/^confirmed_/.test(x.status)).length,dataQuality:snap.metrics?.dataQualityScore??null,predictionAccuracy:snap.metrics?.windowAccuracy??null},at);
 lastReliabilitySampleAt=at;detectOperationalRegressions(state,at);buildDailySystemReport(state,at);buildWeeklyReview(state,at);await persist();
}
function systemPublicState(at=Date.now()){
 const health=watchdog.publicState(at),dlq=state.pipelineDeadLetters.filter(x=>x.status==='failed').slice(0,200).map(x=>({id:x.id,name:x.name,error:x.error,attempts:x.attempts,at:x.at,origin:x.origin,priority:x.priority||'NORMAL',correlationId:x.correlationId||'',idempotencyKey:x.idempotencyKey||''}));
 return {...health,startupValidation:state.operational.startupValidation||null,startupRecovery:state.operational.startupRecovery||null,controls:state.operational.controls,backup:backupManager.publicState(),integrity:state.operational.integrity,outbox:outboxStats(state,at),deadLetters:dlq,configVersions:state.operational.configVersions.slice(0,100),regressions:(state.operational.regressions||[]).slice(0,100),dailyReport:(state.operational.dailyReports||[])[0]||{status:'INSUFFICIENT_DATA'},weeklyReview:(state.operational.weeklyReviews||[])[0]||{status:'INSUFFICIENT_DATA'},sampleCount:(state.operational.samples||[]).length};
}
const server=http.createServer(async(req,res)=>{
  try {
    if(!ALLOWED_HOSTS.has(String(req.headers.host||''))) return json(res,403,{error:'Host não autorizado'});
    const url=new URL(req.url,ORIGIN),remote=String(req.socket?.remoteAddress||req.headers['cf-connecting-ip']||'unknown');
    if(url.pathname==='/login'){
      if(!AUTH_REQUIRED){res.writeHead(303,{Location:'/'});res.end();return;}
      if(req.method==='GET'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'"});res.end(loginHtml());return;}
      if(req.method==='POST'){
        const rate=loginLimiter.check(remote);if(!rate.allowed)return json(res,429,{error:'Muitas tentativas. Aguarde alguns minutos.'});
        if(req.headers.origin&&req.headers.origin!==ORIGIN)return json(res,403,{error:'Origem inválida'});
        let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>10000)throw new Error('Login inválido');}
        const password=new URLSearchParams(raw).get('password')||'';
        if(!validPassword(password,SITE_PASSWORD)){res.writeHead(403,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(loginHtml('Senha incorreta.'));return;}
        const secure=PUBLIC_URL.protocol==='https:'?'; Secure':'';res.writeHead(303,{Location:'/', 'Set-Cookie':'boss_session='+issueSession(SITE_PASSWORD)+'; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200'+secure,'Cache-Control':'no-store'});res.end();return;
      }
      return json(res,405,{error:'Método não permitido'});
    }
    if(url.pathname.startsWith('/extension/')||url.pathname==='/api/community/evidence'){if(await whatsapp.handle(req,res,url))return;}
    if(AUTH_REQUIRED&&!validSession(req.headers.cookie,SITE_PASSWORD)){res.writeHead(303,{Location:'/login','Cache-Control':'no-store'});res.end();return;}
    const rate=apiLimiter.check(remote);if(!rate.allowed)return json(res,429,{error:'Limite temporário de requisições excedido'});
    if(req.method==='POST') {
      if(req.headers.origin!==ORIGIN || req.headers['x-boss-token']!==sessionToken) return json(res,403,{error:'Acesso não autorizado. Atualize a página.'});
      const input=await body(req);
      if(url.pathname==='/api/system/integrity/run'){const result=auditIntegrity(state);lastIntegrityRunAt=Date.now();const repairs=safeRepair(state,result);await persist();await syncOperationalHealth();await watchdog.check();return json(res,200,{result,repairs,system:systemPublicState()});}
      if(url.pathname==='/api/system/backup/run'){const meta=await backupManager.backup();const restore=await backupManager.restoreTest(meta.slot);lastBackupRunAt=Date.now();await persist();return json(res,200,{meta,restore});}
      if(url.pathname==='/api/system/backup/restore-test'){const restore=await backupManager.restoreTest(input.slot||null);await persist();return json(res,200,restore);}
      if(url.pathname==='/api/system/dlq/reprocess'){const item=requeueDeadLetter(state,state.pipelineDeadLetters,String(input.id||''));await persist();await drainOutbox(50);return json(res,200,{ok:true,item:{id:item.id,kind:item.kind,correlationId:item.correlationId}});}
      if(url.pathname==='/api/system/dlq/discard'){const row=discardDeadLetter(state,state.pipelineDeadLetters,String(input.id||''),input.reason||'');await persist();return json(res,200,{ok:true,id:row.id,status:row.status});}
      if(url.pathname==='/api/system/incident/resolve'){const row=await watchdog.resolve(String(input.id||''),{resolution:input.resolution,rootCause:input.rootCause});return json(res,200,row);}
      if(url.pathname==='/api/system/recovery/retry'){const result=await watchdog.retry(String(input.component||''));return json(res,200,result);}
      if(url.pathname==='/api/system/controls'){const controls=setOperationalControls(state,input,{actor:'site-admin'});await persist();await syncOperationalHealth();await watchdog.check();return json(res,200,{controls,system:systemPublicState()});}
      if(url.pathname==='/api/system/source'){const id=String(input.id||''),source=state.intelligence?.sources?.[id];if(!source)throw new Error('Fonte não encontrada');if(typeof input.active!=='boolean')throw new Error('Estado da fonte inválido');source.active=input.active;const disabled=new Set(state.operational.controls.disabledSources||[]);if(input.active)disabled.delete(id);else disabled.add(id);state.operational.controls.disabledSources=[...disabled];recordConfigVersion(state,'source:'+id,{active:input.active},{actor:'site-admin'});appendOperationalEvent(state,'SOURCE_KILL_SWITCH',{sourceId:id,active:input.active},{correlationId:'config:source:'+id});await persist();return json(res,200,{id,active:source.active});}
      if(url.pathname==='/api/system/config/rollback'){const row=state.operational.configVersions.find(x=>x.id===input.id);if(!row)throw new Error('Versão de configuração não encontrada');if(row.name==='operational-controls')setOperationalControls(state,row.value,{actor:'site-admin-rollback'});else if(row.name==='settings')state.settings=validSettings(row.value);else if(row.name.startsWith('source:')){const id=row.name.slice(7),source=state.intelligence?.sources?.[id];if(!source)throw new Error('Fonte da configuração não existe');source.active=!!row.value.active;}else throw new Error('Rollback automático não suportado para esta configuração');appendOperationalEvent(state,'CONFIG_ROLLBACK',{configId:row.id,name:row.name},{correlationId:'config:rollback'});await persist();return json(res,200,{ok:true,name:row.name});}
      if(url.pathname.startsWith('/api/whatsapp/')){const result=await whatsapp.control(url.pathname,input);if(!result)return json(res,404,{error:'Ação inválida'});broadcast('update',{});return json(res,200,result);}if(url.pathname==='/api/investigation/wait')return json(res,200,await investigation.wait(String(input.id||'')));if(url.pathname==='/api/investigation/backtest')return json(res,200,investigation.backtest());
      if(url.pathname==='/api/operations/action'){const world=WORLDS.includes(input.world)?input.world:state.settings.world,boss=String(input.boss||'').slice(0,140);if(!boss)throw new Error('Boss inválido');const result=applyAttentionAction(state,{world,boss,action:String(input.action||''),minutes:input.minutes});await persist();broadcast('update',{kind:'operations-attention',boss});return json(res,200,result);}
      if(url.pathname==='/api/operations/action-outcome'){const result=recordActionOutcome(state,{...input,world:WORLDS.includes(input.world)?input.world:state.settings.world});await persist();return json(res,200,result);}
      if(url.pathname==='/api/operations/replay'){const world=WORLDS.includes(input.world)?input.world:state.settings.world,startAt=Number(input.startAt),endAt=Number(input.endAt);if(!Number.isFinite(startAt)||!Number.isFinite(endAt)||endAt<startAt||endAt-startAt>31*86400000)throw new Error('Período de replay inválido');return json(res,200,operationsReplay(state,world,startAt,endAt));}
      if(url.pathname==='/api/settings') { const next=validSettings(input);recordConfigVersion(state,'settings',next,{actor:'site-admin'});state.settings=next;await persist();json(res,200,state.settings);void poll();return; }
      if(url.pathname==='/api/subscribe') {
        if(!allowedEndpoint(input.endpoint)||typeof input.keys?.p256dh!=='string'||typeof input.keys?.auth!=='string') throw new Error('Este navegador não forneceu uma inscrição de notificações suportada. Abra http://127.0.0.1:4317/ no Chrome, Edge ou Firefox e tente novamente.');
        if(Buffer.from(input.keys.p256dh,'base64url').length!==65 || Buffer.from(input.keys.auth,'base64url').length!==16) throw new Error('Chaves inválidas');
        if(!state.subscriptions.some(s=>s.endpoint===input.endpoint)) { if(state.subscriptions.length>=20) throw new Error('Limite de dispositivos atingido'); state.subscriptions.push({endpoint:input.endpoint,keys:input.keys}); }
        state.settings.enabled=true; await persist(); json(res,200,{ok:true}); void poll(); return;
      }
      if(url.pathname==='/api/unsubscribe') { state.subscriptions=state.subscriptions.filter(s=>s.endpoint!==input.endpoint); if(!state.subscriptions.length) state.settings.enabled=false; await persist(); return json(res,200,{ok:true}); }
      if(url.pathname==='/api/test') {
        const sub=state.subscriptions.find(s=>s.endpoint===input.endpoint); if(!sub) throw new Error('Ative as notificações neste navegador primeiro');
        const response=await sendPush(sub,{title:'Boss Radar',body:'Notificação de teste. Seu navegador está inscrito para receber alertas.',tag:'test-'+Date.now(),url:'/'},vapid);
        if(!response.ok) throw new Error(`Teste recusado (HTTP ${response.status})`); return json(res,200,{ok:true});
      }
      if(url.pathname==='/api/check') {
        if(typeof input.boss!=='string'||input.boss.length>120||!['vazio','encontrado','morto'].includes(input.result)) throw new Error('Checagem inválida');
        if(typeof input.id!=='string'||!/^[a-zA-Z0-9-]{10,80}$/.test(input.id))throw new Error('Identificador de checagem inválido');
        if(state.checks.some(c=>c.id===input.id))return json(res,200,{ok:true,id:input.id});
        const countKill=input.countKill===true&&input.result==='morto';
        const previous=resolvedProgress(input.boss,state.settings.progress[input.boss],bosstiary);
        if(countKill){const p=resolvedProgress(input.boss,state.settings.progress[input.boss],bosstiary);state.settings.progress[input.boss]=resolvedProgress(input.boss,{...p,kills:p.kills+1,known:true},bosstiary);}
        const savedCheck={id:input.id,boss:input.boss,world:state.settings.world,result:input.result,countKill,previousKills:previous.kills,previousKnown:previous.known,afterKills:previous.kills+1,at:Date.now(),origin:'manual',precision:'minute'};state.checks.unshift(savedCheck); state.checks=state.checks.slice(0,2000); await reliableIngestChecks([savedCheck]); await persist(); return json(res,200,{ok:true,id:input.id});
      }
      if(url.pathname==='/api/check/undo'){
        const check=state.checks.find(c=>c.id===input.id);if(!check)return json(res,200,{ok:true});
        if(check.countKill){const p=resolvedProgress(check.boss,state.settings.progress[check.boss],bosstiary);if(p.kills!==check.afterKills)throw new Error('A quantidade foi alterada depois deste registro. Ajuste o total em Meu progresso.');state.settings.progress[check.boss]=resolvedProgress(check.boss,{...p,kills:check.previousKills,known:check.previousKnown},bosstiary);}
        state.checks=state.checks.filter(c=>c.id!==input.id);await reliableRemoveChecks([check]);await persist();return json(res,200,{ok:true});
      }
      if(url.pathname==='/api/group-checks'){
        if(typeof input.batchId!=='string'||!/^[a-zA-Z0-9-]{10,80}$/.test(input.batchId))throw new Error('Rodada inválida');
        if(state.groupChecks.some(c=>c.batchId===input.batchId))return json(res,200,{added:0,duplicates:input.rows?.length||0});
        const names=[...new Set([...catalog.map(b=>b.name),...bosstiary.map(b=>b.name),...Object.keys(state.settings.progress)])];
        const rows=validateGroupRows(input,names,WORLDS),existing=new Set(state.groupChecks.map(checkKey)),fresh=rows.filter(c=>!existing.has(checkKey(c)));
        if(state.groupChecks.length+fresh.length>50000)throw new Error('Limite de 50 mil checagens. Exporte o histórico antes de continuar.');
        const stored=fresh.map((c,i)=>({...c,id:input.batchId+'-'+i,batchId:input.batchId,recordedAt:Date.now()}));state.groupChecks.unshift(...stored);await reliableIngestChecks(stored);await persist();broadcast('update',{});return json(res,200,{added:fresh.length,duplicates:rows.length-fresh.length});
      }
      if(url.pathname==='/api/group-checks/undo'){
        if(typeof input.batchId!=='string')throw new Error('Rodada inválida');const removed=state.groupChecks.filter(c=>c.batchId===input.batchId);state.groupChecks=state.groupChecks.filter(c=>c.batchId!==input.batchId);await reliableRemoveChecks(removed);await persist();broadcast('update',{});return json(res,200,{ok:true});
      }
      if(url.pathname==='/api/intelligence/correct'){const result=await intelligence.correct({eventId:input.eventId,at:input.at,reason:input.reason,actor:'site-admin'});return json(res,200,result);}
      if(url.pathname==='/api/intelligence/backtest'){const world=WORLDS.includes(input.world)?input.world:state.settings.world;const result=await heavyQueue.enqueue('backtest:'+world,async()=>intelligence.backtest(world));return json(res,200,result);}
      if(url.pathname==='/api/intelligence/simulate'){const world=WORLDS.includes(input.world)?input.world:state.settings.world;if(typeof input.boss!=='string'||input.boss.length>140)throw new Error('Boss inválido');return json(res,200,intelligence.simulate(input.boss,world));}
      if(url.pathname==='/api/intelligence/experiment'){const world=WORLDS.includes(input.world)?input.world:state.settings.world;if(!['robust_interval','empirical_survival','analog_state_interval'].includes(input.modelId))throw new Error('Modelo inválido');return json(res,200,await heavyQueue.enqueue('experiment:'+world,()=>intelligence.experiment(world,input.modelId),{payload:{world,modelId:input.modelId}}));}
      if(url.pathname==='/api/intelligence/ai-lab/create'){const world=WORLDS.includes(input.world)?input.world:state.settings.world;if(!['robust_interval','empirical_survival','graph_context_interval','analog_state_interval','server_save_context_interval'].includes(input.modelId))throw new Error('Modelo inválido');const result=await intelligence.labCreate({...input,world,createdBy:'site-admin'});return json(res,200,result);}
      if(url.pathname==='/api/intelligence/ai-lab/run'){const id=String(input.id||'');if(!/^EXP-[A-Z0-9-]{8,40}$/.test(id))throw new Error('Experiment ID inválido');const q=heavyQueue.stats();if(state.operational.safeMode.active)throw new Error('AI Lab pausado: Safe Mode operacional ativo.');if(q.saturationPct>=70||q.oldestPendingAgeMs>120000)throw new Error('AI Lab pausado: produção sob carga elevada.');const result=await heavyQueue.enqueue('ai-lab:'+id,()=>intelligence.labRun(id),{priority:'LOW',payload:{id}});return json(res,200,result);}
      if(url.pathname==='/api/intelligence/ai-lab/decision'){const id=String(input.id||'');if(!/^EXP-[A-Z0-9-]{8,40}$/.test(id))throw new Error('Experiment ID inválido');if(!['approve','reject','archive'].includes(input.decision))throw new Error('Decisão inválida');const result=await intelligence.labDecision(id,{decision:input.decision,reason:String(input.reason||'').slice(0,500),actor:'site-admin'});return json(res,200,result);}
      if(url.pathname==='/api/intelligence/ai-lab/rollback'){const world=WORLDS.includes(input.world)?input.world:state.settings.world;const boss=input.boss==null||input.boss===''?null:String(input.boss).slice(0,140);const result=await intelligence.labRollback({world,boss,reason:String(input.reason||'Rollback manual').slice(0,500),actor:'site-admin'});return json(res,200,result);}
      if(url.pathname==='/api/intelligence/retry'){const row=state.pipelineDeadLetters.find(x=>x.id===input.id&&x.status==='failed');if(!row||!row.name.startsWith('experiment:'))throw new Error('Falha não reprocessável por esta operação');const result=await heavyQueue.enqueue(row.name,()=>intelligence.experiment(row.payload.world,row.payload.modelId),{payload:row.payload});row.status='reprocessed';row.reprocessedAt=Date.now();await persist();return json(res,200,result);}
      if(url.pathname==='/api/intelligence/replay'){if(typeof input.forecastId!=='string'||input.forecastId.length>200)throw new Error('Previsão inválida');return json(res,200,intelligence.replay(input.forecastId));}
      if(url.pathname==='/api/intelligence/discovery/run'){const world=WORLDS.includes(input.world)?input.world:state.settings.world;return json(res,200,await heavyQueue.enqueue('discovery:'+world,()=>intelligence.discoveryWrite('run',{world})));}
      if(url.pathname==='/api/intelligence/discovery/historical'){const world=WORLDS.includes(input.world)?input.world:state.settings.world;return json(res,200,await heavyQueue.enqueue('historical:'+world,()=>intelligence.historical({...input,world})));}
      if(url.pathname.startsWith('/api/intelligence/discovery/')){const operation=url.pathname.split('/').at(-1);if(['candidate','review','sample','context','coverage','collector','collect','advance','dependency','red-team','knowledge','graph-query','evidence','schedule','automatic','discord','discord-collect'].includes(operation)){const world=WORLDS.includes(input.world)?input.world:state.settings.world;return json(res,200,await heavyQueue.enqueue('discovery-control:'+world,()=>intelligence.discoveryWrite(operation,{...input,world})));}}
      if(url.pathname==='/api/refresh') { await refresh(true); await poll(); return json(res,200,{ok:true}); }
      if(url.pathname==='/api/character/refresh') {await refreshCharacter(input.name||CHARACTER_NAME,true);return json(res,200,{ok:true});}
      if(url.pathname==='/api/characters/add') {
        const name=validateCharacterName(input.name);
        if(state.characters.length>=50)throw new Error('Limite de 50 personagens atingido');
        const found=await refreshCharacter(name);
        if(!state.characters.some(x=>x.toLowerCase()===found.player.name.toLowerCase()))state.characters.push(found.player.name);
        await persist();return json(res,200,{names:state.characters,name:found.player.name});
      }
      return json(res,404,{error:'Rota não encontrada'});
    }
    if(req.method!=='GET') return json(res,405,{error:'Método não permitido'});
    if(url.pathname==='/api/boss-maps'){const name=url.searchParams.get('name'),boss=catalog.find(b=>b.name===name)||bosstiary.find(b=>b.name===name);if(!boss)throw new Error('Boss desconhecido');let result=mapCache.get(name);if(!result||Date.now()-result.at>3600000){result={...await fetchBossMaps(name,boss.locations||[]),at:Date.now()};mapCache.set(name,result);}return json(res,200,result);}
    if(url.pathname==='/api/group-image'){const id=url.searchParams.get('id');if(!/^[a-f0-9]{64}$/.test(id||''))throw new Error('Imagem inválida');const image=state.whatsapp.images.find(i=>i.id===id);if(!image)return json(res,404,{error:'Imagem não encontrada'});const bytes=await readFile(join(DATA,'group-images',id));res.writeHead(200,{'Content-Type':image.type,'Cache-Control':'private, max-age=3600','X-Content-Type-Options':'nosniff'});res.end(bytes);return;}
    if(url.pathname==='/api/group-checks')return json(res,200,{records:state.groupChecks});
    if(url.pathname==='/api/health'||url.pathname==='/api/system/health'){await syncOperationalHealth();const h=intelligence.healthState(state.settings.world),w=whatsapp.publicState(),q=heavyQueue.stats(),legacy=buildHealth({lastPoll,lastCollectionAt,lastPredictionAt:h.lastPredictionAt,queue:q,sources:h.sources,whatsapp:w,clients:clients.size,storageMode:'legacy-file',storage:storageHealth,errors24h:structured.errorsSince(86400000).length});return json(res,200,{...legacy,system:systemPublicState(),performance:{...performanceStats}});}
    if(url.pathname==='/api/system/trace'){const id=String(url.searchParams.get('correlation_id')||'');if(!id||id.length>160)throw new Error('correlation_id inválido');return json(res,200,{correlationId:id,events:traceEvents(state,id)});}
    if(url.pathname==='/api/system/replay'){const id=String(url.searchParams.get('correlation_id')||'');if(!id||id.length>160)throw new Error('correlation_id inválido');return json(res,200,replayCorrelation(state,id));}
    if(url.pathname==='/api/investigation')return json(res,200,investigation.publicState(state.settings.world));
    if(url.pathname==='/api/operations'){const intel=intelligence.snapshot(state.settings.world);if(!state.operations?.current||state.operations.current.world!==state.settings.world)runDecisionCycle(state,{world:state.settings.world,intelligence:intel,investigation:investigation.publicState(state.settings.world),whatsapp:whatsapp.publicState(),system:{safeMode:state.operational.safeMode},settings:state.settings});return json(res,200,{...state.operations.current,metrics:operationsMetrics(state,intel,state.settings.world)});}
    if(url.pathname==='/api/intelligence/mlops')return json(res,200,intelligence.mlops(state.settings.world));
    if(url.pathname==='/api/intelligence/ai-lab')return json(res,200,intelligence.aiLab(state.settings.world));
    if(url.pathname==='/api/intelligence/discovery')return json(res,200,await heavyQueue.enqueue('discovery-dashboard:'+state.settings.world,()=>intelligence.discovery(state.settings.world)));
    if(url.pathname==='/api/logs')return json(res,200,{records:structured.recent(300)});
    if(url.pathname==='/api/characters')return json(res,200,{names:state.characters});
    if(url.pathname==='/api/character'){const name=validateCharacterName(url.searchParams.get('name')||CHARACTER_NAME);try{await refreshCharacter(name);}catch{}return json(res,200,{character:characterCache.get(name.toLowerCase())||null,error:characterErrors.get(name.toLowerCase())||null});}
    if(url.pathname==='/api/state') {
      const stateStarted=performance.now();let data=cache.get(state.settings.world); try {data=await refresh();} catch {}
      lastFrontendAt=Date.now();await watchdog.beat('frontend',{status:'HEALTHY',reason:'Painel solicitou estado com sucesso.',critical:false,expectedIntervalMs:60000,staleAfterMs:180000,activityAt:lastFrontendAt});const intelligent=intelligence.snapshot(state.settings.world),ops=runDecisionCycle(state,{world:state.settings.world,intelligence:intelligent,investigation:investigation.publicState(state.settings.world),whatsapp:whatsapp.publicState(),system:{safeMode:state.operational.safeMode},settings:state.settings}),payload={settings:state.settings,bosstiary,whatsapp:whatsapp.publicState(),investigation:investigation.publicState(state.settings.world),operations:{...ops,metrics:operationsMetrics(state,intelligent,state.settings.world)},system:systemPublicState(),data:data||null,error:lastError,lastPoll,subscriptions:state.subscriptions.length,log:state.log,checks:state.checks,groupChecks:state.groupChecks.filter(c=>c.world===state.settings.world).slice(0,500),groupPatterns:groupPatterns(state.groupChecks,state.settings.world),intelligence:intelligent,publicKey:vapid.publicKey,token:sessionToken,worlds:WORLDS};
      performanceStats.lastStateMs=Math.round((performance.now()-stateStarted)*10)/10;return json(res,200,payload);
    }
    if(url.pathname==='/api/events') {
      lastFrontendAt=Date.now();await watchdog.beat('frontend',{status:'HEALTHY',reason:'Cliente conectado ao canal realtime.',critical:false,expectedIntervalMs:60000,staleAfterMs:180000,activityAt:lastFrontendAt});
      res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'}); res.write(': connected\n\n'); clients.add(res);
      const timer=setInterval(()=>res.write(': keepalive\n\n'),20000); req.on('close',()=>{clients.delete(res);clearInterval(timer);}); return;
    }
    if(url.pathname==='/api/outfit'){
      const name=validateCharacterName(url.searchParams.get('name')),direction=Number(url.searchParams.get('direction')||2);
      if(!Number.isInteger(direction)||direction<0||direction>3)throw new Error('Direção inválida');
      const profile=characterCache.get(name.toLowerCase());if(!profile)throw new Error('Consulte o personagem primeiro');
      const p=profile.player,params=new URLSearchParams({type:String(p.looktype),head:String(p.lookhead||0),body:String(p.lookbody||0),legs:String(p.looklegs||0),feet:String(p.lookfeet||0),addons:String(p.lookaddons||0),direction:String(direction),animated:'1',walk:'1',size:'0'}),key=params.toString();
      let sprite=outfitCache.get(key);
      if(!sprite){const response=await fetch('https://rubinot.com.br/api/outfit?'+key,{signal:AbortSignal.timeout(15000)});if(!response.ok||!response.headers.get('content-type')?.startsWith('image/png'))throw new Error('Aparência indisponível');const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>2000000)throw new Error('Imagem muito grande');sprite={bytes};if(outfitCache.size>200)outfitCache.clear();outfitCache.set(key,sprite);}
      res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'public, max-age=3600','X-Content-Type-Options':'nosniff'});res.end(sprite.bytes);return;
    }
    const files={'/':'index.html','/sw.js':'sw.js','/logic.mjs':'logic.mjs','/bosstiary.mjs':'bosstiary.mjs','/boss-map-ui.mjs':'boss-map-ui.mjs','/group-checks.mjs':'group-checks.mjs','/group-ui.mjs':'group-ui.mjs','/whatsapp-ui.mjs':'whatsapp-ui.mjs','/notification-flow.mjs':'notification-flow.mjs','/character-ui.mjs':'character-ui.mjs','/intelligence-ui.mjs':'intelligence-ui.mjs','/discovery-ui.mjs':'discovery-ui.mjs','/system-health-ui.mjs':'system-health-ui.mjs','/ai-lab-ui.mjs':'ai-lab-ui.mjs','/knowledge-graph-ui.mjs':'knowledge-graph-ui.mjs','/app.js':'app.js','/styles.css':'styles.css'};
    if(url.pathname==='/boss-radar-extension.zip'){if(!extensionPackageCache)extensionPackageCache=await buildExtensionPackage(readFile,ROOT);res.writeHead(200,{'Content-Type':'application/zip','Content-Disposition':'attachment; filename="boss-radar-extension.zip"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(extensionPackageCache);return;}
    if(!files[url.pathname]) return json(res,404,{error:'Página não encontrada'});
    const content=await readFile(join(ROOT,files[url.pathname]));
    const type=url.pathname.endsWith('.css')?'text/css':url.pathname==='/'?'text/html':'application/javascript';
    res.writeHead(200,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https://cdn.rubinottools.com https://www.tibiawiki.com.br; connect-src 'self'; frame-src https://tibiamaps.io; object-src 'none'; base-uri 'self'; frame-ancestors 'self'"}); res.end(content);
  } catch(e) { const traceId=randomBytes(8).toString('hex');await structured.write('error','request',e.message,{method:req.method,url:req.url},traceId).catch(()=>{});json(res,400,{error:e.message,traceId}); }
});
const startupHandlers=outboxHandlers(),startupHandlerValidation=validatePendingOutboxHandlers(state,startupHandlers);if(!startupHandlerValidation.ok){appendOperationalEvent(state,'STARTUP_DEGRADED',{reason:'Outbox possui handlers ausentes.',missingHandlers:startupHandlerValidation.missingHandlers},{correlationId:'startup:outbox'});}
const startupOutboxBefore=outboxStats(state).pending,startupDlqBefore=state.pipelineDeadLetters.filter(x=>x.status==='failed').length;try{await drainOutbox(200);}catch(e){appendOperationalEvent(state,'STARTUP_OUTBOX_REPLAY_FAILED',{error:String(e.message||e).slice(0,500)},{correlationId:'startup:recovery'});}recordStartupRecovery(state,{outboxBefore:startupOutboxBefore,outboxAfter:outboxStats(state).pending,dlqBefore:startupDlqBefore,dlqAfter:state.pipelineDeadLetters.filter(x=>x.status==='failed').length});await persist();
server.listen(PORT,HOST,()=>{console.log(`Boss Radar: ${ORIGIN}\nEscutando em ${HOST}:${PORT}.\nA previsão é uma janela de checagem; não garante spawn.`); void poll();});
setInterval(()=>void poll(),60000).unref();

import test from 'node:test';
import assert from 'node:assert/strict';
import {ensureOperational,heartbeat,componentView,appendOperationalEvent,verifyOperationalEvents,traceEvents,openIncident,resolveIncident,incidentMetrics,evaluateSafeMode,reliabilitySummary,recoveryState} from './runtime/operational-state.mjs';
import {createWatchdog} from './runtime/watchdog.mjs';
import {enqueueOutbox,processOutbox,outboxStats,requeueDeadLetter,discardDeadLetter} from './runtime/outbox.mjs';
import {auditIntegrity,safeRepair} from './runtime/integrity.mjs';
import {createBackupManager} from './runtime/backup.mjs';

test('component health never reports stale heartbeat as healthy',()=>{
 const state={};ensureOperational(state);heartbeat(state,'collector',{status:'HEALTHY',critical:true,expectedIntervalMs:1000,staleAfterMs:3000},1000);
 assert.equal(componentView(state,'collector',2500).effectiveStatus,'HEALTHY');
 assert.equal(componentView(state,'collector',5001).effectiveStatus,'UNAVAILABLE');
});

test('reliability score stays unavailable until enough real components are measured',()=>{
 const state={};heartbeat(state,'a',{status:'HEALTHY'},1000);heartbeat(state,'b',{status:'HEALTHY'},1000);heartbeat(state,'c',{status:'HEALTHY'},1000);
 assert.equal(reliabilitySummary(state,1001).score,null);
 heartbeat(state,'d',{status:'HEALTHY'},1000);assert.equal(reliabilitySummary(state,1001).score,100);
});

test('operational event store is hash chained and traceable by correlation id',()=>{
 const state={};appendOperationalEvent(state,'MESSAGE_CAPTURED',{id:'m1'},{at:1000,correlationId:'trace-1'});appendOperationalEvent(state,'EVIDENCE_CREATED',{id:'e1'},{at:1001,correlationId:'trace-1'});
 assert.equal(verifyOperationalEvents(state).valid,true);assert.equal(traceEvents(state,'trace-1').length,2);
 state.operational.events[1].payload.id='tampered';assert.equal(verifyOperationalEvents(state).valid,false);
});

test('incidents are grouped instead of causing alert fatigue and metrics use resolved incidents',()=>{
 const state={};const a=openIncident(state,{component:'collector',kind:'HEARTBEAT_TIMEOUT',startedAt:1000},2000),b=openIncident(state,{component:'collector',kind:'HEARTBEAT_TIMEOUT'},2500);
 assert.equal(a.incident.id,b.incident.id);assert.equal(a.incident.occurrences,2);resolveIncident(state,a.incident.id,{autoRecovered:true,resolution:'ok'},5000);
 const m=incidentMetrics(state,6000);assert.equal(m.total,1);assert.equal(m.autoRecovered,1);assert.equal(m.mttdMs,1000);assert.equal(m.mttrMs,3000);
});

test('watchdog stops automatic recovery after three failed attempts',async()=>{
 const base=Date.now(),state={};heartbeat(state,'critical-worker',{status:'FAILED',reason:'injected',critical:true,expectedIntervalMs:1000,staleAfterMs:60000},base);
 const watchdog=createWatchdog({state,persist:async()=>{},broadcast:()=>{},recoveries:{'critical-worker':async()=>{throw new Error('still broken');}}});
 await watchdog.check(base);await watchdog.check(base+31000);await watchdog.check(base+160000);
 const r=recoveryState(state,'critical-worker');assert.equal(r.attempts,3);assert.equal(r.manualRequired,true);
});

test('safe mode caps confidence only as an operational policy and exposes reasons',()=>{
 const state={};heartbeat(state,'storage',{status:'FAILED',reason:'disk error',critical:true},1000);
 const safe=evaluateSafeMode(state,{},1001);assert.equal(safe.active,true);assert.equal(safe.level,'CRITICAL');assert.equal(safe.confidenceCap,55);assert.match(safe.note,/não representa recalibração/);
});

test('persistent outbox is idempotent and logically exactly once',async()=>{
 const state={},dead=[],calls=[];const first=enqueueOutbox(state,'critical',{id:1},{priority:'CRITICAL',idempotencyKey:'k1',correlationId:'trace-x'}),dup=enqueueOutbox(state,'critical',{id:1},{priority:'CRITICAL',idempotencyKey:'k1',correlationId:'trace-x'});
 assert.equal(first.item.id,dup.item.id);assert.equal(outboxStats(state).pending,1);
 await processOutbox(state,{critical:async payload=>{calls.push(payload.id);return {ok:true};}},{persist:async()=>{},deadLetters:dead});
 assert.deepEqual(calls,[1]);assert.equal(outboxStats(state).pending,0);
 const after=enqueueOutbox(state,'critical',{id:1},{priority:'CRITICAL',idempotencyKey:'k1'});assert.equal(after.duplicate,true);
});

test('persistent outbox moves repeated failures to replayable DLQ',async()=>{
 const state={},dead=[];const x=enqueueOutbox(state,'broken',{id:2},{idempotencyKey:'broken-2',maxAttempts:2}).item;
 await processOutbox(state,{broken:async()=>{throw new Error('boom');}},{persist:async()=>{},deadLetters:dead,at:Date.now()});
 state.operational.outbox.find(r=>r.id===x.id).nextAttemptAt=0;
 await processOutbox(state,{broken:async()=>{throw new Error('boom');}},{persist:async()=>{},deadLetters:dead,at:Date.now()+100000});
 assert.equal(dead.length,1);assert.equal(dead[0].origin,'persistent_outbox');
 const retried=requeueDeadLetter(state,dead,dead[0].id);assert.equal(retried.kind,'broken');assert.equal(dead[0].status,'reprocessed');
 retried.status='PENDING';const another={...dead[0],id:'dlq-discard',status:'failed'};dead.push(another);assert.equal(discardDeadLetter(state,dead,'dlq-discard','manual').status,'discarded');
});

test('integrity audit detects orphan candidate and contaminated training dataset',()=>{
 const badEvent={id:'bad',status:'unconfirmed',qualityStatus:'SUSPEITO',eventType:'appearance',evidence:[],estimatedAt:1000};
 const state={whatsapp:{communityEvidence:[],candidates:[{id:'c1',status:'CONFIRMED',evidenceIds:['missing']}],},groupChecks:[],intelligence:{events:[badEvent],forecasts:[],ledger:[],mlops:{datasets:{ds1:{id:'ds1',events:[badEvent]}}}}};
 const result=auditIntegrity(state,2000);assert.ok(result.criticalIssues>=2);assert.equal(result.trainingData.eligibleOnly,false);
});

test('safe repair never mutates confirmed events and only handles technical duplicate DLQ entries',()=>{
 const state={pipelineDeadLetters:[{id:'x',status:'failed'},{id:'x',status:'failed'}],intelligence:{events:[{id:'evt',status:'confirmed_manual',evidence:[{evidenceId:'e'}]}]}};
 const before=JSON.stringify(state.intelligence.events),audit={};const actions=safeRepair(state,audit,1000);assert.equal(JSON.stringify(state.intelligence.events),before);assert.equal(actions.length,1);
});

test('rotating backup is accepted only after a successful read/hash/parse restore test',async()=>{
 const files=new Map(),state={settings:{world:'Lunarian'},checks:[],intelligence:{events:[]},whatsapp:{candidates:[]}},writeFile=async(p,v)=>files.set(p,String(v)),readFile=async(p)=>{if(!files.has(p)){const e=new Error('missing');e.code='ENOENT';throw e;}return files.get(p);},rename=async(a,b)=>{files.set(b,files.get(a));files.delete(a);},mkdir=async()=>{};
 const b=createBackupManager({state,readFile,writeFile,rename,mkdir,dataDir:'/data'}),meta=await b.backup(6*3600000),restore=await b.restoreTest(meta.slot,6*3600000+1);assert.equal(restore.ok,true);
 files.set(meta.path,'corrupt');await assert.rejects(()=>b.restoreTest(meta.slot,6*3600000+2),/hash divergente/);
});

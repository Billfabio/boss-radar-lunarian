import assert from 'node:assert/strict';
import {ensureSources,noteSource,canAttemptSource,noteEvidenceOutcome} from '../sources/registry.mjs';
import {RateLimiter} from '../security/rate-limit.mjs';
import {TaskQueue} from '../runtime/task-queue.mjs';
import {makeObservation} from '../normalization/observations.mjs';
import {mergeObservation} from '../deduplication/events.mjs';
import {appendLedger,verifyLedger} from '../event-sourcing/ledger.mjs';

const sources=ensureSources({}),now=Date.now();
for(let i=0;i<3;i++)noteSource(sources,'otbosstracker',{ok:false,error:'fault-injection-offline',at:now+i});
assert.equal(canAttemptSource(sources,'otbosstracker',now+1000),false);
const retryAt=sources.otbosstracker.suspendedUntil+1;assert.equal(canAttemptSource(sources,'otbosstracker',retryAt),true);
noteSource(sources,'otbosstracker',{ok:true,records:1,at:retryAt+1});assert.equal(sources.otbosstracker.circuitState,'CLOSED');

for(let i=0;i<8;i++)noteEvidenceOutcome(sources,'rubinot-official',{correct:false,errorMs:4*3600000,precision:'minute',consistency:.1,at:retryAt+100+i});
assert.equal(sources['rubinot-official'].circuitState,'OPEN');assert.equal(sources['rubinot-official'].circuitReason,'quality');
const qualityRecoveryAt=sources['rubinot-official'].suspendedUntil+1;assert.equal(canAttemptSource(sources,'rubinot-official',qualityRecoveryAt),true);assert.equal(sources['rubinot-official'].circuitState,'HALF_OPEN');
noteSource(sources,'rubinot-official',{ok:true,records:1,at:qualityRecoveryAt+1});assert.equal(sources['rubinot-official'].circuitState,'HALF_OPEN');
for(let i=0;i<3;i++)noteEvidenceOutcome(sources,'rubinot-official',{correct:true,errorMs:2*60000,precision:'minute',consistency:.95,at:qualityRecoveryAt+2+i});
assert.equal(sources['rubinot-official'].circuitState,'CLOSED');assert.equal(sources['rubinot-official'].circuitReason,null);

const limiter=new RateLimiter({windowMs:1000,max:100});let rejected=0;for(let i=0;i<1000;i++)if(!limiter.check('load-client',now+i%10).allowed)rejected++;assert.equal(rejected,900);assert.equal(limiter.check('load-client',now+1001).allowed,true);

const queue=new TaskQueue({concurrency:1,maxPending:5});
await assert.rejects(queue.enqueue('failing-worker',async()=>{throw new Error('injected worker failure');}));
assert.equal(await queue.enqueue('recovery-worker',async()=>42),42);assert.equal(queue.stats().completed,1);assert.equal(queue.stats().failed,1);

const at=Date.now()-3600000,events=[],obs=makeObservation({evidenceId:'fault-idempotent',boss:'Fault Boss',world:'Lunarian',sourceId:'manual-panel',eventType:'kill',precision:'minute',estimatedAt:at,manual:true,confidence:.98});
mergeObservation(events,obs,sources);const duplicate=mergeObservation(events,obs,sources);assert.equal(duplicate.duplicate,true);assert.equal(events.length,1);assert.equal(events[0].evidence.length,1);
assert.throws(()=>makeObservation({evidenceId:'bad-time',boss:'Fault Boss',world:'Lunarian',sourceId:'manual-panel',eventType:'kill',precision:'minute',estimatedAt:Date.now()+2*86400000}),/Horário futuro inválido/);

const ledger=[];appendLedger(ledger,'before_restart',{eventId:'evt-1'},now);const restored=JSON.parse(JSON.stringify(ledger));assert.equal(verifyLedger(restored).valid,true);appendLedger(restored,'after_restart',{eventId:'evt-2'},now+1);assert.equal(verifyLedger(restored).valid,true);
console.log(JSON.stringify({kind:'fault-injection',sourceOfflineRecovery:true,sourceQualityDeteriorationQuarantine:true,rateLimitBurstProtection:true,queueRecovery:true,idempotency:true,invalidTimestampRejected:true,ledgerRestartRoundTrip:true,databaseFailure:'not-applicable-runtime-database-not-active',websocketFailure:'not-applicable-runtime-uses-sse-or-polling'},null,2));

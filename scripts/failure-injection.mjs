import assert from 'node:assert/strict';
import {ensureSources,noteSource,canAttemptSource} from '../sources/registry.mjs';
import {TaskQueue} from '../runtime/task-queue.mjs';
import {makeObservation} from '../normalization/observations.mjs';
import {mergeObservation} from '../deduplication/events.mjs';
import {appendLedger,verifyLedger} from '../event-sourcing/ledger.mjs';

const sources=ensureSources({}),now=Date.now();
for(let i=0;i<3;i++)noteSource(sources,'otbosstracker',{ok:false,error:'fault-injection-offline',at:now+i});
assert.equal(canAttemptSource(sources,'otbosstracker',now+1000),false);
const retryAt=sources.otbosstracker.suspendedUntil+1;assert.equal(canAttemptSource(sources,'otbosstracker',retryAt),true);
noteSource(sources,'otbosstracker',{ok:true,records:1,at:retryAt+1});assert.equal(sources.otbosstracker.circuitState,'CLOSED');

const queue=new TaskQueue({concurrency:1,maxPending:5});
await assert.rejects(queue.enqueue('failing-worker',async()=>{throw new Error('injected worker failure');}));
assert.equal(await queue.enqueue('recovery-worker',async()=>42),42);assert.equal(queue.stats().completed,1);assert.equal(queue.stats().failed,1);

const at=Date.now()-3600000,events=[],obs=makeObservation({evidenceId:'fault-idempotent',boss:'Fault Boss',world:'Lunarian',sourceId:'manual-panel',eventType:'kill',precision:'minute',estimatedAt:at,manual:true,confidence:.98});
mergeObservation(events,obs,sources);const duplicate=mergeObservation(events,obs,sources);assert.equal(duplicate.duplicate,true);assert.equal(events.length,1);assert.equal(events[0].evidence.length,1);
assert.throws(()=>makeObservation({evidenceId:'bad-time',boss:'Fault Boss',world:'Lunarian',sourceId:'manual-panel',eventType:'kill',precision:'minute',estimatedAt:Date.now()+2*86400000}),/Horário futuro inválido/);

const ledger=[];appendLedger(ledger,'before_restart',{eventId:'evt-1'},now);const restored=JSON.parse(JSON.stringify(ledger));assert.equal(verifyLedger(restored).valid,true);appendLedger(restored,'after_restart',{eventId:'evt-2'},now+1);assert.equal(verifyLedger(restored).valid,true);
console.log(JSON.stringify({kind:'fault-injection',sourceRecovery:true,queueRecovery:true,idempotency:true,invalidTimestampRejected:true,ledgerRestartRoundTrip:true,databaseFailure:'not-applicable-runtime-database-not-active',websocketFailure:'not-applicable-runtime-uses-sse-or-polling'},null,2));

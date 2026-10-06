import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {buildAdaptivePredictions} from '../prediction/adaptive-engine.mjs';
const H=3600000,DAY=86400000,bosses=20,events=[];const base=Date.now()-240*DAY;
for(let b=0;b<bosses;b++){let at=base+b*H;for(let i=0;i<80;i++){events.push({id:`load-${b}-${i}`,boss:'Load Boss '+b,world:'Lunarian',eventType:'kill',estimatedAt:at,status:'confirmed_auto',qualityStatus:'CONFIRMADO',dataQualityScore:90,confidence:.9,evidence:[{precision:'minute'}]});at+=(60+(b%5)*3+(i%7)-3)*H;}}
const mem0=process.memoryUsage().heapUsed,t0=performance.now(),predictions=buildAdaptivePredictions(events,'Lunarian',{}),inferenceMs=performance.now()-t0,payload=JSON.stringify({predictions}),payloadBytes=Buffer.byteLength(payload),mem1=process.memoryUsage().heapUsed;
assert.equal(predictions.length,bosses);assert.ok(inferenceMs<5000,'Construção do snapshot de previsões excedeu 5 segundos');
const levels=[10,100,1000,10000],rows=[];
for(const users of levels){const before=process.memoryUsage().heapUsed,t1=performance.now();let transferred=0;for(let i=0;i<users;i++)transferred+=payloadBytes;const elapsed=performance.now()-t1,after=process.memoryUsage().heapUsed;rows.push({virtualConsumers:users,snapshotFanoutMs:Math.round(elapsed*1000)/1000,avgLookupMs:Math.round(elapsed/users*1000000)/1000000,logicalTransferredMB:Math.round(transferred/104857.6)/10,heapDeltaMB:Math.round((after-before)/104857.6)/10});}
assert.ok(rows.at(-1).snapshotFanoutMs<1000,'Distribuição em memória do snapshot excedeu 1 segundo para 10 mil consumidores virtuais');
console.log(JSON.stringify({kind:'synthetic-core-load-benchmark',note:'Mede construção do snapshot preditivo e fan-out em memória. Não representa throughput HTTP, banco ou rede de produção.',events:events.length,bosses,inferenceMs:Math.round(inferenceMs*10)/10,payloadKB:Math.round(payloadBytes/102.4)/10,inferenceHeapDeltaMB:Math.round((mem1-mem0)/104857.6)/10,rows},null,2));

import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {predictAdaptive} from '../prediction/adaptive-engine.mjs';
const H=3600000,DAY=86400000,bosses=20,events=[];const base=Date.now()-240*DAY;
for(let b=0;b<bosses;b++){let at=base+b*H;for(let i=0;i<80;i++){events.push({id:`load-${b}-${i}`,boss:'Load Boss '+b,world:'Lunarian',eventType:'kill',estimatedAt:at,status:'confirmed_auto',qualityStatus:'CONFIRMADO',dataQualityScore:90,confidence:.9,evidence:[{precision:'minute'}]});at+=(60+(b%5)*3+(i%7)-3)*H;}}
const levels=[10,100,1000,10000],rows=[];for(const users of levels){const before=process.memoryUsage().heapUsed,t0=performance.now();for(let i=0;i<users;i++){const p=predictAdaptive(events,'Load Boss '+(i%bosses),'Lunarian',{});assert.ok(['ready','insufficient'].includes(p.status));}const elapsed=performance.now()-t0,after=process.memoryUsage().heapUsed;rows.push({virtualConsumers:users,totalMs:Math.round(elapsed*10)/10,avgMs:Math.round(elapsed/users*1000)/1000,heapDeltaMB:Math.round((after-before)/104857.6)/10});}
assert.ok(rows.at(-1).totalMs<30000,'Benchmark do motor excedeu 30 segundos para 10 mil consumidores virtuais');
console.log(JSON.stringify({kind:'synthetic-core-load-benchmark',note:'Não representa capacidade HTTP de produção nem banco de dados.',rows},null,2));

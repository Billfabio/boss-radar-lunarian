import assert from 'node:assert/strict';
import http from 'node:http';
import {performance} from 'node:perf_hooks';
import {buildAdaptivePredictions} from '../prediction/adaptive-engine.mjs';

const H=3600000,DAY=86400000,bosses=20,events=[],base=Date.now()-240*DAY;
for(let b=0;b<bosses;b++){let at=base+b*H;for(let i=0;i<80;i++){events.push({id:`load-${b}-${i}`,boss:'Load Boss '+b,world:'Lunarian',eventType:'kill',estimatedAt:at,status:'confirmed_auto',qualityStatus:'CONFIRMADO',dataQualityScore:90,confidence:.9,evidence:[{precision:'minute'}]});at+=(60+(b%5)*3+(i%7)-3)*H;}}

const mem0=process.memoryUsage().heapUsed,t0=performance.now(),predictions=buildAdaptivePredictions(events,'Lunarian',{}),inferenceMs=performance.now()-t0,payload=Buffer.from(JSON.stringify({predictions})),mem1=process.memoryUsage().heapUsed;
assert.equal(predictions.length,bosses);assert.ok(inferenceMs<5000,'Construção do snapshot de previsões excedeu 5 segundos');

const server=http.createServer((req,res)=>{if(req.url!=='/snapshot'){res.writeHead(404);res.end();return;}res.writeHead(200,{'content-type':'application/json','content-length':payload.length,'cache-control':'no-store'});res.end(payload);});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const port=server.address().port;

function oneRequest(){
 return new Promise(resolve=>{
  const started=performance.now();
  const req=http.get({host:'127.0.0.1',port,path:'/snapshot',agent:false},res=>{let bytes=0;res.on('data',c=>bytes+=c.length);res.on('end',()=>resolve({ok:res.statusCode===200&&bytes===payload.length,ms:performance.now()-started,bytes}));});
  req.setTimeout(5000,()=>req.destroy(new Error('timeout')));req.on('error',()=>resolve({ok:false,ms:performance.now()-started,bytes:0}));
 });
}
const percentile=(a,p)=>{if(!a.length)return null;const s=[...a].sort((x,y)=>x-y),i=Math.min(s.length-1,Math.floor((s.length-1)*p));return Math.round(s[i]*10)/10;};
async function runLevel(users){
 const concurrency=Math.min(users,250),latencies=[],before=process.memoryUsage().heapUsed,started=performance.now();let next=0,failures=0,bytes=0;
 async function worker(){while(true){const i=next++;if(i>=users)return;const r=await oneRequest();latencies.push(r.ms);bytes+=r.bytes;if(!r.ok)failures++;}}
 await Promise.all(Array.from({length:concurrency},worker));
 const elapsed=performance.now()-started,after=process.memoryUsage().heapUsed;
 return {virtualUsers:users,maxConcurrentConnections:concurrency,totalMs:Math.round(elapsed*10)/10,throughputRps:Math.round(users/(elapsed/1000)*10)/10,p50Ms:percentile(latencies,.5),p95Ms:percentile(latencies,.95),p99Ms:percentile(latencies,.99),failures,transferredMB:Math.round(bytes/104857.6)/10,heapDeltaMB:Math.round((after-before)/104857.6)/10};
}
const rows=[];for(const users of [10,100,1000,10000])rows.push(await runLevel(users));
await new Promise(resolve=>server.close(resolve));

assert.ok(rows.every(x=>x.failures===0),'Benchmark HTTP registrou falhas');
assert.ok(rows.find(x=>x.virtualUsers===1000).p95Ms<1000,'p95 excedeu 1s para 1.000 clientes virtuais');
assert.ok(rows.find(x=>x.virtualUsers===10000).p95Ms<2000,'p95 excedeu 2s para 10.000 clientes virtuais');
assert.ok(rows.find(x=>x.virtualUsers===10000).totalMs<60000,'10 mil requisições excederam 60s');

console.log(JSON.stringify({kind:'loopback-http-intelligence-load-benchmark',note:'Mede inferência e entrega HTTP real em loopback do snapshot preditivo. Não representa latência de Internet, banco externo ou APIs de terceiros.',events:events.length,bosses,inferenceMs:Math.round(inferenceMs*10)/10,payloadKB:Math.round(payload.length/102.4)/10,inferenceHeapDeltaMB:Math.round((mem1-mem0)/104857.6)/10,rows},null,2));

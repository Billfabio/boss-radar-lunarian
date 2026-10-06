import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {performance} from 'node:perf_hooks';
import {buildBossDictionary} from '../whatsapp-dictionary.mjs';

const catalog=JSON.parse(await readFile(new URL('../data/catalog.json',import.meta.url),'utf8')),bosstiary=JSON.parse(await readFile(new URL('../bosstiary.json',import.meta.url),'utf8'));
const dictionary=buildBossDictionary({catalog,bosstiary}),names=dictionary.entries.map(x=>x.name);
const code=await readFile(new URL('../edge-extension/collector-core.js',import.meta.url),'utf8'),ctx={globalThis:{},Date,Map,Set,Intl,console};vm.createContext(ctx);vm.runInContext(code,ctx);const core=ctx.globalThis.BossCollectorCore,compiled=core.compileDictionary(dictionary);
const normalize=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const oldMatch=text=>{const t=normalize(text);for(const name of names)if(t.includes(normalize(name)))return name;return null;};
const messages=Array.from({length:6000},(_,i)=>i%20===0?names[i%names.length]+' saiu agora':i%20===1?(names[i%names.length].replace(/r/i,'n')+' agora'):('boa noite grupo hunt loot trade '+i));
function measure(fn){global.gc?.();const before=process.memoryUsage().heapUsed,t0=performance.now();let matches=0;for(const msg of messages)if(fn(msg))matches++;const ms=performance.now()-t0;global.gc?.();return {ms:Math.round(ms*10)/10,matches,heapDeltaBytes:Math.max(0,process.memoryUsage().heapUsed-before),perMessageUs:Math.round(ms/messages.length*10000)/10};}
for(let i=0;i<2;i++){measure(oldMatch);measure(x=>core.match(x,compiled)[0]||null);}
const before=measure(oldMatch),after=measure(x=>core.match(x,compiled)[0]||null);
const result={kind:'synthetic-extension-filter-benchmark',messages:messages.length,bosses:names.length,before:{algorithm:'legacy normalized includes across boss names',...before},after:{algorithm:'compiled exact/alias + shape-indexed fuzzy',...after},architecture:{legacyPollingSeconds:20,currentMutationObserver:true,watchdogSeconds:60}};
console.log(JSON.stringify(result));
if(after.perMessageUs>250)throw new Error('Collector matcher excedeu 250 µs por mensagem no benchmark sintético.');
if(after.matches<before.matches)throw new Error('Collector otimizado perdeu recall em relação ao filtro legado no benchmark sintético.');

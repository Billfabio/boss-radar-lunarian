import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createWhatsAppSync} from './whatsapp-sync.mjs';
import {buildBossDictionary} from './whatsapp-dictionary.mjs';
import {mergeEvidence,enrichCandidate,latencyPercentiles} from './whatsapp-community.mjs';

async function classic(path){const code=await readFile(new URL(path,import.meta.url),'utf8'),ctx={globalThis:{},Date,Map,Set,Intl,console};vm.createContext(ctx);vm.runInContext(code,ctx);return ctx.globalThis;}
const dictionary={version:'v1',entries:[{boss_id:'feru',name:'Ferumbras',aliases:['feru']},{boss_id:'orsh',name:'Orshabaal',aliases:['orsha']}]};

test('collector core performs exact alias fuzzy matching and context classification',async()=>{
 const g=await classic('./edge-extension/collector-core.js'),core=g.BossCollectorCore,c=core.compileDictionary(dictionary);
 assert.equal(core.match('Ferumbras saiu',c)[0].matchType,'EXACT');
 assert.equal(core.match('feru saiu',c)[0].matchType,'ALIAS');
 const fuzzy=core.match('Ferunbras agora',c)[0];assert.equal(fuzzy.name,'Ferumbras');assert.equal(fuzzy.matchType,'FUZZY');assert.ok(fuzzy.similarity>.8);
 assert.equal(core.classify('Ferumbras?'),'QUESTION');assert.equal(core.classify('não saiu Ferumbras'),'NEGATION');assert.equal(core.classify('acho que Ferumbras sai hoje'),'SPECULATION');assert.equal(core.classify('confirmado Ferumbras'),'CONFIRMATION');assert.equal(core.classify('Ferumbras saiu'),'POSSIBLE_REPORT');
});

test('sanitized DOM extraction snapshot keeps high recall without matching irrelevant chat',async()=>{
 const g=await classic('./edge-extension/collector-core.js'),core=g.BossCollectorCore,c=core.compileDictionary(dictionary),fixture=JSON.parse(await readFile(new URL('./edge-extension/fixtures/lunarian-dom-snapshot.json',import.meta.url),'utf8'));
 for(const row of fixture.messages){const matches=core.match(row.text,c);assert.equal(matches[0]?.name||null,row.expectedBoss);assert.equal(core.classify(row.text),row.context);}
 assert.equal(fixture.group,'Lunarian');assert.notEqual(fixture.wrongGroup,'Lunarian');
});

test('WhatsApp adapter parses author and message timestamp without sending raw identity',async()=>{
 const g=await classic('./edge-extension/adapter.js'),a=g.BossWhatsAppAdapter,meta='[21:42, 07/10/2026] Jogador Teste: ';
 assert.equal(a.author(meta),'Jogador Teste');const t=a.timestamp(meta);assert.equal(t.date,'2026-10-07');assert.equal(t.time,'21:42');assert.ok(Number.isFinite(t.at));
});

test('community evidence groups same boss into one candidate and counts independent reporters',()=>{
 const candidates=[],rows=[];for(let i=0;i<4;i++){const e={id:'e'+i,world:'Lunarian',messageTimestamp:100000+i*30000,authorHash:String(i).repeat(16),contextClassification:i===3?'CONFIRMATION':'POSSIBLE_REPORT',bossCandidates:[{name:'Ferumbras',matchType:i===2?'FUZZY':'EXACT',similarity:i===2?.9:1}]};rows.push(e);mergeEvidence(candidates,e);}
 assert.equal(candidates.length,1);enrichCandidate(candidates[0],rows);assert.equal(candidates[0].messages,4);assert.equal(candidates[0].participants,4);assert.equal(candidates[0].exactMatches,3);assert.equal(candidates[0].fuzzyMatches,1);assert.ok(candidates[0].score>70);
});

test('community evidence never reaches intelligence before manual candidate confirmation',async()=>{
 const state={groupChecks:[],whatsapp:{},settings:{}},learned=[];const dict=()=>buildBossDictionary({catalog:[{name:'Ferumbras'}],bosstiary:[],aliases:{Ferumbras:['feru']}});
 const sync=createWhatsAppSync({state,persist:async()=>{},broadcast:()=>{},dictionary:dict,names:()=>['Ferumbras'],worlds:['Lunarian'],readBody:async req=>req.input,onRecords:async rows=>learned.push(...rows)});
 const pair=await sync.control('/api/whatsapp/pair-code',{}),origin='chrome-extension://'+'a'.repeat(32);
 const call=async(path,input,key)=>{let payload,status;const req={method:'POST',headers:{origin,'x-radar-key':key||''},input};const res={writeHead(n){status=n;},end(v){payload=JSON.parse(v);}};await sync.handle(req,res,new URL('http://127.0.0.1:4317'+path));return {status,...payload};};
 const paired=await call('/extension/pair',{code:pair.code,group:'Lunarian',world:'Lunarian',extensionVersion:'1.4.0'});
 assert.equal(paired.status,200);const at=Date.now()-60000,evidence=[0,1,2].map(i=>({messageFingerprint:String(i+1).repeat(64),bossCandidates:[{name:'Ferumbras',matchType:'EXACT',similarity:1}],messageTimestamp:at+i*1000,capturedTimestamp:Date.now(),authorHash:String(i+5).repeat(64),contextClassification:'POSSIBLE_REPORT',text:'Ferumbras saiu',normalizedText:'ferumbras saiu',extensionVersion:'1.4.0'}));
 const received=await call('/api/community/evidence',{group:'Lunarian',evidence},paired.key);assert.equal(received.status,200);assert.equal(state.groupChecks.length,0);assert.equal(learned.length,0);assert.equal(state.whatsapp.candidates.length,1);assert.equal(state.whatsapp.candidates[0].status,'PENDING');
 const id=state.whatsapp.candidates[0].id;await sync.control('/api/whatsapp/candidate-confirm',{id,at});assert.equal(state.groupChecks.length,1);assert.equal(learned.length,1);assert.equal(state.whatsapp.candidates[0].status,'CONFIRMED');
});

test('collector endpoint is idempotent and duplicate evidence does not create a second candidate',async()=>{
 const state={groupChecks:[],whatsapp:{}},dict=()=>buildBossDictionary({catalog:[{name:'Ferumbras'}]});
 const sync=createWhatsAppSync({state,persist:async()=>{},broadcast:()=>{},dictionary:dict,names:()=>['Ferumbras'],worlds:['Lunarian'],readBody:async req=>req.input});
 const pair=await sync.control('/api/whatsapp/pair-code',{}),origin='chrome-extension://'+'b'.repeat(32);let key;
 const call=async(path,input,k)=>{let p,status;const req={method:'POST',headers:{origin,'x-radar-key':k||''},input},res={writeHead(n){status=n;},end(v){p=JSON.parse(v);}};await sync.handle(req,res,new URL('http://x'+path));return {status,...p};};
 key=(await call('/extension/pair',{code:pair.code,group:'Lunarian',world:'Lunarian',extensionVersion:'1.4.0'})).key;const e={messageFingerprint:'c'.repeat(64),bossCandidates:[{name:'Ferumbras',matchType:'EXACT',similarity:1}],messageTimestamp:Date.now()-1000,capturedTimestamp:Date.now(),authorHash:'d'.repeat(64),contextClassification:'POSSIBLE_REPORT',text:'Ferumbras saiu',normalizedText:'ferumbras saiu'};
 await call('/api/community/evidence',{group:'Lunarian',evidence:[e]},key);await call('/api/community/evidence',{group:'Lunarian',evidence:[e]},key);assert.equal(state.whatsapp.communityEvidence.length,1);assert.equal(state.whatsapp.candidates.length,1);assert.equal(state.whatsapp.candidates[0].evidenceIds.length,1);
});

test('extension source uses MutationObserver instead of aggressive interval and least privileges remain bounded',async()=>{
 const content=await readFile(new URL('./edge-extension/content.js',import.meta.url),'utf8'),manifest=JSON.parse(await readFile(new URL('./edge-extension/manifest.json',import.meta.url),'utf8'));
 assert.match(content,/MutationObserver/);assert.doesNotMatch(content,/setInterval\s*\(/);assert.equal(manifest.manifest_version,3);assert.deepEqual(manifest.permissions.sort(),['alarms','storage']);assert.deepEqual(manifest.host_permissions.sort(),['http://127.0.0.1:4317/*','https://web.whatsapp.com/*'].sort());
});

test('latency percentiles are deterministic and do not invent samples',()=>{assert.deepEqual(latencyPercentiles([]),{count:0,p50:null,p95:null,p99:null});const r=latencyPercentiles([10,20,30,40,50]);assert.equal(r.p50,30);assert.equal(r.p95,40);assert.equal(r.p99,40);});


test('manual decisions learn pseudonymous reporter reputation and recurring fuzzy aliases only after confirmation',async()=>{
 const state={groupChecks:[],whatsapp:{}},dict=()=>buildBossDictionary({catalog:[{name:'Ferumbras'}],aliases:state.whatsapp?.aliases||{}});
 const sync=createWhatsAppSync({state,persist:async()=>{},broadcast:()=>{},dictionary:dict,names:()=>['Ferumbras'],worlds:['Lunarian'],readBody:async req=>req.input});
 const origin='chrome-extension://'+'e'.repeat(32),pair=await sync.control('/api/whatsapp/pair-code',{});
 const call=async(path,input,key)=>{let p,status;const req={method:'POST',headers:{origin,'x-radar-key':key||''},input},res={writeHead(n){status=n;},end(v){p=JSON.parse(v);}};await sync.handle(req,res,new URL('http://x'+path));return {status,...p};};
 const key=(await call('/extension/pair',{code:pair.code,group:'Lunarian',world:'Lunarian',extensionVersion:'1.4.0'})).key,base=Date.now()-3600000;
 const evidence=[0,1,2].map(i=>({messageFingerprint:(String(i+7)).repeat(64),bossCandidates:[{name:'Ferumbras',matchType:'FUZZY',similarity:.91,matched:'Ferunbras'}],messageTimestamp:base+i*20*60000,capturedTimestamp:base+i*20*60000+500,authorHash:String.fromCharCode(97+i).repeat(64),contextClassification:'POSSIBLE_REPORT',text:'Ferunbras saiu',normalizedText:'ferunbras saiu'}));
 await call('/api/community/evidence',{group:'Lunarian',evidence},key);assert.equal(state.whatsapp.candidates.length,3);
 for(const c of [...state.whatsapp.candidates])await sync.control('/api/whatsapp/candidate-confirm',{id:c.id,at:c.estimatedAt});
 const p=sync.publicState();assert.equal(p.aliasSuggestions.length,1);assert.equal(p.aliasSuggestions[0].alias,'Ferunbras');assert.equal(p.aliasSuggestions[0].reporters,3);
 assert.equal(p.candidates.find(c=>c.evidence[0].authorHash==='a'.repeat(64)).evidence[0].reporter.samples,1);
 const approved=await sync.control('/api/whatsapp/alias-approve',{boss:'Ferumbras',alias:'Ferunbras'});assert.ok(approved.dictionary.entries[0].aliases.includes('Ferunbras'));
});

test('heartbeat records collection gaps and distinguishes browser uptime from Lunarian coverage',async()=>{
 const state={groupChecks:[],whatsapp:{}},sync=createWhatsAppSync({state,persist:async()=>{},broadcast:()=>{},dictionary:()=>buildBossDictionary({catalog:[{name:'Ferumbras'}]}),names:()=>['Ferumbras'],worlds:['Lunarian'],readBody:async req=>req.input});
 const origin='chrome-extension://'+'f'.repeat(32),pair=await sync.control('/api/whatsapp/pair-code',{});
 const call=async(path,input,key)=>{let p,status;const req={method:'POST',headers:{origin,'x-radar-key':key||''},input},res={writeHead(n){status=n;},end(v){p=JSON.parse(v);}};await sync.handle(req,res,new URL('http://x'+path));return {status,...p};};
 const paired=await call('/extension/pair',{code:pair.code,group:'Lunarian',world:'Lunarian',extensionVersion:'1.4.0'}),now=Date.now();state.whatsapp.collector.lastHeartbeatAt=now-120000;
 await call('/extension/heartbeat',{group:'Lunarian',status:'DEGRADED',extensionVersion:'1.4.0',queueSize:0,metrics:{},diagnostics:{configured:'Lunarian',detected:'Lunarian',domOk:true,gapDetected:true,gapFrom:now-60000,gapTo:now-30000}},paired.key);
 const p=sync.publicState();assert.equal(p.health.browserConnected,true);assert.equal(p.health.lunarianDetected,true);assert.ok(p.coverage.gaps.some(g=>g.reason==='COLLECTION_GAP'));assert.ok(p.coverage.gaps.some(g=>g.reason==='DOM_COLLECTION_GAP'));
});

test('downloadable extension zip embeds the current packaged source files exactly',async()=>{
 const zip=await readFile(new URL('./boss-radar-extension.zip',import.meta.url)),files=['manifest.json','adapter.js','collector-core.js','background.js','content.js','popup.html','popup.js','popup.css','LEIA-ME.md'];
 for(const name of files){const source=await readFile(new URL('./edge-extension/'+name,import.meta.url));assert.ok(zip.indexOf(source)>=0,'ZIP desatualizado: '+name);}
});


test('one reporter repeating messages cannot mimic independent confirmations',()=>{
 const one=Array.from({length:20},(_,i)=>({id:'r'+i,world:'Lunarian',messageTimestamp:1000+i,authorHash:'a'.repeat(64),contextClassification:i%2?'CONFIRMATION':'POSSIBLE_REPORT',bossCandidates:[{name:'Ferumbras',matchType:'EXACT',similarity:1}]}));
 const many=Array.from({length:4},(_,i)=>({id:'m'+i,world:'Lunarian',messageTimestamp:2000+i,authorHash:String.fromCharCode(97+i).repeat(64),contextClassification:'CONFIRMATION',bossCandidates:[{name:'Ferumbras',matchType:'EXACT',similarity:1}]}));
 const c1=[],c2=[];for(const e of one)mergeEvidence(c1,e);for(const e of many)mergeEvidence(c2,e);enrichCandidate(c1[0],one);enrichCandidate(c2[0],many);
 assert.equal(c1[0].participants,1);assert.equal(c2[0].participants,4);assert.ok(c2[0].score>c1[0].score);
});

import test from 'node:test';
import {parseGroupText,validateGroupRows,groupPatterns,checkKey} from './group-checks.mjs';
import {extractObservations,createWhatsAppSync} from './whatsapp-sync.mjs';
import {decodeGroupImage} from './group-images.mjs';
import {mapCoordinates} from './boss-maps.mjs';
import {issueCookie,authenticated} from './cloud/auth.mjs';
test('group pictures validate real binary formats and reject scripts or oversized uploads',()=>{const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aEn0AAAAASUVORK5CYII=';assert.equal(decodeGroupImage(png).type,'image/png');assert.throws(()=>decodeGroupImage('data:image/svg+xml;base64,PHN2Zz4='));assert.throws(()=>decodeGroupImage('data:image/png;base64,'+Buffer.from('not an image').toString('base64')));});
test('wiki maps accept bounded coordinates and deduplicate only actual map markers',()=>{const html='<span class="map_frame_coord" style="display:none;">32836,32703,7:2</span><span class="map_frame_coord">32836,32703,7:2</span><span class="map_frame_coord">99999,1,7:2</span>';assert.equal(mapCoordinates(html).length,1);assert.equal(mapCoordinates(html)[0].coordinates.x,32836);});
test('hosted private session requires a signed, unexpired cookie and is invalidated by changing the password',()=>{const password='test-only-password-123',cookie=issueCookie(password,1000),request=new Request('https://example.workers.dev',{headers:{cookie:'boss_session='+cookie}});assert.equal(authenticated(request,password,2000),true);assert.equal(authenticated(request,'another-password-123',2000),false);assert.equal(authenticated(request,password,1000+8*86400000),false);});
import vm from 'node:vm';
test('WhatsApp adapter reads visible chat names instead of profile tooltips and preserves Brazilian timestamps at night',async()=>{
 const context=vm.createContext({});vm.runInContext(await readFile(new URL('./edge-extension/adapter.js',import.meta.url),'utf8'),context);const a=context.BossWhatsAppAdapter;
 const candidate=text=>({textContent:text,closest:()=>null});const doc={querySelector:selector=>selector==='#main header'?{querySelectorAll:()=>[candidate('Dados do perfil'),candidate('Boss Check Lunarian')]}:null};
 assert.equal(a.title(doc),'Boss Check Lunarian');assert.equal(a.title(doc,'boss check lunarian'),'Boss Check Lunarian');assert.equal(a.title(doc,'Outro grupo'),'');assert.equal(a.timestamp('[23:55, 05/10/2026] Pessoa:').date,'2026-10-05');assert.equal(a.timestamp('[9:12, 05/10/26] Pessoa:').time,'09:12');assert.equal(a.timestamp('[10:12 PM, 05/10/2026] Pessoa:').time,'22:12');assert.equal(a.timestamp('[10:12, 30/02/2026] Pessoa:').at,null);
 const node={matches:()=>false,querySelector:()=>({getAttribute:()=>'[09:12, 05/10/2026] Pessoa:'}),querySelectorAll:selector=>selector==='.selectable-text'?[{innerText:'Dharalion não estava',parentElement:{closest:()=>null}}]:[],getAttribute:()=> 'message-id'};assert.equal(a.extractNode(node).text,'Dharalion não estava');assert.equal(a.extractNode(node).time,'09:12');
});
test('WhatsApp accepts explicit results, preserves unknown reports and rejects plans, questions and delayed reports',()=>{
 const names=['Dharalion','Hirintror'];const base={date:'2026-10-04',time:'09:12'};
 const r=extractObservations({...base,text:'Não estavam:\nDharalion\nEstavam:\nHirintror'},names);assert.equal(r.rows.length,2);assert.equal(r.rows[0].result,'vazio');assert.equal(r.rows[1].result,'encontrado');
 for(const text of ['Dharalion','Vou checar Dharalion','Dharalion estava?','Ontem achei Dharalion','[Foto sem nome de boss]']){const p=extractObservations({...base,text},names);assert.equal(p.rows.length,0);assert.equal(p.pending,true);}
});
test('WhatsApp pairing restricts origin and group; sync is idempotent, atomic and never advances across a gap',async()=>{
 const state={groupChecks:[],settings:{progress:{Dharalion:{kills:4}}}},names=()=>['Dharalion'];let saved=0;
 const imageFiles=new Map();const sync=createWhatsAppSync({state,persist:async()=>saved++,broadcast:()=>{},names,worlds:['Lunarian'],readBody:async req=>req.input,saveImage:async(id,image)=>imageFiles.set(id,image.bytes)});
 const code=(await sync.control('/api/whatsapp/pair-code',{})).code;
 const origin='chrome-extension://'+'a'.repeat(32);
 const call=async(path,input,key,from=origin)=>{let result,code;const req={method:'POST',headers:{origin:from,'x-radar-key':key},input};const res={writeHead(n){code=n;},end(s){result=JSON.parse(s);}};await sync.handle(req,res,new URL('http://127.0.0.1:4317'+path));return {code,...result};};
 assert.equal((await call('/extension/pair',{code,group:'Bosses',world:'Lunarian'},null,'https://example.com')).code,403);
 const paired=await call('/extension/pair',{code,group:'Bosses',world:'Lunarian'});assert.equal(paired.code,200);
 const key=paired.key,id='b'.repeat(64),at=Date.parse('2026-10-04T09:12:00-03:00'),message={id,text:'Dharalion não estava',date:'2026-10-04',time:'09:12'};
 assert.equal((await call('/extension/sync',{group:'Outro grupo',messages:[message]},key)).code,400);
 const input={group:'Bosses',messages:[message],checkpoint:{id,at},coverage:'complete'};
 assert.equal((await call('/extension/sync',input,key)).added,1);assert.equal((await call('/extension/sync',input,key)).added,0);assert.equal(state.settings.progress.Dharalion.kills,4);assert.equal(state.groupChecks[0].text,undefined);assert.equal(sync.publicState().connection,undefined);
 assert.equal(sync.publicState().identified[0].boss,'Dharalion');assert.equal(sync.publicState().identified[0].empty,1);
 const picture={group:'Bosses',messageId:id,data:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aEn0AAAAASUVORK5CYII='};assert.equal((await call('/extension/image',picture,key)).code,200);await call('/extension/image',picture,key);assert.equal(imageFiles.size,1);assert.equal(sync.publicState().images[0].bosses[0],'Dharalion');assert.equal(sync.publicState().images[0].data,undefined);
 await call('/extension/sync',{group:'Bosses',messages:[{...message,id:'e'.repeat(64),text:'Dharalion'}]},key);assert.equal(sync.publicState().identified[0].pending,1);
 const count=state.groupChecks.length;const bad={...message,id:'c'.repeat(64),time:'10:12'};
 assert.equal((await call('/extension/sync',{...input,messages:[bad],checkpoint:{id:'bad',at}},key)).code,400);assert.equal(state.groupChecks.length,count);
 await call('/extension/sync',{...input,messages:[],coverage:'gap',checkpoint:{id:'d'.repeat(64),at:at+3600000}},key);assert.equal(state.whatsapp.checkpoint.id,id);assert.match(state.whatsapp.status,/incompleta/);
 await sync.control('/api/whatsapp/disconnect',{});assert.equal((await call('/extension/config',{group:'Bosses'},key)).code,400);assert.ok(saved>0);
});
test('group messages preserve explicit absence, presence, aliases and timestamp precision',()=>{
 const names=['Dharalion','Hirintror','Midnight Panther'];const rows=parseGroupText('Não estavam:\nDharalion\nHirintror\nEstavam:\npantera',names,{date:'2026-10-05'});
 assert.equal(rows.length,3);assert.equal(rows[0].result,'vazio');assert.equal(rows[2].result,'encontrado');assert.equal(rows[2].boss,'Midnight Panther');assert.equal(rows[0].time,'');
 const whatsapp=parseGroupText('[09:10, 05/10/2026] Pessoa: Dharalion não estava',names,{date:'2026-10-05'});assert.equal(whatsapp[0].boss,'Dharalion');assert.equal(whatsapp[0].time,'09:10');
 assert.equal(parseGroupText('Nome estranho',names,{date:'2026-10-05'})[0].boss,'');
});
test('group rounds reject invalid dates, duplicate observations and never carry personal kills',()=>{
 const input={world:'Lunarian',rows:[{boss:'Dharalion',date:'2026-10-05',time:'',result:'vazio',favorable:'yes',countKill:true}]};const records=validateGroupRows(input,['Dharalion'],['Lunarian'],Date.parse('2026-10-05T20:00:00-03:00'));
 assert.equal(records[0].precision,'day');assert.equal(records[0].time,null);assert.equal(records[0].countKill,undefined);assert.equal(checkKey(records[0]),checkKey({...records[0],recordedAt:123}));
 assert.throws(()=>validateGroupRows({...input,rows:[input.rows[0],input.rows[0]]},['Dharalion'],['Lunarian']));
 assert.throws(()=>validateGroupRows({...input,rows:[{...input.rows[0],date:'2026-02-30'}]},['Dharalion'],['Lunarian']));
 assert.throws(()=>validateGroupRows({...input,rows:[{...input.rows[0],date:'2099-01-01'}]},['Dharalion'],['Lunarian']));
});
test('patterns learn only from checked periods, collapse repeated reports and require comparative evidence',()=>{
 const record={boss:'Dharalion',world:'Lunarian',date:'2026-09-01',time:'09:10',result:'vazio',favorable:'yes',at:1};
 const one=groupPatterns([record,record,{...record,time:'10:00',result:'encontrado'}],'Lunarian')[0];assert.equal(one.total,1);assert.equal(one.found,1);assert.equal(one.recommended,null);
 const records=[];for(let i=1;i<=15;i++){const date='2026-09-'+String(i).padStart(2,'0');records.push({...record,date,time:'09:00',result:'encontrado'},{...record,date,time:'18:00',result:'vazio'});}
 const pattern=groupPatterns(records,'Lunarian')[0];assert.equal(pattern.recommended.start,9);assert.equal(pattern.total,30);assert.equal(pattern.days,15);
 assert.equal(groupPatterns(records,'Auroria').length,0);
 const day=groupPatterns([{...record,time:null}],'Lunarian')[0];assert.equal(day.hours.reduce((n,h)=>n+h.total,0),0);
});
import {STAGES,resolvedProgress,parseTotals} from './bosstiary.mjs';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import { instant,status,dueAlert,uniqueHistory } from './logic.mjs';
import { allowedEndpoint,createVapid } from './push.mjs';
import {normalizePublic} from './public-source.mjs';
import {bounded,activateNotifications} from './notification-flow.mjs';
import {mergeOfficial} from './official-source.mjs';
import {normalizeCharacter,validateCharacterName} from './character-source.mjs';
import {findRankings} from './highscores-source.mjs';
import {renderCharacter} from './character-ui.mjs';
test('verified completion targets replace old one-kill defaults and unknown categories never auto-complete',async()=>{
 const entries=JSON.parse(await readFile(new URL('./bosstiary.json',import.meta.url),'utf8'));
 assert.deepEqual(STAGES.Nemesis,[1,3,5]);assert.deepEqual(STAGES.Archfoe,[5,20,60]);assert.deepEqual(STAGES.Bane,[25,100,300]);
 const p=resolvedProgress('Dharalion',{kills:1,target:1,completed:true},entries);assert.equal(p.target,5);assert.equal(p.completed,false);
 assert.equal(resolvedProgress('Dharalion',{kills:5,known:true},entries).completed,true);
 assert.equal(resolvedProgress('Unknown',{kills:1,known:true},entries).completed,false);
 assert.equal(resolvedProgress('Midnight Panther',{kills:4,known:true},entries).category,'Bestiary');
 assert.equal(resolvedProgress('Midnight Panther',{kills:4,known:true},entries).completed,false);
 assert.equal(resolvedProgress('Feroxa',{kills:4,known:true},entries).target,5);
 assert.equal(new Set(entries.map(e=>e.name)).size,entries.length);
});
test('bulk past kills accept exact totals, reject ambiguous rows, duplicates and unknown bosses',()=>{
 const names=['Dharalion','Ferumbras'];assert.deepEqual(parseTotals('Dharalion; 3\nFerumbras = 5',names),[{name:'Dharalion',kills:3},{name:'Ferumbras',kills:5}]);
 assert.throws(()=>parseTotals('Dharalion; 1\nDharalion; 2',names));assert.throws(()=>parseTotals('Unknown; 5',names));assert.throws(()=>parseTotals('Dharalion; -1',names));
});
test('character lookup preserves public fields without importing private identifiers or inventing boss progress',()=>{
 const c=normalizeCharacter({player:{name:'Kena Rain',level:1108,vocation:'Master Sorcerer',world:'Lunarian',account_id:123,password:'private',achievementPoints:456},deaths:[]});
 assert.equal(c.player.level,1108);assert.equal(c.player.account_id,undefined);assert.equal(c.player.password,undefined);assert.equal(c.bosstiaryAvailable,false);
 const html=renderCharacter({character:c});assert.match(html,/1108|1\.108/);assert.match(html,/Bosstiary/);assert.doesNotMatch(html,/private/);
 assert.throws(()=>normalizeCharacter({player:{name:'Outro'}}),/não encontrado/);
});
test('additional characters are validated and missing rankings are not converted to zero',()=>{
 assert.equal(validateCharacterName(' Outro Char '),'Outro Char');assert.throws(()=>validateCharacterName('x'),/nome/);
 const c=normalizeCharacter({player:{name:'Outro Char',world:'Elysian'}},1000,'Outro Char');assert.equal(c.player.name,'Outro Char');
 const rows=findRankings([{category:'magic',players:[{name:'Outro Char',rank:10,value:'100'}]},{category:'shielding',players:[]},{category:'fishing',error:'HTTP 429'}],'outro char');
 assert.equal(rows[0].value,'100');assert.equal(rows[1].value,null);assert.equal(rows[1].status,'not-listed');assert.equal(rows[2].status,'unavailable');
});
test('notification permission timeout and push-service failure produce actionable errors',async()=>{
 await assert.rejects(bounded(new Promise(()=>{}),'tempo esgotado',5),/tempo esgotado/);
 const env={isSecureContext:true,PushManager:{},Notification:{permission:'granted'},navigator:{serviceWorker:{register:async()=>{},ready:Promise.resolve({pushManager:{getSubscription:async()=>null,subscribe:async()=>{throw new Error('Registration failed - push service error');}}})}}};
 let saved=false;await assert.rejects(activateNotifications(env,new Uint8Array(),async()=>{saved=true;}),/Chrome, Edge ou Firefox/);assert.equal(saved,false);
 env.navigator.serviceWorker.ready=Promise.resolve({pushManager:{getSubscription:async()=>null,subscribe:async()=>({toJSON:()=>({endpoint:'test'})})}});
 await activateNotifications(env,new Uint8Array(),async()=>{saved=true;});assert.equal(saved,true);
});
test('official counts add coverage without inventing zero rows or spawn dates',()=>{
 const data={bosses:[{name:'Fernfang'},{name:'Maw'}],pending:[]};
 const snapshot=mergeOfficial(data,{entries:[{race_name:'FERNFANG',creatures_killed_24h:0,creatures_killed_7d:1}]},{},1000);
 assert.equal(data.additionalCoverage,1);assert.equal(data.bosses[0].official.week,1);assert.equal(data.bosses[1].official,undefined);assert.equal(data.pending.length,0);
 mergeOfficial(data,{entries:[{race_name:'Fernfang',creatures_killed_24h:1,creatures_killed_7d:2}]},snapshot,2000);assert.equal(data.bosses[0].official.increase,true);
});
test('public daily history never creates a spawn hour, rejects stale records and matches catalogue names',()=>{
 const raw={updated:'05/10/2026 13:05',worlds:{lunarian:{demonLords:[],bosses:[{boss:'Diblis The Fair',status_key:'quente',txt_date:'01/10/2026 (aprox)',window_txt:'3-14',last_kills:[]}]}}};
 const now=Date.parse('2026-10-05T17:29:59-03:00');
 const data=normalizePublic(raw,'Lunarian',[{name:'Diblis the Fair'}],now);
 const p=data.pending[0];assert.equal(p.boss_name,'Diblis the Fair');assert.equal(p.predicted_window_start,undefined);assert.equal(status(p,now),'high');
 const config={enabled:true,leadMinutes:30,checkTime:'18:00',progress:{}};
 assert.equal(dueAlert(p,config,now),null);assert.equal(dueAlert(p,config,now+1000).kind,'round');
 assert.equal(dueAlert(p,config,Date.parse('2026-10-05T18:00:01-03:00')),null);
 assert.equal(dueAlert({...p,sourceStatus:'inicial'},config,now+1000),null);
 assert.throws(()=>normalizePublic({...raw,updated:'01/10/2026'},'Lunarian',[],now),/desatualizado/);
});
const prediction={boss_name:'Midnight Panther',world:'Lunarian',predicted_window_start:'2026-10-05T18:00:00-03:00',predicted_window_end:'2026-10-06T18:00:00-03:00'};
const settings={enabled:true,leadMinutes:30,progress:{},favoritesOnly:false};
test('alerts begin exactly 30 minutes before the window and stop after its end',()=>{
  const start=instant(prediction.predicted_window_start),end=instant(prediction.predicted_window_end);
  assert.equal(dueAlert(prediction,settings,start-1800001),null);
  assert.equal(dueAlert(prediction,settings,start-1800000).kind,'soon');
  assert.equal(dueAlert(prediction,settings,start).kind,'open');
  assert.equal(dueAlert(prediction,settings,end+1),null);
  assert.equal(dueAlert(prediction,settings,start-1800000).key,dueAlert(prediction,settings,start).key);
});
test('ambiguous timezone cannot trigger unattended alerts',()=>{
  const p={...prediction,predicted_window_start:'2026-10-05T18:00:00'};
  assert.equal(instant(p.predicted_window_start),null);assert.equal(status(p),'unknown');assert.equal(dueAlert(p,settings,instant(prediction.predicted_window_start)),null);
});
test('completed, muted and nonfavorite bosses are suppressed',()=>{
  const now=instant(prediction.predicted_window_start);
  assert.equal(dueAlert(prediction,{...settings,progress:{'Midnight Panther':{completed:true}}},now),null);
  assert.equal(dueAlert(prediction,{...settings,progress:{'Midnight Panther':{muted:true}}},now),null);
  assert.equal(dueAlert(prediction,{...settings,favoritesOnly:true},now),null);
});
test('duplicate historical lines do not inflate appearances',()=>{
  const row={world:'Lunarian',date:'2026-10-01T14:47:00'};
  assert.equal(uniqueHistory(Array(28).fill(row)).length,1);
  assert.equal(uniqueHistory([row,{...row,world:'Belaria'}]).length,2);
});
test('push endpoints reject arbitrary hosts and credentialed URLs',()=>{
  assert.equal(allowedEndpoint('https://fcm.googleapis.com/fcm/send/example'),true);
  assert.equal(allowedEndpoint('https://127.0.0.1/secret'),false);
  assert.equal(allowedEndpoint('https://fcm.googleapis.com.evil.example/push'),false);
  assert.equal(allowedEndpoint('https://user:password@fcm.googleapis.com/push'),false);
  const keys=createVapid();assert.equal(Buffer.from(keys.publicKey,'base64url').length,65);assert.equal(Buffer.from(keys.privateKey,'base64url').length,32);
});


import {ensureSources,sourceWeight,noteSource,canAttemptSource,noteEvidenceOutcome,sourcePublic} from './sources/registry.mjs';
import {makeObservation} from './normalization/observations.mjs';
import {mergeObservation} from './deduplication/events.mjs';
import {predictBoss} from './prediction/engine.mjs';
import {learnFromEvent,anomalyFor} from './learning/reliability.mjs';

test('intelligence deduplicates sighting and kill evidence into one event',()=>{
 const sources=ensureSources({});for(const s of Object.values(sources))s.effectiveWeight=sourceWeight(s);
 const events=[],at=Date.parse('2026-10-05T21:30:00-03:00');
 const seen=makeObservation({evidenceId:'seen-1',boss:'Ferumbras',world:'Lunarian',sourceId:'manual-panel',eventType:'appearance',precision:'minute',estimatedAt:at,manual:true,confidence:.98});
 const killed=makeObservation({evidenceId:'kill-1',boss:'Ferumbras',world:'Lunarian',sourceId:'whatsapp-group',eventType:'kill',precision:'minute',estimatedAt:at+5*60000,confidence:.85});
 mergeObservation(events,seen,sources);mergeObservation(events,killed,sources);
 assert.equal(events.length,1);assert.equal(events[0].eventType,'kill');assert.equal(events[0].evidence.length,2);assert.equal(events[0].status,'confirmed_manual');
});

test('prediction refuses exact likely time until enough precise history exists',()=>{
 const base=Date.parse('2026-09-01T12:00:00-03:00'),events=[];
 for(let i=0;i<6;i++)events.push({boss:'Dharalion',world:'Lunarian',eventType:'kill',estimatedAt:base+i*3*86400000,status:'confirmed_auto',confidence:.9,evidence:[{precision:'day'}]});
 const p=predictBoss(events,'Dharalion','Lunarian',base+20*86400000);
 assert.equal(p.status,'ready');assert.equal(p.likelyAt,null);assert.ok(p.windowEnd>p.windowStart);assert.ok(p.confidence<97);
});

test('prediction exposes likely time only after sufficient precise history',()=>{
 const base=Date.parse('2026-09-01T12:00:00-03:00'),events=[];
 for(let i=0;i<8;i++)events.push({boss:'Dharalion',world:'Lunarian',eventType:'kill',estimatedAt:base+i*72*3600000,status:'confirmed_auto',confidence:.92,evidence:[{precision:'minute'}]});
 const p=predictBoss(events,'Dharalion','Lunarian',base+30*86400000);
 assert.equal(p.status,'ready');assert.ok(Number.isFinite(p.likelyAt));assert.equal(p.preciseSamples,8);assert.ok(p.probability>=25&&p.probability<=94);
});

test('anomaly detector flags implausibly early repeat appearances',()=>{
 const base=Date.parse('2026-10-01T12:00:00-03:00');
 const events=[
  {boss:'Ferumbras',world:'Lunarian',eventType:'kill',estimatedAt:base,status:'confirmed_auto',confidence:.9,evidence:[{precision:'minute'}]},
  {boss:'Ferumbras',world:'Lunarian',eventType:'kill',estimatedAt:base+72*3600000,status:'confirmed_auto',confidence:.9,evidence:[{precision:'minute'}]},
  {boss:'Ferumbras',world:'Lunarian',eventType:'kill',estimatedAt:base+144*3600000,status:'confirmed_auto',confidence:.9,evidence:[{precision:'minute'}]}
 ];
 const prediction=predictBoss(events,'Ferumbras','Lunarian');
 const obsAt=base+145*3600000;const obs=makeObservation({evidenceId:'too-soon',boss:'Ferumbras',world:'Lunarian',sourceId:'whatsapp-group',eventType:'appearance',precision:'minute',estimatedAt:obsAt,sourceObservedAt:obsAt,processedAt:obsAt+60000,reportedAt:obsAt+60000,collectedAt:obsAt+60000,confidence:.8});
 assert.equal(anomalyFor(obs,events,prediction)?.kind,'too_soon');
});

test('dynamic source reliability updates all unevaluated evidence in confirmed event',()=>{
 const sources=ensureSources({});const beforeA=sources['otbosstracker'].alpha,beforeB=sources['whatsapp-group'].alpha,at=Date.now();
 const event={status:'confirmed_auto',estimatedAt:at,evidence:[
  {sourceId:'otbosstracker',precision:'minute',estimatedAt:at+60000,confidence:.8},
  {sourceId:'whatsapp-group',precision:'minute',estimatedAt:at+120000,confidence:.8}
 ]};
 learnFromEvent(event,sources);
 assert.ok(sources['otbosstracker'].alpha>beforeA);assert.ok(sources['whatsapp-group'].alpha>beforeB);
 assert.equal(event.evidence.every(x=>x.evaluated),true);
});


import {predictAdaptive,buildAdaptivePredictions} from './prediction/adaptive-engine.mjs';
import {resolveForecasts,adaptiveMethodWeight} from './learning/model-performance.mjs';
import {forecastMetrics} from './metrics/forecast-metrics.mjs';

test('adaptive engine gives recent interval influence when boss behavior changes',()=>{
 const H=3600000,base=Date.parse('2026-08-01T20:00:00-03:00'),events=[];let at=base;
 for(let i=0;i<12;i++){events.push({id:'old'+i,boss:'Change Boss',world:'Lunarian',eventType:'kill',estimatedAt:at,status:'confirmed_auto',confidence:.9,evidence:[{precision:'minute'}]});at+=72*H;}
 for(let i=0;i<8;i++){events.push({id:'new'+i,boss:'Change Boss',world:'Lunarian',eventType:'kill',estimatedAt:at,status:'confirmed_auto',confidence:.9,evidence:[{precision:'minute'}]});at+=60*H;}
 const p=predictAdaptive(events,'Change Boss','Lunarian',{});
 assert.equal(p.status,'ready');assert.ok(p.intervalRecentMs<p.intervalAverageMs);assert.ok(p.methods.find(x=>x.name==='recent_interval').weight>=p.methods.find(x=>x.name==='historical_interval').weight*.8);
});

test('forecast resolution learns method performance independently per boss',()=>{
 const models={},base=Date.parse('2026-10-01T20:00:00-03:00'),forecast={id:'f1',boss:'A',world:'Lunarian',baseEventId:'prev',baseEventAt:base-72*3600000,createdAt:base-71*3600000,windowStart:base-3600000,windowEnd:base+3600000,likelyAt:base-10*60000,methods:[{name:'recent_interval',predictedAt:base-5*60000},{name:'weekday',predictedAt:base-5*3600000}]};
 const event={id:'actual',boss:'A',world:'Lunarian',eventType:'kill',estimatedAt:base,startAt:base,endAt:base,status:'confirmed_auto',evidence:[{precision:'minute',estimatedAt:base}]};
 resolveForecasts([forecast],event,models);
 assert.ok(models['Lunarian|a'].methods.recent_interval.emaErrorMinutes<models['Lunarian|a'].methods.weekday.emaErrorMinutes);
 assert.equal(adaptiveMethodWeight(models,'B','Lunarian','recent_interval'),1);
});

test('rolling forecast metrics report 7 30 and 90 day windows',()=>{
 const now=Date.now(),mk=(days,hit,error)=>({world:'Lunarian',boss:'B',resolvedAt:now-days*86400000,windowHit:hit,errorMinutes:error});
 const m=forecastMetrics([mk(2,true,5),mk(15,false,20),mk(60,true,10),mk(120,true,2)],'Lunarian',now);
 assert.equal(m.days7.predictions,1);assert.equal(m.days30.predictions,2);assert.equal(m.days90.predictions,3);assert.equal(m.all.predictions,4);assert.equal(m.days30.windowAccuracy,50);
});


test('WhatsApp streams newly accepted records to intelligence callback immediately',async()=>{
 const state={groupChecks:[],settings:{progress:{}}};let streamed=[];
 const sync=createWhatsAppSync({state,persist:async()=>{},broadcast:()=>{},names:()=>['Dharalion'],worlds:['Lunarian'],readBody:async req=>req.input,onRecords:async rows=>{streamed.push(...rows);}});
 const code=(await sync.control('/api/whatsapp/pair-code',{})).code,origin='chrome-extension://'+'a'.repeat(32);
 const call=async(path,input,key)=>{let data,status;const req={method:'POST',headers:{origin,'x-radar-key':key},input};const res={writeHead(n){status=n;},end(v){data=JSON.parse(v);}};await sync.handle(req,res,new URL('http://127.0.0.1:4317'+path));return {status,...data};};
 const paired=await call('/extension/pair',{code,group:'Bosses',world:'Lunarian'});
 const id='f'.repeat(64),at=Date.parse('2026-10-05T10:10:00-03:00');
 await call('/extension/sync',{group:'Bosses',messages:[{id,text:'Dharalion encontrado',date:'2026-10-05',time:'10:10'}],checkpoint:{id,at},coverage:'complete'},paired.key);
 assert.equal(streamed.length,1);assert.equal(streamed[0].boss,'Dharalion');assert.equal(streamed[0].origin,'whatsapp');
});


import {runHistoricalBacktest} from './backtest/history.mjs';
import {TaskQueue} from './runtime/task-queue.mjs';
import {buildHealth} from './runtime/health.mjs';
import {recalculateForecastOutcome,rebuildBossModel} from './learning/model-performance.mjs';
import {issueSession,validSession} from './security/session.mjs';
import {RateLimiter} from './security/rate-limit.mjs';

test('daily observations on consecutive days remain separate events',()=>{
 const sources=ensureSources({});for(const src of Object.values(sources))src.effectiveWeight=sourceWeight(src);
 const events=[],d1=Date.parse('2026-10-01T12:00:00-03:00'),d2=Date.parse('2026-10-02T12:00:00-03:00');
 mergeObservation(events,makeObservation({evidenceId:'d1',boss:'Daily Boss',world:'Lunarian',sourceId:'otbosstracker',eventType:'kill',precision:'day',estimatedAt:d1,confidence:.7}),sources);
 mergeObservation(events,makeObservation({evidenceId:'d2',boss:'Daily Boss',world:'Lunarian',sourceId:'otbosstracker',eventType:'kill',precision:'day',estimatedAt:d2,confidence:.7}),sources);
 assert.equal(events.length,2);
});

test('manual correction becomes authoritative consolidated time',()=>{
 const sources=ensureSources({});for(const src of Object.values(sources))src.effectiveWeight=sourceWeight(src);
 const at=Date.parse('2026-10-01T20:00:00-03:00'),events=[];
 const first=makeObservation({evidenceId:'source',boss:'Correct Boss',world:'Lunarian',sourceId:'whatsapp-group',eventType:'kill',precision:'minute',estimatedAt:at,confidence:.8});
 const correction=makeObservation({evidenceId:'correction',boss:'Correct Boss',world:'Lunarian',sourceId:'manual-panel',eventType:'kill',precision:'minute',estimatedAt:at+11*60000,manual:true,confidence:.995,detail:{correction:true}});
 mergeObservation(events,first,sources);mergeObservation(events,correction,sources);
 assert.equal(events.length,1);assert.equal(events[0].estimatedAt,at+11*60000);assert.equal(events[0].status,'confirmed_manual');
});

test('source reliability waits for independent corroboration instead of self-scoring',()=>{
 const sources=ensureSources({}),before=sources['otbosstracker'].alpha,at=Date.now();
 const event={status:'confirmed_auto',estimatedAt:at,evidence:[{sourceId:'otbosstracker',precision:'minute',estimatedAt:at,confidence:.8}]};
 learnFromEvent(event,sources);
 assert.equal(sources['otbosstracker'].alpha,before);assert.equal(event.evidence[0].evaluated,undefined);
 event.evidence.push({sourceId:'manual-panel',precision:'minute',estimatedAt:at+60000,confidence:.99,manual:true,detail:{correction:true},reportedAt:at+1000});
 learnFromEvent(event,sources);
 assert.ok(sources['otbosstracker'].alpha>before);assert.equal(event.evidence[0].referenceEvidence,'manual_correction');
});

test('walk-forward backtest evaluates only future event after minimum training history',()=>{
 const H=3600000,base=Date.parse('2026-01-01T20:00:00-03:00'),events=[];
 for(let i=0;i<12;i++)events.push({id:'bt'+i,boss:'Back Boss',world:'Lunarian',eventType:'kill',estimatedAt:base+i*72*H,status:'confirmed_auto',confidence:.9,evidence:[{precision:'minute'}]});
 const result=runHistoricalBacktest(events,'Lunarian',{minTrain:5});
 assert.equal(result.eventsEvaluated,7);assert.ok(result.predictionsEvaluated>=7);
 assert.equal(result.perBoss[0].testedEvents,7);assert.ok(result.perBoss[0].models.some(x=>x.model==='adaptive_ensemble'));
});

test('adaptive prediction exposes deterministic confidence breakdown summing to final score',()=>{
 const base=Date.parse('2026-01-01T20:00:00-03:00'),events=[];
 for(let i=0;i<12;i++)events.push({id:'cf'+i,boss:'Confidence Boss',world:'Lunarian',eventType:'kill',estimatedAt:base+i*72*3600000,status:'confirmed_auto',confidence:.9,evidence:[{precision:'minute'}]});
 const p=predictAdaptive(events,'Confidence Boss','Lunarian',{});
 assert.equal(p.status,'ready');assert.ok(p.confidenceBreakdown);
 const total=p.confidenceBreakdown.dataQuality+p.confidenceBreakdown.history+p.confidenceBreakdown.modelAgreement+p.confidenceBreakdown.sourceReliability+p.confidenceBreakdown.temporalQuality+p.confidenceBreakdown.stability;
 assert.ok(Math.abs(total-p.confidence)<=1);
});

test('task queue bounds pending work and reports health truthfully',async()=>{
 const q=new TaskQueue({concurrency:1,maxPending:1});let release;const gate=new Promise(r=>release=r);
 const a=q.enqueue('a',()=>gate),b=q.enqueue('b',async()=>2);assert.throws(()=>q.enqueue('c',async()=>3),/Fila de processamento cheia/);
 release(1);assert.equal(await a,1);assert.equal(await b,2);assert.equal(q.stats().completed,2);
 const health=buildHealth({lastPoll:Date.now(),lastCollectionAt:Date.now(),lastPredictionAt:Date.now(),queue:q.stats(),sources:[],whatsapp:{connected:true},clients:1,errors24h:0});
 assert.equal(health.services.api.status,'ONLINE');assert.equal(health.services.whatsapp.status,'ONLINE');
});

test('forecast metrics flags significant recent deterioration only with enough evidence',()=>{
 const now=Date.now(),rows=[];
 for(let i=0;i<20;i++)rows.push({world:'Lunarian',boss:'D',resolvedAt:now-(8+i)*86400000,windowHit:true,errorMinutes:10});
 for(let i=0;i<6;i++)rows.push({world:'Lunarian',boss:'D',resolvedAt:now-i*86400000,windowHit:i===0,errorMinutes:40});
 const m=forecastMetrics(rows,'Lunarian',now);
 assert.equal(m.deterioration?.detected,true);assert.ok(m.deterioration.accuracyDrop>=15);
});


test('resolved forecast outcome is recalculated when actual event time is corrected',()=>{
 const base=Date.parse('2026-10-01T20:00:00-03:00'),forecast={id:'corr-f',boss:'Corr',world:'Lunarian',baseEventId:'before',baseEventAt:base-72*3600000,createdAt:base-71*3600000,resolvedAt:base+1000,windowStart:base-3600000,windowEnd:base+3600000,predictedCenterAt:base,likelyAt:base,methods:[{name:'recent_interval',predictedAt:base}]};
 const models={},first={id:'actual-corr',boss:'Corr',world:'Lunarian',eventType:'kill',estimatedAt:base+30*60000,startAt:base+30*60000,endAt:base+30*60000,status:'confirmed_manual',evidence:[{precision:'minute'}]};
 recalculateForecastOutcome(forecast,first);rebuildBossModel([forecast],models,'Corr','Lunarian');
 const before=forecast.errorMinutes;
 const corrected={...first,estimatedAt:base+5*60000,startAt:base+5*60000,endAt:base+5*60000,evidence:[{precision:'minute',manual:true,detail:{correction:true}}]};
 recalculateForecastOutcome(forecast,corrected);rebuildBossModel([forecast],models,'Corr','Lunarian');
 assert.equal(before,30);assert.equal(forecast.errorMinutes,5);assert.equal(models['Lunarian|corr'].methods.recent_interval.emaErrorMinutes,5);
});

test('day-only resolved forecast never fabricates minute error',()=>{
 const base=Date.parse('2026-10-01T12:00:00-03:00'),forecast={id:'day-f',boss:'Day',world:'Lunarian',baseEventId:'before',baseEventAt:base-72*3600000,createdAt:base-71*3600000,resolvedAt:base+1000,windowStart:base-6*3600000,windowEnd:base+6*3600000,predictedCenterAt:base,methods:[{name:'historical_interval',predictedAt:base}]};
 const event={id:'day-real',boss:'Day',world:'Lunarian',eventType:'kill',estimatedAt:base,startAt:Date.parse('2026-10-01T00:00:00-03:00'),endAt:Date.parse('2026-10-01T23:59:59-03:00'),status:'confirmed_auto',evidence:[{precision:'day'}]};
 recalculateForecastOutcome(forecast,event);
 assert.equal(forecast.errorMinutes,null);assert.equal(forecast.actualPrecision,'day');assert.equal(forecast.methods[0].actualErrorMinutes,null);
});

test('signed public session expires and changes with password',()=>{
 const now=Date.now(),cookie=issueSession('abcdefghijkl',now,1000);
 assert.equal(validSession('boss_session='+cookie,'abcdefghijkl',now+500),true);
 assert.equal(validSession('boss_session='+cookie,'abcdefghijkl',now+2000),false);
 assert.equal(validSession('boss_session='+cookie,'mnopqrstuvwx',now+500),false);
});

test('rate limiter rejects requests above configured window and resets later',()=>{
 const limiter=new RateLimiter({windowMs:1000,max:2});
 assert.equal(limiter.check('ip',0).allowed,true);assert.equal(limiter.check('ip',1).allowed,true);assert.equal(limiter.check('ip',2).allowed,false);assert.equal(limiter.check('ip',1001).allowed,true);
});


import {assessObservation} from './data-quality/engine.mjs';
import {predictionReadiness} from './prediction/abstention.mjs';
import {datasetVersion} from './prediction/version.mjs';
import {consensusForEvidence} from './consensus/engine.mjs';
import {calibrationReport,calibrateConfidence} from './learning/calibration.mjs';
import {detectDrift} from './learning/drift.mjs';
import {championChallengerReport} from './learning/champion.mjs';
import {probabilityDistribution} from './prediction/distribution.mjs';
import {appendLedger,verifyLedger} from './event-sourcing/ledger.mjs';
import {createIntelligence} from './intelligence/service.mjs';

test('data quality score rewards traceable precise evidence and quarantines weak anomalous evidence',()=>{
 const sources=ensureSources({});for(const src of Object.values(sources))src.effectiveWeight=sourceWeight(src);
 const at=Date.now(),good=makeObservation({evidenceId:'q-good',boss:'Q',world:'Lunarian',sourceId:'manual-panel',sourceRef:'boss-radar://panel',collectionMethod:'manual_panel',eventType:'kill',precision:'minute',estimatedAt:at,sourceObservedAt:at,collectedAt:at,reportedAt:at,processedAt:at,manual:true,confidence:.97});
 const bad=makeObservation({evidenceId:'q-bad',boss:'Q',world:'Lunarian',sourceId:'external-api',eventType:'kill',precision:'day',estimatedAt:at-30*86400000,reportedAt:at,processedAt:at,confidence:.3});bad.anomaly={kind:'impossible_outlier'};
 const a=assessObservation(good,{sources,events:[],now:at}),b=assessObservation(bad,{sources,events:[],now:at});
 assert.ok(a.score>=85);assert.ok(b.score<55);assert.equal(b.eligibleForLearning,false);
});

test('consensus accepts nearby precise sources and marks multi-hour disagreement as conflict',()=>{
 const sources=ensureSources({});for(const src of Object.values(sources))src.effectiveWeight=sourceWeight(src);
 const at=Date.now()-5*3600000,mk=(id,source,offset)=>{const observedAt=at+offset;const x=makeObservation({evidenceId:id,boss:'C',world:'Lunarian',sourceId:source,eventType:'kill',precision:'minute',estimatedAt:observedAt,processedAt:observedAt+60000,confidence:.9});x.quality={score:90,status:'CONFIRMADO',eligibleForLearning:true};return x;};
 const good=consensusForEvidence([mk('a','manual-panel',0),mk('b','whatsapp-group',5*60000)],sources);assert.equal(good.conflict,false);assert.ok(good.centerAt>=at&&good.centerAt<=at+5*60000);
 const bad=consensusForEvidence([mk('c','manual-panel',0),mk('d','whatsapp-group',4*3600000)],sources);assert.equal(bad.conflict,true);assert.equal(bad.status,'CONFLITANTE');
});

test('source circuit breaker opens after repeated failures and half-opens after cooldown',()=>{
 const sources=ensureSources({}),t=Date.now();for(let i=0;i<3;i++)noteSource(sources,'otbosstracker',{ok:false,error:'offline',at:t+i});
 assert.equal(sources.otbosstracker.circuitState,'OPEN');assert.equal(canAttemptSource(sources,'otbosstracker',t+1000),false);
 assert.equal(canAttemptSource(sources,'otbosstracker',sources.otbosstracker.suspendedUntil+1),true);assert.equal(sources.otbosstracker.circuitState,'HALF_OPEN');
 noteSource(sources,'otbosstracker',{ok:true,at:sources.otbosstracker.suspendedUntil+2});assert.equal(sources.otbosstracker.circuitState,'CLOSED');
});

test('confidence calibration reports empirical gaps and adjusts only after enough resolved forecasts',()=>{
 const rows=[];for(let i=0;i<30;i++)rows.push({world:'Lunarian',boss:'Cal',resolvedAt:i+1,confidenceRaw:90,windowHit:i<21});
 const report=calibrationReport(rows,'Lunarian','Cal');const bin=report.bins.find(x=>x.min===90);assert.equal(bin.samples,30);assert.equal(bin.actual,70);
 const calibrated=calibrateConfidence(90,rows,'Lunarian','Cal');assert.ok(calibrated.calibrated<90);assert.equal(calibrated.method,'empirical_beta_shrinkage');
});

test('drift detector identifies sustained interval regime change and reduces historical weight',()=>{
 const H=3600000,events=[];let at=Date.parse('2026-01-01T12:00:00-03:00');
 for(let i=0;i<20;i++){events.push({id:'old-d'+i,boss:'Drift',world:'Lunarian',eventType:'kill',estimatedAt:at,status:'confirmed_auto',qualityStatus:'CONFIRMADO',evidence:[{precision:'minute'}]});at+=72*H;}
 for(let i=0;i<10;i++){events.push({id:'new-d'+i,boss:'Drift',world:'Lunarian',eventType:'kill',estimatedAt:at,status:'confirmed_auto',qualityStatus:'CONFIRMADO',evidence:[{precision:'minute'}]});at+=54*H;}
 const d=detectDrift(events,'Drift','Lunarian');assert.equal(d.detected,true);assert.ok(d.historyWeightMultiplier<1);assert.ok(d.recentWeightMultiplier>1);
});

test('prediction abstains when sample is below minimum instead of inventing a time',()=>{
 const H=3600000,base=Date.now()-10*86400000,events=[];for(let i=0;i<4;i++)events.push({id:'abs'+i,boss:'Abstain',world:'Lunarian',eventType:'kill',estimatedAt:base+i*72*H,status:'confirmed_auto',qualityStatus:'CONFIRMADO',confidence:.9,dataQualityScore:90,evidence:[{precision:'minute'}]});
 const p=predictAdaptive(events,'Abstain','Lunarian',{});assert.equal(p.status,'insufficient');assert.match(p.reason,/DADOS INSUFICIENTES/);assert.equal(p.likelyAt,undefined);
});

test('probability distribution is normalized and has no fixed random filler',()=>{
 const at=Date.now(),rows=probabilityDistribution([{predictedAt:at,weight:1,normalizedWeight:.6},{predictedAt:at+30*60000,weight:.6,normalizedWeight:.4}],at,2*3600000,{slotMinutes:30,slots:8});
 const total=rows.reduce((n,x)=>n+x.probability,0);assert.ok(Math.abs(total-100)<=.2);assert.equal(rows.length,8);assert.ok(rows.every(x=>x.probability>=0));
});

test('champion challenger requires paired sample significance before recommending promotion',()=>{
 const base=Date.now(),small=[],large=[];
 for(let i=0;i<10;i++)small.push({id:'s'+i,boss:'Gov',world:'Lunarian',resolvedAt:base+i,errorMinutes:20,windowHit:true,challengers:[{name:'better',actualErrorMinutes:5,hit:true}]});
 assert.equal(championChallengerReport(small,'Gov','Lunarian').promotionRecommended,null);
 for(let i=0;i<60;i++)large.push({id:'l'+i,boss:'Gov',world:'Lunarian',resolvedAt:base+i,errorMinutes:25+(i%3),windowHit:i%3!==0,challengers:[{name:'better',actualErrorMinutes:8+(i%2),hit:true}]});
 assert.equal(championChallengerReport(large,'Gov','Lunarian').promotionRecommended,'better');
});

test('event ledger is append-only hash chained and detects tampering',()=>{
 const ledger=[];appendLedger(ledger,'evidence_received',{id:'1'},1);appendLedger(ledger,'event_corrected',{id:'1',at:2},2);assert.equal(verifyLedger(ledger).valid,true);
 ledger[0].payload.id='changed';assert.equal(verifyLedger(ledger).valid,false);
});

test('backtest exposes baselines and temporal development validation test cohorts',()=>{
 const H=3600000,events=[];let at=Date.parse('2026-01-01T10:00:00-03:00');for(let i=0;i<30;i++){events.push({id:'tb'+i,boss:'Temporal',world:'Lunarian',eventType:'kill',estimatedAt:at,status:'confirmed_auto',qualityStatus:'CONFIRMADO',confidence:.9,dataQualityScore:90,evidence:[{precision:'minute'}]});at+=(i>18?66:72)*H;}
 const r=runHistoricalBacktest(events,'Lunarian',{minTrain:5});assert.ok(r.overallModels.some(x=>x.model==='last_interval'));assert.ok(r.overallModels.some(x=>x.model==='recent_mean_10'));assert.ok(r.temporalValidation.development.predictions>0);assert.ok(r.temporalValidation.validation.predictions>0);assert.ok(r.temporalValidation.test.predictions>0);
});


test('consensus marks the explicit 21:42 versus 23:15 minute reports as conflicting',()=>{
 const sources=ensureSources({});for(const src of Object.values(sources))src.effectiveWeight=sourceWeight(src);
 const day='2026-10-06',a=Date.parse(day+'T21:42:00-03:00'),b=Date.parse(day+'T23:15:00-03:00');
 const mk=(id,source,at)=>{const x=makeObservation({evidenceId:id,boss:'Conflict Boss',world:'Lunarian',sourceId:source,sourceRef:'test://'+source,collectionMethod:'test',eventType:'kill',precision:'minute',estimatedAt:at,processedAt:at+60000,confidence:.9});x.quality={score:90,status:'CONFIRMADO',eligibleForLearning:true};return x;};
 const c=consensusForEvidence([mk('c-a','manual-panel',a),mk('c-b','whatsapp-group',b)],sources);
 assert.equal(c.conflict,true);assert.equal(c.status,'CONFLITANTE');assert.equal(c.conflictThresholdMs,45*60000);
});

test('unknown provenance fields do not receive traceability credit',()=>{
 const sources=ensureSources({}),at=Date.now();
 const known=makeObservation({evidenceId:'prov-known',boss:'P',world:'Lunarian',sourceId:'manual-panel',sourceRef:'boss-radar://panel',collectionMethod:'manual_panel',eventType:'kill',precision:'minute',estimatedAt:at,processedAt:at+1000,confidence:.9});
 const unknown=makeObservation({evidenceId:'prov-unknown',boss:'P',world:'Lunarian',sourceId:'manual-panel',sourceRef:'unknown',collectionMethod:'unknown',eventType:'kill',precision:'minute',estimatedAt:at,processedAt:at+1000,confidence:.9});
 const a=assessObservation(known,{sources,now:at+1000}),b=assessObservation(unknown,{sources,now:at+1000});
 assert.ok(a.components.provenance>b.components.provenance);assert.ok(a.score>b.score);
});

test('recent bad outcomes reduce source reputation and can quarantine an automatic source',()=>{
 const sources=ensureSources({}),before=sourceWeight(sources.otbosstracker),at=Date.now();
 for(let i=0;i<8;i++)noteEvidenceOutcome(sources,'otbosstracker',{correct:false,errorMs:6*3600000,precision:'minute',consistency:.1,at:at+i});
 const after=sourceWeight(sources.otbosstracker),pub=sourcePublic(sources).find(x=>x.id==='otbosstracker');
 assert.ok(after<before);assert.equal(sources.otbosstracker.circuitState,'OPEN');assert.equal(pub.recentAccuracy,0);assert.equal(pub.averageErrorMinutes,360);
});

test('coarse daily source records do not contaminate precise average timing error',()=>{
 const sources=ensureSources({});
 noteEvidenceOutcome(sources,'otbosstracker',{correct:true,errorMs:12*3600000,precision:'day',consistency:.8,updateCircuit:false});
 noteEvidenceOutcome(sources,'otbosstracker',{correct:true,errorMs:5*60000,precision:'minute',consistency:.9,updateCircuit:false});
 const row=sourcePublic(sources).find(x=>x.id==='otbosstracker');
 assert.equal(row.preciseEvaluatedRecords,1);assert.equal(row.averageErrorMinutes,5);
});

test('prediction readiness abstains on low quality even with a large history',()=>{
 const r=predictionReadiness({sampleSize:100,preciseSamples:90,dataQuality:.42,predictionScore:90,anomalyRate:0,agreement:.9,uncertaintyMs:3600000,intervalMedianMs:72*3600000});
 assert.equal(r.canPredictWindow,false);assert.ok(r.reasons.some(x=>/qualidade dos dados/.test(x)));
});

test('dataset version changes when an older confirmed event is corrected',()=>{
 const base=Date.parse('2026-01-01T12:00:00-03:00'),events=[
  {id:'v1',boss:'Version Boss',world:'Lunarian',eventType:'kill',status:'confirmed_auto',qualityStatus:'CONFIRMADO',estimatedAt:base,updatedAt:base},
  {id:'v2',boss:'Version Boss',world:'Lunarian',eventType:'kill',status:'confirmed_auto',qualityStatus:'CONFIRMADO',estimatedAt:base+72*3600000,updatedAt:base+72*3600000}
 ];
 const before=datasetVersion(events,'Version Boss','Lunarian');events[0].estimatedAt+=5*60000;events[0].updatedAt+=10;const after=datasetVersion(events,'Version Boss','Lunarian');
 assert.notEqual(before,after);
});

test('calibration report exposes ECE MCE and Brier without fabricating samples',()=>{
 const rows=[];for(let i=0;i<40;i++)rows.push({world:'Lunarian',boss:'Metric Boss',resolvedAt:i+1,confidenceRaw:80,confidence:80,windowHit:i<28});
 const r=calibrationReport(rows,'Lunarian','Metric Boss');
 assert.equal(r.samples,40);assert.ok(Number.isFinite(r.ece));assert.ok(Number.isFinite(r.mce));assert.ok(Number.isFinite(r.brier));assert.ok(r.brier>=0&&r.brier<=1);
});

test('champion promotion policy requires at least fifty paired results and material gain',()=>{
 const base=Date.now(),rows=[];
 for(let i=0;i<40;i++)rows.push({id:'cp'+i,boss:'Policy Boss',world:'Lunarian',resolvedAt:base+i,errorMinutes:30,windowHit:true,challengers:[{name:'candidate',actualErrorMinutes:5,hit:true}]});
 const r=championChallengerReport(rows,'Policy Boss','Lunarian');
 assert.equal(r.minSamples,50);assert.equal(r.promotionRecommended,null);assert.equal(r.promotionPolicy.minimumRelativeMaeImprovementPct,5);
});


test('robust anomaly detector quarantines an extreme late interval after stable history',()=>{
 const H=3600000,base=Date.parse('2026-01-01T12:00:00-03:00'),events=[];
 for(let i=0;i<12;i++)events.push({id:'late-'+i,boss:'Late Boss',world:'Lunarian',eventType:'kill',estimatedAt:base+i*72*H,status:'confirmed_auto',qualityStatus:'CONFIRMADO',confidence:.9,evidence:[{precision:'minute'}]});
 const obs=makeObservation({evidenceId:'late-outlier',boss:'Late Boss',world:'Lunarian',sourceId:'whatsapp-group',eventType:'kill',precision:'minute',estimatedAt:events.at(-1).estimatedAt+300*H,confidence:.8});
 const anomaly=anomalyFor(obs,events,null);
 assert.equal(anomaly?.kind,'interval_outlier_late');assert.ok(anomaly.thresholdMs<anomaly.deltaMs);
});


test('untraceable evidence is quarantined and never eligible for learning',()=>{
 const sources=ensureSources({}),at=Date.now()-60000;
 const obs=makeObservation({evidenceId:'no-origin',boss:'Trace Boss',world:'Lunarian',sourceId:'manual-panel',eventType:'kill',precision:'minute',estimatedAt:at,confidence:.95});
 const q=assessObservation(obs,{sources,now:Date.now()});
 assert.equal(q.traceable,false);assert.equal(q.eligibleForLearning,false);assert.equal(q.status,'AGUARDANDO_CONFIRMAÇÃO');assert.ok(q.score<=69);
});

test('walk-forward calibration never uses future outcomes from another boss',()=>{
 const H=3600000,events=[],early=Date.parse('2026-01-01T12:00:00-03:00'),late=Date.parse('2026-06-01T12:00:00-03:00');
 for(let i=0;i<28;i++)events.push({id:'z-'+i,boss:'Z Early',world:'Lunarian',eventType:'kill',estimatedAt:early+i*72*H,status:'confirmed_auto',qualityStatus:'CONFIRMADO',dataQualityScore:90,confidence:.9,evidence:[{precision:'minute'}]});
 for(let i=0;i<35;i++)events.push({id:'a-'+i,boss:'A Late',world:'Lunarian',eventType:'kill',estimatedAt:late+i*72*H,status:'confirmed_auto',qualityStatus:'CONFIRMADO',dataQualityScore:90,confidence:.9,evidence:[{precision:'minute'}]});
 const r=runHistoricalBacktest(events,'Lunarian',{minTrain:6});
 const firstEarly=r.recentResults.filter(x=>x.boss==='Z Early'&&x.model==='adaptive_ensemble').sort((a,b)=>a.actualAt-b.actualAt)[0];
 assert.ok(firstEarly);assert.equal(firstEarly.calibrationSamples,0);
});

test('health reports storage failure separately from API availability and recovery count',()=>{
 const h=buildHealth({lastPoll:Date.now(),lastCollectionAt:Date.now(),lastPredictionAt:Date.now(),queue:{},sources:[],whatsapp:{connected:true},clients:0,storage:{lastSuccessAt:Date.now()-1000,lastError:'disk full',recoveryCount:2}});
 assert.equal(h.services.api.status,'ONLINE');assert.equal(h.services.storage.status,'ERRO');assert.equal(h.services.storage.lastError,'disk full');assert.equal(h.services.storage.recoveryCount,2);
});


test('legacy duplicate can recover provenance idempotently without changing the observed fact',async()=>{
 const state={intelligence:{version:3,sources:{},events:[],audit:[],corrections:[],metricsHistory:[],forecasts:[],models:{},ledger:[]}};
 const intel=createIntelligence({state,persist:async()=>{},broadcast:()=>{}});
 const at=Date.now()-3600000;
 const old=makeObservation({evidenceId:'legacy-provenance',boss:'Legacy Boss',world:'Lunarian',sourceId:'otbosstracker',eventType:'kill',precision:'minute',estimatedAt:at,confidence:.9});
 const first=intel.addObservation(old,{allowAnomaly:false});assert.equal(first.duplicate,false);
 const event=state.intelligence.events[0],beforeAt=event.estimatedAt;assert.equal(event.evidence[0].quality.traceable,false);
 const fresh=makeObservation({evidenceId:'legacy-provenance',boss:'Legacy Boss',world:'Lunarian',sourceId:'otbosstracker',sourceRef:'https://otbosstracker.com/data/bosses.json',collectionMethod:'public_json',eventType:'kill',precision:'minute',estimatedAt:at,confidence:.9});
 const second=intel.addObservation(fresh,{allowAnomaly:false});
 assert.equal(second.duplicate,true);assert.equal(second.enriched,true);assert.equal(event.estimatedAt,beforeAt);assert.equal(event.evidence.length,1);assert.equal(event.evidence[0].quality.traceable,true);assert.equal(event.evidence[0].sourceRef,'https://otbosstracker.com/data/bosses.json');
 assert.ok(state.intelligence.ledger.some(x=>x.type==='evidence_provenance_enriched'));
});


test('calibration can isolate results from the active model version',()=>{
 const rows=[];for(let i=0;i<30;i++)rows.push({world:'Lunarian',boss:'V',modelVersion:'old',resolvedAt:i+1,confidenceRaw:90,confidence:90,windowHit:false});
 for(let i=0;i<30;i++)rows.push({world:'Lunarian',boss:'V',modelVersion:'new',resolvedAt:100+i,confidenceRaw:90,confidence:90,windowHit:i<27});
 const all=calibrationReport(rows,'Lunarian','V'),current=calibrationReport(rows,'Lunarian','V',{modelVersion:'new'});
 assert.equal(all.samples,60);assert.equal(current.samples,30);assert.equal(current.bins.find(x=>x.min===90).actual,90);
 const c=calibrateConfidence(90,rows,'Lunarian','V',{modelVersion:'new'});assert.equal(c.samples,30);assert.ok(c.calibrated>=88);
});

test('champion challenger governance does not mix forecasts from old engine versions',()=>{
 const base=Date.now(),rows=[];
 for(let i=0;i<80;i++)rows.push({id:'old-g'+i,boss:'Version Gov',world:'Lunarian',modelVersion:'old',resolvedAt:base+i,errorMinutes:30,windowHit:true,challengers:[{name:'candidate',actualErrorMinutes:4,hit:true}]});
 for(let i=0;i<20;i++)rows.push({id:'new-g'+i,boss:'Version Gov',world:'Lunarian',modelVersion:'new',resolvedAt:base+1000+i,errorMinutes:10,windowHit:true,challengers:[{name:'candidate',actualErrorMinutes:9,hit:true}]});
 const g=championChallengerReport(rows,'Version Gov','Lunarian','adaptive_ensemble',{modelVersion:'new'});
 assert.equal(g.champion.samples,20);assert.equal(g.promotionRecommended,null);assert.equal(g.minSamples,50);
});


test('forecast metrics can isolate the active model version from historical versions',()=>{
 const now=Date.now(),rows=[];
 for(let i=0;i<20;i++)rows.push({world:'Lunarian',boss:'VM',modelVersion:'old',resolvedAt:now-i*1000,windowHit:false,errorMinutes:60});
 for(let i=0;i<10;i++)rows.push({world:'Lunarian',boss:'VM',modelVersion:'new',resolvedAt:now-i*1000,windowHit:true,errorMinutes:10});
 const all=forecastMetrics(rows,'Lunarian',now),current=forecastMetrics(rows,'Lunarian',now,{modelVersion:'new'});
 assert.equal(all.totalResolved,30);assert.equal(current.totalResolved,10);assert.equal(current.all.windowAccuracy,100);assert.equal(current.all.maeMinutes,10);
});

test('intelligence initialization records engine/model version transition in the immutable ledger',()=>{
 const state={intelligence:{version:3,engineVersion:'4.1.0',modelVersion:'adaptive-ensemble-v4.1',sources:{},events:[],audit:[],corrections:[],metricsHistory:[],forecasts:[],models:{},ledger:[]}};
 createIntelligence({state,persist:async()=>{},broadcast:()=>{}});
 const change=state.intelligence.ledger.find(x=>x.type==='engine_version_changed');assert.ok(change);assert.equal(change.payload.fromEngine,'4.1.0');assert.equal(change.payload.toEngine,'4.2.0');assert.equal(verifyLedger(state.intelligence.ledger).valid,true);
});


test('quality circuit stays half-open after HTTP recovery until three good evidence outcomes',()=>{
 const sources=ensureSources({}),at=Date.now();
 for(let i=0;i<8;i++)noteEvidenceOutcome(sources,'otbosstracker',{correct:false,errorMs:3*3600000,precision:'minute',consistency:.1,at:at+i});
 const src=sources.otbosstracker;assert.equal(src.circuitState,'OPEN');assert.equal(src.circuitReason,'quality');
 const retry=src.suspendedUntil+1;assert.equal(canAttemptSource(sources,'otbosstracker',retry),true);assert.equal(src.circuitState,'HALF_OPEN');
 noteSource(sources,'otbosstracker',{ok:true,records:1,at:retry+1});assert.equal(src.circuitState,'HALF_OPEN');
 noteEvidenceOutcome(sources,'otbosstracker',{correct:true,errorMs:60000,precision:'minute',consistency:.95,at:retry+2});assert.equal(src.circuitState,'HALF_OPEN');
 noteEvidenceOutcome(sources,'otbosstracker',{correct:true,errorMs:60000,precision:'minute',consistency:.95,at:retry+3});assert.equal(src.circuitState,'HALF_OPEN');
 noteEvidenceOutcome(sources,'otbosstracker',{correct:true,errorMs:60000,precision:'minute',consistency:.95,at:retry+4});assert.equal(src.circuitState,'CLOSED');assert.equal(src.circuitReason,null);
});


test('quarantined waiting evidence cannot shift a confirmed consensus timestamp',()=>{
 const sources=ensureSources({});for(const src of Object.values(sources))src.effectiveWeight=sourceWeight(src);
 const base=Date.parse('2026-10-06T21:42:00-03:00'),events=[];
 const good=makeObservation({evidenceId:'good-q',boss:'Q Boss',world:'Lunarian',sourceId:'manual-panel',sourceRef:'boss-radar://panel',collectionMethod:'manual_panel',eventType:'kill',precision:'minute',estimatedAt:base,manual:true,confidence:.98});
 good.quality={score:95,status:'CONFIRMADO',eligibleForLearning:true,traceable:true};
 const waiting=makeObservation({evidenceId:'wait-q',boss:'Q Boss',world:'Lunarian',sourceId:'whatsapp-group',sourceRef:'whatsapp://authorized-group',collectionMethod:'browser_extension',eventType:'kill',precision:'minute',estimatedAt:base+3*3600000,confidence:.9});
 waiting.quality={score:65,status:'AGUARDANDO_CONFIRMAÇÃO',eligibleForLearning:false,traceable:true};
 mergeObservation(events,good,sources);mergeObservation(events,waiting,sources);
 assert.equal(events.length,1);assert.equal(events[0].estimatedAt,base);assert.equal(events[0].qualityStatus,'PROVÁVEL');
});

test('quarantined minute evidence does not count as precise history for exact prediction readiness',()=>{
 const H=3600000,base=Date.parse('2026-01-01T10:00:00-03:00'),events=[];
 for(let i=0;i<10;i++){
   const at=base+i*72*H;
   events.push({id:'qp'+i,boss:'Precision Quarantine',world:'Lunarian',eventType:'kill',estimatedAt:at,status:'confirmed_auto',qualityStatus:'CONFIRMADO',dataQualityScore:90,confidence:.9,evidence:[
     {precision:'day',quality:{status:'CONFIRMADO',eligibleForLearning:true}},
     {precision:'minute',quality:{status:'AGUARDANDO_CONFIRMAÇÃO',eligibleForLearning:false}}
   ]});
 }
 const p=predictAdaptive(events,'Precision Quarantine','Lunarian',{});
 assert.equal(p.status,'ready');assert.equal(p.preciseSamples,0);assert.equal(p.likelyAt,null);assert.ok(p.readiness.exactReasons.some(x=>/menos de 8 aparições com horário preciso/.test(x)));
});


test('boss with only quarantined evidence is surfaced as insufficient instead of disappearing',()=>{
 const at=Date.now()-3600000,events=[{id:'only-q',boss:'Only Quarantine',world:'Lunarian',eventType:'kill',estimatedAt:at,status:'unconfirmed',qualityStatus:'AGUARDANDO_CONFIRMAÇÃO',dataQualityScore:60,confidence:.5,evidence:[{precision:'minute',quality:{status:'AGUARDANDO_CONFIRMAÇÃO',eligibleForLearning:false,traceable:true}}]}];
 const rows=buildAdaptivePredictions(events,'Lunarian',{});
 assert.equal(rows.length,1);assert.equal(rows[0].boss,'Only Quarantine');assert.equal(rows[0].status,'insufficient');assert.match(rows[0].reason,/DADOS INSUFICIENTES/);
});

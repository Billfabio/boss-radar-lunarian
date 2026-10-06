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

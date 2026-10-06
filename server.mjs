import http from 'node:http';
import {fetchBossMaps} from './boss-maps.mjs';
import {createWhatsAppSync} from './whatsapp-sync.mjs';
import {validateGroupRows,checkKey,groupPatterns,brasiliaDate} from './group-checks.mjs';
import {entryFor,resolvedProgress} from './bosstiary.mjs';
import {PUBLIC_SOURCE,normalizePublic} from './public-source.mjs';
import {officialURL,mergeOfficial} from './official-source.mjs';
import {fetchCharacter,validateCharacterName,CHARACTER_NAME} from './character-source.mjs';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { WORLDS, uniqueHistory, dueAlert,status } from './logic.mjs';
import { createVapid, sendPush, allowedEndpoint } from './push.mjs';
import { createIntelligence } from './intelligence/service.mjs';
import { TaskQueue } from './runtime/task-queue.mjs';
import { buildHealth } from './runtime/health.mjs';
import { createStructuredLogger } from './observability/logger.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4317);
const HOST = process.env.HOST || '127.0.0.1';
const ORIGIN = process.env.PUBLIC_ORIGIN || `http://${HOST==='0.0.0.0'?'127.0.0.1':HOST}:${PORT}`;
const PUBLIC_URL=new URL(ORIGIN);
const ALLOWED_HOSTS=new Set((process.env.ALLOWED_HOSTS||PUBLIC_URL.host).split(',').map(x=>x.trim()).filter(Boolean));
if(!['http:','https:'].includes(PUBLIC_URL.protocol))throw new Error('PUBLIC_ORIGIN deve usar http ou https');
if(HOST!=='127.0.0.1'&&HOST!=='localhost'&&!process.env.PUBLIC_ORIGIN)throw new Error('Defina PUBLIC_ORIGIN ao expor o servidor fora do localhost');
const DATA = join(ROOT, 'data');
const bosstiary=JSON.parse(await readFile(join(ROOT,'bosstiary.json'),'utf8'));
const outfitCache=new Map();
const mapCache=new Map();
await mkdir(DATA, { recursive:true });
await mkdir(join(DATA,'group-images'), { recursive:true });
let state;
try { state = JSON.parse(await readFile(join(DATA,'state.json'),'utf8')); }
catch (e) { if (e.code !== 'ENOENT') throw e; state={ settings:{world:'Lunarian', leadMinutes:30, enabled:false, favoritesOnly:false, progress:{}}, subscriptions:[], sent:{}, log:[], checks:[] }; }
state.settings.progress=Object.fromEntries(Object.entries(state.settings.progress).map(([name,p])=>[name,resolvedProgress(name,p,bosstiary)]));
let vapid;
try { vapid=JSON.parse(await readFile(join(DATA,'vapid.json'),'utf8')); }
catch (e) { if (e.code !== 'ENOENT') throw e; vapid=createVapid(); await writeFile(join(DATA,'vapid.json'),JSON.stringify(vapid),{mode:0o600}); }
const sessionToken = randomBytes(32).toString('hex');
const heavyQueue=new TaskQueue({concurrency:1,maxPending:8});
let persistQueue = Promise.resolve();
function persist() {
  const snapshot=JSON.stringify(state);
  persistQueue=persistQueue.then(async()=>{ await writeFile(join(DATA,'state.tmp'),snapshot); await rename(join(DATA,'state.tmp'),join(DATA,'state.json')); });
  return persistQueue;
}
const cache=new Map();
let refreshPromise=null, lastError=null, monitoring=false, lastPoll=null, lastCollectionAt=null;
let catalog=[];
try {catalog=JSON.parse(await readFile(join(DATA,'catalog.json'),'utf8'));} catch(e) {if(e.code!=='ENOENT') throw e;}
const clients=new Set();
state.characters ||= [CHARACTER_NAME];
state.groupChecks ||= [];
const characterCache=new Map(Object.entries(state.characterProfiles||{})),characterErrors=new Map(),characterPromises=new Map();
async function refreshCharacter(input=CHARACTER_NAME,force=false){
 const name=validateCharacterName(input),key=name.toLowerCase(),old=characterCache.get(key);
 if(!force && old && Date.now()-old.fetchedAt<300000)return old;
 if(characterPromises.has(key))return characterPromises.get(key);
 const promise=fetchCharacter(name).then(async result=>{characterCache.set(key,result);characterErrors.delete(key);state.characterProfiles ||= {};state.characterProfiles[key]=result;await persist();return result;}).catch(e=>{characterErrors.set(key,e.message);throw e;}).finally(()=>{characterPromises.delete(key);});
 characterPromises.set(key,promise);return promise;
}
function broadcast(type, data) { for (const res of clients) res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`); }
const intelligence=createIntelligence({state,persist,broadcast});
const structured=createStructuredLogger({state,persist});
await intelligence.bootstrapChecks([...state.checks,...state.groupChecks]);
async function refresh(force=false) {
  const world=state.settings.world;
  const old=cache.get(world);
  if (!force && old && !old.catalogOnly && Date.now()-old.fetchedAt < 240000) return old;
  if (refreshPromise) { await refreshPromise; if (cache.get(world)) return cache.get(world); }
  refreshPromise=(async()=>{
    const capturedWorld=world;
    if(!catalog.length) {
      const started=Date.now();const response=await fetch('https://cdn.rubinottools.com/json/bosses.json',{signal:AbortSignal.timeout(20000)});
      if(!response.ok){intelligence.sourceAttempt('rubinot-catalog',{ok:false,error:`HTTP ${response.status}`,latencyMs:Date.now()-started});throw new Error(`Catálogo indisponível (HTTP ${response.status})`);}
      const raw=await response.json();
      if(!Array.isArray(raw)) throw new Error('Formato do catálogo desconhecido');
      catalog=raw.filter(b=>b && typeof b.name==='string').map(b=>({...b,history:[]}));
      intelligence.sourceAttempt('rubinot-catalog',{ok:true,records:catalog.length,latencyMs:Date.now()-started});
      await writeFile(join(DATA,'catalog.json'),JSON.stringify(catalog));
    }
    if(!cache.has(capturedWorld))cache.set(capturedWorld,{world:capturedWorld,pending:[],bosses:catalog,fetchedAt:Date.now(),catalogOnly:true});
    const publicStarted=Date.now();const response=await fetch(PUBLIC_SOURCE,{signal:AbortSignal.timeout(20000),headers:{Accept:'application/json'}});
    if(!response.ok){intelligence.sourceAttempt('otbosstracker',{ok:false,error:`HTTP ${response.status}`,latencyMs:Date.now()-publicStarted});throw new Error(`Histórico público indisponível (HTTP ${response.status})`);}
    const result=normalizePublic(await response.json(),capturedWorld,catalog);intelligence.sourceAttempt('otbosstracker',{ok:true,records:result.bosses.reduce((n,b)=>n+(b.history?.length||0),0),latencyMs:Date.now()-publicStarted});await intelligence.ingestPublic(result);
    try {
      const officialStarted=Date.now();const official=await fetch(officialURL(capturedWorld),{signal:AbortSignal.timeout(15000),headers:{Accept:'application/json'}});
      if(!official.ok)throw new Error(`HTTP ${official.status}`);
      state.officialSnapshots ||= {};
      const snapshot=mergeOfficial(result,await official.json(),state.officialSnapshots[capturedWorld]);intelligence.sourceAttempt('rubinot-official',{ok:true,records:result.officialCoverage||0,latencyMs:Date.now()-officialStarted});await intelligence.ingestOfficial(result);
      state.officialSnapshots[capturedWorld]=snapshot;
      state.officialHistory ||= {};
      const history=state.officialHistory[capturedWorld] ||= [];
      if(!history.length || snapshot.at-history.at(-1).at>=240000)history.push(snapshot);
      state.officialHistory[capturedWorld]=history.slice(-10800);
      await persist();
    }catch(e){intelligence.sourceAttempt('rubinot-official',{ok:false,error:e.message});result.officialError=`Estatísticas oficiais indisponíveis: ${e.message}`;}
    cache.set(capturedWorld,result); lastCollectionAt=Date.now();lastError=null; broadcast('update',{world:capturedWorld}); return result;
  })();
  try { return await refreshPromise; } catch(e) { lastError=e.message; throw e; } finally { refreshPromise=null; }
}
function log(entry) { state.log.unshift({...entry,at:Date.now()}); state.log=state.log.slice(0,200); }
async function poll() {
  if (monitoring) return;
  monitoring=true;
  try {
    const data=await refresh(); lastPoll=Date.now();
    if (state.settings.world !== data.world || !state.settings.enabled) return;
    const now=Date.now();
    for (const prediction of data.pending) {
      const alert=dueAlert(prediction,state.settings,now);
      if (!alert) continue;
      const sent=state.sent[alert.key] || [];
      const when=alert.start?new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit'}).format(new Date(alert.start)):'';
      const message={title:`${prediction.boss_name} • ${prediction.world}`,body:alert.kind==='round'?`Dia favorável segundo o histórico. Sua rodada está marcada para ${when}; prepare a checagem. Não é uma previsão de hora de spawn.`:'Histórico indica um dia favorável para procurar. Horário de spawn desconhecido.',tag:alert.key,url:'/',boss:prediction.boss_name};
      for (const sub of [...state.subscriptions]) {
        if (sent.includes(sub.endpoint)) continue;
        try {
          const response=await sendPush(sub,message,vapid);
          if (response.status===404 || response.status===410) { state.subscriptions=state.subscriptions.filter(s=>s.endpoint!==sub.endpoint); continue; }
          if (!response.ok) throw new Error(`Entrega recusada (HTTP ${response.status})`);
          sent.push(sub.endpoint); state.sent[alert.key]=sent;
          log({boss:prediction.boss_name,world:prediction.world,kind:alert.kind,result:'Enviado ao serviço de push'});
          await persist(); broadcast('alert',message);
        } catch(e) { log({boss:prediction.boss_name,world:prediction.world,result:e.message}); }
      }
    }
    // Preserve daily-cycle deduplication while retaining only the latest 5000 keys.
    const keys=Object.keys(state.sent);for(const key of keys.slice(0,Math.max(0,keys.length-5000)))delete state.sent[key];
    await persist();
  } catch(e) { lastError=e.message; broadcast('source-error',{error:e.message}); }
  finally { monitoring=false; }
}
function json(res,code,value) { res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(value)); }
async function body(req) {
  let text=''; for await(const chunk of req) { text+=chunk; if(text.length>400000) throw new Error('Arquivo grande demais'); }
  return JSON.parse(text || '{}');
}
function validSettings(input) {
  const result={...state.settings};
  if ('world' in input) { if(!WORLDS.includes(input.world)) throw new Error('Mundo inválido'); result.world=input.world; }
  if ('leadMinutes' in input) { const n=Number(input.leadMinutes); if(!Number.isInteger(n)||n<5||n>120) throw new Error('Antecedência deve ser entre 5 e 120 minutos'); result.leadMinutes=n; }
  for(const k of ['enabled','favoritesOnly']) if(k in input) { if(typeof input[k]!=='boolean') throw new Error('Preferência inválida'); result[k]=input[k]; }
  if ('checkTime' in input) {if(input.checkTime!=='' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.checkTime))throw new Error('Horário inválido');result.checkTime=input.checkTime;}
  if ('progress' in input) {
    if (!input.progress || Array.isArray(input.progress) || typeof input.progress!=='object' || Object.keys(input.progress).length>1000) throw new Error('Progresso inválido');
    const progress=Object.create(null);
    for(const [name,v] of Object.entries(input.progress)) {
      if(name.length>120 || ['__proto__','constructor','prototype'].includes(name) || !v || typeof v!=='object') throw new Error('Boss inválido');
      const kills=Math.max(0,Math.min(100000,Math.trunc(Number(v.kills)||0)));
      const target=Math.max(1,Math.min(100000,Math.trunc(Number(v.target)||100)));
      progress[name]=resolvedProgress(name,{kills,target,known:v.known!==false,targetConfirmed:!!v.targetConfirmed,favorite:!!v.favorite,muted:!!v.muted},bosstiary);
    }
    result.progress=progress;
  }
  return result;
}
const whatsapp=createWhatsAppSync({state,persist,broadcast,names:()=>[...new Set([...catalog.map(b=>b.name),...bosstiary.map(b=>b.name)])],worlds:WORLDS,readBody:body,onRecords:records=>intelligence.ingestChecks(records),saveImage:async(id,image)=>writeFile(join(DATA,'group-images',id),image.bytes),favorable:row=>{const data=cache.get(row.world);if(row.date!==brasiliaDate()||!data||data.catalogOnly||Date.now()-data.fetchedAt>300000||lastError)return 'unknown';const p=data.pending.find(p=>p.boss_name===row.boss);return status(p)==='high'?'yes':'unknown';}});
const server=http.createServer(async(req,res)=>{
  try {
    if(!ALLOWED_HOSTS.has(String(req.headers.host||''))) return json(res,403,{error:'Host não autorizado'});
    const url=new URL(req.url,ORIGIN);
    if(await whatsapp.handle(req,res,url))return;
    if(req.method==='POST') {
      if(req.headers.origin!==ORIGIN || req.headers['x-boss-token']!==sessionToken) return json(res,403,{error:'Acesso não autorizado. Atualize a página.'});
      const input=await body(req);
      if(url.pathname.startsWith('/api/whatsapp/')){const result=await whatsapp.control(url.pathname,input);if(!result)return json(res,404,{error:'Ação inválida'});broadcast('update',{});return json(res,200,result);}
      if(url.pathname==='/api/settings') { state.settings=validSettings(input); await persist(); json(res,200,state.settings); void poll(); return; }
      if(url.pathname==='/api/subscribe') {
        if(!allowedEndpoint(input.endpoint)||typeof input.keys?.p256dh!=='string'||typeof input.keys?.auth!=='string') throw new Error('Este navegador não forneceu uma inscrição de notificações suportada. Abra http://127.0.0.1:4317/ no Chrome, Edge ou Firefox e tente novamente.');
        if(Buffer.from(input.keys.p256dh,'base64url').length!==65 || Buffer.from(input.keys.auth,'base64url').length!==16) throw new Error('Chaves inválidas');
        if(!state.subscriptions.some(s=>s.endpoint===input.endpoint)) { if(state.subscriptions.length>=20) throw new Error('Limite de dispositivos atingido'); state.subscriptions.push({endpoint:input.endpoint,keys:input.keys}); }
        state.settings.enabled=true; await persist(); json(res,200,{ok:true}); void poll(); return;
      }
      if(url.pathname==='/api/unsubscribe') { state.subscriptions=state.subscriptions.filter(s=>s.endpoint!==input.endpoint); if(!state.subscriptions.length) state.settings.enabled=false; await persist(); return json(res,200,{ok:true}); }
      if(url.pathname==='/api/test') {
        const sub=state.subscriptions.find(s=>s.endpoint===input.endpoint); if(!sub) throw new Error('Ative as notificações neste navegador primeiro');
        const response=await sendPush(sub,{title:'Boss Radar',body:'Notificação de teste. Seu navegador está inscrito para receber alertas.',tag:'test-'+Date.now(),url:'/'},vapid);
        if(!response.ok) throw new Error(`Teste recusado (HTTP ${response.status})`); return json(res,200,{ok:true});
      }
      if(url.pathname==='/api/check') {
        if(typeof input.boss!=='string'||input.boss.length>120||!['vazio','encontrado','morto'].includes(input.result)) throw new Error('Checagem inválida');
        if(typeof input.id!=='string'||!/^[a-zA-Z0-9-]{10,80}$/.test(input.id))throw new Error('Identificador de checagem inválido');
        if(state.checks.some(c=>c.id===input.id))return json(res,200,{ok:true,id:input.id});
        const countKill=input.countKill===true&&input.result==='morto';
        const previous=resolvedProgress(input.boss,state.settings.progress[input.boss],bosstiary);
        if(countKill){const p=resolvedProgress(input.boss,state.settings.progress[input.boss],bosstiary);state.settings.progress[input.boss]=resolvedProgress(input.boss,{...p,kills:p.kills+1,known:true},bosstiary);}
        const savedCheck={id:input.id,boss:input.boss,world:state.settings.world,result:input.result,countKill,previousKills:previous.kills,previousKnown:previous.known,afterKills:previous.kills+1,at:Date.now(),origin:'manual',precision:'minute'};state.checks.unshift(savedCheck); state.checks=state.checks.slice(0,2000); await intelligence.ingestChecks([savedCheck]); await persist(); return json(res,200,{ok:true,id:input.id});
      }
      if(url.pathname==='/api/check/undo'){
        const check=state.checks.find(c=>c.id===input.id);if(!check)return json(res,200,{ok:true});
        if(check.countKill){const p=resolvedProgress(check.boss,state.settings.progress[check.boss],bosstiary);if(p.kills!==check.afterKills)throw new Error('A quantidade foi alterada depois deste registro. Ajuste o total em Meu progresso.');state.settings.progress[check.boss]=resolvedProgress(check.boss,{...p,kills:check.previousKills,known:check.previousKnown},bosstiary);}
        await intelligence.removeCheck(check);state.checks=state.checks.filter(c=>c.id!==input.id);await persist();return json(res,200,{ok:true});
      }
      if(url.pathname==='/api/group-checks'){
        if(typeof input.batchId!=='string'||!/^[a-zA-Z0-9-]{10,80}$/.test(input.batchId))throw new Error('Rodada inválida');
        if(state.groupChecks.some(c=>c.batchId===input.batchId))return json(res,200,{added:0,duplicates:input.rows?.length||0});
        const names=[...new Set([...catalog.map(b=>b.name),...bosstiary.map(b=>b.name),...Object.keys(state.settings.progress)])];
        const rows=validateGroupRows(input,names,WORLDS),existing=new Set(state.groupChecks.map(checkKey)),fresh=rows.filter(c=>!existing.has(checkKey(c)));
        if(state.groupChecks.length+fresh.length>50000)throw new Error('Limite de 50 mil checagens. Exporte o histórico antes de continuar.');
        const stored=fresh.map((c,i)=>({...c,id:input.batchId+'-'+i,batchId:input.batchId,recordedAt:Date.now()}));state.groupChecks.unshift(...stored);await intelligence.ingestChecks(stored);await persist();broadcast('update',{});return json(res,200,{added:fresh.length,duplicates:rows.length-fresh.length});
      }
      if(url.pathname==='/api/group-checks/undo'){
        if(typeof input.batchId!=='string')throw new Error('Rodada inválida');const removed=state.groupChecks.filter(c=>c.batchId===input.batchId);await intelligence.removeChecks(removed);state.groupChecks=state.groupChecks.filter(c=>c.batchId!==input.batchId);await persist();broadcast('update',{});return json(res,200,{ok:true});
      }
      if(url.pathname==='/api/intelligence/correct'){const result=await intelligence.correct({eventId:input.eventId,at:input.at,reason:input.reason,actor:'site-admin'});return json(res,200,result);}
      if(url.pathname==='/api/intelligence/backtest'){const world=WORLDS.includes(input.world)?input.world:state.settings.world;const result=await heavyQueue.enqueue('backtest:'+world,async()=>intelligence.backtest(world));return json(res,200,result);}
      if(url.pathname==='/api/intelligence/simulate'){const world=WORLDS.includes(input.world)?input.world:state.settings.world;if(typeof input.boss!=='string'||input.boss.length>140)throw new Error('Boss inválido');return json(res,200,intelligence.simulate(input.boss,world));}
      if(url.pathname==='/api/refresh') { await refresh(true); await poll(); return json(res,200,{ok:true}); }
      if(url.pathname==='/api/character/refresh') {await refreshCharacter(input.name||CHARACTER_NAME,true);return json(res,200,{ok:true});}
      if(url.pathname==='/api/characters/add') {
        const name=validateCharacterName(input.name);
        if(state.characters.length>=50)throw new Error('Limite de 50 personagens atingido');
        const found=await refreshCharacter(name);
        if(!state.characters.some(x=>x.toLowerCase()===found.player.name.toLowerCase()))state.characters.push(found.player.name);
        await persist();return json(res,200,{names:state.characters,name:found.player.name});
      }
      return json(res,404,{error:'Rota não encontrada'});
    }
    if(req.method!=='GET') return json(res,405,{error:'Método não permitido'});
    if(url.pathname==='/api/boss-maps'){const name=url.searchParams.get('name'),boss=catalog.find(b=>b.name===name)||bosstiary.find(b=>b.name===name);if(!boss)throw new Error('Boss desconhecido');let result=mapCache.get(name);if(!result||Date.now()-result.at>3600000){result={...await fetchBossMaps(name,boss.locations||[]),at:Date.now()};mapCache.set(name,result);}return json(res,200,result);}
    if(url.pathname==='/api/group-image'){const id=url.searchParams.get('id');if(!/^[a-f0-9]{64}$/.test(id||''))throw new Error('Imagem inválida');const image=state.whatsapp.images.find(i=>i.id===id);if(!image)return json(res,404,{error:'Imagem não encontrada'});const bytes=await readFile(join(DATA,'group-images',id));res.writeHead(200,{'Content-Type':image.type,'Cache-Control':'private, max-age=3600','X-Content-Type-Options':'nosniff'});res.end(bytes);return;}
    if(url.pathname==='/api/group-checks')return json(res,200,{records:state.groupChecks});
    if(url.pathname==='/api/health'){const h=intelligence.healthState(state.settings.world),w=whatsapp.publicState(),q=heavyQueue.stats();return json(res,200,buildHealth({lastPoll,lastCollectionAt,lastPredictionAt:h.lastPredictionAt,queue:q,sources:h.sources,whatsapp:w,clients:clients.size,storageMode:'legacy-file',errors24h:structured.errorsSince(86400000).length}));}
    if(url.pathname==='/api/logs')return json(res,200,{records:structured.recent(300)});
    if(url.pathname==='/api/characters')return json(res,200,{names:state.characters});
    if(url.pathname==='/api/character'){const name=validateCharacterName(url.searchParams.get('name')||CHARACTER_NAME);try{await refreshCharacter(name);}catch{}return json(res,200,{character:characterCache.get(name.toLowerCase())||null,error:characterErrors.get(name.toLowerCase())||null});}
    if(url.pathname==='/api/state') {
      let data=cache.get(state.settings.world); try {data=await refresh();} catch {}
      const intelligent=intelligence.snapshot(state.settings.world);
      return json(res,200,{settings:state.settings,bosstiary,whatsapp:whatsapp.publicState(),data:data||null,error:lastError,lastPoll,subscriptions:state.subscriptions.length,log:state.log,checks:state.checks,groupChecks:state.groupChecks.filter(c=>c.world===state.settings.world).slice(0,500),groupPatterns:groupPatterns(state.groupChecks,state.settings.world),intelligence:intelligent,publicKey:vapid.publicKey,token:sessionToken,worlds:WORLDS});
    }
    if(url.pathname==='/api/events') {
      res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'}); res.write(': connected\n\n'); clients.add(res);
      const timer=setInterval(()=>res.write(': keepalive\n\n'),20000); req.on('close',()=>{clients.delete(res);clearInterval(timer);}); return;
    }
    if(url.pathname==='/api/outfit'){
      const name=validateCharacterName(url.searchParams.get('name')),direction=Number(url.searchParams.get('direction')||2);
      if(!Number.isInteger(direction)||direction<0||direction>3)throw new Error('Direção inválida');
      const profile=characterCache.get(name.toLowerCase());if(!profile)throw new Error('Consulte o personagem primeiro');
      const p=profile.player,params=new URLSearchParams({type:String(p.looktype),head:String(p.lookhead||0),body:String(p.lookbody||0),legs:String(p.looklegs||0),feet:String(p.lookfeet||0),addons:String(p.lookaddons||0),direction:String(direction),animated:'1',walk:'1',size:'0'}),key=params.toString();
      let sprite=outfitCache.get(key);
      if(!sprite){const response=await fetch('https://rubinot.com.br/api/outfit?'+key,{signal:AbortSignal.timeout(15000)});if(!response.ok||!response.headers.get('content-type')?.startsWith('image/png'))throw new Error('Aparência indisponível');const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>2000000)throw new Error('Imagem muito grande');sprite={bytes};if(outfitCache.size>200)outfitCache.clear();outfitCache.set(key,sprite);}
      res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'public, max-age=3600','X-Content-Type-Options':'nosniff'});res.end(sprite.bytes);return;
    }
    const files={'/':'index.html','/sw.js':'sw.js','/logic.mjs':'logic.mjs','/bosstiary.mjs':'bosstiary.mjs','/boss-map-ui.mjs':'boss-map-ui.mjs','/group-checks.mjs':'group-checks.mjs','/group-ui.mjs':'group-ui.mjs','/whatsapp-ui.mjs':'whatsapp-ui.mjs','/notification-flow.mjs':'notification-flow.mjs','/character-ui.mjs':'character-ui.mjs','/intelligence-ui.mjs':'intelligence-ui.mjs','/app.js':'app.js','/styles.css':'styles.css'};
    if(url.pathname==='/boss-radar-extension.zip'){const content=await readFile(join(ROOT,'boss-radar-extension.zip'));res.writeHead(200,{'Content-Type':'application/zip','Content-Disposition':'attachment; filename="boss-radar-extension.zip"','Cache-Control':'no-store'});res.end(content);return;}
    if(!files[url.pathname]) return json(res,404,{error:'Página não encontrada'});
    const content=await readFile(join(ROOT,files[url.pathname]));
    const type=url.pathname.endsWith('.css')?'text/css':url.pathname==='/'?'text/html':'application/javascript';
    res.writeHead(200,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https://cdn.rubinottools.com https://www.tibiawiki.com.br; connect-src 'self'; frame-src https://tibiamaps.io; object-src 'none'; base-uri 'self'; frame-ancestors 'self'"}); res.end(content);
  } catch(e) { const traceId=randomBytes(8).toString('hex');await structured.write('error','request',e.message,{method:req.method,url:req.url},traceId).catch(()=>{});json(res,400,{error:e.message,traceId}); }
});
server.listen(PORT,HOST,()=>{console.log(`Boss Radar: ${ORIGIN}\nEscutando em ${HOST}:${PORT}.\nA previsão é uma janela de checagem; não garante spawn.`); void poll();});
setInterval(()=>void poll(),60000).unref();

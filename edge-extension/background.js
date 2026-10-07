const BASE='http://127.0.0.1:4317',GROUP='Lunarian',VERSION=chrome.runtime.getManifest().version;
const MAX_QUEUE=5000,QUEUE_TTL=48*3600000;
function serviceURL(value){const u=new URL(value||BASE);if(u.username||u.password)throw new Error('Não use usuário ou senha na URL.');if(u.origin===BASE||u.protocol==='https:')return u.origin;throw new Error('Use o endereço local ou uma origem HTTPS segura.');}
async function request(path,data,key,base){const stored=await chrome.storage.local.get('config'),url=serviceURL(base||stored.config?.serviceURL);const r=await fetch(url+path,{method:'POST',headers:{'Content-Type':'application/json','X-Radar-Extension':chrome.runtime.id,...(key?{'X-Radar-Key':key}:{})},body:JSON.stringify(data),signal:AbortSignal.timeout(15000)});let result={};try{result=await r.json();}catch{}if(!r.ok)throw new Error(result.error||('Falha HTTP '+r.status));return result;}
const metricKeys=['messagesSeen','messagesFiltered','bossMatches','exactMatches','fuzzyMatches','duplicates','errors','domAdapterErrors','observerEvents','batches','requests'];
function blankMetrics(){return Object.fromEntries(metricKeys.map(k=>[k,0]));}
async function addMetrics(delta={}){const {collectorMetrics={}}=await chrome.storage.local.get('collectorMetrics'),next={...blankMetrics(),...collectorMetrics};for(const k of metricKeys)if(Number.isFinite(Number(delta[k])))next[k]=Math.max(0,(next[k]||0)+Number(delta[k]));await chrome.storage.local.set({collectorMetrics:next});return next;}
async function technicalLog(type,data={}){const {collectorLogs=[]}=await chrome.storage.local.get('collectorLogs'),safe={};for(const [k,v] of Object.entries(data))if(['count','size','status','attempt','code'].includes(k))safe[k]=v;collectorLogs.unshift({at:Date.now(),type:String(type).slice(0,60),data:safe});collectorLogs.length=Math.min(500,collectorLogs.length);await chrome.storage.local.set({collectorLogs});}
async function setStatus(status,message=''){await chrome.storage.local.set({collectorStatus:status,status:message||status});await technicalLog('COLLECTOR_STATUS',{status});}
function makeSalt(){const a=new Uint8Array(24);crypto.getRandomValues(a);return [...a].map(x=>x.toString(16).padStart(2,'0')).join('');}
async function getQueue(){const {evidenceQueue=[]}=await chrome.storage.local.get('evidenceQueue'),now=Date.now();return evidenceQueue.filter(x=>now-(x.queuedAt||now)<=QUEUE_TTL);}
async function enqueueEvidence(rows=[]){let queue=await getQueue();const seen=new Set(queue.map(x=>x.messageFingerprint));let dup=0;for(const row of rows){if(seen.has(row.messageFingerprint)){dup++;continue;}if(queue.length>=MAX_QUEUE){await setStatus('DEGRADED','Fila local cheia; coleta pausada para não perder evidências.');throw new Error('Fila local atingiu o limite de '+MAX_QUEUE+' evidências.');}queue.push({...row,queuedAt:Date.now()});seen.add(row.messageFingerprint);}await chrome.storage.local.set({evidenceQueue:queue});if(dup){await addMetrics({duplicates:dup});await technicalLog('DUPLICATE_IGNORED',{count:dup});}if(rows.length-dup)await technicalLog('EVIDENCE_QUEUED',{count:rows.length-dup,size:queue.length});return {queued:rows.length-dup,duplicates:dup,size:queue.length};}
let flushing=false;
function jitterFactor(){const a=new Uint32Array(1);crypto.getRandomValues(a);return .85+(a[0]/4294967295)*.3;}
async function scheduleRetry(attempt){const base=Math.min(16,Math.pow(2,Math.min(4,Math.max(0,attempt)))),minutes=Math.max(.5,base*jitterFactor());await chrome.storage.local.set({retryAttempt:attempt,retryAt:Date.now()+minutes*60000});chrome.alarms.create('queue-retry',{delayInMinutes:minutes});}
async function flushQueue(){
 if(flushing)return;flushing=true;
 try{
  const {config,paused,retryAttempt=0}=await chrome.storage.local.get(['config','paused','retryAttempt']);if(!config||paused)return;
  let queue=await getQueue();await chrome.storage.local.set({evidenceQueue:queue});if(!queue.length){await chrome.storage.local.set({retryAttempt:0,retryAt:null});return;}
  while(queue.length){const batch=queue.slice(0,50);await addMetrics({requests:1,batches:1});try{const response=await request('/api/community/evidence',{group:GROUP,evidence:batch},config.key,config.serviceURL);if(response.duplicates?.length)await addMetrics({duplicates:response.duplicates.length});await technicalLog('EVIDENCE_SENT',{count:batch.length});}catch(e){await addMetrics({errors:1});await technicalLog('BACKEND_OFFLINE',{attempt:retryAttempt+1});await setStatus('BACKEND_OFFLINE','Boss Radar indisponível. Evidências preservadas na fila local.');await scheduleRetry(retryAttempt+1);throw e;}queue=queue.slice(batch.length);await chrome.storage.local.set({evidenceQueue:queue,retryAttempt:0,retryAt:null});}
  await setStatus('CONNECTED','Fila sincronizada com o Boss Radar.');
 }finally{flushing=false;}
}
async function heartbeat(extra={}){
 const {config,paused,collectorMetrics={},evidenceQueue=[]}=await chrome.storage.local.get(['config','paused','collectorMetrics','evidenceQueue']);if(!config)return;
 const status=paused?'PAUSED':extra.status||'CONNECTED';const heartbeatAt=Date.now();await chrome.storage.local.set({lastHeartbeatLocalAt:heartbeatAt});try{await request('/extension/heartbeat',{group:GROUP,status,extensionVersion:VERSION,queueSize:evidenceQueue.length,metrics:collectorMetrics,diagnostics:extra.diagnostics||null,clientNow:heartbeatAt},config.key,config.serviceURL);if(!paused&&status==='CONNECTED')await setStatus('CONNECTED','Lunarian Collector ativo.');}catch(e){await addMetrics({errors:1,requests:1});await setStatus('BACKEND_OFFLINE','Boss Radar offline; fila local preservada.');}
}
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
 const local=!sender.tab&&sender.url?.startsWith(chrome.runtime.getURL('')),web=sender.tab?.url?.startsWith('https://web.whatsapp.com/');
 if(!local&&!web)return;
 (async()=>{
  const stored=await chrome.storage.local.get(['config','paused','reporterSalt']),config=stored.config,paused=stored.paused;
  if(message.type==='pair'&&local){const base=serviceURL(message.serviceURL),salt=stored.reporterSalt||makeSalt();if(String(message.group||'').trim().toLowerCase()!=='lunarian')throw new Error('Esta versão monitora exclusivamente o grupo Lunarian.');const r=await request('/extension/pair',{code:message.code,group:GROUP,world:message.world,extensionVersion:VERSION},null,base);await chrome.storage.local.set({config:{key:r.key,collectorId:r.collectorId,group:GROUP,world:r.world,dictionary:r.dictionary,dictionaryVersion:r.dictionary?.version||'',serviceURL:base},reporterSalt:salt,paused:false,collectorStatus:'CONNECTED',status:'Conectado. Aguardando Lunarian.',evidenceQueue:[],retryAttempt:0});return {ok:true};}
  if(message.type==='config'&&web){if(!config||paused)return {paused:true};try{const r=await request('/extension/config',{group:GROUP},config.key,config.serviceURL);const next={...config,dictionary:r.dictionary||config.dictionary,dictionaryVersion:r.dictionary?.version||config.dictionaryVersion,collectorId:r.collectorId||config.collectorId};await chrome.storage.local.set({config:next,serverCheckpoint:r.checkpoint});return {...r,group:GROUP,reporterSalt:stored.reporterSalt||''};}catch(e){await setStatus('BACKEND_OFFLINE','Painel indisponível: '+e.message);return {paused:false,error:e.message,offline:true,dictionary:config.dictionary,world:config.world,collectorId:config.collectorId,group:GROUP,reporterSalt:stored.reporterSalt||'',checkpoint:null};}}
  if(message.type==='evidence-batch'&&web){if(!config||paused||message.group!==GROUP)throw new Error('Collector não autorizado ou pausado.');const r=await enqueueEvidence(message.evidence||[]);await flushQueue().catch(()=>{});return {ok:true,...r};}
  if(message.type==='heartbeat'&&web){await addMetrics(message.metricsDelta||{});await heartbeat({status:message.status,diagnostics:message.diagnostics});if(!paused)await flushQueue().catch(()=>{});const q=await getQueue();return {ok:true,queueSize:q.length};}
  if(message.type==='image'&&web){if(!config||paused||message.group!==GROUP)throw new Error('Collector não autorizado.');const result=await request('/extension/image',{group:GROUP,messageId:message.messageId,data:message.data},config.key,config.serviceURL);return result;}
  if(message.type==='read-now'&&local){const tabs=await chrome.tabs.query({active:true,currentWindow:true});if(!tabs[0]?.url?.startsWith('https://web.whatsapp.com/'))throw new Error('Abra a extensão na aba do WhatsApp Web.');await chrome.tabs.sendMessage(tabs[0].id,{type:'tick',manual:true});return {ok:true};}
  if(message.type==='selected-group'&&local)throw new Error('A seleção do grupo é feita pelo content script.');
  if(message.type==='status'&&web){await setStatus(message.statusCode||'DEGRADED',String(message.status||'').slice(0,250));await heartbeat({status:message.statusCode||'DEGRADED',diagnostics:message.diagnostics});return {ok:true};}
  if(message.type==='flush'&&local){await flushQueue();return {ok:true};}
  throw new Error('Ação não permitida');
 })().then(reply).catch(async e=>{await addMetrics({errors:1});await setStatus('ERROR',e.message);reply({error:e.message});});
 return true;
});
chrome.alarms.create('check-group',{periodInMinutes:1});
chrome.alarms.onAlarm.addListener(async alarm=>{if(alarm.name==='check-group'){const tabs=await chrome.tabs.query({url:'https://web.whatsapp.com/*'});for(const tab of tabs)chrome.tabs.sendMessage(tab.id,{type:'tick',fallback:true}).catch(()=>{});await heartbeat().catch(()=>{});await flushQueue().catch(()=>{});}if(alarm.name==='queue-retry')await flushQueue().catch(()=>{});});
chrome.runtime.onInstalled.addListener(()=>{chrome.storage.local.set({collectorStatus:'DISCONNECTED',collectorMetrics:blankMetrics()}).catch(()=>{});});

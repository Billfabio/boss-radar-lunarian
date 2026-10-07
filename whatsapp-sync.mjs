import {randomBytes,createHash} from 'node:crypto';
import {decodeGroupImage} from './group-images.mjs';
import {parseGroupText,validateGroupRows,checkKey,brasiliaDate} from './group-checks.mjs';
import {evidenceId,mergeEvidence,enrichCandidate,latencyPercentiles} from './whatsapp-community.mjs';
const digest=s=>createHash('sha256').update(String(s)).digest('hex');
const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const REQUIRED_GROUP='lunarian',LATEST_EXTENSION='1.5.0';
const contexts=new Set(['POSSIBLE_REPORT','CONFIRMATION','QUESTION','NEGATION','SPECULATION','CORRECTION','UNKNOWN']);
const collectorStates=new Set(['CONNECTED','WHATSAPP_NOT_FOUND','LUNARIAN_NOT_FOUND','PAUSED','BACKEND_OFFLINE','DEGRADED','ERROR','DISCONNECTED','WHATSAPP_WEB_STRUCTURE_CHANGED']);
const safeNum=(v,min=0,max=Number.MAX_SAFE_INTEGER)=>Math.max(min,Math.min(max,Number(v)||0));
const timeParts=at=>Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(new Date(at)).map(x=>[x.type,x.value]));
export function extractObservations(message,names){
 const text=String(message.text||'').slice(0,6000),mentioned=names.filter(n=>norm(text).includes(norm(n)));
 if(/[?]|\b(?:vou|vamos|sera|talvez|se aparecer|amanha|ontem|anteontem)\b/.test(norm(text)))return {rows:[],pending:true,mentioned};
 const rows=parseGroupText(text,names,{date:message.date,time:message.time,result:''}),recognized=rows.filter(r=>r.boss&&r.result);
 return {rows:recognized,pending:rows.some(r=>!r.boss||!r.result)||(!recognized.length&&mentioned.length>0),mentioned};
}
export function createWhatsAppSync({state,persist,broadcast,dictionary,names=()=>[],worlds,readBody,favorable=()=> 'unknown',saveImage=async()=>{throw new Error('Armazenamento de imagens indisponível');},onRecords=async()=>{},investigate=async()=>{},onCandidate=async()=>{},onDecision=async()=>{}}){
 state.whatsapp ||= {connection:null,pending:[],seen:[],checkpoint:null,status:'Não conectado'};
 const w=state.whatsapp;w.pending ||= [];w.seen ||= [];w.identified ||= [];w.images ||= [];w.communityEvidence ||= [];w.candidates ||= [];w.coverageSegments ||= [];w.uptimeSegments ||= [];w.gaps ||= [];w.aliases ||= {};w.aliasSuggestions ||= [];w.reporters ||= {};w.revokedCollectors ||= [];w.collector ||= {status:'DISCONNECTED',metrics:{},captureLatencies:[],messageCaptureApproxLatencies:[]};
 const dict=()=>dictionary?dictionary():{version:'legacy',entries:names().map((name,i)=>({boss_id:'legacy-'+i,name,aliases:[]}))};
 const bossNames=()=>dict().entries.map(x=>x.name);
 const identified=()=>{const byBoss=new Map();for(const row of (state.groupChecks||[]).filter(c=>String(c.origin||'').startsWith('whatsapp'))){if(!byBoss.has(row.boss))byBoss.set(row.boss,{boss:row.boss,found:0,empty:0,pending:0,lastAt:0});const p=byBoss.get(row.boss);p[row.result==='encontrado'?'found':'empty']++;p.lastAt=Math.max(p.lastAt,row.at||0);}for(const p of w.pending||[])for(const boss of p.bosses||[]){if(!byBoss.has(boss))byBoss.set(boss,{boss,found:0,empty:0,pending:0,lastAt:0});const r=byBoss.get(boss);r.pending++;r.lastAt=Math.max(r.lastAt,Date.parse(String(p.date||'')+'T'+(p.time||'12:00')+':00-03:00')||0);}return [...byBoss.values()].sort((a,b)=>a.boss.localeCompare(b.boss));};
 const badGroup=s=>/^(dados do perfil|profile details|dados do contato|contact info|group info|dados do grupo)$/i.test(String(s).trim());
 const exactGroup=s=>norm(s)===REQUIRED_GROUP;
 let pairing=null,attempts=0,lastHeartbeatPersist=0;
 function spanTotal(rows,start,now){return rows.filter(x=>x.endAt>start&&x.startAt<now).reduce((n,x)=>n+Math.max(0,Math.min(now,x.endAt)-Math.max(start,x.startAt)),0);}
 function addSegment(rows,startAt,endAt){if(!Number.isFinite(startAt)||!Number.isFinite(endAt)||endAt<=startAt)return;const last=rows.at(-1);if(last&&startAt-last.endAt<=90000)last.endAt=Math.max(last.endAt,endAt);else rows.push({startAt,endAt});}
 function coverage(now=Date.now()){
  const start=now-86400000,covered=Math.min(86400000,spanTotal(w.coverageSegments,start,now)),uptime=Math.min(86400000,spanTotal(w.uptimeSegments,start,now)),gaps=w.gaps.filter(x=>x.endAt>start&&x.startAt<now);
  return {windowHours:24,coveredMs:covered,coveragePct:Math.round(1000*covered/86400000)/10,uptimePct:Math.round(1000*uptime/86400000)/10,gapMinutes:Math.round(gaps.reduce((n,x)=>n+Math.max(0,Math.min(now,x.endAt)-Math.max(start,x.startAt)),0)/60000),gaps:gaps.slice(-20)};
 }
 function reporterView(hash){const r=w.reporters[hash]||{confirmed:0,rejected:0};const n=r.confirmed+r.rejected;return {samples:n,reliability:Math.round(1000*(2+r.confirmed)/(4+n))/10,lastAt:r.lastAt||null};}
 function updateReporters(candidate,accepted){const ids=new Set((candidate.evidenceIds||[]).map(id=>w.communityEvidence.find(e=>e.id===id)?.authorHash).filter(Boolean));for(const hash of ids){const r=w.reporters[hash]||{confirmed:0,rejected:0,lastAt:0};r[accepted?'confirmed':'rejected']++;r.lastAt=Date.now();w.reporters[hash]=r;}}
 function updateAliasSuggestions(candidate,accepted){for(const id of candidate.evidenceIds||[]){const e=w.communityEvidence.find(x=>x.id===id);for(const match of e?.bossCandidates||[]){const alias=String(match.matched||'').trim();if(match.matchType!=='FUZZY'||alias.length<2||norm(alias)===norm(match.name))continue;let row=w.aliasSuggestions.find(x=>x.boss===match.name&&norm(x.alias)===norm(alias));if(!row){row={boss:match.name,alias,confirmed:0,rejected:0,reporters:[],status:'OBSERVANDO',createdAt:Date.now()};w.aliasSuggestions.push(row);}row[accepted?'confirmed':'rejected']++;if(e.authorHash&&!row.reporters.includes(e.authorHash))row.reporters.push(e.authorHash);const total=row.confirmed+row.rejected;row.status=row.confirmed>=3&&row.reporters.length>=2&&row.confirmed/Math.max(1,total)>=.75?'SUGERIDO':'OBSERVANDO';row.updatedAt=Date.now();}}}
 function metrics(){
  const m=w.collector.metrics||{},latency=latencyPercentiles(w.collector.captureLatencies||[]),messageCaptureApprox=latencyPercentiles(w.collector.messageCaptureApproxLatencies||[]);
  return {...m,candidateEvents:w.candidates.length,captureLatency:latency,backendDeliveryLatency:latency,messageCaptureApproxLatency:messageCaptureApprox,queueSize:safeNum(w.collector.queueSize,0,10000),duplicateRate:m.relevantMessages?Math.round(1000*(m.duplicates||0)/m.relevantMessages)/10:0,errorRate:m.requests?Math.round(1000*(m.errors||0)/m.requests)/10:0};
 }
 const publicEvidence=e=>({id:e.id,correlationId:e.correlationId||null,bossCandidates:e.bossCandidates,contextClassification:e.contextClassification,messageTimestamp:e.messageTimestamp,capturedTimestamp:e.capturedTimestamp,receivedAt:e.receivedAt,authorHash:e.authorHash,reporter:e.authorHash?reporterView(e.authorHash):null,text:e.text});
 const publicCandidate=c=>({...c,evidence:(c.evidenceIds||[]).map(id=>w.communityEvidence.find(e=>e.id===id)).filter(Boolean).map(publicEvidence)});
 const publicState=()=>({connected:!!w.connection,group:w.connection?.group||'',world:w.connection?.world||'',collectorId:w.connection?.collectorId||'',revokedCollectors:w.revokedCollectors.length,status:w.collector.status||'DISCONNECTED',statusMessage:w.status||'',extensionVersion:w.collector.extensionVersion||null,latestExtensionVersion:LATEST_EXTENSION,updateAvailable:!!w.collector.extensionVersion&&w.collector.extensionVersion!==LATEST_EXTENSION,dictionaryVersion:dict().version,lastHeartbeat:w.collector.lastHeartbeatAt||null,lastRelevantMessage:w.collector.lastRelevantMessageAt||null,clockSkewMs:Number.isFinite(w.collector.clockSkewMs)?w.collector.clockSkewMs:null,lastSync:w.lastSync||null,checkpoint:w.checkpoint||null,coverage:coverage(),health:{browserConnected:Date.now()-(w.collector.lastHeartbeatAt||0)<=90000,whatsappDetected:Date.now()-(w.collector.lastHeartbeatAt||0)<=90000&&!['WHATSAPP_NOT_FOUND','DISCONNECTED'].includes(w.collector.status),lunarianDetected:Date.now()-(w.collector.lastHeartbeatAt||0)<=90000&&(w.collector.status==='CONNECTED'||norm(w.diagnostics?.detected)===REQUIRED_GROUP)},metrics:metrics(),aliasSuggestions:w.aliasSuggestions.filter(x=>x.status==='SUGERIDO').slice(0,100).map(x=>({...x,reporters:x.reporters.length})),candidates:w.candidates.slice(0,200).map(publicCandidate),pending:w.pending.slice(0,100),identified:identified(),images:w.images.slice(0,100),diagnostics:w.diagnostics||null});
 function rate(c,kind,now=Date.now()){c.rate ||= {};let r=c.rate[kind];if(!r||now-r.start>=60000)r=c.rate[kind]={start:now,count:0};r.count++;const limit=kind==='evidence'?600:180;if(r.count>limit)throw new Error('Collector excedeu o limite temporário de requisições.');}
 function heartbeat(input){
  const now=Date.now(),c=w.collector,prev=c.lastHeartbeatAt,status=collectorStates.has(input.status)?input.status:'ERROR',diag=cleanDiagnostics(input.diagnostics),clientNow=Number(input.clientNow),clockSkewMs=Number.isFinite(clientNow)?now-clientNow:null;
  if(prev&&now-prev>90000)w.gaps.push({startAt:prev,endAt:now,reason:'COLLECTION_GAP'});
  if(prev&&now-prev<=90000&&status!=='DISCONNECTED')addSegment(w.uptimeSegments,prev,now);
  if(status==='CONNECTED'&&prev&&now-prev<=90000)addSegment(w.coverageSegments,prev,now);
  if(diag?.gapDetected&&Number.isFinite(diag.gapFrom)&&Number.isFinite(diag.gapTo)&&diag.gapTo>diag.gapFrom){
    const duplicate=w.gaps.some(x=>x.reason==='DOM_COLLECTION_GAP'&&Math.abs(x.startAt-diag.gapFrom)<1000&&Math.abs(x.endAt-diag.gapTo)<1000);
    if(!duplicate)w.gaps.push({startAt:diag.gapFrom,endAt:diag.gapTo,reason:'DOM_COLLECTION_GAP'});
  }
  c.status=status;c.lastHeartbeatAt=now;c.extensionVersion=String(input.extensionVersion||'').slice(0,30);c.queueSize=safeNum(input.queueSize,0,10000);if(Number.isFinite(clockSkewMs)){c.clockSkewMs=clockSkewMs;c.clockSkewSamples=(c.clockSkewSamples||0)+1;}c.metrics={...(c.metrics||{}),...cleanMetrics(input.metrics)};w.diagnostics=diag;
  w.coverageSegments=w.coverageSegments.slice(-3000);w.uptimeSegments=w.uptimeSegments.slice(-3000);w.gaps=w.gaps.slice(-1000);w.status=status;
 }
 async function control(path,input){
  if(path==='/api/whatsapp/pair-code'){pairing={code:randomBytes(12).toString('hex'),expires:Date.now()+600000};attempts=0;return {code:pairing.code,expires:pairing.expires,group:'Lunarian'};}
  if(path==='/api/whatsapp/disconnect'){if(w.connection?.collectorId){w.revokedCollectors.unshift({collectorId:w.connection.collectorId,revokedAt:Date.now()});w.revokedCollectors=w.revokedCollectors.slice(0,100);}w.connection=null;w.collector.status='DISCONNECTED';pairing=null;w.status='Desconectado';await persist();return {ok:true};}
  if(path==='/api/whatsapp/candidate-reject'){const c=w.candidates.find(x=>x.id===input.id);if(!c)throw new Error('Candidato não encontrado');if(c.status!=='PENDING')throw new Error('Candidato já revisado');c.status='REJECTED';c.reviewedAt=Date.now();c.reviewReason=String(input.reason||'').slice(0,300);updateReporters(c,false);updateAliasSuggestions(c,false);try{await onDecision(publicCandidate(c),{outcome:'REJECTED',reason:c.reviewReason});}catch(e){c.investigationDecisionError=String(e.message||e).slice(0,200);}await persist();broadcast('update',{});return {ok:true,candidate:publicCandidate(c)};}
  if(path==='/api/whatsapp/candidate-confirm'){
   const c=w.candidates.find(x=>x.id===input.id);if(!c)throw new Error('Candidato não encontrado');if(c.status!=='PENDING')throw new Error('Candidato já revisado');
   const boss=bossNames().find(n=>norm(n)===norm(input.boss||c.boss));if(!boss)throw new Error('Boss inválido');
   const at=Number(input.at)||Number(c.estimatedAt)||Number(c.firstEvidenceAt);if(!Number.isFinite(at)||at>Date.now()+60000||at<Date.parse('2020-01-01'))throw new Error('Horário de confirmação inválido');
   const p=timeParts(at),row=validateGroupRows({world:c.world,rows:[{boss,date:`${p.year}-${p.month}-${p.day}`,time:`${p.hour}:${p.minute}`,result:'encontrado',favorable:'unknown'}]},bossNames(),worlds)[0];
   const record={...row,id:'wa-confirmed-'+c.id,origin:'whatsapp-confirmed',candidateId:c.id,correlationId:c.correlationId||null,evidenceIds:[...c.evidenceIds],recordedAt:Date.now(),timeBasis:'manual-confirmation'};
   if(!state.groupChecks.some(x=>x.candidateId===c.id)){state.groupChecks.unshift(record);await onRecords([record]);}
   c.status='CONFIRMED';c.reviewedAt=Date.now();c.confirmedAt=c.reviewedAt;c.confirmedEventAt=at;c.confirmedBoss=boss;updateReporters(c,true);updateAliasSuggestions(c,true);try{await onDecision(publicCandidate(c),{outcome:'CONFIRMED',finalBoss:boss,finalAt:at});}catch(e){c.investigationDecisionError=String(e.message||e).slice(0,200);}await persist();broadcast('update',{});return {ok:true,candidate:publicCandidate(c)};
  }
  if(path==='/api/whatsapp/alias-approve'){const boss=bossNames().find(n=>norm(n)===norm(input.boss)),alias=String(input.alias||'').trim();if(!boss||alias.length<2||alias.length>80)throw new Error('Alias inválido');w.aliases[boss]=[...new Set([...(w.aliases[boss]||[]),alias])].slice(0,50);const suggestion=w.aliasSuggestions.find(x=>x.boss===boss&&norm(x.alias)===norm(alias));if(suggestion){suggestion.status='APROVADO';suggestion.approvedAt=Date.now();}await persist();broadcast('update',{});return {ok:true,dictionary:dict()};}
  if(path==='/api/whatsapp/dismiss'){w.pending=w.pending.filter(p=>p.id!==input.id);await persist();return {ok:true};}
  return null;
 }
 async function handle(req,res,url){
  const isCollector=url.pathname.startsWith('/extension/')||url.pathname==='/api/community/evidence';if(!isCollector)return false;
  const origin=req.headers.origin||'',match=origin.match(/^chrome-extension:\/\/([a-p]{32})$/)||(!origin?String(req.headers['x-radar-extension']||'').match(/^([a-p]{32})$/):null);
  const reply=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store',...(match&&origin?{'Access-Control-Allow-Origin':origin,'Vary':'Origin'}:{})});res.end(JSON.stringify(data));};
  if(!match){reply(403,{error:'Origem da extensão inválida'});return true;}
  if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, X-Radar-Key, X-Radar-Extension','Access-Control-Max-Age':'600','Access-Control-Allow-Private-Network':'true','Vary':'Origin'});res.end();return true;}
  if(req.method!=='POST'){reply(405,{error:'Método inválido'});return true;}
  try{
   const input=await readBody(req);
   if(url.pathname==='/extension/pair'){
    if(++attempts>10||!pairing||pairing.expires<Date.now()||input.code!==pairing.code)throw new Error('Código inválido ou expirado. Gere outro no painel.');
    if(typeof input.group!=='string'||!exactGroup(input.group)||badGroup(input.group)||!worlds.includes(input.world))throw new Error('Esta versão monitora exclusivamente o grupo Lunarian.');
    if(w.connection?.collectorId){w.revokedCollectors.unshift({collectorId:w.connection.collectorId,revokedAt:Date.now(),reason:'repaired'});w.revokedCollectors=w.revokedCollectors.slice(0,100);}const key=randomBytes(32).toString('hex');w.connection={extensionId:match[1],keyHash:digest(key),group:'Lunarian',world:input.world,collectorId:'collector-'+randomBytes(8).toString('hex'),pairedAt:Date.now()};w.checkpoint=null;w.collector={status:'CONNECTED',metrics:{},captureLatencies:[],lastHeartbeatAt:Date.now(),extensionVersion:String(input.extensionVersion||'').slice(0,30)};pairing=null;await persist();broadcast('update',{});reply(200,{key,collectorId:w.connection.collectorId,group:'Lunarian',world:input.world,dictionary:dict(),latestExtensionVersion:LATEST_EXTENSION});return true;
   }
   const c=w.connection;if(!c||c.extensionId!==match[1]||digest(String(req.headers['x-radar-key']||''))!==c.keyHash)throw new Error('Extensão desconectada. Conecte novamente no painel.');
   if(input.group&& !exactGroup(input.group))throw new Error('Somente o grupo Lunarian está autorizado.');
   if(url.pathname==='/extension/config'){rate(c,'heartbeat');reply(200,{group:'Lunarian',world:c.world,collectorId:c.collectorId,dictionary:dict(),checkpoint:w.checkpoint,latestExtensionVersion:LATEST_EXTENSION,serverTime:Date.now()});return true;}
   if(url.pathname==='/extension/heartbeat'){rate(c,'heartbeat');heartbeat(input);if(Date.now()-lastHeartbeatPersist>60000){lastHeartbeatPersist=Date.now();await persist();}broadcast('update',{});reply(200,{ok:true,serverTime:Date.now(),dictionaryVersion:dict().version});return true;}
   if(url.pathname==='/api/community/evidence'){
    rate(c,'evidence');const batch=Array.isArray(input.evidence)?input.evidence:[];if(!batch.length||batch.length>100)throw new Error('Envie de 1 a 100 evidências por lote.');
    const known=new Set(w.communityEvidence.map(x=>x.id)),accepted=[],duplicates=[],changedCandidates=new Set(),receivedAt=Date.now(),d=dict(),byName=new Map(d.entries.map(x=>[norm(x.name),x]));
    for(const raw of batch){
     if(typeof raw.messageFingerprint!=='string'||!/^[a-f0-9]{64}$/.test(raw.messageFingerprint)||!contexts.has(raw.contextClassification))throw new Error('Evidência inválida');
     const candidates=(raw.bossCandidates||[]).slice(0,5).map(x=>{const b=byName.get(norm(x.name));if(!b)return null;return {boss_id:b.boss_id,name:b.name,matchType:['EXACT','ALIAS','FUZZY'].includes(x.matchType)?x.matchType:'FUZZY',similarity:Math.max(0,Math.min(1,Number(x.similarity)||0)),matched:String(x.matched||'').slice(0,80)};}).filter(Boolean);if(!candidates.length)continue;
     const item={messageFingerprint:raw.messageFingerprint,source:'whatsapp-lunarian',group:'Lunarian',world:c.world,bossCandidates:candidates,messageTimestamp:Number(raw.messageTimestamp)||null,capturedTimestamp:Number(raw.capturedTimestamp)||receivedAt,receivedAt,authorHash:/^[a-f0-9]{16,64}$/.test(raw.authorHash||'')?raw.authorHash:null,contextClassification:raw.contextClassification,text:String(raw.text||'').slice(0,1000),normalizedText:String(raw.normalizedText||'').slice(0,1000),extensionVersion:String(raw.extensionVersion||'').slice(0,30),collectorId:c.collectorId};item.id=evidenceId(item);
     if(known.has(item.id)){duplicates.push(item.id);continue;}known.add(item.id);w.communityEvidence.unshift(item);accepted.push(item.id);w.collector.lastRelevantMessageAt=receivedAt;w.collector.captureLatencies.push(Math.max(0,receivedAt-item.capturedTimestamp));w.collector.captureLatencies=w.collector.captureLatencies.slice(-5000);if(Number.isFinite(item.messageTimestamp)&&item.capturedTimestamp>=item.messageTimestamp){w.collector.messageCaptureApproxLatencies ||= [];w.collector.messageCaptureApproxLatencies.push(Math.max(0,item.capturedTimestamp-item.messageTimestamp));w.collector.messageCaptureApproxLatencies=w.collector.messageCaptureApproxLatencies.slice(-5000);}
     const candidate=mergeEvidence(w.candidates,item);if(candidate){enrichCandidate(candidate,w.communityEvidence);changedCandidates.add(candidate.id);if(candidate.score>=70&&candidate.participants>=2&&!candidate.notifiedAt){candidate.notifiedAt=Date.now();Promise.resolve(onCandidate(publicCandidate(candidate))).catch(()=>{});}}
    }
    const latest=batch.map(x=>({id:x.messageFingerprint,at:Number(x.messageTimestamp)||Number(x.capturedTimestamp)||receivedAt})).filter(x=>/^[a-f0-9]{64}$/.test(x.id)&&Number.isFinite(x.at)).sort((a,b)=>a.at-b.at).at(-1);if(latest&&(!w.checkpoint||latest.at>=w.checkpoint.at))w.checkpoint=latest;
    w.communityEvidence=w.communityEvidence.slice(0,20000);w.candidates=w.candidates.slice(0,5000);w.collector.metrics={...(w.collector.metrics||{}),relevantMessages:safeNum((w.collector.metrics?.relevantMessages||0)+accepted.length),duplicates:safeNum((w.collector.metrics?.duplicates||0)+duplicates.length)};w.lastSync=receivedAt;await persist();broadcast('update',{});
    for(const id of changedCandidates){const candidate=w.candidates.find(x=>x.id===id);if(candidate&&candidate.investigation?.status==='PENDING'){candidate.investigation={status:'REQUESTED',at:Date.now()};Promise.resolve(investigate(publicCandidate(candidate))).then(async result=>{candidate.investigation={status:'COMPLETED',at:Date.now(),result:result&&typeof result==='object'?{rawScore:result.rawScore,calibratedConfidence:result.calibratedConfidence,recommendation:result.recommendation,independentEvidence:result.consensus?.independentEvidence||0,conflictScore:result.consensus?.conflictScore||0}:null};await persist();broadcast('update',{kind:'investigation',candidateId:candidate.id});}).catch(async e=>{candidate.investigation={status:'ERROR',at:Date.now(),error:String(e.message||e).slice(0,200)};await persist();broadcast('update',{kind:'investigation-error',candidateId:candidate.id});});}}
    reply(200,{ok:true,accepted,duplicates,queueAck:accepted.length+duplicates.length,serverTime:receivedAt});return true;
   }
   if(url.pathname==='/extension/image'){
    const related=w.communityEvidence.some(e=>e.messageFingerprint===input.messageId);if(!/^[a-f0-9]{64}$/.test(input.messageId||'')||!related)throw new Error('Envie primeiro a evidência da mensagem relacionada.');
    const image=decodeGroupImage(input.data),id=digest(input.messageId+'|'+image.hash);if(w.images.some(i=>i.id===id)){reply(200,{ok:true,id});return true;}if(w.images.length>=2000)throw new Error('Limite de 2 mil imagens atingido.');
    await saveImage(id,image);w.images.unshift({id,messageId:input.messageId,at:Date.now(),world:c.world,group:'Lunarian',type:image.type,url:'/api/group-image?id='+id});await persist();broadcast('update',{});reply(200,{ok:true,id});return true;
   }
   if(url.pathname==='/extension/status'){heartbeat({status:input.status,extensionVersion:input.extensionVersion,queueSize:input.queueSize,metrics:input.metrics,diagnostics:input.diagnostics});reply(200,{ok:true});return true;}
   if(url.pathname==='/extension/sync'){
    // Compatibility with extension <=1.3: retain as review-only evidence. Never calls onRecords.
    if(!Array.isArray(input.messages)||input.messages.length>100)throw new Error('Envie até 100 mensagens por lote.');const seen=new Set(w.seen),reviews=[];
    for(const m of input.messages){if(!/^[a-f0-9]{64}$/.test(m.id||'')||typeof m.text!=='string'||m.text.length>6000)throw new Error('Mensagem inválida');if(seen.has(m.id))continue;const parsed=extractObservations(m,bossNames());if(parsed.mentioned?.length)reviews.push({id:m.id,bosses:parsed.mentioned.slice(0,20),date:String(m.date||'').slice(0,10),time:String(m.time||'').slice(0,5),reason:'Extensão antiga: revise manualmente. Nenhum spawn foi confirmado automaticamente.'});seen.add(m.id);}
    w.seen=[...seen].slice(-20000);w.pending.unshift(...reviews);w.pending=w.pending.slice(0,2000);w.lastSync=Date.now();w.status='Extensão antiga detectada. Atualize para 1.4.0; mensagens permanecem apenas para revisão.';await persist();broadcast('update',{});reply(200,{added:0,pending:reviews.length,checkpoint:w.checkpoint,legacy:true});return true;
   }
   throw new Error('Rota inválida');
  }catch(e){w.collector.metrics={...(w.collector.metrics||{}),errors:safeNum((w.collector.metrics?.errors||0)+1),requests:safeNum((w.collector.metrics?.requests||0)+1)};reply(400,{error:e.message});}
  return true;
 }
 return {handle,control,publicState};
}
function cleanDiagnostics(d){if(!d)return null;return {configured:String(d.configured||'').slice(0,150),detected:String(d.detected||'').slice(0,150),visible:safeNum(d.visible,0,100000),relevant:safeNum(d.relevant,0,100000),withoutDate:safeNum(d.withoutDate,0,100000),domOk:!!d.domOk,fallbackUsed:!!d.fallbackUsed,gapDetected:!!d.gapDetected,gapFrom:Number.isFinite(Number(d.gapFrom))?Number(d.gapFrom):null,gapTo:Number.isFinite(Number(d.gapTo))?Number(d.gapTo):null,manual:!!d.manual};}
function cleanMetrics(m){if(!m||typeof m!=='object')return {};const out={};for(const k of ['messagesSeen','messagesFiltered','bossMatches','exactMatches','fuzzyMatches','duplicates','errors','domAdapterErrors','observerEvents','batches','requests'])out[k]=safeNum(m[k],0,1e12);return out;}

import {digest} from '../mlops/feature-store.mjs';

export const DECISION_ENGINE_VERSION='1.0.0';
const H=3600000,MIN=60000,DAY=24*H;
const clamp=(n,a=0,b=1)=>Math.max(a,Math.min(b,n));
const pct=n=>Number.isFinite(n)?clamp(Number(n)/100):null;
const round=(n,d=1)=>Number.isFinite(n)?Math.round(n*10**d)/10**d:null;
const mean=a=>{const x=a.filter(Number.isFinite);return x.length?x.reduce((s,n)=>s+n,0)/x.length:null;};
const q=(a,p)=>{const x=a.filter(Number.isFinite).sort((m,n)=>m-n);if(!x.length)return null;const at=(x.length-1)*p,i=Math.floor(at),f=at-i;return x[i]+(x[Math.min(i+1,x.length-1)]-x[i])*f;};
const HEALTH={HEALTHY:1,STALE:.65,DEGRADED:.45,RATE_LIMITED:.2,ERROR:.1,OFFLINE:0,UNKNOWN:.35};
const POLLABLE=new Set(['otbosstracker','rubinot-official']);
const TERMINAL_INVESTIGATION=new Set(['CONFIRMED','CONFIRMED_LATE','REJECTED','EXPIRED']);

function healthFactor(status){return HEALTH[String(status||'UNKNOWN').toUpperCase()]??.35;}
function weighted(parts){
 let n=0,d=0;for(const [value,weight] of parts){if(!Number.isFinite(value)||weight<=0)continue;n+=clamp(value)*weight;d+=weight;}return d?n/d:null;
}
function attentionFor(ops,world,boss,at){
 const key=world+'|'+boss.toLowerCase(),x=ops.attention[key]||{};return {...x,followClosely:!!x.followClosely,snoozedUntil:Number(x.snoozedUntil)||0,acknowledgedAt:Number(x.acknowledgedAt)||0,activeSnooze:(Number(x.snoozedUntil)||0)>at};
}
function sourceRows(intelligence,investigation){
 const inv=new Map((investigation?.sources||[]).map(x=>[x.id,x]));return (intelligence?.sources||[]).filter(x=>x.active!==false&&x.eventEvidence!==false).map(x=>{const i=inv.get(x.id)||{},status=i.health||x.circuitState==='OPEN'?(x.circuitReason==='technical'?'ERROR':'DEGRADED'):'HEALTHY';return {...x,...i,id:x.id,name:i.name||x.name||x.id,health:i.health||status,reliability:Number(i.reliability??x.reliability),firstDetectionRate:Number(i.firstDetectionRate),latency:i.latency||{averageMs:x.averageLatencyMs??null,averageDelayMinutes:x.averageDelayMinutes??null}};});
}
function sourceCoverage(rows,whatsapp){
 if(!rows.length)return null;let n=0,d=0;for(const s of rows){const rel=Number.isFinite(s.reliability)?clamp(s.reliability/100):.5;let availability=healthFactor(s.health);if(s.id==='whatsapp-group'&&Number.isFinite(whatsapp?.coverage?.coveragePct))availability*=clamp(whatsapp.coverage.coveragePct/100);n+=rel*availability;d+=rel;}return d?n/d:null;
}
function latencyRisk(rows){
 const measured=rows.map(s=>Number(s.latency?.averageDelayMinutes)).filter(Number.isFinite);if(!measured.length)return null;return mean(measured.map(m=>clamp(m/120)));
}
function recentSignals(whatsapp,boss,at){
 const candidates=(whatsapp?.candidates||[]).filter(c=>c.boss===boss&&c.status==='PENDING'&&at-(Number(c.lastEvidenceAt)||Number(c.firstEvidenceAt)||0)<=30*MIN);
 const evidence=candidates.flatMap(c=>c.evidence||[]),recent2=evidence.filter(e=>at-(Number(e.receivedAt)||Number(e.capturedTimestamp)||Number(e.messageTimestamp)||0)<=2*MIN),recent10=evidence.filter(e=>at-(Number(e.receivedAt)||Number(e.capturedTimestamp)||Number(e.messageTimestamp)||0)<=10*MIN),reporters=new Set(recent10.map(e=>e.authorHash).filter(Boolean)),score=Math.max(0,...candidates.map(c=>Number(c.score)||0));
 return {candidates,evidence,recent2:recent2.length,recent10:recent10.length,independentReporters:reporters.size,candidateScore:score,momentumScore:100*clamp(recent2.length/5),latestCandidate:candidates.sort((a,b)=>(b.lastEvidenceAt||0)-(a.lastEvidenceAt||0))[0]||null};
}
function investigationFor(investigation,boss){
 return (investigation?.cases||[]).filter(c=>c.boss===boss&&!TERMINAL_INVESTIGATION.has(c.status)).sort((a,b)=>(b.updatedAt||b.createdAt||0)-(a.updatedAt||a.createdAt||0))[0]||null;
}
function peakOf(prediction){
 const rows=prediction?.probabilityDistribution||[];if(!rows.length)return null;const best=rows.reduce((a,b)=>!a||b.probability>a.probability?b:a,null);return best?{from:best.from,to:best.to,at:Math.round((best.from+best.to)/2),slotProbability:best.probability}:null;
}
function windowProximity(prediction,at){
 if(prediction?.status!=='ready'||!Number.isFinite(prediction.windowStart)||!Number.isFinite(prediction.windowEnd))return null;
 if(at>=prediction.windowStart&&at<=prediction.windowEnd)return 1;
 if(at<prediction.windowStart)return clamp(1-(prediction.windowStart-at)/(12*H));
 return clamp(1-(at-prediction.windowEnd)/(6*H));
}
function uncertaintyScore(prediction){
 if(prediction?.status!=='ready'||!Number.isFinite(prediction.uncertaintyMs))return null;const typical=Number(prediction.intervalRecentMs)||Number(prediction.intervalAverageMs)||24*H;return clamp((2*prediction.uncertaintyMs)/Math.max(6*H,typical));
}
function sourceSpecialty(source,boss){
 const rows=Array.isArray(source.bossSpecialties)?source.bossSpecialties:[];for(const x of rows){if(typeof x==='string'&&x===boss)return 1;if(x&&typeof x==='object'&&String(x.boss||x.name||'')===boss)return Number.isFinite(Number(x.rate))?clamp(Number(x.rate)/100):1;}return null;
}
function recentEvidenceSources(invCase){return new Set((invCase?.evidence||[]).filter(x=>x.positive).map(x=>x.sourceId).filter(Boolean));}
function sourceValue(source,boss,infoGap,urgency,used){
 const availability=healthFactor(source.health);if(availability<=.2)return {sourceId:source.id,name:source.name,status:source.health,valueOfInformation:0,eligible:false,reason:source.health==='RATE_LIMITED'?'rate_limited':'source_unavailable'};
 const reliability=pct(source.reliability),first=pct(source.firstDetectionRate),delay=Number(source.latency?.averageDelayMinutes),latency=Number.isFinite(delay)?1/(1+delay/30):null,specialty=sourceSpecialty(source,boss),quality=weighted([[reliability,.4],[first,.25],[latency,.2],[specialty,.15]]);
 if(quality==null)return {sourceId:source.id,name:source.name,status:source.health,valueOfInformation:null,eligible:false,reason:'insufficient_source_history'};
 const duplicatePenalty=used.has(source.id)?.35:1,voi=100*clamp(infoGap/100)*quality*availability*duplicatePenalty*(.7+.3*clamp(urgency));
 return {sourceId:source.id,name:source.name,status:source.health,reliability:source.reliability,firstDetectionRate:Number.isFinite(source.firstDetectionRate)?source.firstDetectionRate:null,averageDelayMinutes:Number.isFinite(delay)?delay:null,specialty,alreadyContributed:used.has(source.id),valueOfInformation:round(voi),eligible:true,components:{informationGap:round(infoGap),sourceQuality:round(quality*100),availability:round(availability*100),urgency:round(urgency*100),duplicatePenalty}};
}
function pollingInterval(priority,state,follow){
 let ms=priority>=85?60*1000:priority>=70?2*MIN:priority>=55?5*MIN:priority>=35?10*MIN:15*MIN;
 if(['UNDER_INVESTIGATION','PENDING_CONFIRMATION','POSSIBLE_SIGNAL','WINDOW_ACTIVE'].includes(state))ms=Math.min(ms,60*1000);if(follow)ms=Math.min(ms,60*1000);return ms;
}
function decisionState({prediction,priority,velocity,signals,invCase,lastConfirmedAt,at}){
 if(Number.isFinite(lastConfirmedAt)&&at-lastConfirmedAt<=30*MIN)return 'CONFIRMED';
 if(Number.isFinite(lastConfirmedAt)&&at-lastConfirmedAt<=6*H&&!signals.candidates.length&&!invCase)return 'COOLDOWN';
 if(invCase?.status==='MANUAL_REVIEW_REQUIRED'||invCase?.recommendation==='CONFIRM_RECOMMENDED')return 'PENDING_CONFIRMATION';
 if(invCase)return 'UNDER_INVESTIGATION';
 if(signals.candidates.length)return 'POSSIBLE_SIGNAL';
 if(prediction?.drift?.detected&&Number(prediction.drift.score)>=70)return 'ANOMALOUS';
 if(priority>=80)return 'HIGH_PRIORITY';
 if(prediction?.status==='ready'&&prediction.phase==='active')return 'WINDOW_ACTIVE';
 if(prediction?.status==='ready'&&Number.isFinite(prediction.windowStart)&&prediction.windowStart>at&&prediction.windowStart-at<=3*H)return 'WINDOW_APPROACHING';
 if(velocity>=10)return 'RISING';
 if(priority>=60)return 'WATCH';
 if(priority>=35)return 'MONITORING';
 return 'DORMANT';
}
function nextBestAction({state,infoGap,nextSource,signals,invCase,priority}){
 if(['CONFIRMED','COOLDOWN'].includes(state)||priority<35)return {action:'NO_ACTION',automatic:false,reason:'operational_attention_not_needed'};
 if(invCase?.status==='MANUAL_REVIEW_REQUIRED')return {action:'MANUAL_REVIEW',automatic:false,reason:'investigation_requires_human_review'};
 if(invCase)return {action:'CONTINUE_INVESTIGATION',automatic:true,reason:'active_investigation_exists'};
 if(signals.candidates.length&&signals.independentReporters<2)return {action:'REVIEW_LUNARIAN',automatic:false,reason:'signal_needs_independent_confirmation'};
 if(infoGap>=55&&nextSource?.eligible)return {action:'CHECK_SOURCE',sourceId:nextSource.sourceId,automatic:POLLABLE.has(nextSource.sourceId),reason:'high_information_gap_and_source_value'};
 if(priority>=70)return {action:'WAIT_FOR_MORE_EVIDENCE',automatic:true,reason:'priority_high_but_information_gap_controlled'};
 return {action:'MONITOR',automatic:true,reason:'continue_passive_monitoring'};
}
function whyNow(f){
 const rows=[];if(f.window>=.8)rows.push({factor:'janela próxima/ativa',impact:'UP'});if(f.probability>=.7)rows.push({factor:'probabilidade do modelo alta',impact:'UP'});if(f.signal>=.5)rows.push({factor:'sinais recentes',impact:'UP'});if(f.missRisk>=.5)rows.push({factor:'risco de detecção tardia',impact:'UP'});if(f.infoGap>=.6)rows.push({factor:'lacuna de informação',impact:'UP'});if(f.novelty>=.45)rows.push({factor:'estado incomum do servidor',impact:'UP'});if(f.coverage>=.85)rows.push({factor:'boa cobertura atual',impact:'DOWN'});if(f.confidence>=.85)rows.push({factor:'alta confiança do modelo',impact:'DOWN_GAP'});return rows;}
function mindChanges(row){
 const up=[],down=[];if(row.signals.independentReporters<2)up.push('uma segunda fonte/reportador independente confirmar');if(row.informationGapScore>=50&&row.nextBestSource?.name)up.push(row.nextBestSource.name+' trouxer evidência nova');if(row.priorityScore<80)up.push('probabilidade ou velocidade subir materialmente');down.push('a janela passar sem novos sinais');if(row.signals.candidates.length)down.push('o candidato atual ser rejeitado');if(row.informationGapScore>40)down.push('cobertura e confiança aumentarem sem evidência positiva');return {up,down};
}
function alertLevel(score){return score>=90?'CRITICAL':score>=80?'HIGH':score>=70?'IMPORTANT':score>=55?'WATCH':'INFO';}
function meaningful(prev,row){
 if(!prev)return row.signals.candidates.length>0&&row.priorityScore>=70;
 if(prev.state!==row.state&&['HIGH_PRIORITY','POSSIBLE_SIGNAL','UNDER_INVESTIGATION','PENDING_CONFIRMATION','CONFIRMED','ANOMALOUS'].includes(row.state))return true;
 if(row.priorityScore-prev.priorityScore>=15)return true;if(row.signals.recent2>Number(prev.signals?.recent2||0)&&row.signals.independentReporters>=2)return true;return false;
}
function scoreBoss({prediction,prev,signals,invCase,coverage,latency,whatsapp,attention,lastConfirmedAt,at,settings,sourceRows}){
 const probability=prediction?.status==='ready'&&Number.isFinite(prediction.probability)?clamp(prediction.probability/100):null,confidence=prediction?.status==='ready'?pct(prediction.confidence):null,predictability=prediction?.status==='ready'?pct(prediction.predictionScore):null,window=windowProximity(prediction,at),uncertainty=uncertaintyScore(prediction),novelty=Number.isFinite(prediction?.noveltySafety?.noveltyScore)?clamp(prediction.noveltySafety.noveltyScore):0,investigationSignal=Number.isFinite(invCase?.calibratedConfidence)?clamp(invCase.calibratedConfidence/100):Number.isFinite(invCase?.rawScore)?clamp(invCase.rawScore/100):0,signal=Math.max(clamp(signals.candidateScore/100),investigationSignal,clamp(signals.momentumScore/100)),opportunity=Math.max(probability??0,signal),sourceFailure=sourceRows.length?mean(sourceRows.map(s=>1-healthFactor(s.health))):null,latencyR=latency??.5,coverageN=coverage??0,lunarianHealthy=!!whatsapp?.health?.browserConnected&&!!whatsapp?.health?.whatsappDetected,missRisk=opportunity>0?clamp((.55*(1-coverageN)+.25*latencyR+.2*(sourceFailure??.5))*(.55*opportunity+.25*signal+.2*(window??0))):null,infoGap=weighted([[confidence==null?1:1-confidence,.3],[1-coverageN,.25],[lunarianHealthy?0:1,.15],[uncertainty==null?1:uncertainty,.15],[novelty,.1],[invCase?.recommendation==='HIGH_CONFLICT'?1:0,.05]]),elapsed=prev&&Number.isFinite(prev.asOf)&&at>prev.asOf?(at-prev.asOf)/H:null,probVelocity=prev&&elapsed&&probability!=null&&Number.isFinite(prev.modelProbability)?((probability*100-prev.modelProbability)/elapsed):0,velocityScore=clamp(Math.max(0,probVelocity)/30),favorite=!!settings?.progress?.[prediction?.boss||signals.latestCandidate?.boss]?.favorite;
 const priority=weighted([[opportunity,.25],[window,.15],[velocityScore,.08],[missRisk,.15],[infoGap,.15],[clamp(signals.momentumScore/100),.1],[novelty,.05],[favorite?1:0,.04],[predictability,.03]]);
 if(priority==null||(!prediction||prediction.status!=='ready')&&!signals.candidates.length&&!invCase)return {status:'INSUFFICIENT_DATA',priorityScore:null,modelProbability:probability==null?null:round(probability*100),probabilityVelocity:round(probVelocity),confidence:confidence==null?null:round(confidence*100),predictability:predictability==null?null:round(predictability*100),window,uncertainty,novelty,missRisk:null,infoGap:round((infoGap??1)*100),signal,coverage:coverageN};
 return {status:'MEASURED',priorityScore:Math.round(priority*100),modelProbability:probability==null?null:round(probability*100),probabilityVelocity:round(probVelocity),confidence:confidence==null?null:round(confidence*100),predictability:predictability==null?null:round(predictability*100),window,uncertainty,novelty,missRisk:round((missRisk??0)*100),infoGap:round((infoGap??1)*100),signal,coverage:coverageN};
}
export function ensureOperations(state,at=Date.now()){
 state.operations||={schema:1,createdAt:at,decisionChampion:{id:'decision_rules_v1',version:1,status:'CHAMPION',promotedAt:at,explainable:true},challengers:[],attention:{},current:null,timeline:[],snapshots:[],alerts:[],investigations:[],actionOutcomes:[],sourceActions:[],queryBaseline:null,version:0};
 const o=state.operations;if(o.schema!==1)throw new Error('Operations schema não suportado');o.attention||={};o.timeline||=[];o.snapshots||=[];o.alerts||=[];o.investigations||=[];o.actionOutcomes||=[];o.sourceActions||=[];o.challengers||=[];o.version=Number(o.version)||0;return o;
}
export function runDecisionCycle(state,{world,intelligence,investigation,whatsapp,system,settings},at=Date.now()){
 const ops=ensureOperations(state,at),predictions=intelligence?.predictions||[],sources=sourceRows(intelligence,investigation),coverage=sourceCoverage(sources,whatsapp),latency=latencyRisk(sources),prevByBoss=new Map((ops.current?.bosses||[]).map(x=>[x.boss,x])),eventBosses=(intelligence?.events||[]).filter(e=>e.world===world).map(e=>e.boss),candidateBosses=(whatsapp?.candidates||[]).filter(x=>x.world===world&&x.status==='PENDING').map(x=>x.boss),names=[...new Set([...predictions.map(x=>x.boss),...eventBosses,...candidateBosses])],rows=[];
 for(const boss of names){const prediction=predictions.find(x=>x.boss===boss)||{boss,world,status:'insufficient'},signals=recentSignals(whatsapp,boss,at),invCase=investigationFor(investigation,boss),prev=prevByBoss.get(boss),attention=attentionFor(ops,world,boss,at),lastConfirmed=(intelligence?.events||[]).filter(e=>e.boss===boss&&e.world===world&&/^confirmed_/.test(e.status)&&e.eventType==='appearance'&&Number.isFinite(e.estimatedAt)&&e.estimatedAt<=at).sort((a,b)=>b.estimatedAt-a.estimatedAt)[0]?.estimatedAt??null,scored=scoreBoss({prediction,prev,signals,invCase,coverage,latency,whatsapp,attention,lastConfirmedAt:lastConfirmed,at,settings,sourceRows:sources});
  if(scored.status==='INSUFFICIENT_DATA'){rows.push({boss,world,asOf:at,status:'INSUFFICIENT_DATA',state:'INSUFFICIENT_DATA',priorityScore:null,decisionConfidence:null,modelProbability:scored.modelProbability,informationGapScore:scored.infoGap,missedDetectionRisk:null,signals:{candidateCount:signals.candidates.length,recent2:signals.recent2,recent10:signals.recent10,independentReporters:signals.independentReporters},nextBestAction:{action:'NO_ACTION',automatic:false,reason:'insufficient_data'},nextBestSource:null,polling:{intervalMs:15*MIN,reason:'insufficient_data'},whyNow:[],whatWouldChange:{up:['novas evidências confiáveis ou histórico suficiente'],down:[]}});continue;}
  const stateName=decisionState({prediction,priority:scored.priorityScore,velocity:scored.probabilityVelocity,signals,invCase,lastConfirmedAt:lastConfirmed,at}),used=recentEvidenceSources(invCase),urgency=scored.window??clamp(scored.priorityScore/100),sourceValues=sources.map(s=>sourceValue(s,boss,scored.infoGap,urgency,used)).sort((a,b)=>(b.valueOfInformation??-1)-(a.valueOfInformation??-1)),nextSource=sourceValues.find(x=>x.eligible&&(x.valueOfInformation??0)>0)||null,pollMs=pollingInterval(scored.priorityScore,stateName,attention.followClosely),safeLevel=String(system?.safeMode?.level||system?.status||'NORMAL').toUpperCase(),safeCap=safeLevel==='CRITICAL'?35:safeLevel==='DEGRADED'||safeLevel==='FAILED'?60:100,sourceCap=Math.round(45+55*(scored.coverage??0)),decisionConfidence=Math.min(safeCap,sourceCap,Math.round(100*(weighted([[pct(scored.confidence),.35],[scored.coverage,.3],[pct(prediction.dataQualityScore),.15],[pct(invCase?.calibratedConfidence),.1],[1-(scored.uncertainty??1),.1]])??0))),action=nextBestAction({state:stateName,infoGap:scored.infoGap,nextSource,signals,invCase,priority:scored.priorityScore}),peak=peakOf(prediction),factors={probability:(scored.modelProbability??0)/100,confidence:(scored.confidence??0)/100,window:scored.window??0,signal:scored.signal,missRisk:(scored.missRisk??0)/100,infoGap:scored.infoGap/100,coverage:scored.coverage,novelty:scored.novelty};
  const row={boss,world,asOf:at,status:'MEASURED',state:stateName,priorityScore:scored.priorityScore,decisionConfidence,modelProbability:scored.modelProbability,probabilityVelocity:scored.probabilityVelocity,predictabilityScore:scored.predictability,uncertaintyScore:round((scored.uncertainty??1)*100),informationGapScore:scored.infoGap,missedDetectionRisk:scored.missRisk,detectionCoverage:round((scored.coverage??0)*100),peakProbabilityTime:peak?.at??prediction.predictedCenterAt??null,peakSlotProbability:peak?.slotProbability??null,windowStart:prediction.windowStart??null,windowEnd:prediction.windowEnd??null,probabilityCurve:prediction.probabilityDistribution||[],signals:{candidateCount:signals.candidates.length,recent2:signals.recent2,recent10:signals.recent10,independentReporters:signals.independentReporters,candidateScore:signals.candidateScore,investigationScore:invCase?.rawScore??null,lunarianHealthy:!!whatsapp?.health?.whatsappDetected},investigation:invCase?{id:invCase.id,candidateId:invCase.candidateId,status:invCase.status,recommendation:invCase.recommendation,rawScore:invCase.rawScore,calibratedConfidence:invCase.calibratedConfidence}:null,nextBestSource:nextSource,sourceRanking:sourceValues.slice(0,8),nextBestAction:action,polling:{intervalMs:pollMs,reason:attention.followClosely?'follow_closely':stateName.toLowerCase()},attention:{followClosely:attention.followClosely,activeSnooze:attention.activeSnooze,snoozedUntil:attention.snoozedUntil},whyNow:whyNow(factors),whatWouldChange:null};
  row.whatWouldChange=mindChanges(row);rows.push(row);
 }
 rows.sort((a,b)=>(b.priorityScore??-1)-(a.priorityScore??-1)||a.boss.localeCompare(b.boss));
 const previous=ops.current,alertsToSend=[];for(const row of rows.filter(x=>x.status==='MEASURED')){const prev=prevByBoss.get(row.boss);if(!meaningful(prev,row))continue;const attention=attentionFor(ops,world,row.boss,at);if(attention.activeSnooze)continue;const change=prev?Math.max(0,row.priorityScore-prev.priorityScore):0,alertValue=Math.round(100*(weighted([[row.priorityScore/100,.4],[(row.missedDetectionRisk??0)/100,.2],[clamp(change/30),.15],[row.decisionConfidence/100,.15],[row.signals.independentReporters>=2?1:0,.1]])??0)),level=alertLevel(alertValue),last=ops.alerts.find(x=>x.world===world&&x.boss===row.boss&&x.status!=='SUPPRESSED'),critical=level==='CRITICAL'||row.state==='CONFIRMED';if(last&&!critical&&at-last.createdAt<30*MIN)continue;if(!['IMPORTANT','HIGH','CRITICAL'].includes(level))continue;const id='OPS-ALERT-'+digest({world,boss:row.boss,state:row.state,bucket:Math.floor(row.priorityScore/10),candidate:row.investigation?.candidateId||null,at:Math.floor(at/(5*MIN))}).slice(0,24),alert={id,world,boss:row.boss,createdAt:at,status:'PLANNED',level,alertValueScore:alertValue,priorityScore:row.priorityScore,previousPriority:prev?.priorityScore??null,state:row.state,previousState:prev?.state??null,modelProbability:row.modelProbability,decisionConfidence:row.decisionConfidence,missedDetectionRisk:row.missedDetectionRisk,reason:row.whyNow.map(x=>x.factor),change:prev?{priority:(row.priorityScore-prev.priorityScore),state:prev.state===row.state?null:prev.state+' → '+row.state}:null};if(!ops.alerts.some(x=>x.id===id)){ops.alerts.unshift(alert);alertsToSend.push(alert);}}
 for(const row of rows){const prev=prevByBoss.get(row.boss);if(!prev||prev.state!==row.state||prev.priorityScore!==row.priorityScore){ops.timeline.unshift({id:'DEC-'+digest({world,boss:row.boss,at,state:row.state,priority:row.priorityScore}).slice(0,20),at,world,boss:row.boss,previousState:prev?.state??null,newState:row.state,previousPriority:prev?.priorityScore??null,priorityScore:row.priorityScore,reason:row.whyNow.map(x=>x.factor),inputs:{modelProbability:row.modelProbability,decisionConfidence:row.decisionConfidence,informationGapScore:row.informationGapScore,missedDetectionRisk:row.missedDetectionRisk,signals:row.signals},decisionEngineVersion:DECISION_ENGINE_VERSION});}}
 const ranked=rows.filter(x=>x.priorityScore!=null).slice(0,20).map((x,i)=>({rank:i+1,boss:x.boss,priorityScore:x.priorityScore,state:x.state}));ops.snapshots.push({at,world,ranking:ranked});if(ops.snapshots.length>20000)ops.snapshots.splice(0,ops.snapshots.length-20000);if(ops.timeline.length>20000)ops.timeline.length=20000;if(ops.alerts.length>5000)ops.alerts.length=5000;
 const top=rows.find(x=>x.priorityScore!=null),globalIntervalMs=top?Math.max(60*1000,Math.min(15*MIN,top.polling.intervalMs)):15*MIN,activeInvestigations=rows.filter(x=>x.priorityScore>=70&&x.informationGapScore>=50).map(x=>({id:'OPS-INV-'+digest({world,boss:x.boss,at:Math.floor(at/(5*MIN))}).slice(0,20),boss:x.boss,world,status:x.investigation?'ACTIVE':'PLANNED',priorityScore:x.priorityScore,informationGapScore:x.informationGapScore,resourceBudget:x.priorityScore>=85?'HIGH':'MEDIUM',sourceBudget:Math.min(3,x.sourceRanking.filter(s=>s.eligible).length),timeBudgetMs:x.priorityScore>=85?5*MIN:10*MIN,stopConditions:['CONFIRMED','CONFIDENCE_SUFFICIENT','CANDIDATE_REJECTED','WINDOW_EXPIRED','INFORMATION_NO_LONGER_RELEVANT'],steps:x.sourceRanking.filter(s=>s.eligible).slice(0,3).map((s,i)=>({order:i+1,action:s.sourceId==='whatsapp-group'?'REVIEW_LUNARIAN':'CHECK_SOURCE',sourceId:s.sourceId,valueOfInformation:s.valueOfInformation}))}));
 ops.investigations=activeInvestigations;ops.version++;ops.current={version:ops.version,world,asOf:at,decisionEngineVersion:DECISION_ENGINE_VERSION,champion:ops.decisionChampion,bosses:rows,topPriority:rows.filter(x=>x.priorityScore!=null).slice(0,10),activeInvestigations,polling:{globalIntervalMs,baselineIntervalMs:4*MIN,mode:'ADAPTIVE_GLOBAL_V1',nextBestSources:[...new Set(rows.map(x=>x.nextBestSource?.sourceId).filter(Boolean))].slice(0,5)},alertsToSend:alertsToSend.map(x=>x.id)};
 if(!ops.queryBaseline){ops.queryBaseline={at,requests:Object.fromEntries((intelligence?.sources||[]).filter(x=>POLLABLE.has(x.id)).map(x=>[x.id,Number(x.requests)||0]))};}
 return {...ops.current,alertsToSend};
}
export function markDecisionAlertDispatched(state,id,at=Date.now()){
 const o=ensureOperations(state,at),x=o.alerts.find(a=>a.id===id);if(x){x.status='DISPATCHED';x.dispatchedAt=at;}return x||null;
}
export function applyAttentionAction(state,{world,boss,action,minutes=60},at=Date.now()){
 const o=ensureOperations(state,at),key=String(world)+'|'+String(boss).toLowerCase(),x=o.attention[key]||{boss,world};
 if(action==='ACKNOWLEDGE'){x.acknowledgedAt=at;x.snoozedUntil=Math.max(x.snoozedUntil||0,at+30*MIN);}
 else if(action==='SNOOZE'){const m=Math.max(5,Math.min(24*60,Math.trunc(Number(minutes)||60)));x.snoozedUntil=at+m*MIN;}
 else if(action==='FOLLOW_CLOSELY'){x.followClosely=true;x.followSince=at;}
 else if(action==='UNFOLLOW'){x.followClosely=false;x.followSince=null;}
 else throw new Error('Ação operacional inválida');
 o.attention[key]=x;return x;
}
export function recordActionOutcome(state,input,at=Date.now()){
 const o=ensureOperations(state,at),row={id:'OPS-ACTION-'+digest({at,...input}).slice(0,24),at,world:String(input.world||''),boss:String(input.boss||''),action:String(input.action||''),sourceId:input.sourceId||null,outcome:String(input.outcome||'UNKNOWN'),uncertaintyBefore:Number.isFinite(input.uncertaintyBefore)?input.uncertaintyBefore:null,uncertaintyAfter:Number.isFinite(input.uncertaintyAfter)?input.uncertaintyAfter:null,useful:input.useful==null?null:!!input.useful};o.actionOutcomes.unshift(row);if(o.actionOutcomes.length>10000)o.actionOutcomes.length=10000;return row;
}
export function operationsMetrics(state,intelligence,world,at=Date.now()){
 const o=ensureOperations(state,at),snaps=o.snapshots.filter(x=>x.world===world),events=(intelligence?.events||[]).filter(e=>e.world===world&&/^confirmed_/.test(e.status)&&e.eventType==='appearance'&&Number.isFinite(e.estimatedAt)&&e.estimatedAt>=o.createdAt&&e.estimatedAt<=at).sort((a,b)=>a.estimatedAt-b.estimatedAt),evaluated=[];for(const e of events){const snap=snaps.filter(x=>x.at<=e.estimatedAt&&e.estimatedAt-x.at<=6*H).at(-1);if(!snap)continue;const rank=snap.ranking.find(x=>x.boss===e.boss)?.rank??null,high=o.timeline.filter(x=>x.world===world&&x.boss===e.boss&&x.newState==='HIGH_PRIORITY'&&x.at<=e.estimatedAt&&e.estimatedAt-x.at<=12*H).sort((a,b)=>a.at-b.at)[0],alerts=o.alerts.filter(x=>x.world===world&&x.boss===e.boss&&x.createdAt<=e.estimatedAt&&e.estimatedAt-x.createdAt<=6*H&&x.status!=='SUPPRESSED');evaluated.push({eventId:e.id,boss:e.boss,eventAt:e.estimatedAt,rank,earlyWarningMs:high?e.estimatedAt-high.at:null,alerted:alerts.length>0});}
 const n=evaluated.length,top=k=>n?100*evaluated.filter(x=>x.rank!=null&&x.rank<=k).length/n:null,alerts=o.alerts.filter(x=>x.world===world&&x.createdAt>=o.createdAt&&x.createdAt<=at&&x.status!=='SUPPRESSED'),alertHits=alerts.filter(a=>events.some(e=>e.boss===a.boss&&e.estimatedAt>=a.createdAt&&e.estimatedAt-a.createdAt<=6*H)).length,precision=alerts.length?100*alertHits/alerts.length:null,recall=n?100*evaluated.filter(x=>x.alerted).length/n:null,missed=n?100*evaluated.filter(x=>x.rank==null||x.rank>5).length/n:null,early=evaluated.map(x=>x.earlyWarningMs).filter(Number.isFinite),outcomes=o.actionOutcomes.filter(x=>x.world===world),useful=outcomes.filter(x=>x.useful===true),sourceRequests=(intelligence?.sources||[]).filter(x=>POLLABLE.has(x.id)),elapsed=Math.max(0,at-(o.queryBaseline?.at||at)),actual=sourceRequests.reduce((n,s)=>n+Math.max(0,(Number(s.requests)||0)-Number(o.queryBaseline?.requests?.[s.id]||0)),0),baselineExpected=elapsed>0?elapsed/(4*MIN)*Math.max(1,sourceRequests.length):0,queryReduction=baselineExpected>=5?100*(1-actual/baselineExpected):null;
 return {status:n>=5?'MEASURED':'INSUFFICIENT_DATA',since:o.createdAt,confirmedEvents:n,top1HitRate:round(top(1)),top3HitRate:round(top(3)),top5HitRate:round(top(5)),alertPrecision:round(precision),alertRecall:round(recall),falseAlarmRate:precision==null?null:round(100-precision),missedBossRate:round(missed),meanEarlyWarningMinutes:early.length?round(mean(early)/MIN):null,p50EarlyWarningMinutes:early.length?round(q(early,.5)/MIN):null,investigations:o.investigations.length,actionOutcomes:outcomes.length,usefulActions:useful.length,averageInformationGain:useful.length?round(mean(useful.map(x=>Number.isFinite(x.uncertaintyBefore)&&Number.isFinite(x.uncertaintyAfter)?x.uncertaintyBefore-x.uncertaintyAfter:null))):null,adaptivePolling:{actualQueries:actual,baselineExpectedQueries:baselineExpected>=1?round(baselineExpected):null,queryReductionPct:round(queryReduction),measurement:'requests_since_decision_engine_start'},limitations:n<20?['Métricas operacionais ainda possuem amostra pequena; não usar para promover Decision Challenger.']:[]};
}
export function operationsReplay(state,world,startAt,endAt){
 const o=ensureOperations(state),snaps=o.snapshots.filter(x=>x.world===world&&x.at>=startAt&&x.at<=endAt),timeline=o.timeline.filter(x=>x.world===world&&x.at>=startAt&&x.at<=endAt),alerts=o.alerts.filter(x=>x.world===world&&x.createdAt>=startAt&&x.createdAt<=endAt);return {world,startAt,endAt,snapshots:snaps,timeline,alerts,status:snaps.length?'MEASURED':'INSUFFICIENT_DATA'};
}

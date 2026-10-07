import {digest} from '../mlops/feature-store.mjs';
import {eventsAsOf} from './canonical-events.mjs';
import {bossGraph,sourceGraph} from './graphs.mjs';
import {beforeSpawnAnalysis,serverSaveAnalysis} from './context-analysis.mjs';

const H=3600000,DAY=24*H;
const REL_STATUSES=new Set(['DISCOVERED','TESTING','VALIDATED','REJECTED','ACTIVE','DEGRADED','ARCHIVED']);
const FEATURE_STATUSES=new Set(['DISCOVERED','TESTING','VALIDATED','REJECTED','ACTIVE']);
const round=(n,d=3)=>Number.isFinite(n)?Math.round(n*10**d)/10**d:null;
function brasiliaHour(at){const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(new Date(at)).map(x=>[x.type,x.value]));return (Number(p.hour)%24)+Number(p.minute)/60;}
export function ensureTemporalKnowledge(d,at=Date.now()){
 d.temporalKnowledge||={schema:1,createdAt:at,relationshipRegistry:{},featureRegistry:{},hypotheses:{},snapshots:[],sourceRelationships:[],sequenceRegistry:[],runs:[],version:0};
 const k=d.temporalKnowledge;if(k.schema!==1)throw new Error('Temporal Knowledge schema não suportado');k.relationshipRegistry||={};k.featureRegistry||={};k.hypotheses||={};k.snapshots||=[];k.sourceRelationships||=[];k.sequenceRegistry||=[];k.runs||=[];k.version=Number(k.version)||0;return k;
}
function stateAt(d,world,asOf){
 const events=eventsAsOf(d,world,asOf),recent=hours=>events.filter(e=>e.spawn.estimate>asOf-hours*H&&e.spawn.estimate<=asOf),last24=recent(24),save=(d.serverSaveSchedules||[]).filter(s=>s.world===world&&s.knownAt<=asOf&&s.validFrom<=asOf).sort((a,b)=>b.validFrom-a.validFrom)[0],hour=brasiliaHour(asOf),regime=(d.regimeHistory||[]).filter(r=>r.world===world&&r.asOf<=asOf).at(-1),last=events.at(-1);
 return {world,asOf,eventCount:events.length,lastBoss:last?.boss||null,lastEventAt:last?.spawn?.estimate||null,hoursSinceLastEvent:last?round((asOf-last.spawn.estimate)/H,2):null,bossesLast1h:recent(1).length,bossesLast3h:recent(3).length,bossesLast6h:recent(6).length,bossesLast12h:recent(12).length,bossesLast24h:last24.length,uniqueBossesLast24h:new Set(last24.map(e=>e.boss)).size,recentBosses:last24.slice(-12).map(e=>({boss:e.boss,eventTime:e.spawn.estimate,availableAt:e.availableAt,id:e.id})),hoursSinceServerSave:save?round((hour-save.hour+24)%24,2):null,serverSaveScheduleId:save?.id||null,regimeStatus:regime?.status||null,sourceCount24h:new Set(last24.flatMap(e=>e.evidence.map(x=>x.sourceId))).size};
}
function stateVector(s){return [s.bossesLast1h/4,s.bossesLast3h/8,s.bossesLast6h/12,s.bossesLast12h/24,s.bossesLast24h/40,s.uniqueBossesLast24h/20,(s.hoursSinceServerSave??12)/24,s.sourceCount24h/10];}
function similarity(a,b){
 const x=stateVector(a),y=stateVector(b);let d=0;for(let i=0;i<x.length;i++)d+=(x[i]-y[i])**2;d=Math.sqrt(d/x.length);if(a.regimeStatus&&b.regimeStatus&&a.regimeStatus!==b.regimeStatus)d+=.15;return Math.exp(-d);
}
function upsertSnapshots(d,k,world,asOf){
 const events=eventsAsOf(d,world,asOf),seen=new Set(k.snapshots.map(x=>x.id)),pending=events.filter(e=>{const knownAt=e.availableAt,id='STATE-'+digest({world,eventId:e.id,knownAt}).slice(0,24);return Number.isFinite(knownAt)&&knownAt<=asOf&&!seen.has(id);}).slice(-250);
 for(const e of pending){const knownAt=e.availableAt;if(!Number.isFinite(knownAt)||knownAt>asOf)continue;const id='STATE-'+digest({world,eventId:e.id,knownAt}).slice(0,24);if(seen.has(id))continue;const beforeAt=Math.max(1,knownAt-1),state=stateAt(d,world,beforeAt);k.snapshots.push({id,world,eventId:e.id,eventTime:e.spawn.estimate,availableAt:knownAt,capturedAsKnownAt:beforeAt,state});seen.add(id);}
 if(k.snapshots.length>10000)k.snapshots.splice(0,k.snapshots.length-10000);
}
function featureId(relation){return 'GRAPH-FEATURE-'+digest({relationId:relation.id,source:relation.sourceEntity,target:relation.targetEntity,window:relation.window}).slice(0,24);}
function hypothesisId(feature){return 'GRAPH-HYP-'+digest({featureId:feature.id,targetBoss:feature.targetBoss}).slice(0,24);}
function relationshipId(world,from,to,w){return 'REL-'+digest({world,from,to,fromHours:w.fromHours,toHours:w.toHours}).slice(0,24);}
function updateRelationship(k,world,edge,w,asOf){
 const id=relationshipId(world,edge.from,edge.to,w),existing=k.relationshipRegistry[id],candidate=w.status==='CANDIDATE_RELATIONSHIP',drift=!!w.relationshipDrift;
 let status=existing?.status|| (candidate?'DISCOVERED':w.status==='REJECTED'?'REJECTED':'DISCOVERED');
 if(!REL_STATUSES.has(status))status='DISCOVERED';
 if(existing&&['ACTIVE','VALIDATED','TESTING'].includes(existing.status)&&drift)status='DEGRADED';
 else if(existing&&['ACTIVE','VALIDATED','TESTING'].includes(existing.status)&&candidate)status=existing.status;
 else if(!candidate&&w.status==='REJECTED'&&!['ACTIVE','VALIDATED'].includes(existing?.status))status='REJECTED';
 const metrics={support:w.occurrences,sampleSize:w.samples,baselineSamples:w.baselineSamples,baselineProbability:w.baselineProbability,conditionalProbability:w.conditionalProbability,lift:w.lift,confidence:w.confidence,adjustedSignificance:w.test?.q??null,rawSignificance:w.test?.p??null,direction:w.direction,qualityScore:w.qualityScore,delayHours:w.delayHours,driftScore:w.driftScore,recentStrength:w.recentStrength,previousStrength:w.previousStrength};
 const version={version:(existing?.versions?.at(-1)?.version||0)+1,at:asOf,status,metrics};
 const row={id,kind:'boss_to_boss',world,sourceEntity:{type:'Boss',id:edge.from},targetEntity:{type:'Boss',id:edge.to},window:{fromHours:w.fromHours,toHours:w.toHours},status,validFrom:existing?.validFrom||asOf,validUntil:status==='ARCHIVED'?asOf:null,discoveredAt:existing?.discoveredAt||asOf,lastValidated:asOf,lastUpdatedAt:asOf,metrics,lineage:{anchorEventIds:w.anchorIds||[],targetEventIds:w.occurrenceIds||[]},causalityProven:false,note:'Associação temporal; não implica causalidade.',versions:[...(existing?.versions||[]).slice(-19),version]};
 k.relationshipRegistry[id]=row;return row;
}
function upsertGraphFeature(k,relation,asOf){
 if(!['DISCOVERED','TESTING','VALIDATED','ACTIVE','DEGRADED'].includes(relation.status))return null;
 const id=featureId(relation),old=k.featureRegistry[id],delay=relation.metrics.delayHours?.median;if(!Number.isFinite(delay))return null;
 let status=old?.status||'DISCOVERED';if(relation.status==='DEGRADED'&&status==='ACTIVE')status='TESTING';if(!FEATURE_STATUSES.has(status))status='DISCOVERED';
 const feature={id,name:'hours_since_'+relation.sourceEntity.id.replace(/\W+/g,'_').toLowerCase(),kind:'temporal_graph_relation',world:relation.world,sourceBoss:relation.sourceEntity.id,targetBoss:relation.targetEntity.id,relationId:relation.id,windowHours:relation.window.toHours,windowStartHours:relation.window.fromHours,medianDelayHours:delay,direction:relation.metrics.direction,status,discoveredAt:old?.discoveredAt||asOf,lastUpdatedAt:asOf,productionEligible:status==='ACTIVE',leakageRule:'Use somente eventos com available_at <= prediction asOf.',versions:[...(old?.versions||[]).slice(-19),{at:asOf,status,relationMetrics:relation.metrics}]};
 k.featureRegistry[id]=feature;return feature;
}
function upsertHypothesis(k,feature,relation,asOf){
 const id=hypothesisId(feature),old=k.hypotheses[id],positive=relation.metrics.direction==='POSITIVE',score=(relation.metrics.qualityScore||0)*Math.log1p(relation.metrics.sampleSize||0)*Math.max(.25,1-(relation.metrics.driftScore||0));
 const hypothesis={id,status:old?.status||'UNVALIDATED_HYPOTHESIS',world:feature.world,boss:feature.targetBoss,featureId:feature.id,relationId:relation.id,hypothesis:`A aparição de ${feature.sourceBoss} nas últimas ${feature.windowHours}h melhora a previsão temporal de ${feature.targetBoss}.`,modelId:'graph_context_interval',kind:'graph_feature',parameters:{sourceBoss:feature.sourceBoss,windowHours:feature.windowHours,windowStartHours:feature.windowStartHours,medianDelayHours:feature.medianDelayHours,graphWeight:.35,direction:feature.direction,relationId:relation.id,featureId:feature.id},rankScore:round(score,2),support:relation.metrics.sampleSize,lift:relation.metrics.lift,adjustedSignificance:relation.metrics.adjustedSignificance,direction:feature.direction,createdAt:old?.createdAt||asOf,updatedAt:asOf,eligibleForExperiment:positive&&feature.status!=='REJECTED'&&relation.status!=='DEGRADED',note:positive?'Hipótese não validada; precisa passar pelo AI Lab.':'Relação negativa registrada; ainda não há transformação temporal segura para promoção automática.'};
 k.hypotheses[id]=hypothesis;return hypothesis;
}
function updateSourceRelationships(k,graph,asOf){
 k.sourceRelationships=(graph.edges||[]).map(e=>({...e,id:'SRCREL-'+digest({from:e.from,to:e.to}).slice(0,24),lastValidated:asOf,productionEligible:false})).sort((a,b)=>(b.samples||0)-(a.samples||0)).slice(0,2000);
}
function updateSequences(k,sequences,asOf){
 const old=new Map(k.sequenceRegistry.map(x=>[x.pattern,x]));k.sequenceRegistry=(sequences||[]).map(x=>({...x,id:'SEQ-'+digest(x.pattern).slice(0,24),firstSeenAt:old.get(x.pattern)?.firstSeenAt||asOf,lastValidated:asOf,productionEligible:false})).slice(0,1000);
}
function archiveStale(k,asOf){
 for(const r of Object.values(k.relationshipRegistry))if(r.status==='REJECTED'&&asOf-r.lastUpdatedAt>365*DAY){r.status='ARCHIVED';r.validUntil=asOf;}
 const rows=Object.values(k.relationshipRegistry).sort((a,b)=>b.lastUpdatedAt-a.lastUpdatedAt);if(rows.length>5000){for(const r of rows.slice(5000))if(r.status==='REJECTED')r.status='ARCHIVED';}
}
export function refreshTemporalKnowledge(intel,world,asOf=Date.now(),precomputed=null){
 const d=intel.discovery,k=ensureTemporalKnowledge(d,asOf),events=eventsAsOf(d,world,asOf),graph=precomputed?.bossGraph||bossGraph(events,d.coverage,d.experiments||[],world,asOf),sources=precomputed?.sourceGraph||sourceGraph(events);
 upsertSnapshots(d,k,world,asOf);const touched=[];
 for(const edge of graph.edges||[])for(const w of edge.windows||[]){if(w.samples<20||w.baselineSamples<20)continue;const r=updateRelationship(k,world,edge,w,asOf);touched.push(r.id);if(w.status==='CANDIDATE_RELATIONSHIP'){const f=upsertGraphFeature(k,r,asOf);if(f)upsertHypothesis(k,f,r,asOf);}}
 updateSourceRelationships(k,sources,asOf);updateSequences(k,graph.sequences,asOf);archiveStale(k,asOf);k.version++;const run={id:'GRAPH-RUN-'+digest({world,asOf,tests:graph.numberOfTests,events:events.map(e=>e.id)}).slice(0,24),world,asOf,version:k.version,eventCount:events.length,relationshipTests:graph.numberOfTests||0,touchedRelationships:touched.length,candidates:touched.map(id=>k.relationshipRegistry[id]).filter(x=>x?.status==='DISCOVERED').length,sourceRelationshipCount:k.sourceRelationships.length,sequenceCount:k.sequenceRegistry.length};k.runs.push(run);if(k.runs.length>500)k.runs.splice(0,k.runs.length-500);return run;
}
function similarStates(d,k,world,asOf,limit=20){
 const current=stateAt(d,world,asOf),rows=k.snapshots.filter(x=>x.world===world&&x.capturedAsKnownAt<asOf-1).map(x=>({...x,similarity:similarity(current,x.state)})).sort((a,b)=>b.similarity-a.similarity).slice(0,limit),best=rows[0]?.similarity??null,novelty=best==null?null:1-best;
 return {current,noveltyScore:round(novelty,4),status:rows.length<10?'INSUFFICIENT_HISTORY':novelty>=.45?'NOVEL_STATE':'KNOWN_STATE',similarStates:rows.map(x=>({id:x.id,eventId:x.eventId,eventTime:x.eventTime,availableAt:x.availableAt,similarity:round(x.similarity,4),state:x.state}))};
}
export function noveltyAssessment(intel,world,asOf=Date.now(),limit=20){
 const d=intel.discovery,k=ensureTemporalKnowledge(d,asOf),result=similarStates(d,k,world,asOf,limit);
 return {...result,samples:result.similarStates.length,policy:{minHistoricalStates:10,novelStateThreshold:.45,maxConfidencePenalty:40,minConfidenceCap:60}};
}
export function noveltyConfidenceGuard(assessment,currentConfidence){
 const confidence=Number(currentConfidence);if(!Number.isFinite(confidence))return {applied:false,confidenceCap:null,adjustedConfidence:currentConfidence,adjustment:0,reason:'confidence_unavailable'};
 if(!assessment||assessment.status!=='NOVEL_STATE'||assessment.samples<10||!Number.isFinite(assessment.noveltyScore))return {applied:false,confidenceCap:null,adjustedConfidence:confidence,adjustment:0,reason:assessment?.status==='INSUFFICIENT_HISTORY'?'insufficient_historical_states':'state_not_novel'};
 const p=assessment.policy||{},threshold=Number(p.novelStateThreshold)||.45,minCap=Number(p.minConfidenceCap)||60,maxPenalty=Number(p.maxConfidencePenalty)||40,scale=Math.max(0,Math.min(1,(assessment.noveltyScore-threshold)/Math.max(.01,1-threshold))),cap=Math.max(minCap,Math.round(100-maxPenalty*(.5+.5*scale))),adjusted=Math.min(confidence,cap);
 return {applied:adjusted<confidence,confidenceCap:cap,adjustedConfidence:adjusted,adjustment:adjusted-confidence,reason:'novel_server_state',noveltyScore:assessment.noveltyScore,samples:assessment.samples,bestSimilarity:assessment.similarStates?.[0]?.similarity??null};
}
function graphHealth(k,asOf){
 const relations=Object.values(k.relationshipRegistry),features=Object.values(k.featureRegistry),ids=new Set(relations.map(x=>x.id)),stale=relations.filter(x=>asOf-x.lastValidated>90*DAY&&!['ARCHIVED','REJECTED'].includes(x.status)),orphans=features.filter(x=>!ids.has(x.relationId)),dupes=relations.length-new Set(relations.map(x=>[x.world,x.sourceEntity.id,x.targetEntity.id,x.window.fromHours,x.window.toHours].join('|'))).size;
 return {relationships:relations.length,features:features.length,staleEdges:stale.length,orphanFeatures:orphans.length,duplicateEdges:dupes,status:orphans.length||dupes?'DEGRADED':stale.length?'STALE':'HEALTHY'};
}
export function temporalKnowledgeDashboard(intel,world,asOf=Date.now()){
 const d=intel.discovery,k=ensureTemporalKnowledge(d,asOf),relations=Object.values(k.relationshipRegistry).filter(x=>x.world===world&&x.validFrom<=asOf&&(x.validUntil==null||x.validUntil>asOf)).map(x=>{const version=(x.versions||[]).filter(v=>v.at<=asOf).sort((a,b)=>a.at-b.at).at(-1);return version?{...x,status:version.status,metrics:structuredClone(version.metrics),lastValidated:version.at}:x;}),features=Object.values(k.featureRegistry).filter(x=>x.world===world&&x.discoveredAt<=asOf).map(x=>{const version=(x.versions||[]).filter(v=>v.at<=asOf).sort((a,b)=>a.at-b.at).at(-1);return version?{...x,status:version.status,productionEligible:version.status==='ACTIVE',lastUpdatedAt:version.at}:x;}),hypotheses=Object.values(k.hypotheses).filter(x=>x.world===world&&x.createdAt<=asOf).sort((a,b)=>b.rankScore-a.rankScore),states=similarStates(d,k,world,asOf),lab=Object.values(intel.mlops?.lab?.experiments||{}).filter(x=>x.world===world&&x.kind==='graph_feature'&&x.createdAt<=asOf),promoted=lab.filter(x=>x.status==='PROMOTED'&&x.promotedAt<=asOf),gains=promoted.map(x=>x.result?.historical?.holdoutImprovementPct).filter(Number.isFinite);
 const active=relations.filter(x=>x.status==='ACTIVE'),validated=relations.filter(x=>x.status==='VALIDATED'),discovered=relations.filter(x=>x.status==='DISCOVERED'),rejected=relations.filter(x=>x.status==='REJECTED'),degraded=relations.filter(x=>x.status==='DEGRADED'),beforeSpawn=beforeSpawnAnalysis(d,world,asOf),serverSave=serverSaveAnalysis(d,world,asOf);
 return {version:k.version,world,asOf,counts:{active:active.length,validated:validated.length,discovered:discovered.length,testing:relations.filter(x=>x.status==='TESTING').length,rejected:rejected.length,degraded:degraded.length,features:features.length,activeFeatures:features.filter(x=>x.status==='ACTIVE').length,hypotheses:hypotheses.length,snapshots:k.snapshots.filter(x=>x.world===world).length},topRelationships:relations.filter(x=>['DISCOVERED','TESTING','VALIDATED','ACTIVE','DEGRADED'].includes(x.status)).sort((a,b)=>(b.metrics.qualityScore||0)-(a.metrics.qualityScore||0)).slice(0,100),rejectedRelationships:rejected.sort((a,b)=>b.lastValidated-a.lastValidated).slice(0,100),relationshipDrift:degraded.concat(relations.filter(x=>x.metrics?.driftScore>=.2)).filter((x,i,a)=>a.findIndex(y=>y.id===x.id)===i).slice(0,100),sourceRelationships:k.sourceRelationships,sequencePatterns:k.sequenceRegistry.slice(0,200),features:features.sort((a,b)=>b.lastUpdatedAt-a.lastUpdatedAt).slice(0,300),hypotheses:hypotheses.slice(0,200),serverState:states.current,stateNoveltyScore:states.noveltyScore,novelStateStatus:states.status,similarHistoricalStates:states.similarStates,beforeSpawn,serverSave,graphHealth:graphHealth(k,asOf),graphContribution:{promotedGraphExperiments:promoted.length,validatedGraphFeatures:features.filter(x=>['VALIDATED','ACTIVE'].includes(x.status)).length,activeGraphFeatures:features.filter(x=>x.status==='ACTIVE').length,measuredHoldoutImprovementPct:gains.length?round(gains.reduce((a,b)=>a+b,0)/gains.length,2):null,note:'Contribuição só é reportada a partir de experimentos graph_feature promovidos; não atribui causalidade.'},latestRun:k.runs.filter(x=>x.world===world&&x.asOf<=asOf).at(-1)||null,limitations:['Relações são associações temporais, não causalidade.','Janelas negativas só contam quando existe cobertura observável suficiente.','Features do grafo só podem afetar produção após AI Lab, Shadow, Quality Gate e Canary.','Novelty é uma medida de distância de estado, não uma probabilidade de spawn.']};
}
export function queryTemporalKnowledge(intel,world,input={},asOf=Date.now()){
 const dashboard=temporalKnowledgeDashboard(intel,world,asOf),boss=String(input.boss||'').trim(),kind=String(input.kind||'before');
 if(kind==='after')return {question:{kind,boss},answer:dashboard.topRelationships.filter(x=>x.sourceEntity.id===boss).slice(0,50),evidenceRequired:true,asOf};
 if(kind==='before')return {question:{kind,boss},answer:dashboard.topRelationships.filter(x=>x.targetEntity.id===boss).slice(0,50),evidenceRequired:true,asOf};
 if(kind==='source')return {question:{kind,source:String(input.source||'')},answer:dashboard.sourceRelationships.filter(x=>x.from===input.source||x.to===input.source).slice(0,50),evidenceRequired:true,asOf};
 if(kind==='drift')return {question:{kind},answer:dashboard.relationshipDrift,evidenceRequired:true,asOf};
 if(kind==='similar')return {question:{kind},answer:{state:dashboard.serverState,noveltyScore:dashboard.stateNoveltyScore,similar:dashboard.similarHistoricalStates},evidenceRequired:true,asOf};
 if(kind==='as_known_at')return {question:{kind},answer:{state:dashboard.serverState,relationships:dashboard.topRelationships.filter(x=>x.validFrom<=asOf)},evidenceRequired:true,asOf};
 throw new Error('Consulta temporal inválida');
}
export function setGraphFeatureStatus(intel,id,status,{actor='site-admin',reason='',at=Date.now()}={}){
 const k=ensureTemporalKnowledge(intel.discovery,at),f=k.featureRegistry[id];if(!f)throw new Error('Graph feature não encontrada');if(!FEATURE_STATUSES.has(status))throw new Error('Status de feature inválido');f.status=status;f.productionEligible=status==='ACTIVE';f.lastUpdatedAt=at;f.versions.push({at,status,actor:String(actor),reason:String(reason).slice(0,500)});const r=k.relationshipRegistry[f.relationId];if(r&&status==='ACTIVE')r.status='ACTIVE';else if(r&&status==='VALIDATED')r.status='VALIDATED';return f;
}

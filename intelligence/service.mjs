import {ensureSources,noteSource,sourcePublic,noteDuplicate,canAttemptSource} from '../sources/registry.mjs';
import {publicHistoryObservation,checkObservation,makeObservation,canonical} from '../normalization/observations.mjs';
import {mergeObservation,recomputeEvent,removeEvidence} from '../deduplication/events.mjs';
import {refreshEffectiveWeights,learnFromEvent,anomalyFor,rebuildSourceReliability} from '../learning/reliability.mjs';
import {predictBoss} from '../prediction/engine.mjs';
import {predictAdaptive,buildAdaptivePredictions} from '../prediction/adaptive-engine.mjs';
import {resolveForecasts,modelPublic,recalculateForecastOutcome,rebuildBossModel} from '../learning/model-performance.mjs';
import {forecastMetrics,recentForecasts} from '../metrics/forecast-metrics.mjs';
import {runHistoricalBacktest} from '../backtest/history.mjs';
import {audit,publicAudit} from '../audit/logger.mjs';
import {assessObservation,reassessEventQuality,qualitySummary,DATA_QUALITY_ENGINE_VERSION} from '../data-quality/engine.mjs';
import {calibrationReport,calibrateConfidence} from '../learning/calibration.mjs';
import {championChallengerReport} from '../learning/champion.mjs';
import {detectDrift} from '../learning/drift.mjs';
import {aiObservability} from '../metrics/ai-observability.mjs';
import {appendLedger,verifyLedger} from '../event-sourcing/ledger.mjs';
import {PREDICTION_ENGINE_VERSION,MODEL_FAMILY_VERSION,datasetVersion} from '../prediction/version.mjs';
import {ensureMLOps,recordPrediction,resolveMLOps,dashboard,replayPrediction,evaluateModel} from '../mlops/service.mjs';
import {temporalExperiment} from '../mlops/backtest.mjs';
import {poisoningSignal} from '../mlops/analysis.mjs';
import {modelsForPrediction,proposeOnlineUpdate,monitorCanary} from '../mlops/online-learning.mjs';
import {buildFeatures} from '../mlops/feature-store.mjs';
import {selfCritique} from '../mlops/analysis.mjs';
import {survivalCurve} from '../mlops/models.mjs';
import {ensureDiscovery,captureCanonical,discoveryDashboard,discover,historicalReplay,registerCandidate,sourceSample,addContext,addCoverage,reviewCandidate} from '../discovery/service.mjs';

import {discoveryControl,prospectiveTick,governedObservations,signalOverlay,windowEvidence} from '../discovery/runtime.mjs';
import {recordConfiguration,recordHistoricalAlert} from '../discovery/history.mjs';

const trimOldestFirst=(a,n)=>{if(a.length>n)a.splice(0,a.length-n);return a;};
const trimNewestFirst=(a,n)=>{if(a.length>n)a.length=n;return a;};
export function createIntelligence({state,persist,broadcast}){
 state.intelligence ||= {version:3,sources:{},events:[],audit:[],corrections:[],metricsHistory:[],forecasts:[],models:{},ledger:[]};
 const intel=state.intelligence;
 ensureMLOps(intel);
 ensureSources(intel.sources);refreshEffectiveWeights(intel.sources);
 intel.version=3;intel.events ||= [];intel.audit ||= [];intel.corrections ||= [];intel.metricsHistory ||= [];intel.forecasts ||= [];intel.models ||= {};intel.ledger ||= [];
 const previousEngineVersion=intel.engineVersion||null,previousModelVersion=intel.modelVersion||null;
 if(previousEngineVersion!==PREDICTION_ENGINE_VERSION||previousModelVersion!==MODEL_FAMILY_VERSION)appendLedger(intel.ledger,'engine_version_changed',{fromEngine:previousEngineVersion,fromModel:previousModelVersion,toEngine:PREDICTION_ENGINE_VERSION,toModel:MODEL_FAMILY_VERSION});
 intel.engineVersion=PREDICTION_ENGINE_VERSION;intel.modelVersion=MODEL_FAMILY_VERSION;
 let qualityBackfilled=0;for(const event of intel.events){let changed=false;for(const evidence of event.evidence||[]){if(!evidence.quality||evidence.quality.version!==DATA_QUALITY_ENGINE_VERSION){evidence.quality=assessObservation(evidence,{sources:intel.sources,events:[],peerEvidence:(event.evidence||[]).filter(x=>x!==evidence)});qualityBackfilled++;changed=true;}}if(changed&&event.evidence?.length){recomputeEvent(event,intel.sources);event.updatedAt=Date.now();}}if(qualityBackfilled){rebuildSourceReliability(intel.events,intel.sources);appendLedger(intel.ledger,'quality_backfill',{records:qualityBackfilled,qualityEngineVersion:DATA_QUALITY_ENGINE_VERSION});}
 const backtestCache=new Map(),predictionCache=new Map();let intelligenceRevision=0,lastPredictionLatencyMs=null;
 const invalidatePredictions=()=>{intelligenceRevision++;predictionCache.clear();};
 const predictionsFor=world=>{const now=Date.now(),key=world+'|'+intelligenceRevision+'|'+Math.floor(now/60000);if(predictionCache.has(key))return predictionCache.get(key);const started=performance.now(),rows=buildAdaptivePredictions(intel.events,world,intel.models).map(p=>{const chosen=modelsForPrediction(intel,p.boss,world,p.baseEventId||p.boss),prediction=chosen.rollout?.selected?predictAdaptive(intel.events,p.boss,world,chosen.models,now):p;return signalOverlay(intel,governedPrediction(calibratedPrediction(prediction),now),now);});lastPredictionLatencyMs=performance.now()-started;predictionCache.clear();predictionCache.set(key,rows);return rows;};
 ensureDiscovery(intel);captureCanonical(intel);
 const save=async()=>{trimOldestFirst(intel.events,200000);trimNewestFirst(intel.audit,10000);trimNewestFirst(intel.corrections,10000);trimOldestFirst(intel.metricsHistory,1095);trimNewestFirst(intel.forecasts,200000);captureCanonical(intel);await persist();};

 function sourceAttempt(id,result){noteSource(intel.sources,id,result);refreshEffectiveWeights(intel.sources);audit(intel.audit,'source_check',{sourceId:id,ok:!!result.ok,records:result.records||0,latencyMs:result.latencyMs||0,error:result.error||'',circuitState:intel.sources[id]?.circuitState},result.at||Date.now());}
 function sourceReady(id,now=Date.now()){return canAttemptSource(intel.sources,id,now);}

 function calibratedPrediction(prediction){
   if(prediction.status!=='ready')return prediction;
   const raw=prediction.confidence;let calibration=calibrateConfidence(raw,intel.forecasts,prediction.world,prediction.boss,{modelVersion:MODEL_FAMILY_VERSION});
   if(calibration.samples<20)calibration=calibrateConfidence(raw,intel.forecasts,prediction.world,null,{modelVersion:MODEL_FAMILY_VERSION});
   const adjustment=Math.round((calibration.calibrated-raw)*10)/10,breakdown=prediction.confidenceBreakdown?{...prediction.confidenceBreakdown,rawTotal:raw,calibrationAdjustment:adjustment,total:calibration.calibrated}:null;
   const sourceUsage=(prediction.sourceUsage||[]).map(x=>{const src=intel.sources[x.sourceId]||{};return {...x,name:src.name||x.sourceId,reliability:Math.round((src.effectiveWeight??src.baseWeight??.5)*100),evaluatedRecords:src.evaluatedRecords||0,recentAccuracy:(src.recentOutcomes||[]).length>=5?Math.round(1000*(src.recentOutcomes||[]).slice(-30).filter(r=>r.correct).length/Math.min(30,(src.recentOutcomes||[]).length))/10:null,averageErrorMinutes:src.preciseEvaluatedRecords?Math.round((src.preciseTotalErrorMs||0)/src.preciseEvaluatedRecords/6000)/10:null,circuitState:src.circuitState||'CLOSED'};});
   const explain=[...(prediction.explain||[])];if(calibration.method!=='identity'&&calibration.method!=='insufficient_calibration_data')explain.push(`Calibração histórica: confiança bruta ${raw}% ajustada para ${calibration.calibrated}% usando ${calibration.samples} previsões resolvidas comparáveis.`);else explain.push(`Calibração histórica ainda insuficiente (${calibration.samples} amostras); confiança bruta mantida.`);
   return {...prediction,confidenceRaw:raw,confidence:calibration.calibrated,confidenceBreakdown:breakdown,sourceUsage,calibration,explain};
 }
 function upsertForecast(event){
   if(!event||!/^confirmed_/.test(event.status)||event.eventType==='absence'||['CONFLITANTE','SUSPEITO','DESCARTADO'].includes(event.qualityStatus))return null;
   const selected=modelsForPrediction(intel,event.boss,event.world,event.id),prediction=governedPrediction(calibratedPrediction(predictAdaptive(intel.events,event.boss,event.world,selected.models)),Date.now());
   if(prediction.status!=='ready'||prediction.baseEventId!==event.id)return null;
   let forecast=intel.forecasts.find(f=>!f.resolvedAt&&f.boss===event.boss&&f.world===event.world&&f.baseEventId===event.id);
   const fields={boss:event.boss,world:event.world,baseEventId:event.id,baseEventAt:event.estimatedAt,windowStart:prediction.windowStart,windowEnd:prediction.windowEnd,predictedCenterAt:prediction.predictedCenterAt,likelyAt:prediction.likelyAt,confidenceRaw:prediction.confidenceRaw,confidence:prediction.confidence,calibration:prediction.calibration,probability:prediction.probability,predictionScore:prediction.predictionScore,dataQualityScore:prediction.dataQualityScore,uncertaintyMs:prediction.uncertaintyMs,probabilityDistribution:prediction.probabilityDistribution,distributionConditional:prediction.distributionConditional,sourceUsage:prediction.sourceUsage,excluded:prediction.excluded,confidenceBreakdown:prediction.confidenceBreakdown,methods:prediction.methods,challengers:prediction.challengers,champion:'adaptive_ensemble',trend:prediction.trend,drift:prediction.drift,sampleSize:prediction.sampleSize,predictionEngineVersion:PREDICTION_ENGINE_VERSION,modelVersion:MODEL_FAMILY_VERSION,datasetVersion:datasetVersion(intel.events,event.boss,event.world)};
   if(forecast){Object.assign(forecast,fields,{lastUpdatedAt:Date.now(),revisions:(forecast.revisions||1)+1});appendLedger(intel.ledger,'forecast_revised',{forecastId:forecast.id,boss:event.boss,world:event.world,revision:forecast.revisions,modelVersion:forecast.modelVersion,datasetVersion:forecast.datasetVersion});}
   else{forecast={id:'forecast-'+event.id+'-'+Date.now(),...fields,createdAt:Date.now(),lastUpdatedAt:Date.now(),revisions:1};intel.forecasts.unshift(forecast);appendLedger(intel.ledger,'forecast_created',{forecastId:forecast.id,boss:event.boss,world:event.world,confidence:forecast.confidence,predictionScore:forecast.predictionScore,modelVersion:forecast.modelVersion,datasetVersion:forecast.datasetVersion});audit(intel.audit,'forecast_created',{boss:event.boss,world:event.world,forecastId:forecast.id,confidence:forecast.confidence,probability:forecast.probability,predictionScore:forecast.predictionScore});}
   forecast.selfCritique=prediction.selfCritique;forecast.rollout=selected.rollout;const artifact=recordPrediction(intel,forecast,Date.now(),selected.models);forecast.mlopsDatasetId=artifact.datasetId;forecast.features=artifact.features;
   if(!artifact.critique.canPublishExact)forecast.likelyAt=null;
   return forecast;
 }
 function governedPrediction(prediction,asOf){
   if(prediction.status!=='ready')return prediction;
   const features=buildFeatures(intel.events,prediction.boss,prediction.world,asOf),critique=selfCritique(prediction,features,Object.values(intel.mlops.errors)),confidence=Math.min(prediction.confidence,critique.confidenceCap);
   return {...prediction,confidence,likelyAt:critique.canPublishExact?prediction.likelyAt:null,selfCritique:critique,features:features.values,survival:survivalCurve(features),confidenceBreakdown:{...prediction.confidenceBreakdown,safetyAdjustment:confidence-prediction.confidence,total:confidence}};
 }
 function addObservation(obs,{allowAnomaly=true}={}){
   if(!obs)return null;
   if(!intel.sources[obs.sourceId]||intel.sources[obs.sourceId].active===false)obs.anomaly={kind:'unvalidated_source',reason:'Fonte não passou pelo pipeline de produção'};
   refreshEffectiveWeights(intel.sources);
   const prediction=predictBoss(intel.events,obs.boss,obs.world),anomaly=allowAnomaly?anomalyFor(obs,intel.events,prediction):null;
   const poisoning=poisoningSignal(obs,intel.events);if(!obs.anomaly){if(poisoning)obs.anomaly=poisoning;else if(anomaly)obs.anomaly=anomaly;}
   obs.quality=assessObservation(obs,{sources:intel.sources,events:intel.events});
   appendLedger(intel.ledger,'evidence_received',{evidenceId:obs.evidenceId,boss:obs.boss,world:obs.world,sourceId:obs.sourceId,sourceRef:obs.sourceRef,collectionMethod:obs.collectionMethod,sourceObservedAt:obs.sourceObservedAt,collectedAt:obs.collectedAt,processedAt:obs.processedAt,quality:obs.quality,anomaly:obs.anomaly||null});
   const existingEvent=intel.events.find(e=>(e.evidence||[]).some(x=>x.evidenceId===obs.evidenceId)),existing=existingEvent?.evidence?.find(x=>x.evidenceId===obs.evidenceId);
   if(existing){
     const wasTraceable=!!existing.quality?.traceable,newTraceable=!!obs.quality?.traceable,sameCore=existing.boss===obs.boss&&existing.world===obs.world&&existing.sourceId===obs.sourceId&&existing.eventType===obs.eventType&&existing.precision===obs.precision&&existing.startAt===obs.startAt&&existing.endAt===obs.endAt&&existing.estimatedAt===obs.estimatedAt;
     if(!wasTraceable&&newTraceable&&sameCore){
       for(const key of ['sourceRef','collectionMethod','sourceObservedAt','collectedAt','processedAt','confirmedBy'])if((existing[key]==null||existing[key]===''||existing[key]==='unknown')&&obs[key]!=null&&obs[key]!=='')existing[key]=obs[key];
       existing.quality=assessObservation(existing,{sources:intel.sources,events:intel.events,peerEvidence:(existingEvent.evidence||[]).filter(x=>x!==existing)});
       reassessEventQuality(existingEvent,intel.sources);recomputeEvent(existingEvent,intel.sources);invalidatePredictions();rebuildSourceReliability(intel.events,intel.sources);upsertForecast(existingEvent);
       appendLedger(intel.ledger,'evidence_provenance_enriched',{evidenceId:obs.evidenceId,eventId:existingEvent.id,boss:obs.boss,world:obs.world,sourceId:obs.sourceId,sourceRef:existing.sourceRef,collectionMethod:existing.collectionMethod});
       audit(intel.audit,'evidence_provenance_enriched',{boss:obs.boss,world:obs.world,sourceId:obs.sourceId,eventId:existingEvent.id,evidenceId:obs.evidenceId});
       return {event:existingEvent,duplicate:true,enriched:true};
     }
     noteDuplicate(intel.sources,obs.sourceId);appendLedger(intel.ledger,'evidence_duplicate',{evidenceId:obs.evidenceId,sourceId:obs.sourceId,boss:obs.boss,world:obs.world});return {event:existingEvent,duplicate:true,enriched:false};
   }
   const result=mergeObservation(intel.events,obs,intel.sources);
   if(result.event){invalidatePredictions();
     if(obs.anomaly)result.event.anomaly=obs.anomaly;
     reassessEventQuality(result.event,intel.sources);recomputeEvent(result.event,intel.sources);
     learnFromEvent(result.event,intel.sources);
     const resolved=resolveForecasts(intel.forecasts,result.event,intel.models,{controlled:true});
     for(const row of resolved){resolveMLOps(intel,row,result.event);monitorCanary(intel,row.boss,row.world);const n=Object.values(intel.mlops.updates).filter(x=>x.boss===row.boss&&x.world===row.world).length;if(n%10===0)proposeOnlineUpdate(intel,row.boss,row.world);}
     for(const row of resolved){appendLedger(intel.ledger,'forecast_resolved',{forecastId:row.id,actualEventId:result.event.id,errorMinutes:row.errorMinutes,windowHit:row.windowHit});audit(intel.audit,'forecast_resolved',{boss:row.boss,world:row.world,forecastId:row.id,errorMinutes:row.errorMinutes,windowHit:row.windowHit});}
     upsertForecast(result.event);
     appendLedger(intel.ledger,'event_consolidated',{eventId:result.event.id,boss:result.event.boss,world:result.event.world,status:result.event.status,qualityStatus:result.event.qualityStatus,dataQualityScore:result.event.dataQualityScore,estimatedAt:result.event.estimatedAt,confirmingSources:result.event.confirmingSources});
     audit(intel.audit,'observation_ingested',{boss:obs.boss,world:obs.world,sourceId:obs.sourceId,eventId:result.event.id,status:result.event.status,qualityStatus:result.event.qualityStatus,dataQualityScore:result.event.dataQualityScore,confidence:Math.round(result.event.confidence*100),anomaly:obs.anomaly?.kind||null});
   }
   return result;
 }

 async function ingestPublic(data){
   if(!data?.bosses?.length)return 0;let added=0;
   for(const boss of data.bosses){
     for(const row of boss.history||[]){
       const obs=publicHistoryObservation(data.world,boss.name,row,canonical(row.date)+(row.approximate?'a':'e'));
       if(!obs)continue;const before=intel.events.length;const r=addObservation(obs,{allowAnomaly:false});if(r&&!r.duplicate&&(intel.events.length>before||r.event))added++;
     }
   }
   if(added)await save();return added;
 }

 async function ingestOfficial(data){
   if(!data?.bosses?.length)return 0;let added=0;
   for(const boss of data.bosses){
     const o=boss.official;if(!o?.increase||!Number.isFinite(o.observedSince)||!Number.isFinite(o.fetchedAt))continue;
     const obs=makeObservation({evidenceId:`official|${data.world}|${canonical(boss.name)}|${o.observedSince}|${o.fetchedAt}`,boss:boss.name,world:data.world,sourceId:'rubinot-official',sourceRef:'https://rubinot.com.br/api/killstats',collectionMethod:'official_json',eventType:'kill',precision:'range',startAt:o.observedSince,endAt:o.fetchedAt,sourceObservedAt:o.observedSince,collectedAt:o.fetchedAt,confidence:.84,detail:{kills24h:o.day,kills7d:o.week}});
     const r=addObservation(obs);if(r&&!r.duplicate)added++;
   }
   if(added)await save();return added;
 }

 async function ingestChecks(checks=[]){
   let added=0;
   for(const check of checks){const obs=checkObservation(check);if(!obs)continue;const r=addObservation(obs);if(r&&!r.duplicate)added++;}
   if(added)await save();return added;
 }

 async function removeCheck(check){
   if(!check)return;const obs=checkObservation(check);if(!obs)return;removeEvidence(intel.events,obs.evidenceId,intel.sources);invalidatePredictions();rebuildSourceReliability(intel.events,intel.sources);rebuildBossModel(intel.forecasts,intel.models,check.boss,check.world);appendLedger(intel.ledger,'evidence_removed',{boss:check.boss,world:check.world,evidenceId:obs.evidenceId});audit(intel.audit,'observation_removed',{boss:check.boss,world:check.world,evidenceId:obs.evidenceId});await save();
 }
 async function removeChecks(checks=[]){const affected=new Set();if(checks.length)invalidatePredictions();for(const check of checks){const obs=checkObservation(check);if(obs){removeEvidence(intel.events,obs.evidenceId,intel.sources);affected.add(check.world+'|'+check.boss);appendLedger(intel.ledger,'evidence_removed',{boss:check.boss,world:check.world,evidenceId:obs.evidenceId});}}if(checks.length){rebuildSourceReliability(intel.events,intel.sources);for(const value of affected){const [world,...parts]=value.split('|');rebuildBossModel(intel.forecasts,intel.models,parts.join('|'),world);}audit(intel.audit,'observations_removed',{count:checks.length});await save();}}

 async function correct({eventId,at,reason='',actor='site-admin'}){
   const event=intel.events.find(e=>e.id===eventId);if(!event)throw new Error('Evento não encontrado');
   const value=Number(at);if(!Number.isFinite(value)||value>Date.now()+60000||value<Date.parse('2020-01-01'))throw new Error('Horário corrigido inválido');
   const oldAt=event.estimatedAt,id=`correction|${eventId}|${Date.now()}`;
   const obs=makeObservation({evidenceId:id,boss:event.boss,world:event.world,sourceId:'manual-panel',sourceRef:'boss-radar://manual-correction',collectionMethod:'manual_correction',confirmedBy:actor,eventType:event.eventType,precision:'minute',estimatedAt:value,sourceObservedAt:value,manual:true,confidence:.995,detail:{correction:true,reason:String(reason||'').slice(0,300),oldAt}});
   obs.quality=assessObservation(obs,{sources:intel.sources,events:intel.events});appendLedger(intel.ledger,'event_correction_requested',{eventId,boss:event.boss,world:event.world,oldAt,newAt:value,reason:String(reason||'').slice(0,300),actor:String(actor).slice(0,80),evidenceId:id});
   event.evidence.push(obs);event.corrected=true;event.anomaly=null;recomputeEvent(event,intel.sources);event.status='confirmed_manual';event.qualityStatus='CONFIRMADO';invalidatePredictions();
   for(const forecast of intel.forecasts.filter(f=>f.actualEventId===event.id&&f.resolvedAt)){recalculateForecastOutcome(forecast,event);forecast.outcomeUpdatedAt=Date.now();resolveMLOps(intel,forecast,event);}
   const rollout=intel.mlops.rollouts[event.world+'|'+event.boss.toLowerCase()];if(rollout?.status==='canary'){rollout.status='rolled_back';rollout.percentage=0;intel.mlops.timeline.push({type:'correction_invalidated_canary',world:event.world,boss:event.boss,at:Date.now()});}
   rebuildSourceReliability(intel.events,intel.sources);rebuildBossModel(intel.forecasts,intel.models,event.boss,event.world);
   const latest=intel.events.filter(e=>e.boss===event.boss&&e.world===event.world&&/^confirmed_/.test(e.status)&&e.eventType!=='absence').sort((a,b)=>b.estimatedAt-a.estimatedAt)[0];if(latest?.id===event.id)upsertForecast(event);
   const row={id,boss:event.boss,world:event.world,eventId,oldAt,newAt:value,actor:String(actor).slice(0,80),reason:String(reason||'').slice(0,300),at:Date.now()};intel.corrections.unshift(row);appendLedger(intel.ledger,'event_corrected',row);audit(intel.audit,'event_corrected',row);await save();broadcast?.('update',{});return row;
 }

 function selfEvaluation(world,sources,drifts,anomalies){
   const rows=intel.forecasts.filter(f=>f.world===world&&f.modelVersion===MODEL_FAMILY_VERSION&&f.resolvedAt).sort((a,b)=>b.resolvedAt-a.resolvedAt).slice(0,100),precise=rows.filter(f=>Number.isFinite(f.errorMinutes)),errors=precise.map(f=>f.errorMinutes).sort((a,b)=>a-b);
   const medianError=errors.length?errors[Math.floor(errors.length/2)]:null,accuracy=rows.length?Math.round(1000*rows.filter(f=>f.windowHit).length/rows.length)/10:null;
   const byBoss=new Map();for(const f of precise){const x=byBoss.get(f.boss)||[];x.push(f.errorMinutes);byBoss.set(f.boss,x);}
   const bosses=[...byBoss].filter(([,x])=>x.length>=5).map(([boss,x])=>({boss,samples:x.length,mae:Math.round(x.reduce((a,b)=>a+b,0)/x.length*10)/10})).sort((a,b)=>a.mae-b.mae);
   const sourceRank=sources.filter(x=>x.active&&x.evaluatedRecords>=5).sort((a,b)=>b.reliability-a.reliability);
   const methodMap=new Map();for(const f of precise){const rows=[{name:'adaptive_ensemble',actualErrorMinutes:f.errorMinutes},...(f.methods||[]),...(f.challengers||[])];for(const m of rows){if(!Number.isFinite(m.actualErrorMinutes))continue;const x=methodMap.get(m.name)||[];x.push(m.actualErrorMinutes);methodMap.set(m.name,x);}}
   const methods=[...methodMap].filter(([,x])=>x.length>=10).map(([name,x])=>({name,samples:x.length,mae:Math.round(x.reduce((a,b)=>a+b,0)/x.length*10)/10})).sort((a,b)=>a.mae-b.mae);
   return {window:'last_100_resolved',predictions:rows.length,precisePredictions:precise.length,windowAccuracy:accuracy,maeMinutes:errors.length?Math.round(errors.reduce((a,b)=>a+b,0)/errors.length*10)/10:null,medianErrorMinutes:medianError==null?null:Math.round(medianError*10)/10,bestBoss:bosses[0]||null,worstBoss:bosses.at(-1)||null,bestSource:sourceRank[0]||null,worstSource:sourceRank.at(-1)||null,bestMethod:methods[0]||null,drifts:drifts.length,anomalies:anomalies.length};
 }
 function trustCenter(world,predictions,performance){
   const sources=sourcePublic(intel.sources),quality=qualitySummary(intel.events,world),calibration=calibrationReport(intel.forecasts,world,null,{modelVersion:MODEL_FAMILY_VERSION});
   const bosses=[...new Set(intel.events.filter(e=>e.world===world).map(e=>e.boss))],drifts=bosses.map(boss=>({boss,...detectDrift(intel.events,boss,world)})).filter(x=>x.detected);
   const governance=bosses.map(boss=>({boss,...championChallengerReport(intel.forecasts,boss,world,'adaptive_ensemble',{modelVersion:MODEL_FAMILY_VERSION})})).filter(x=>x.champion.samples||x.challengers.length);
   const events=intel.events.filter(e=>e.world===world),conflicts=events.filter(e=>e.qualityStatus==='CONFLITANTE'),suspect=events.filter(e=>['SUSPEITO','DESCARTADO','AGUARDANDO_CONFIRMAÇÃO'].includes(e.qualityStatus)),anomalies=events.filter(e=>e.anomaly);
   const alerts=[];
   for(const src of sources){
     if(src.circuitState==='OPEN')alerts.push({kind:'source_circuit',severity:'high',message:`${src.name} foi temporariamente suspensa pelo circuit breaker.`,sourceId:src.id});
     else if(src.evaluatedRecords>=20&&src.reliability<60)alerts.push({kind:'source_reliability',severity:'medium',message:`${src.name} apresentou queda de confiabilidade para ${src.reliability}%.`,sourceId:src.id});
     if(src.recentSamples>=8&&src.accuracyRate!=null&&src.recentAccuracy!=null&&src.accuracyRate-src.recentAccuracy>=20)alerts.push({kind:'source_recent_drop',severity:'medium',message:`${src.name}: acurácia recente ${src.recentAccuracy}% está ${Math.round((src.accuracyRate-src.recentAccuracy)*10)/10} p.p. abaixo do histórico.`,sourceId:src.id});
   }
   const evidenceTimes=events.flatMap(e=>(e.evidence||[]).map(x=>x.processedAt||x.reportedAt).filter(Number.isFinite)),now=Date.now(),lastHour=evidenceTimes.filter(t=>t>=now-3600000).length,prior=evidenceTimes.filter(t=>t<now-3600000&&t>=now-25*3600000).length,priorHourly=prior/24;
   if(lastHour>=20&&lastHour>Math.max(20,priorHourly*4))alerts.push({kind:'data_volume_spike',severity:'medium',message:`Volume anormal de dados detectado: ${lastHour} evidências na última hora contra média anterior de ${Math.round(priorHourly*10)/10}/h.`});
   if(performance.deterioration?.detected)alerts.push({kind:'precision_drop',severity:'high',message:performance.deterioration.message});
   for(const d of drifts.slice(0,20))alerts.push({kind:'drift',severity:'medium',message:`Mudança de comportamento detectada em ${d.boss}: ${d.changePercent}% no intervalo recente.`,boss:d.boss});
   if(conflicts.length)alerts.push({kind:'source_conflict',severity:'medium',message:`${conflicts.length} evento(s) com conflito entre fontes aguardando resolução.`});
   for(const g of governance.filter(x=>x.promotionRecommended).slice(0,20))alerts.push({kind:'challenger',severity:'info',message:`${g.boss}: challenger ${g.promotionRecommended} superou o Champion com evidência estatística suficiente.`,boss:g.boss});
   const insufficient=predictions.filter(p=>p.status==='insufficient').map(p=>({boss:p.boss,reason:p.reason||'Dados insuficientes'})),autoEvaluation=selfEvaluation(world,sources,drifts,anomalies);
   return {quality,calibration,sources,conflicts:conflicts.length,quarantined:suspect.length,anomalies:anomalies.length,drifts,governance,insufficientBosses:insufficient,autoEvaluation,ledger:verifyLedger(intel.ledger),algorithmChanges:intel.ledger.filter(x=>x.type==='engine_version_changed').slice(-20).reverse(),alerts,engineVersion:PREDICTION_ENGINE_VERSION,modelVersion:MODEL_FAMILY_VERSION};
 }
 function snapshot(world){
   refreshEffectiveWeights(intel.sources);
   const predictions=predictionsFor(world),performance=forecastMetrics(intel.forecasts,world,Date.now(),{modelVersion:MODEL_FAMILY_VERSION}),performanceAllVersions=forecastMetrics(intel.forecasts,world);
   performance.calibration=calibrationReport(intel.forecasts,world,null,{modelVersion:MODEL_FAMILY_VERSION});
   const ready=predictions.filter(p=>p.status==='ready'),trust=trustCenter(world,predictions,performance),sources=trust.sources;
   const metrics={bossesModeled:ready.length,bossesInsufficient:predictions.filter(p=>p.status==='insufficient').length,averageConfidence:ready.length?Math.round(ready.reduce((n,p)=>n+p.confidence,0)/ready.length*10)/10:null,averagePredictionScore:ready.length?Math.round(ready.reduce((n,p)=>n+(p.predictionScore||0),0)/ready.length*10)/10:null,dataQualityScore:trust.quality.averageScore,calibrationError:trust.calibration.ece,windowAccuracy:performance.days30.windowAccuracy,maeMinutes:performance.days30.maeMinutes,backtestSamples:performance.days30.predictions,totalResolved:performance.totalResolved};
   const lastMetric=intel.metricsHistory.at(-1),day=new Date().toISOString().slice(0,10);
   if(!lastMetric||lastMetric.day!==day)intel.metricsHistory.push({day,...metrics,days7:performance.days7,days30:performance.days30,days90:performance.days90});
   const events=intel.events.filter(e=>e.world===world).sort((a,b)=>b.estimatedAt-a.estimatedAt).slice(0,2000).map(e=>({id:e.id,boss:e.boss,world:e.world,eventType:e.eventType,startAt:e.startAt,endAt:e.endAt,estimatedAt:e.estimatedAt,confidence:Math.round((e.confidence||0)*100),dataQualityScore:e.dataQualityScore??null,qualityStatus:e.qualityStatus||null,status:e.status,sourceCount:e.sourceCount,confirmations:e.confirmations,confirmingSources:e.confirmingSources||[],consensus:e.consensus||null,anomaly:e.anomaly||null,corrected:!!e.corrected,evidence:(e.evidence||[]).map(x=>({evidenceId:x.evidenceId,sourceId:x.sourceId,sourceRef:x.sourceRef||'',collectionMethod:x.collectionMethod||'unknown',sourceObservedAt:x.sourceObservedAt||null,collectedAt:x.collectedAt||null,processedAt:x.processedAt||null,confirmedBy:x.confirmedBy||null,precision:x.precision,estimatedAt:x.estimatedAt,startAt:x.startAt,endAt:x.endAt,confidence:Math.round(x.confidence*100),quality:x.quality||null,manual:x.manual,anomaly:x.anomaly||null,detail:x.detail||null}))}));
   const observability=aiObservability({events:intel.events,forecasts:intel.forecasts,sources,world,predictions,predictionLatencyMs:lastPredictionLatencyMs,modelVersion:MODEL_FAMILY_VERSION});
   return {predictions,metrics,performance,performanceAllVersions,trustCenter:trust,observability,events,forecasts:recentForecasts(intel.forecasts,world),models:modelPublic(intel.models,world),sources,audit:publicAudit(intel.audit,300),corrections:intel.corrections.filter(x=>x.world===world).slice(0,500),metricsHistory:intel.metricsHistory.slice(-90),ledgerTail:intel.ledger.slice(-200)};
 }

 async function bootstrapChecks(checks=[]){let added=0;for(const check of checks){const obs=checkObservation(check);if(!obs)continue;const r=addObservation(obs,{allowAnomaly:false});if(r&&!r.duplicate)added++;}if(added){audit(intel.audit,'legacy_bootstrap',{records:added});await save();}return added;}
 function backtest(world){
   const rows=intel.events.filter(e=>e.world===world),last=rows.reduce((m,e)=>Math.max(m,e.updatedAt||e.estimatedAt||0),0),key=world+'|'+rows.length+'|'+last;
   if(backtestCache.has(key))return backtestCache.get(key);
   const result=runHistoricalBacktest(intel.events,world);backtestCache.clear();backtestCache.set(key,result);audit(intel.audit,'backtest_completed',{world,eventsEvaluated:result.eventsEvaluated,predictionsEvaluated:result.predictionsEvaluated});
   return result;
 }
 function healthState(world){
   const forecasts=intel.forecasts.filter(x=>x.world===world),events=intel.events.filter(x=>x.world===world),lastForecast=forecasts.reduce((m,x)=>Math.max(m,x.lastUpdatedAt||x.createdAt||0),0),lastEvent=events.reduce((m,x)=>Math.max(m,x.updatedAt||x.estimatedAt||0),0),sources=sourcePublic(intel.sources);
   return {sources,lastPredictionAt:lastForecast,lastEventAt:lastEvent,eventCount:events.length,forecastCount:forecasts.length,models:Object.keys(intel.models).filter(k=>k.startsWith(world+'|')).length,quarantinedEvents:events.filter(e=>['CONFLITANTE','SUSPEITO','DESCARTADO','AGUARDANDO_CONFIRMAÇÃO'].includes(e.qualityStatus)).length,openCircuits:sources.filter(x=>x.circuitState==='OPEN').length,ledger:verifyLedger(intel.ledger)};
 }
 function simulate(boss,world){
   const prediction=calibratedPrediction(predictAdaptive(intel.events,boss,world,intel.models)),events=intel.events.filter(e=>e.boss===boss&&e.world===world&&/^confirmed_/.test(e.status)&&!e.anomaly&&!['CONFLITANTE','SUSPEITO','DESCARTADO'].includes(e.qualityStatus)&&e.eventType!=='absence').sort((a,b)=>a.estimatedAt-b.estimatedAt);
   const recent=events.slice(-100),intervals=[];for(let i=1;i<recent.length;i++)intervals.push({from:recent[i-1].estimatedAt,to:recent[i].estimatedAt,ms:recent[i].estimatedAt-recent[i-1].estimatedAt});
   const model=modelPublic(intel.models,world).find(x=>x.boss===boss)||null,governance=championChallengerReport(intel.forecasts,boss,world,'adaptive_ensemble',{modelVersion:MODEL_FAMILY_VERSION});
   return {boss,world,prediction,governance,calibration:calibrationReport(intel.forecasts,world,boss,{modelVersion:MODEL_FAMILY_VERSION}),drift:detectDrift(intel.events,boss,world),events:recent.map(e=>({id:e.id,estimatedAt:e.estimatedAt,status:e.status,qualityStatus:e.qualityStatus,dataQualityScore:e.dataQualityScore,confidence:Math.round((e.confidence||0)*100),sourceCount:e.sourceCount,confirmations:e.confirmations,confirmingSources:e.confirmingSources||[]})),intervals,model};
 }
 async function experiment(world,modelId){const result=temporalExperiment(intel,world,modelId);evaluateModel(intel,modelId,world);await save();return result;}
 async function discoveryWrite(operation,input){let result;if(operation==='run')result=discover(intel,input.world);else if(operation==='candidate')result=registerCandidate(intel.discovery,input);else if(operation==='review')result=reviewCandidate(intel.discovery,input);else if(operation==='sample')result=sourceSample(intel.discovery,input);else if(operation==='context')result=addContext(intel.discovery,input);else if(operation==='coverage')result=addCoverage(intel.discovery,input);else result=await discoveryControl(intel,operation,input);for(const row of governedObservations(intel)){addObservation(row.observation);row.sample.admittedAt=Date.now();}invalidatePredictions();appendLedger(intel.ledger,'discovery_'+operation,{id:result.id||null,world:input.world||null,at:Date.now()});await save();return result;}
 const discoveryDue=world=>{const d=intel.discovery,last=d.runs.filter(r=>r.world===world).at(-1);return d.coverage.some(c=>c.world===world&&!c.candidateId)&&Object.values(d.current).filter(v=>v.event.world===world&&v.event.status==='CONFIRMADO').length>=10&&(!last||Date.now()-last.at>=86400000);};
 async function discoveryTick(world){
 const at=Date.now();recordConfiguration(intel.discovery,world,state.settings||{},at);prospectiveTick(intel,world,at);
 if(intel.discovery.automaticCollection&&at-(intel.discovery.collectionRuns.at(-1)?.at||0)>=3600000)await discoveryWrite('collect',{world});
 for(const row of governedObservations(intel,at)){addObservation(row.observation);row.sample.admittedAt=at;}await save();
 }
 return {discoveryTick,recordAlert:input=>recordHistoricalAlert(intel.discovery,input),recordSettings:()=>recordConfiguration(intel.discovery,state.settings.world,state.settings),windowEvidence:input=>windowEvidence(intel,input.world,input.boss,input.startAt,input.endAt,input.prior),sourceAttempt,sourceReady,ingestPublic,ingestOfficial,ingestChecks,bootstrapChecks,removeCheck,removeChecks,correct,snapshot,backtest,simulate,healthState,addObservation,mlops:world=>dashboard(intel,world),replay:id=>replayPrediction(intel,id),experiment,discovery:world=>discoveryDashboard(intel,world),discoveryWrite,discoveryDue,historical:input=>historicalReplay(intel.discovery,input.world,input.startAt,input.endAt,input.stepMinutes,intel.mlops.runs)};
}

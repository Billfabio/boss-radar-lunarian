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
import {assessObservation,qualitySummary} from '../data-quality/engine.mjs';
import {calibrationReport,calibrateConfidence} from '../learning/calibration.mjs';
import {championChallengerReport} from '../learning/champion.mjs';
import {detectDrift} from '../learning/drift.mjs';
import {aiObservability} from '../metrics/ai-observability.mjs';
import {appendLedger,verifyLedger} from '../event-sourcing/ledger.mjs';
import {PREDICTION_ENGINE_VERSION,MODEL_FAMILY_VERSION,datasetVersion} from '../prediction/version.mjs';

const trimOldestFirst=(a,n)=>{if(a.length>n)a.splice(0,a.length-n);return a;};
const trimNewestFirst=(a,n)=>{if(a.length>n)a.length=n;return a;};
export function createIntelligence({state,persist,broadcast}){
 state.intelligence ||= {version:3,sources:{},events:[],audit:[],corrections:[],metricsHistory:[],forecasts:[],models:{},ledger:[]};
 const intel=state.intelligence;
 ensureSources(intel.sources);refreshEffectiveWeights(intel.sources);
 intel.version=3;intel.events ||= [];intel.audit ||= [];intel.corrections ||= [];intel.metricsHistory ||= [];intel.forecasts ||= [];intel.models ||= {};intel.ledger ||= [];
 let qualityBackfilled=0;for(const event of intel.events){for(const evidence of event.evidence||[]){if(!evidence.quality){evidence.quality=assessObservation(evidence,{sources:intel.sources,events:[]});qualityBackfilled++;}}if(event.evidence?.length)recomputeEvent(event,intel.sources);}if(qualityBackfilled)appendLedger(intel.ledger,'quality_backfill',{records:qualityBackfilled,version:3});
 const backtestCache=new Map(),predictionCache=new Map();let intelligenceRevision=0,lastPredictionLatencyMs=null;
 const invalidatePredictions=()=>{intelligenceRevision++;predictionCache.clear();};
 const predictionsFor=world=>{const key=world+'|'+intelligenceRevision;if(predictionCache.has(key))return predictionCache.get(key);const started=performance.now(),rows=buildAdaptivePredictions(intel.events,world,intel.models).map(calibratedPrediction);lastPredictionLatencyMs=performance.now()-started;predictionCache.set(key,rows);return rows;};
 const save=async()=>{trimOldestFirst(intel.events,200000);trimNewestFirst(intel.audit,10000);trimNewestFirst(intel.corrections,10000);trimOldestFirst(intel.metricsHistory,1095);trimNewestFirst(intel.forecasts,200000);await persist();};

 function sourceAttempt(id,result){noteSource(intel.sources,id,result);refreshEffectiveWeights(intel.sources);audit(intel.audit,'source_check',{sourceId:id,ok:!!result.ok,records:result.records||0,latencyMs:result.latencyMs||0,error:result.error||'',circuitState:intel.sources[id]?.circuitState},result.at||Date.now());}
 function sourceReady(id,now=Date.now()){return canAttemptSource(intel.sources,id,now);}

 function calibratedPrediction(prediction){
   if(prediction.status!=='ready')return prediction;
   let calibration=calibrateConfidence(prediction.confidence,intel.forecasts,prediction.world,prediction.boss);
   if(calibration.samples<20)calibration=calibrateConfidence(prediction.confidence,intel.forecasts,prediction.world,null);
   return {...prediction,confidenceRaw:prediction.confidence,confidence:calibration.calibrated,calibration};
 }
 function upsertForecast(event){
   if(!event||!/^confirmed_/.test(event.status)||event.eventType==='absence'||['CONFLITANTE','SUSPEITO','DESCARTADO'].includes(event.qualityStatus))return null;
   const prediction=calibratedPrediction(predictAdaptive(intel.events,event.boss,event.world,intel.models));
   if(prediction.status!=='ready'||prediction.baseEventId!==event.id)return null;
   let forecast=intel.forecasts.find(f=>!f.resolvedAt&&f.boss===event.boss&&f.world===event.world&&f.baseEventId===event.id);
   const fields={boss:event.boss,world:event.world,baseEventId:event.id,baseEventAt:event.estimatedAt,windowStart:prediction.windowStart,windowEnd:prediction.windowEnd,predictedCenterAt:prediction.predictedCenterAt,likelyAt:prediction.likelyAt,confidenceRaw:prediction.confidenceRaw,confidence:prediction.confidence,calibration:prediction.calibration,probability:prediction.probability,predictionScore:prediction.predictionScore,dataQualityScore:prediction.dataQualityScore,uncertaintyMs:prediction.uncertaintyMs,probabilityDistribution:prediction.probabilityDistribution,methods:prediction.methods,challengers:prediction.challengers,champion:'adaptive_ensemble',trend:prediction.trend,drift:prediction.drift,sampleSize:prediction.sampleSize,predictionEngineVersion:PREDICTION_ENGINE_VERSION,modelVersion:MODEL_FAMILY_VERSION,datasetVersion:datasetVersion(intel.events,event.boss,event.world)};
   if(forecast){Object.assign(forecast,fields,{lastUpdatedAt:Date.now(),revisions:(forecast.revisions||1)+1});appendLedger(intel.ledger,'forecast_revised',{forecastId:forecast.id,boss:event.boss,world:event.world,revision:forecast.revisions,modelVersion:forecast.modelVersion,datasetVersion:forecast.datasetVersion});}
   else{forecast={id:'forecast-'+event.id+'-'+Date.now(),...fields,createdAt:Date.now(),lastUpdatedAt:Date.now(),revisions:1};intel.forecasts.unshift(forecast);appendLedger(intel.ledger,'forecast_created',{forecastId:forecast.id,boss:event.boss,world:event.world,confidence:forecast.confidence,predictionScore:forecast.predictionScore,modelVersion:forecast.modelVersion,datasetVersion:forecast.datasetVersion});audit(intel.audit,'forecast_created',{boss:event.boss,world:event.world,forecastId:forecast.id,confidence:forecast.confidence,probability:forecast.probability,predictionScore:forecast.predictionScore});}
   return forecast;
 }
 function addObservation(obs,{allowAnomaly=true}={}){
   if(!obs)return null;
   refreshEffectiveWeights(intel.sources);
   const prediction=predictBoss(intel.events,obs.boss,obs.world),anomaly=allowAnomaly?anomalyFor(obs,intel.events,prediction):null;
   if(anomaly)obs.anomaly=anomaly;
   obs.quality=assessObservation(obs,{sources:intel.sources,events:intel.events});
   appendLedger(intel.ledger,'evidence_received',{evidenceId:obs.evidenceId,boss:obs.boss,world:obs.world,sourceId:obs.sourceId,sourceRef:obs.sourceRef,collectionMethod:obs.collectionMethod,sourceObservedAt:obs.sourceObservedAt,collectedAt:obs.collectedAt,processedAt:obs.processedAt,quality:obs.quality,anomaly:obs.anomaly||null});
   const result=mergeObservation(intel.events,obs,intel.sources);
   if(result.duplicate){noteDuplicate(intel.sources,obs.sourceId);appendLedger(intel.ledger,'evidence_duplicate',{evidenceId:obs.evidenceId,sourceId:obs.sourceId,boss:obs.boss,world:obs.world});return result;}
   if(result.event){invalidatePredictions();
     if(obs.anomaly)result.event.anomaly=obs.anomaly;
     learnFromEvent(result.event,intel.sources);
     const resolved=resolveForecasts(intel.forecasts,result.event,intel.models);
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
   for(const forecast of intel.forecasts.filter(f=>f.actualEventId===event.id&&f.resolvedAt))recalculateForecastOutcome(forecast,event);
   rebuildSourceReliability(intel.events,intel.sources);rebuildBossModel(intel.forecasts,intel.models,event.boss,event.world);
   const latest=intel.events.filter(e=>e.boss===event.boss&&e.world===event.world&&/^confirmed_/.test(e.status)&&e.eventType!=='absence').sort((a,b)=>b.estimatedAt-a.estimatedAt)[0];if(latest?.id===event.id)upsertForecast(event);
   const row={id,boss:event.boss,world:event.world,eventId,oldAt,newAt:value,actor:String(actor).slice(0,80),reason:String(reason||'').slice(0,300),at:Date.now()};intel.corrections.unshift(row);appendLedger(intel.ledger,'event_corrected',row);audit(intel.audit,'event_corrected',row);await save();broadcast?.('update',{});return row;
 }

 function selfEvaluation(world,sources,drifts,anomalies){
   const rows=intel.forecasts.filter(f=>f.world===world&&f.resolvedAt).sort((a,b)=>b.resolvedAt-a.resolvedAt).slice(0,100),precise=rows.filter(f=>Number.isFinite(f.errorMinutes)),errors=precise.map(f=>f.errorMinutes).sort((a,b)=>a-b);
   const medianError=errors.length?errors[Math.floor(errors.length/2)]:null,accuracy=rows.length?Math.round(1000*rows.filter(f=>f.windowHit).length/rows.length)/10:null;
   const byBoss=new Map();for(const f of precise){const x=byBoss.get(f.boss)||[];x.push(f.errorMinutes);byBoss.set(f.boss,x);}
   const bosses=[...byBoss].filter(([,x])=>x.length>=5).map(([boss,x])=>({boss,samples:x.length,mae:Math.round(x.reduce((a,b)=>a+b,0)/x.length*10)/10})).sort((a,b)=>a.mae-b.mae);
   const sourceRank=sources.filter(x=>x.active&&x.evaluatedRecords>=5).sort((a,b)=>b.reliability-a.reliability);
   const methodMap=new Map();for(const f of precise){const rows=[{name:'adaptive_ensemble',actualErrorMinutes:f.errorMinutes},...(f.methods||[]),...(f.challengers||[])];for(const m of rows){if(!Number.isFinite(m.actualErrorMinutes))continue;const x=methodMap.get(m.name)||[];x.push(m.actualErrorMinutes);methodMap.set(m.name,x);}}
   const methods=[...methodMap].filter(([,x])=>x.length>=10).map(([name,x])=>({name,samples:x.length,mae:Math.round(x.reduce((a,b)=>a+b,0)/x.length*10)/10})).sort((a,b)=>a.mae-b.mae);
   return {window:'last_100_resolved',predictions:rows.length,precisePredictions:precise.length,windowAccuracy:accuracy,maeMinutes:errors.length?Math.round(errors.reduce((a,b)=>a+b,0)/errors.length*10)/10:null,medianErrorMinutes:medianError==null?null:Math.round(medianError*10)/10,bestBoss:bosses[0]||null,worstBoss:bosses.at(-1)||null,bestSource:sourceRank[0]||null,worstSource:sourceRank.at(-1)||null,bestMethod:methods[0]||null,drifts:drifts.length,anomalies:anomalies.length};
 }
 function trustCenter(world,predictions,performance){
   const sources=sourcePublic(intel.sources),quality=qualitySummary(intel.events,world),calibration=calibrationReport(intel.forecasts,world);
   const bosses=[...new Set(intel.events.filter(e=>e.world===world).map(e=>e.boss))],drifts=bosses.map(boss=>({boss,...detectDrift(intel.events,boss,world)})).filter(x=>x.detected);
   const governance=bosses.map(boss=>({boss,...championChallengerReport(intel.forecasts,boss,world)})).filter(x=>x.champion.samples||x.challengers.length);
   const events=intel.events.filter(e=>e.world===world),conflicts=events.filter(e=>e.qualityStatus==='CONFLITANTE'),suspect=events.filter(e=>['SUSPEITO','DESCARTADO','AGUARDANDO_CONFIRMAÇÃO'].includes(e.qualityStatus)),anomalies=events.filter(e=>e.anomaly);
   const alerts=[];
   for(const src of sources){if(src.circuitState==='OPEN')alerts.push({kind:'source_circuit',severity:'high',message:`${src.name} foi temporariamente suspensa pelo circuit breaker.`,sourceId:src.id});else if(src.evaluatedRecords>=20&&src.reliability<60)alerts.push({kind:'source_reliability',severity:'medium',message:`${src.name} apresentou queda de confiabilidade para ${src.reliability}%.`,sourceId:src.id});}
   if(performance.deterioration?.detected)alerts.push({kind:'precision_drop',severity:'high',message:performance.deterioration.message});
   for(const d of drifts.slice(0,20))alerts.push({kind:'drift',severity:'medium',message:`Mudança de comportamento detectada em ${d.boss}: ${d.changePercent}% no intervalo recente.`,boss:d.boss});
   if(conflicts.length)alerts.push({kind:'source_conflict',severity:'medium',message:`${conflicts.length} evento(s) com conflito entre fontes aguardando resolução.`});
   for(const g of governance.filter(x=>x.promotionRecommended).slice(0,20))alerts.push({kind:'challenger',severity:'info',message:`${g.boss}: challenger ${g.promotionRecommended} superou o Champion com evidência estatística suficiente.`,boss:g.boss});
   const insufficient=predictions.filter(p=>p.status==='insufficient').map(p=>({boss:p.boss,reason:p.reason||'Dados insuficientes'})),autoEvaluation=selfEvaluation(world,sources,drifts,anomalies);
   return {quality,calibration,sources,conflicts:conflicts.length,quarantined:suspect.length,anomalies:anomalies.length,drifts,governance,insufficientBosses:insufficient,autoEvaluation,ledger:verifyLedger(intel.ledger),alerts,engineVersion:PREDICTION_ENGINE_VERSION,modelVersion:MODEL_FAMILY_VERSION};
 }
 function snapshot(world){
   refreshEffectiveWeights(intel.sources);
   const predictions=predictionsFor(world),performance=forecastMetrics(intel.forecasts,world);
   performance.calibration=calibrationReport(intel.forecasts,world);
   const ready=predictions.filter(p=>p.status==='ready'),trust=trustCenter(world,predictions,performance),sources=trust.sources;
   const metrics={bossesModeled:ready.length,bossesInsufficient:predictions.filter(p=>p.status==='insufficient').length,averageConfidence:ready.length?Math.round(ready.reduce((n,p)=>n+p.confidence,0)/ready.length*10)/10:null,averagePredictionScore:ready.length?Math.round(ready.reduce((n,p)=>n+(p.predictionScore||0),0)/ready.length*10)/10:null,dataQualityScore:trust.quality.averageScore,calibrationError:trust.calibration.ece,windowAccuracy:performance.days30.windowAccuracy,maeMinutes:performance.days30.maeMinutes,backtestSamples:performance.days30.predictions,totalResolved:performance.totalResolved};
   const lastMetric=intel.metricsHistory.at(-1),day=new Date().toISOString().slice(0,10);
   if(!lastMetric||lastMetric.day!==day)intel.metricsHistory.push({day,...metrics,days7:performance.days7,days30:performance.days30,days90:performance.days90});
   const events=intel.events.filter(e=>e.world===world).sort((a,b)=>b.estimatedAt-a.estimatedAt).slice(0,2000).map(e=>({id:e.id,boss:e.boss,world:e.world,eventType:e.eventType,startAt:e.startAt,endAt:e.endAt,estimatedAt:e.estimatedAt,confidence:Math.round((e.confidence||0)*100),dataQualityScore:e.dataQualityScore??null,qualityStatus:e.qualityStatus||null,status:e.status,sourceCount:e.sourceCount,confirmations:e.confirmations,confirmingSources:e.confirmingSources||[],consensus:e.consensus||null,anomaly:e.anomaly||null,corrected:!!e.corrected,evidence:(e.evidence||[]).map(x=>({evidenceId:x.evidenceId,sourceId:x.sourceId,sourceRef:x.sourceRef||'',collectionMethod:x.collectionMethod||'unknown',sourceObservedAt:x.sourceObservedAt||null,collectedAt:x.collectedAt||null,processedAt:x.processedAt||null,confirmedBy:x.confirmedBy||null,precision:x.precision,estimatedAt:x.estimatedAt,startAt:x.startAt,endAt:x.endAt,confidence:Math.round(x.confidence*100),quality:x.quality||null,manual:x.manual,anomaly:x.anomaly||null,detail:x.detail||null}))}));
   const observability=aiObservability({events:intel.events,forecasts:intel.forecasts,sources,world,predictions,predictionLatencyMs:lastPredictionLatencyMs});
   return {predictions,metrics,performance,trustCenter:trust,observability,events,forecasts:recentForecasts(intel.forecasts,world),models:modelPublic(intel.models,world),sources,audit:publicAudit(intel.audit,300),corrections:intel.corrections.filter(x=>x.world===world).slice(0,500),metricsHistory:intel.metricsHistory.slice(-90),ledgerTail:intel.ledger.slice(-200)};
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
   const model=modelPublic(intel.models,world).find(x=>x.boss===boss)||null,governance=championChallengerReport(intel.forecasts,boss,world);
   return {boss,world,prediction,governance,calibration:calibrationReport(intel.forecasts,world,boss),drift:detectDrift(intel.events,boss,world),events:recent.map(e=>({id:e.id,estimatedAt:e.estimatedAt,status:e.status,qualityStatus:e.qualityStatus,dataQualityScore:e.dataQualityScore,confidence:Math.round((e.confidence||0)*100),sourceCount:e.sourceCount,confirmations:e.confirmations,confirmingSources:e.confirmingSources||[]})),intervals,model};
 }
 return {sourceAttempt,sourceReady,ingestPublic,ingestOfficial,ingestChecks,bootstrapChecks,removeCheck,removeChecks,correct,snapshot,backtest,simulate,healthState,addObservation};
}

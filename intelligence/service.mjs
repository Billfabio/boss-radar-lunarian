import {ensureSources,noteSource,sourcePublic} from '../sources/registry.mjs';
import {publicHistoryObservation,checkObservation,makeObservation,canonical} from '../normalization/observations.mjs';
import {mergeObservation,recomputeEvent,removeEvidence} from '../deduplication/events.mjs';
import {refreshEffectiveWeights,learnFromEvent,anomalyFor} from '../learning/reliability.mjs';
import {predictBoss} from '../prediction/engine.mjs';
import {predictAdaptive,buildAdaptivePredictions} from '../prediction/adaptive-engine.mjs';
import {resolveForecasts,modelPublic} from '../learning/model-performance.mjs';
import {forecastMetrics,recentForecasts} from '../metrics/forecast-metrics.mjs';
import {runHistoricalBacktest} from '../backtest/history.mjs';
import {audit,publicAudit} from '../audit/logger.mjs';

const trimOldestFirst=(a,n)=>{if(a.length>n)a.splice(0,a.length-n);return a;};
const trimNewestFirst=(a,n)=>{if(a.length>n)a.length=n;return a;};
export function createIntelligence({state,persist,broadcast}){
 state.intelligence ||= {version:2,sources:{},events:[],audit:[],corrections:[],metricsHistory:[],forecasts:[],models:{}};
 const intel=state.intelligence;
 ensureSources(intel.sources);refreshEffectiveWeights(intel.sources);
 intel.version=2;intel.events ||= [];intel.audit ||= [];intel.corrections ||= [];intel.metricsHistory ||= [];intel.forecasts ||= [];intel.models ||= {};
 const backtestCache=new Map();
 const save=async()=>{trimOldestFirst(intel.events,200000);trimNewestFirst(intel.audit,10000);trimNewestFirst(intel.corrections,10000);trimOldestFirst(intel.metricsHistory,1095);trimNewestFirst(intel.forecasts,200000);await persist();};

 function sourceAttempt(id,result){noteSource(intel.sources,id,result);refreshEffectiveWeights(intel.sources);audit(intel.audit,'source_check',{sourceId:id,ok:!!result.ok,records:result.records||0,latencyMs:result.latencyMs||0,error:result.error||''},result.at||Date.now());}

 function upsertForecast(event){
   if(!event||!/^confirmed_/.test(event.status)||event.eventType==='absence')return null;
   const prediction=predictAdaptive(intel.events,event.boss,event.world,intel.models);
   if(prediction.status!=='ready'||prediction.baseEventId!==event.id)return null;
   let forecast=intel.forecasts.find(f=>!f.resolvedAt&&f.boss===event.boss&&f.world===event.world&&f.baseEventId===event.id);
   const fields={boss:event.boss,world:event.world,baseEventId:event.id,baseEventAt:event.estimatedAt,windowStart:prediction.windowStart,windowEnd:prediction.windowEnd,likelyAt:prediction.likelyAt,confidence:prediction.confidence,probability:prediction.probability,methods:prediction.methods,trend:prediction.trend,sampleSize:prediction.sampleSize};
   if(forecast){Object.assign(forecast,fields,{lastUpdatedAt:Date.now(),revisions:(forecast.revisions||1)+1});}
   else{forecast={id:'forecast-'+event.id+'-'+Date.now(),...fields,createdAt:Date.now(),lastUpdatedAt:Date.now(),revisions:1};intel.forecasts.unshift(forecast);audit(intel.audit,'forecast_created',{boss:event.boss,world:event.world,forecastId:forecast.id,confidence:forecast.confidence,probability:forecast.probability});}
   return forecast;
 }
 function addObservation(obs,{allowAnomaly=true}={}){
   if(!obs)return null;
   const prediction=predictBoss(intel.events,obs.boss,obs.world);
   const anomaly=allowAnomaly?anomalyFor(obs,intel.events,prediction):null;
   if(anomaly)obs.anomaly=anomaly;
   const result=mergeObservation(intel.events,obs,intel.sources);
   if(result.event){
     if(obs.anomaly)result.event.anomaly=obs.anomaly;
     learnFromEvent(result.event,intel.sources);
     const resolved=resolveForecasts(intel.forecasts,result.event,intel.models);
     for(const row of resolved)audit(intel.audit,'forecast_resolved',{boss:row.boss,world:row.world,forecastId:row.id,errorMinutes:row.errorMinutes,windowHit:row.windowHit});
     upsertForecast(result.event);
     audit(intel.audit,'observation_ingested',{boss:obs.boss,world:obs.world,sourceId:obs.sourceId,eventId:result.event.id,status:result.event.status,confidence:Math.round(result.event.confidence*100),anomaly:obs.anomaly?.kind||null});
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
     const obs=makeObservation({evidenceId:`official|${data.world}|${canonical(boss.name)}|${o.observedSince}|${o.fetchedAt}`,boss:boss.name,world:data.world,sourceId:'rubinot-official',eventType:'kill',precision:'range',startAt:o.observedSince,endAt:o.fetchedAt,confidence:.84,detail:{kills24h:o.day,kills7d:o.week}});
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
   if(!check)return;const obs=checkObservation(check);if(!obs)return;removeEvidence(intel.events,obs.evidenceId,intel.sources);audit(intel.audit,'observation_removed',{boss:check.boss,world:check.world,evidenceId:obs.evidenceId});await save();
 }
 async function removeChecks(checks=[]){for(const check of checks){const obs=checkObservation(check);if(obs)removeEvidence(intel.events,obs.evidenceId,intel.sources);}if(checks.length){audit(intel.audit,'observations_removed',{count:checks.length});await save();}}

 async function correct({eventId,at,reason='',actor='site-admin'}){
   const event=intel.events.find(e=>e.id===eventId);if(!event)throw new Error('Evento não encontrado');
   const value=Number(at);if(!Number.isFinite(value)||value>Date.now()+60000||value<Date.parse('2020-01-01'))throw new Error('Horário corrigido inválido');
   const oldAt=event.estimatedAt;
   const id=`correction|${eventId}|${Date.now()}`;
   const obs=makeObservation({evidenceId:id,boss:event.boss,world:event.world,sourceId:'manual-panel',eventType:event.eventType,precision:'minute',estimatedAt:value,manual:true,confidence:.995,detail:{correction:true,reason:String(reason||'').slice(0,300),oldAt}});
   event.evidence.push(obs);event.corrected=true;event.anomaly=null;recomputeEvent(event,intel.sources);event.status='confirmed_manual';learnFromEvent(event,intel.sources);
   const row={id,boss:event.boss,world:event.world,eventId,oldAt,newAt:value,actor:String(actor).slice(0,80),reason:String(reason||'').slice(0,300),at:Date.now()};intel.corrections.unshift(row);audit(intel.audit,'event_corrected',row);await save();broadcast?.('update',{});return row;
 }

 function snapshot(world){
   refreshEffectiveWeights(intel.sources);
   const predictions=buildAdaptivePredictions(intel.events,world,intel.models),performance=forecastMetrics(intel.forecasts,world);
   const ready=predictions.filter(p=>p.status==='ready');
   const metrics={bossesModeled:ready.length,averageConfidence:ready.length?Math.round(ready.reduce((n,p)=>n+p.confidence,0)/ready.length*10)/10:null,windowAccuracy:performance.days30.windowAccuracy,maeMinutes:performance.days30.maeMinutes,backtestSamples:performance.days30.predictions,totalResolved:performance.totalResolved};
   const lastMetric=intel.metricsHistory.at(-1);const day=new Date().toISOString().slice(0,10);
   if(!lastMetric||lastMetric.day!==day)intel.metricsHistory.push({day,...metrics,days7:performance.days7,days30:performance.days30,days90:performance.days90});
   const events=intel.events.filter(e=>e.world===world).sort((a,b)=>b.estimatedAt-a.estimatedAt).slice(0,2000).map(e=>({id:e.id,boss:e.boss,world:e.world,eventType:e.eventType,startAt:e.startAt,endAt:e.endAt,estimatedAt:e.estimatedAt,confidence:Math.round((e.confidence||0)*100),status:e.status,sourceCount:e.sourceCount,confirmations:e.confirmations,anomaly:e.anomaly||null,corrected:!!e.corrected,evidence:(e.evidence||[]).map(x=>({sourceId:x.sourceId,precision:x.precision,estimatedAt:x.estimatedAt,startAt:x.startAt,endAt:x.endAt,confidence:Math.round(x.confidence*100),manual:x.manual,anomaly:x.anomaly||null,detail:x.detail||null}))}));
   return {predictions,metrics,performance,events,forecasts:recentForecasts(intel.forecasts,world),models:modelPublic(intel.models,world),sources:sourcePublic(intel.sources),audit:publicAudit(intel.audit,300),corrections:intel.corrections.filter(x=>x.world===world).slice(0,500),metricsHistory:intel.metricsHistory.slice(-90)};
 }

 async function bootstrapChecks(checks=[]){let added=0;for(const check of checks){const obs=checkObservation(check);if(!obs)continue;const r=addObservation(obs,{allowAnomaly:false});if(r&&!r.duplicate)added++;}if(added){audit(intel.audit,'legacy_bootstrap',{records:added});await save();}return added;}
 function backtest(world){
   const rows=intel.events.filter(e=>e.world===world),last=rows.reduce((m,e)=>Math.max(m,e.updatedAt||e.estimatedAt||0),0),key=world+'|'+rows.length+'|'+last;
   if(backtestCache.has(key))return backtestCache.get(key);
   const result=runHistoricalBacktest(intel.events,world);backtestCache.clear();backtestCache.set(key,result);audit(intel.audit,'backtest_completed',{world,eventsEvaluated:result.eventsEvaluated,predictionsEvaluated:result.predictionsEvaluated});
   return result;
 }
 function healthState(world){
   const forecasts=intel.forecasts.filter(x=>x.world===world),events=intel.events.filter(x=>x.world===world),lastForecast=forecasts.reduce((m,x)=>Math.max(m,x.lastUpdatedAt||x.createdAt||0),0),lastEvent=events.reduce((m,x)=>Math.max(m,x.updatedAt||x.estimatedAt||0),0);
   return {sources:sourcePublic(intel.sources),lastPredictionAt:lastForecast,lastEventAt:lastEvent,eventCount:events.length,forecastCount:forecasts.length,models:Object.keys(intel.models).filter(k=>k.startsWith(world+'|')).length};
 }
 return {sourceAttempt,ingestPublic,ingestOfficial,ingestChecks,bootstrapChecks,removeCheck,removeChecks,correct,snapshot,backtest,healthState,addObservation};
}

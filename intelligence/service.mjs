import {ensureSources,noteSource,sourcePublic} from '../sources/registry.mjs';
import {publicHistoryObservation,checkObservation,makeObservation,canonical} from '../normalization/observations.mjs';
import {mergeObservation,recomputeEvent,removeEvidence} from '../deduplication/events.mjs';
import {refreshEffectiveWeights,learnFromEvent,anomalyFor} from '../learning/reliability.mjs';
import {buildPredictions,aggregateMetrics,predictBoss} from '../prediction/engine.mjs';
import {audit,publicAudit} from '../audit/logger.mjs';

const trim=(a,n)=>{if(a.length>n)a.splice(0,a.length-n);return a;};
export function createIntelligence({state,persist,broadcast}){
 state.intelligence ||= {version:1,sources:{},events:[],audit:[],corrections:[],metricsHistory:[]};
 const intel=state.intelligence;
 ensureSources(intel.sources);refreshEffectiveWeights(intel.sources);
 intel.events ||= [];intel.audit ||= [];intel.corrections ||= [];intel.metricsHistory ||= [];
 const save=async()=>{trim(intel.events,50000);trim(intel.audit,3000);trim(intel.corrections,5000);trim(intel.metricsHistory,1095);await persist();};

 function sourceAttempt(id,result){noteSource(intel.sources,id,result);refreshEffectiveWeights(intel.sources);audit(intel.audit,'source_check',{sourceId:id,ok:!!result.ok,records:result.records||0,latencyMs:result.latencyMs||0,error:result.error||''},result.at||Date.now());}

 function addObservation(obs,{allowAnomaly=true}={}){
   if(!obs)return null;
   const prediction=predictBoss(intel.events,obs.boss,obs.world);
   const anomaly=allowAnomaly?anomalyFor(obs,intel.events,prediction):null;
   if(anomaly)obs.anomaly=anomaly;
   const result=mergeObservation(intel.events,obs,intel.sources);
   if(result.event){
     if(obs.anomaly)result.event.anomaly=obs.anomaly;
     learnFromEvent(result.event,intel.sources);
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
   const predictions=buildPredictions(intel.events,world),metrics=aggregateMetrics(predictions);
   const lastMetric=intel.metricsHistory.at(-1);const day=new Date().toISOString().slice(0,10);
   if(!lastMetric||lastMetric.day!==day)intel.metricsHistory.push({day,...metrics});
   const events=intel.events.filter(e=>e.world===world).sort((a,b)=>b.estimatedAt-a.estimatedAt).slice(0,1000).map(e=>({id:e.id,boss:e.boss,world:e.world,eventType:e.eventType,startAt:e.startAt,endAt:e.endAt,estimatedAt:e.estimatedAt,confidence:Math.round((e.confidence||0)*100),status:e.status,sourceCount:e.sourceCount,confirmations:e.confirmations,anomaly:e.anomaly||null,corrected:!!e.corrected,evidence:(e.evidence||[]).map(x=>({sourceId:x.sourceId,precision:x.precision,estimatedAt:x.estimatedAt,startAt:x.startAt,endAt:x.endAt,confidence:Math.round(x.confidence*100),manual:x.manual,anomaly:x.anomaly||null,detail:x.detail||null}))}));
   return {predictions,metrics,events,sources:sourcePublic(intel.sources),audit:publicAudit(intel.audit),corrections:intel.corrections.filter(x=>x.world===world).slice(0,200),metricsHistory:intel.metricsHistory.slice(-90)};
 }

 return {sourceAttempt,ingestPublic,ingestOfficial,ingestChecks,removeCheck,removeChecks,correct,snapshot,addObservation};
}

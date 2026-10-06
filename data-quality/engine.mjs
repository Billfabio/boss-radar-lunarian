const clamp=(n,a=0,b=1)=>Math.max(a,Math.min(b,n));
const PRECISION={minute:1,hour:.82,range:.64,day:.42};
const STATUS={confirmed:'CONFIRMADO',probable:'PROVÁVEL',waiting:'AGUARDANDO_CONFIRMAÇÃO',conflict:'CONFLITANTE',suspect:'SUSPEITO',discarded:'DESCARTADO'};
function ageScore(obs,now){
 const collected=Number(obs.collectedAt||obs.reportedAt||now),observed=Number(obs.sourceObservedAt||obs.reportedAt||obs.estimatedAt||collected);
 const delay=Math.max(0,collected-observed);
 if(delay<=5*60000)return 1;if(delay<=60*60000)return .9;if(delay<=6*3600000)return .72;if(delay<=24*3600000)return .55;if(delay<=7*86400000)return .4;return .25;
}
function provenanceScore(obs){
 let n=0,total=8;
 if(obs.evidenceId)n++;if(obs.sourceId)n++;if(obs.boss)n++;if(obs.world)n++;
 if(Number.isFinite(obs.reportedAt))n++;if(Number.isFinite(obs.processedAt))n++;
 if(obs.collectionMethod||obs.detail?.collectionMethod)n++;
 if(obs.sourceRef||obs.detail?.sourceRef)n++;
 return n/total;
}
function consistencyScore(obs,context){
 if(obs.anomaly)return .15;
 const same=(context.events||[]).filter(e=>e.boss===obs.boss&&e.world===obs.world&&e.eventType!=='absence'&&/^confirmed_/.test(e.status)).sort((a,b)=>Math.abs(a.estimatedAt-obs.estimatedAt)-Math.abs(b.estimatedAt-obs.estimatedAt));
 if(!same.length)return .7;
 const nearest=same[0],delta=Math.abs(nearest.estimatedAt-obs.estimatedAt);
 if(delta<=45*60000)return 1;if(delta<=3*3600000)return .9;if(delta<=12*3600000)return .72;
 return .62;
}
export function assessObservation(obs,{sources={},events=[],now=Date.now(),duplicate=false}={}){
 const source=sources[obs.sourceId]||{},sourceWeight=Number(source.effectiveWeight??source.baseWeight??.5);
 const components={
  provenance:provenanceScore(obs),
  temporal:PRECISION[obs.precision]??.35,
  freshness:ageScore(obs,now),
  source:clamp(sourceWeight),
  consistency:consistencyScore(obs,{events}),
  anomaly:obs.anomaly?.kind?.includes('impossible')?0:obs.anomaly?.kind?.includes('too_soon')?.2:obs.anomaly?.kind?.includes('outlier')?.3:1,
  uniqueness:duplicate?0:1
 };
 const weights={provenance:.16,temporal:.16,freshness:.1,source:.22,consistency:.14,anomaly:.14,uniqueness:.08};
 let score=0;for(const [k,w] of Object.entries(weights))score+=components[k]*w;
 if(obs.manual&&obs.detail?.correction)score=Math.max(score,.98);
 score=Math.round(clamp(score)*100);
 let status=score>=85?STATUS.confirmed:score>=70?STATUS.probable:score>=55?STATUS.waiting:score>=35?STATUS.suspect:STATUS.discarded;
 if(obs.anomaly&&status===STATUS.confirmed)status=STATUS.waiting;
 const eligibleForLearning=score>=70&&!obs.anomaly&&status!==STATUS.discarded;
 return {score,status,eligibleForLearning,components:Object.fromEntries(Object.entries(components).map(([k,v])=>[k,Math.round(v*100)])),evaluatedAt:now};
}
export function qualitySummary(events,world){
 const evidence=events.filter(e=>!world||e.world===world).flatMap(e=>e.evidence||[]),scores=evidence.map(x=>x.quality?.score).filter(Number.isFinite);
 const statuses={};for(const x of evidence){const s=x.quality?.status||'SEM_AVALIAÇÃO';statuses[s]=(statuses[s]||0)+1;}
 const avg=scores.length?scores.reduce((a,b)=>a+b,0)/scores.length:null;
 return {records:evidence.length,scored:scores.length,averageScore:avg==null?null:Math.round(avg*10)/10,statuses};
}
export {STATUS as DATA_QUALITY_STATUS};

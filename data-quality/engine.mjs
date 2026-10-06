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
 const method=String(obs.collectionMethod||obs.detail?.collectionMethod||'').trim().toLowerCase();if(method&&method!=='unknown')n++;
 const ref=String(obs.sourceRef||obs.detail?.sourceRef||'').trim().toLowerCase();if(ref&&ref!=='unknown'&&ref!=='n/a')n++;
 return n/total;
}
function structuralScore(obs){
 let valid=0,total=6;
 if(String(obs.evidenceId||'').trim())valid++;if(String(obs.boss||'').trim())valid++;if(String(obs.world||'').trim())valid++;if(String(obs.sourceId||'').trim())valid++;
 if(Number.isFinite(obs.startAt)&&Number.isFinite(obs.endAt)&&obs.endAt>=obs.startAt)valid++;
 if(Number.isFinite(obs.estimatedAt)&&obs.estimatedAt>=obs.startAt&&obs.estimatedAt<=obs.endAt)valid++;
 return valid/total;
}
function corroborationScore(obs,peerEvidence=[]){
 const peers=peerEvidence.filter(x=>x&&x.evidenceId!==obs.evidenceId&&x.sourceId!==obs.sourceId&&!x.anomaly&&!['DESCARTADO','SUSPEITO'].includes(x.quality?.status));
 if(!peers.length)return .65;
 let best=.1;
 for(const peer of peers){
   if(['minute','hour'].includes(obs.precision)&&['minute','hour'].includes(peer.precision)){
     const delta=Math.abs(obs.estimatedAt-peer.estimatedAt);
     best=Math.max(best,delta<=15*60000?1:delta<=45*60000?.88:delta<=90*60000?.5:.1);
   }else{
     const overlap=Math.max(obs.startAt,peer.startAt)<=Math.min(obs.endAt,peer.endAt);
     best=Math.max(best,overlap?.9:.25);
   }
 }
 const distinct=new Set(peers.map(x=>x.sourceId)).size;
 return clamp(best+Math.min(.08,Math.max(0,distinct-1)*.04));
}
export function assessObservation(obs,{sources={},events=[],peerEvidence=[],now=Date.now(),duplicate=false}={}){
 const source=sources[obs.sourceId]||{},sourceWeight=Number(source.effectiveWeight??source.baseWeight??.5);
 const components={
  provenance:provenanceScore(obs),
  temporal:PRECISION[obs.precision]??.35,
  freshness:ageScore(obs,now),
  source:clamp(sourceWeight),
  corroboration:corroborationScore(obs,peerEvidence),
  structural:structuralScore(obs),
  anomaly:obs.anomaly?.kind?.includes('impossible')?0:obs.anomaly?.kind?.includes('too_soon')?.2:obs.anomaly?.kind?.includes('outlier')?.3:1,
  uniqueness:duplicate?0:1
 };
 const weights={provenance:.15,temporal:.14,freshness:.1,source:.2,corroboration:.16,structural:.05,anomaly:.14,uniqueness:.06};
 let score=0;for(const [k,w] of Object.entries(weights))score+=components[k]*w;
 const anomalyKind=String(obs.anomaly?.kind||''),method=String(obs.collectionMethod||obs.detail?.collectionMethod||'').trim().toLowerCase(),ref=String(obs.sourceRef||obs.detail?.sourceRef||'').trim().toLowerCase(),traceable=!!obs.sourceId&&!!obs.evidenceId&&!!method&&method!=='unknown'&&!!ref&&ref!=='unknown'&&ref!=='n/a';
 if(anomalyKind.includes('impossible'))score=Math.min(score,.34);
 else if(anomalyKind.includes('too_soon'))score=Math.min(score,.54);
 else if(anomalyKind.includes('outlier'))score=Math.min(score,.64);
 if(!traceable)score=Math.min(score,.69);
 if(obs.manual&&obs.detail?.correction)score=Math.max(score,.98);
 score=Math.round(clamp(score)*100);
 let status=score>=85?STATUS.confirmed:score>=70?STATUS.probable:score>=55?STATUS.waiting:score>=35?STATUS.suspect:STATUS.discarded;
 if(!traceable&&status!==STATUS.discarded)status=STATUS.waiting;
 if(obs.anomaly&&status===STATUS.confirmed)status=STATUS.waiting;
 const eligibleForLearning=traceable&&score>=70&&!obs.anomaly&&status!==STATUS.discarded&&status!==STATUS.waiting;
 return {score,status,eligibleForLearning,traceable,components:Object.fromEntries(Object.entries(components).map(([k,v])=>[k,Math.round(v*100)])),evaluatedAt:now};
}

export function reassessEventQuality(event,sources,now=Date.now()){
 const evidence=event?.evidence||[];
 for(const obs of evidence)obs.quality=assessObservation(obs,{sources,peerEvidence:evidence.filter(x=>x!==obs),now});
 return evidence;
}
export function qualitySummary(events,world){
 const evidence=events.filter(e=>!world||e.world===world).flatMap(e=>e.evidence||[]),scores=evidence.map(x=>x.quality?.score).filter(Number.isFinite);
 const statuses={};for(const x of evidence){const s=x.quality?.status||'SEM_AVALIAÇÃO';statuses[s]=(statuses[s]||0)+1;}
 const avg=scores.length?scores.reduce((a,b)=>a+b,0)/scores.length:null;
 return {records:evidence.length,scored:scores.length,averageScore:avg==null?null:Math.round(avg*10)/10,statuses};
}
export {STATUS as DATA_QUALITY_STATUS};

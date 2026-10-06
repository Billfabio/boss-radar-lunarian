import {consensusForEvidence} from '../consensus/engine.mjs';
const overlap=(a,b)=>Math.max(a.startAt,b.startAt)<=Math.min(a.endAt,b.endAt);
const distance=(a,b)=>Math.max(0,Math.max(a.startAt,b.startAt)-Math.min(a.endAt,b.endAt));
const clamp=n=>Math.max(0,Math.min(1,n));
function temporalTolerance(o){return o.precision==='day'?0:o.precision==='range'?6*3600000:o.precision==='hour'?90*60000:45*60000;}
export function findEvent(events,o){
  const compatible=e=>e.eventType===o.eventType||(e.eventType!=='absence'&&o.eventType!=='absence');
  return events.filter(e=>e.boss===o.boss&&e.world===o.world&&compatible(e)).filter(e=>overlap(e,o)||distance(e,o)<=temporalTolerance(o)).sort((a,b)=>Math.abs(a.estimatedAt-o.estimatedAt)-Math.abs(b.estimatedAt-o.estimatedAt))[0]||null;
}
export function recomputeEvent(event,sources){
  const evidence=event.evidence||[],usable=evidence.filter(x=>!x.quality||['CONFIRMADO','PROVÁVEL'].includes(x.quality.status));
  const active=usable.length?usable:evidence;let miss=1,weightedAt=0,total=0,min=Infinity,max=-Infinity,manual=false;
  const sourceIds=new Set();
  for(const x of active){const s=sources[x.sourceId],quality=(x.quality?.score??50)/100,w=(s?.effectiveWeight??s?.baseWeight??.6)*x.confidence*quality;miss*=1-clamp(w);sourceIds.add(x.sourceId);weightedAt+=x.estimatedAt*w;total+=w;min=Math.min(min,x.startAt);max=Math.max(max,x.endAt);manual||=x.manual;}
  const base=1-miss,span=Math.max(0,max-min),penalty=span<=45*60000?1:span<=3*3600000?.96:span<=24*3600000?.88:.78;
  event.eventType=evidence.some(x=>x.eventType==='kill')?'kill':evidence.some(x=>x.eventType==='appearance')?'appearance':'absence';
  const anomalous=evidence.filter(x=>x.anomaly).length,anomalyPenalty=anomalous===evidence.length?.55:anomalous?Math.max(.7,1-anomalous/evidence.length*.25):1;
  const consensus=consensusForEvidence(evidence,sources),qualityScores=active.map(x=>Number.isFinite(x.quality?.score)?x.quality.score:Math.round((x.confidence||.5)*100)).filter(Number.isFinite);
  event.dataQualityScore=qualityScores.length?Math.round(qualityScores.reduce((a,b)=>a+b,0)/qualityScores.length*10)/10:null;
  event.consensus=consensus;event.confidence=clamp(Math.max(base*penalty*anomalyPenalty,consensus.confidence||0));
  event.startAt=min;event.endAt=max;event.estimatedAt=Number.isFinite(consensus.centerAt)?consensus.centerAt:(total?Math.round(weightedAt/total):Math.round((min+max)/2));event.sourceCount=sourceIds.size;event.confirmations=active.length;event.confirmingSources=consensus.confirmingSources||[];
  const corrections=evidence.filter(x=>x.manual&&x.detail?.correction).sort((a,b)=>(a.reportedAt||0)-(b.reportedAt||0)),override=corrections.at(-1);
  if(override){event.estimatedAt=override.estimatedAt;event.startAt=override.estimatedAt;event.endAt=override.estimatedAt;event.manualOverrideAt=override.estimatedAt;event.confidence=Math.max(event.confidence,.995);event.qualityStatus='CONFIRMADO';}
  else if(evidence.every(x=>x.quality?.status==='DESCARTADO'))event.qualityStatus='DESCARTADO';
  else if(consensus.conflict)event.qualityStatus='CONFLITANTE';
  else if(anomalous===evidence.length)event.qualityStatus='SUSPEITO';
  else event.qualityStatus=consensus.status;
  event.anomaly=anomalous&&!override?evidence.find(x=>x.anomaly)?.anomaly||null:null;
  const manuallyConfirmed=manual&&event.dataQualityScore>=85&&!event.anomaly&&!consensus.conflict;
  event.status=override||manuallyConfirmed?'confirmed_manual':event.qualityStatus==='CONFIRMADO'&&event.sourceCount>=2&&event.eventType!=='absence'?'confirmed_auto':event.qualityStatus==='PROVÁVEL'?'probable':'unconfirmed';
  if(event.eventType==='absence')event.status='unconfirmed';
  event.updatedAt=Date.now();return event;
}
export function mergeObservation(events,o,sources){
  if(events.some(e=>e.evidence?.some(x=>x.evidenceId===o.evidenceId)))return {event:null,duplicate:true};
  let event=findEvent(events,o);
  if(!event){event={id:`evt-${o.evidenceId.replace(/[^a-zA-Z0-9_-]/g,'-').slice(-80)}`,boss:o.boss,world:o.world,eventType:o.eventType,evidence:[],createdAt:Date.now(),corrected:false};events.push(event);}
  event.evidence.push(o);recomputeEvent(event,sources);if(event.eventType==='absence')event.status='unconfirmed';return {event,duplicate:false};
}
export function removeEvidence(events,evidenceId,sources){
  for(let i=events.length-1;i>=0;i--){const e=events[i],before=e.evidence.length;e.evidence=e.evidence.filter(x=>x.evidenceId!==evidenceId);if(!e.evidence.length){events.splice(i,1);continue;}if(e.evidence.length!==before)recomputeEvent(e,sources);}
}

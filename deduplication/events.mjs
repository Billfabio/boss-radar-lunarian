const overlap=(a,b)=>Math.max(a.startAt,b.startAt)<=Math.min(a.endAt,b.endAt);
const distance=(a,b)=>Math.max(0,Math.max(a.startAt,b.startAt)-Math.min(a.endAt,b.endAt));
const clamp=n=>Math.max(0,Math.min(1,n));
function temporalTolerance(o){return o.precision==='day'?36*3600000:o.precision==='range'?6*3600000:o.precision==='hour'?90*60000:45*60000;}
export function findEvent(events,o){
  const compatible=e=>e.eventType===o.eventType||(e.eventType!=='absence'&&o.eventType!=='absence');
  return events.filter(e=>e.boss===o.boss&&e.world===o.world&&compatible(e)).filter(e=>overlap(e,o)||distance(e,o)<=temporalTolerance(o)).sort((a,b)=>Math.abs(a.estimatedAt-o.estimatedAt)-Math.abs(b.estimatedAt-o.estimatedAt))[0]||null;
}
export function recomputeEvent(event,sources){
  const evidence=event.evidence||[];let miss=1,weightedAt=0,total=0,min=Infinity,max=-Infinity,manual=false;
  const sourceIds=new Set();
  for(const x of evidence){const s=sources[x.sourceId],w=(s?.effectiveWeight??s?.baseWeight??.6)*x.confidence;miss*=1-clamp(w);sourceIds.add(x.sourceId);weightedAt+=x.estimatedAt*w;total+=w;min=Math.min(min,x.startAt);max=Math.max(max,x.endAt);manual||=x.manual;}
  const base=1-miss,span=Math.max(0,max-min),penalty=span<=45*60000?1:span<=3*3600000?.96:span<=24*3600000?.88:.78;
  event.eventType=evidence.some(x=>x.eventType==='kill')?'kill':evidence.some(x=>x.eventType==='appearance')?'appearance':'absence';
  const anomalous=evidence.filter(x=>x.anomaly).length,anomalyPenalty=anomalous===evidence.length?.55:anomalous?Math.max(.7,1-anomalous/evidence.length*.25):1;
  event.confidence=clamp(base*penalty*anomalyPenalty);event.startAt=min;event.endAt=max;event.estimatedAt=total?Math.round(weightedAt/total):Math.round((min+max)/2);event.sourceCount=sourceIds.size;event.confirmations=evidence.length;
  event.anomaly=anomalous?evidence.find(x=>x.anomaly)?.anomaly||null:null;
  event.status=manual&&event.eventType!=='absence'?'confirmed_manual':anomalous===evidence.length?'probable':event.sourceCount>=2&&event.confidence>=.86&&event.eventType!=='absence'?'confirmed_auto':event.confidence>=.55?'probable':'unconfirmed';
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

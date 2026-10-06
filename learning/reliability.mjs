import {sourceWeight} from '../sources/registry.mjs';
const clamp=n=>Math.max(0,Math.min(1,n));
export function refreshEffectiveWeights(sources){for(const s of Object.values(sources))s.effectiveWeight=sourceWeight(s);return sources;}
export function learnFromEvent(event,sources){
  if(!event||!/^confirmed_/.test(event.status)||!Number.isFinite(event.estimatedAt))return;
  const evidence=event.evidence||[],correction=evidence.filter(x=>x.manual&&x.detail?.correction).sort((a,b)=>(a.reportedAt||0)-(b.reportedAt||0)).at(-1);
  for(const x of evidence){
    if(x.evaluated)continue;const s=sources[x.sourceId];if(!s)continue;
    const peers=evidence.filter(y=>y!==x&&y.sourceId!==x.sourceId&&!y.anomaly);
    const reference=correction&&correction!==x?correction.estimatedAt:(peers.length?peers.reduce((n,y)=>n+y.estimatedAt,0)/peers.length:null);
    if(!Number.isFinite(reference))continue;
    const tolerance=x.precision==='day'?18*3600000:x.precision==='range'?6*3600000:x.precision==='hour'?90*60000:30*60000;
    const error=Math.abs(x.estimatedAt-reference),score=clamp(1-error/Math.max(1,tolerance*2));
    s.alpha+=score;s.beta+=1-score;x.evaluated=true;x.errorMs=error;x.agreementScore=score;x.referenceEvidence=correction&&correction!==x?'manual_correction':'independent_sources';
  }
  refreshEffectiveWeights(sources);
}
export function anomalyFor(observation,events,prediction){
  const previous=events.filter(e=>e.boss===observation.boss&&e.world===observation.world&&/^confirmed_/.test(e.status)&&e.eventType!=='absence').sort((a,b)=>b.estimatedAt-a.estimatedAt)[0];
  if(!previous||observation.estimatedAt<=previous.estimatedAt)return null;
  const delta=observation.estimatedAt-previous.estimatedAt;
  if(prediction?.intervalMinMs&&delta<prediction.intervalMinMs*.45)return {kind:'too_soon',message:'Intervalo muito menor que o histórico recente.',deltaMs:delta};
  if(delta<2*3600000)return {kind:'too_soon',message:'Nova aparição apenas algumas horas após o último evento confirmado.',deltaMs:delta};
  return null;
}

export function rebuildSourceReliability(events,sources){
  for(const s of Object.values(sources)){s.alpha=8*(s.baseWeight??.5);s.beta=8*(1-(s.baseWeight??.5));}
  for(const event of events){for(const x of event.evidence||[]){delete x.evaluated;delete x.errorMs;delete x.agreementScore;delete x.referenceEvidence;}}
  const ordered=[...events].filter(e=>/^confirmed_/.test(e.status)).sort((a,b)=>a.estimatedAt-b.estimatedAt);
  for(const event of ordered)learnFromEvent(event,sources);
  return refreshEffectiveWeights(sources);
}

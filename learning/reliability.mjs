import {sourceWeight,noteEvidenceOutcome} from '../sources/registry.mjs';
const clamp=n=>Math.max(0,Math.min(1,n));
export function refreshEffectiveWeights(sources){for(const s of Object.values(sources))s.effectiveWeight=sourceWeight(s);return sources;}
export function learnFromEvent(event,sources){
  if(!event||!/^confirmed_/.test(event.status)||!Number.isFinite(event.estimatedAt)||['CONFLITANTE','SUSPEITO','DESCARTADO'].includes(event.qualityStatus))return;
  const evidence=event.evidence||[],correction=evidence.filter(x=>x.manual&&x.detail?.correction).sort((a,b)=>(a.reportedAt||0)-(b.reportedAt||0)).at(-1);
  const evaluatedSources=new Set(evidence.filter(x=>x.evaluated).map(x=>x.sourceId));
  for(const x of evidence){
    if(x.evaluated||evaluatedSources.has(x.sourceId))continue;const s=sources[x.sourceId];if(!s)continue;
    if(x.quality&&!x.quality.eligibleForLearning)continue;
    if(x.manual&&x.detail?.correction){x.evaluated=true;x.referenceEvidence='ground_truth_correction';continue;}
    const groups=new Map();for(const y of evidence){if(y!==x&&y.sourceId!==x.sourceId&&!(x.confirmedBy&&x.confirmedBy===y.confirmedBy)&&(sources[y.sourceId]?.dependencyGroup||y.sourceId)!==(s.dependencyGroup||x.sourceId)&&!y.anomaly&&(!y.quality||y.quality.eligibleForLearning)&&!groups.has(sources[y.sourceId]?.dependencyGroup||y.sourceId))groups.set(sources[y.sourceId]?.dependencyGroup||y.sourceId,y);}const peers=[...groups.values()];
    const reference=correction&&correction!==x?correction.estimatedAt:(peers.length?peers.reduce((n,y)=>n+y.estimatedAt,0)/peers.length:null);
    if(!Number.isFinite(reference))continue;
    const tolerance=x.precision==='day'?18*3600000:x.precision==='range'?6*3600000:x.precision==='hour'?90*60000:30*60000;
    const error=Math.abs(x.estimatedAt-reference),score=clamp(1-error/Math.max(1,tolerance*2));
    s.alpha+=score;s.beta+=1-score;x.evaluated=true;evaluatedSources.add(x.sourceId);x.errorMs=error;x.agreementScore=score;x.referenceEvidence=correction&&correction!==x?'manual_correction':'independent_sources';
    const delayMs=Number.isFinite(x.collectedAt)&&Number.isFinite(x.sourceObservedAt)?Math.max(0,x.collectedAt-x.sourceObservedAt):null;
    noteEvidenceOutcome(sources,x.sourceId,{correct:score>=.65,errorMs:error,delayMs,consistency:score,precision:x.precision,at:x.processedAt||event.updatedAt||event.estimatedAt||Date.now()});
  }
  refreshEffectiveWeights(sources);
}
export function anomalyFor(observation,events,prediction){
  const rows=events.filter(e=>e.boss===observation.boss&&e.world===observation.world&&/^confirmed_/.test(e.status)&&!e.anomaly&&!['CONFLITANTE','SUSPEITO','DESCARTADO'].includes(e.qualityStatus)&&e.eventType!=='absence').sort((a,b)=>a.estimatedAt-b.estimatedAt);
  const previous=rows.at(-1);
  if(!previous||observation.estimatedAt<=previous.estimatedAt)return null;
  const delta=observation.estimatedAt-previous.estimatedAt;
  if(prediction?.intervalMinMs&&delta<prediction.intervalMinMs*.45)return {kind:'too_soon',message:'Intervalo muito menor que o histórico recente.',deltaMs:delta};
  if(delta<2*3600000)return {kind:'too_soon',message:'Nova aparição apenas algumas horas após o último evento confirmado.',deltaMs:delta};
  const ints=rows.slice(1).map((e,i)=>e.estimatedAt-rows[i].estimatedAt).filter(x=>x>3600000&&x<180*86400000);
  if(ints.length>=8){
    const sorted=[...ints].sort((a,b)=>a-b),median=sorted[Math.floor(sorted.length/2)],dev=ints.map(x=>Math.abs(x-median)).sort((a,b)=>a-b),mad=dev[Math.floor(dev.length/2)]||3600000,robustSigma=Math.max(3600000,mad*1.4826);
    const lateThreshold=median+Math.max(5*robustSigma,median*1.5);
    if(delta>lateThreshold)return {kind:'interval_outlier_late',message:'Intervalo muito acima do padrão histórico; pode indicar evento perdido, mudança de regime ou dado incorreto.',deltaMs:delta,medianMs:median,thresholdMs:lateThreshold};
  }
  return null;
}

export function rebuildSourceReliability(events,sources){
  for(const s of Object.values(sources)){s.alpha=8*(s.baseWeight??.5);s.beta=8*(1-(s.baseWeight??.5));s.evaluatedRecords=0;s.correctRecords=0;s.incorrectRecords=0;s.totalErrorMs=0;s.preciseEvaluatedRecords=0;s.preciseCorrectRecords=0;s.preciseTotalErrorMs=0;s.totalDelayMs=0;s.recentOutcomes=[];s.delaySamples=0;s.consistencySum=0;s.consistencySamples=0;}
  for(const event of events){for(const x of event.evidence||[]){delete x.evaluated;delete x.errorMs;delete x.agreementScore;delete x.referenceEvidence;}}
  const ordered=[...events].filter(e=>/^confirmed_/.test(e.status)).sort((a,b)=>a.estimatedAt-b.estimatedAt);
  for(const event of ordered)learnFromEvent(event,sources);
  return refreshEffectiveWeights(sources);
}

import {mean,quantile,digest,knownRows,availableAt} from './feature-store.mjs';
export function errorAnalysis(forecast,event){
 const causes=[];if(forecast.drift?.score>=40)causes.push('drift');if((forecast.sampleSize||0)<20)causes.push('limited_history');if((forecast.excluded?.conflicts||0)>0)causes.push('source_conflict');if(event.anomaly)causes.push('anomalous_event');
 const delays=(event.evidence||[]).filter(x=>x.quality?.traceable).map(x=>(x.collectedAt||x.processedAt||event.estimatedAt)-event.estimatedAt);if(delays.some(x=>x>3600000))causes.push('delayed_confirmation');
 if((event.evidence||[]).some(x=>['SUSPEITO','DESCARTADO'].includes(x.quality?.status)))causes.push('suspect_evidence');
 if(!causes.length)causes.push('unexplained_interval_variation');return {id:'error_'+forecast.id,forecastId:forecast.id,boss:forecast.boss,world:forecast.world,predictedAt:forecast.predictedCenterAt,actualAt:event.estimatedAt,errorMinutes:forecast.errorMinutes,causes,classification:'hypotheses_not_causality',resolvedAt:forecast.resolvedAt};
}
export function selfCritique(prediction,features,errors=[]){
 const reasons=[];if(features.values.samples<10)reasons.push('limited_history');if(features.values.driftScore>=40)reasons.push('drift');if((prediction.excluded?.conflicts||0)>0)reasons.push('source_conflict');if((prediction.excluded?.suspect||0)>0)reasons.push('suspect_evidence');if((prediction.calibration?.samples||0)<20)reasons.push('uncalibrated');
 const similar=errors.filter(x=>x.boss===prediction.boss&&x.world===prediction.world&&Number.isFinite(x.errorMinutes)&&x.errorMinutes>120).slice(-5);if(similar.length>=3)reasons.push('repeated_large_errors');
 return {reasons,confidenceCap:reasons.length?Math.max(30,85-reasons.length*10):100,canPublishExact:!reasons.some(x=>['source_conflict','suspect_evidence','repeated_large_errors'].includes(x)),needsConfirmation:reasons.some(x=>['limited_history','source_conflict','suspect_evidence'].includes(x)),uncertaintyMatrix:(prediction.confidence>=70?'ALTA':'BAIXA')+'_CONFIANÇA_'+(prediction.probability>=70?'ALTA':'BAIXA')+'_PROBABILIDADE'};
}
export function poisoningSignal(obs,events){
 if(!['minute','hour'].includes(obs.precision))return null;
 const rows=events.flatMap(e=>e.evidence||[]).filter(x=>x.sourceId===obs.sourceId&&x.boss===obs.boss&&x.world===obs.world&&x.evidenceId!==obs.evidenceId&&['minute','hour'].includes(x.precision)&&Math.abs((x.processedAt||0)-(obs.processedAt||0))<3600000);
 const repeats=rows.filter(x=>x.estimatedAt===obs.estimatedAt);if(repeats.length>=10)return {kind:'repeated_precise_timestamp',records:repeats.length};
 if(rows.length>=100)return {kind:'abnormal_source_burst',records:rows.length};return null;
}
export function sourceRelationships(events,world){
 const pairs={},latencies={};for(const e of events.filter(x=>x.world===world)){const evidence=(e.evidence||[]).filter(x=>x.quality?.traceable&&!x.anomaly&&['minute','hour'].includes(x.precision)&&['CONFIRMADO','PROVÁVEL'].includes(x.quality?.status));
 for(const x of evidence){const delay=(x.collectedAt||0)-x.estimatedAt;if(delay>=0)(latencies[x.sourceId]||=[]).push(delay);}
 const unique=[...new Map(evidence.map(x=>[x.sourceId,x])).values()];for(let i=0;i<unique.length;i++)for(let j=i+1;j<unique.length;j++){const [a,b]=[unique[i],unique[j]].sort((x,y)=>x.sourceId.localeCompare(y.sourceId)),key=a.sourceId+'|'+b.sourceId,p=pairs[key]||={from:a.sourceId,to:b.sourceId,total:0,identical:0,delays:[]};p.total++;if(a.estimatedAt===b.estimatedAt){p.identical++;p.delays.push((b.collectedAt||0)-(a.collectedAt||0));}}}
 return {latencies:Object.entries(latencies).map(([sourceId,xs])=>({sourceId,samples:xs.length,medianReportingDelayMs:quantile(xs,.5)})),edges:Object.values(pairs).map(p=>({...p,delays:undefined,medianLagMs:quantile(p.delays,.5),suspectedDependence:p.total>=20&&p.identical/p.total>=.95,status:'hypothesis_requires_review'}))};
}
export function discoverPatterns(events,boss,world,asOf){
 const rows=knownRows(events,boss,world,asOf);if(rows.length<20)return [];
 const intervals=rows.slice(1).map((x,i)=>(x.estimatedAt-rows[i].estimatedAt)/3600000),median=quantile(intervals,.5),support=intervals.filter(x=>Math.abs(x-median)<=Math.max(.5,median*.1)).length,n=intervals.length,p=support/n,z=1.96,lower=(p+z*z/(2*n)-z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n)))/(1+z*z/n);
 const body={boss,world,type:'recurring_interval',medianHours:median};return [{id:'pattern_'+digest(body).slice(0,24),...body,description:'Intervalos dentro de 10% da mediana histórica',occurrences:support,samples:n,statisticalConfidence:{support:p,wilsonLower95:lower},predictionImpact:null,discoveredAt:asOf,lastValidatedAt:asOf,status:'Shadow',reason:'Padrão descritivo; aplicação exige backtest independente.'}];
}
export function featureImportance(events,boss,world,asOf){
 const rows=knownRows(events,boss,world,asOf),xs=rows.slice(1).map((e,i)=>(e.estimatedAt-rows[i].estimatedAt)/3600000),errors=[];
 for(let i=15;i<xs.length;i++){const prior=xs.slice(0,i),actual=xs[i],long=quantile(prior,.5),recent=quantile(prior.slice(-10),.5),full=.8*long+.2*recent;errors.push({full:Math.abs(actual-full),withoutRecent:Math.abs(actual-long),withoutHistory:Math.abs(actual-recent)});}
 if(errors.length<20)return {status:'insufficient',samples:errors.length,features:[]};
 const baseline=mean(errors.map(x=>x.full)),gains=[['median',mean(errors.map(x=>x.withoutHistory))-baseline],['recentIntervals',mean(errors.map(x=>x.withoutRecent))-baseline]],total=gains.reduce((s,x)=>s+Math.max(0,x[1]),0);
 return {status:total>0?'measured':'no_positive_gain',method:'walk_forward_group_ablation',samples:errors.length,model:'robust_interval',features:gains.map(([name,gain])=>({name,maeIncreaseHours:gain,importance:total?Math.max(0,gain)/total:null})),unusedFeatures:['hour','weekday'],productionEligible:false};
}

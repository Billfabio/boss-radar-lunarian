import {mean,quantile,digest} from './feature-store.mjs';
import {MODEL_FAMILY_VERSION} from '../prediction/version.mjs';
export const MODEL_SPECS={
 adaptive_ensemble:{name:'Ensemble adaptativo',version:MODEL_FAMILY_VERSION,status:'Champion',features:['mean10','median','hour','weekday','driftScore']},
 robust_interval:{name:'Intervalo robusto com memória longa',version:'1.0.0',status:'Shadow',features:['median','mean5','stddev','driftScore']},
 empirical_survival:{name:'Sobrevivência empírica',version:'1.0.0',status:'Shadow',features:['elapsedHours','median','samples']},
 graph_context_interval:{name:'Intervalo com contexto temporal do Knowledge Graph',version:'1.0.0',status:'Shadow',features:['median','mean5','driftScore','bossesLast6h','bossesLast12h','bossesLast24h','relatedBossHoursAgo','relatedBossAfterLastTarget']},
 analog_state_interval:{name:'Analog Forecasting por estados históricos semelhantes',version:'1.0.0',status:'Shadow',features:['elapsedHours','bossesLast6h','bossesLast12h','bossesLast24h','uniqueBossesLast24h','analogStateSamples','analogBestSimilarity']}
};
export function candidatePrediction(name,features,parameters={}){
 if(name==='analog_state_interval'){const examples=(features.analogExamples||[]).filter(x=>Number.isFinite(x.intervalHours)&&Number.isFinite(x.similarity)),minSimilarity=Math.max(.2,Math.min(.95,Number(parameters.minSimilarity)||.45)),neighbors=Math.max(5,Math.min(30,Number(parameters.neighbors)||12)),eligible=examples.filter(x=>x.similarity>=minSimilarity).slice(0,neighbors),last=features.rows.at(-1)?.estimatedAt,elapsed=features.values.elapsedHours;if(last==null||!Number.isFinite(elapsed)||eligible.length<8)return null;const weight=x=>Math.max(.001,x.similarity**2),total=eligible.reduce((n,x)=>n+weight(x),0),center=eligible.reduce((n,x)=>n+x.intervalHours*weight(x),0)/total,spread=Math.max(.5,quantile(eligible.map(x=>Math.abs(x.intervalHours-center)),.8));if(center<elapsed)return null;return {predictedAt:Math.round(last+center*3600000),windowStart:Math.round(last+Math.max(elapsed,center-spread)*3600000),windowEnd:Math.round(last+(center+spread)*3600000),parameters:{...structuredClone(parameters),neighbors:eligible.length,minSimilarity,meanSimilarity:mean(eligible.map(x=>x.similarity)),bestSimilarity:eligible[0]?.similarity??null,intervals:features.intervals.length},confidence:null};}
 if(name==='graph_context_interval'&&(!String(parameters.sourceBoss||'').trim()||!Number.isFinite(Number(parameters.windowHours))||Number(parameters.windowHours)<=0||!Number.isFinite(Number(parameters.medianDelayHours))||Number(parameters.medianDelayHours)<=0))return null;
 const xs=features.intervals,v=features.values,last=features.rows.at(-1)?.estimatedAt;if(xs.length<5||last==null||v.preciseSamples<5)return null;
 const recentWindow=Math.max(3,Math.min(30,Number(parameters.recentWindow)||10));let baseShare=Math.max(0,Math.min(.8,Number.isFinite(Number(parameters.recentShare))?Number(parameters.recentShare):.2)),driftShare=Math.max(baseShare,Math.min(.9,Number.isFinite(Number(parameters.driftRecentShare))?Number(parameters.driftRecentShare):.4));if(parameters.ablateRecent===true){baseShare=0;driftShare=0;}if(parameters.ablateHistory===true){baseShare=1;driftShare=1;}
 let center=quantile(xs,Math.max(.1,Math.min(.9,Number(parameters.quantile)||.5))),recentWeight=0,longHistoryWeight=1,graphApplied=false,graphTargetHours=null;
 if(['robust_interval','graph_context_interval'].includes(name)){const recent=quantile(xs.slice(-recentWindow),.5),share=v.driftScore>=40?driftShare:baseShare;center=(1-share)*center+share*recent;recentWeight=share;longHistoryWeight=1-share;}
 if(name==='graph_context_interval'){const ago=Number(v.relatedBossHoursAgo),windowStart=Math.max(0,Number(parameters.windowStartHours)||0),windowEnd=Math.max(windowStart,Number(parameters.windowHours)||0),delay=Number(parameters.medianDelayHours),weight=Math.max(.05,Math.min(.7,Number(parameters.graphWeight)||.35)),direction=String(parameters.direction||'POSITIVE');if(direction==='POSITIVE'&&v.relatedBossAfterLastTarget&&Number.isFinite(ago)&&Number.isFinite(delay)&&windowEnd>0&&ago>=windowStart&&ago<=windowEnd&&delay>=ago){graphTargetHours=v.elapsedHours-ago+delay;if(Number.isFinite(graphTargetHours)&&graphTargetHours>=v.elapsedHours){center=(1-weight)*center+weight*graphTargetHours;graphApplied=true;}}}
 if(!['robust_interval','empirical_survival','graph_context_interval'].includes(name))throw new Error('Modelo desconhecido');
 const spread=Math.max(.5,quantile(xs.map(x=>Math.abs(x-center)),.8));
 return {predictedAt:Math.round(last+center*3600000),windowStart:Math.round(last+(center-spread)*3600000),windowEnd:Math.round(last+(center+spread)*3600000),parameters:{...structuredClone(parameters),recentWindow,longHistoryWeight,recentWeight,graphApplied,graphTargetHours,intervals:xs.length},confidence:null};
}
export function survivalCurve(features,horizons=[6,12,24,48,72]){
 const xs=features.intervals,elapsed=features.values.elapsedHours;if(xs.length<10||elapsed==null)return {status:'insufficient',horizons:[]};
 const survivors=xs.filter(x=>x>elapsed);if(survivors.length<5)return {status:'insufficient_tail',horizons:[],samples:survivors.length};
 return {status:'ready',method:'empirical_conditional_survival',elapsedHours:elapsed,samples:xs.length,atRisk:survivors.length,cumulative:xs.map(x=>x).sort((a,b)=>a-b).filter((x,i,a)=>i===0||x!==a[i-1]).map(x=>({hours:x,probability:xs.filter(y=>y<=x).length/xs.length})),horizons:horizons.map(hours=>{const n=survivors.length,hits=survivors.filter(x=>x<=elapsed+hours).length,p=hits/n,z=1.96,den=1+z*z/n,mid=(p+z*z/(2*n))/den,half=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/den;return {hours,probability:p,ci95:[Math.max(0,mid-half),Math.min(1,mid+half)],samples:n};})};
}
export function metrics(rows){
 const valid=rows.filter(x=>Number.isFinite(x.errorMinutes)),xs=valid.map(x=>x.errorMinutes),ps=rows.filter(x=>Number.isFinite(x.confidence));
 const bins=Array.from({length:10},(_,i)=>ps.filter(x=>Math.min(9,Math.floor(Math.max(0,Math.min(99.999,x.confidence))/10))===i));
 const reliabilityBins=bins.map((b,i)=>({range:[i*10,(i+1)*10],samples:b.length,predicted:b.length?mean(b.map(x=>x.confidence/100)):null,observed:b.length?mean(b.map(x=>x.windowHit?1:0)):null}));
 const ece=ps.length?reliabilityBins.reduce((n,b)=>n+(b.samples?b.samples/ps.length*Math.abs(b.predicted-b.observed):0),0):null;
 const brier=ps.length?mean(ps.map(x=>{const p=Math.max(0,Math.min(1,x.confidence/100)),y=x.windowHit?1:0;return (p-y)**2;})):null;
 const eps=1e-6,logLoss=ps.length?mean(ps.map(x=>{const p=Math.max(eps,Math.min(1-eps,x.confidence/100)),y=x.windowHit?1:0;return -(y*Math.log(p)+(1-y)*Math.log(1-p));})):null;
 const mae=mean(xs),rmse=xs.length?Math.sqrt(mean(xs.map(x=>x*x))):null,p95=quantile(xs,.95),coverage=rows.length?valid.length/rows.length:null;
 const tail=(minutes)=>xs.length?xs.filter(x=>x>minutes).length/xs.length:null;
 return {samples:xs.length,totalRows:rows.length,coverage,maeMinutes:mae,medianErrorMinutes:quantile(xs,.5),rmseMinutes:rmse,p95ErrorMinutes:p95,tailOver60Pct:tail(60),tailOver180Pct:tail(180),tailOver720Pct:tail(720),windowAccuracy:rows.length?mean(rows.map(x=>x.windowHit?1:0)):null,calibrationError:ece,brierScore:brier,logLoss,reliabilityBins,calibrationSamples:ps.length,latencyMs:quantile(rows.map(x=>x.latencyMs).filter(Number.isFinite),.95),failureRate:rows.length?mean(rows.map(x=>x.failed?1:0)):null};
}
export function qualityGate(champion,candidate,{temporalPassed=false,leakagePassed=false,minSamples=50}={}){
 const map=new Map(champion.map(x=>[x.pairId,x])),pairs=candidate.filter(x=>map.has(x.pairId)&&Number.isFinite(x.errorMinutes)&&Number.isFinite(map.get(x.pairId).errorMinutes)),a=pairs.map(x=>map.get(x.pairId)),A=metrics(a),B=metrics(pairs),d=pairs.map((x,i)=>a[i].errorMinutes-x.errorMinutes),avg=mean(d),sd=d.length>1?Math.sqrt(d.reduce((s,x)=>s+(x-avg)**2,0)/(d.length-1)):null,lower=sd==null?null:avg-1.96*sd/Math.sqrt(d.length),reasons=[];
 if(pairs.length<minSamples)reasons.push('insufficient_paired_samples');if(!temporalPassed)reasons.push('temporal_validation_required');if(!leakagePassed)reasons.push('availability_audit_required');
 if(A.maeMinutes==null||B.maeMinutes==null||B.maeMinutes>=A.maeMinutes*.95||lower==null||lower<=1)reasons.push('material_significant_improvement_required');
 if(A.calibrationError==null||B.calibrationError==null||B.calibrationError>A.calibrationError)reasons.push('calibration_unverified_or_worse');
 if(Number.isFinite(A.p95ErrorMinutes)&&Number.isFinite(B.p95ErrorMinutes)&&B.p95ErrorMinutes>A.p95ErrorMinutes*1.05)reasons.push('p95_tail_regression');
 if(Number.isFinite(A.tailOver180Pct)&&Number.isFinite(B.tailOver180Pct)&&B.tailOver180Pct>A.tailOver180Pct+.02)reasons.push('catastrophic_tail_regression');
 if(Number.isFinite(A.brierScore)&&Number.isFinite(B.brierScore)&&B.brierScore>A.brierScore*1.03)reasons.push('brier_regression');
 if(Number.isFinite(A.logLoss)&&Number.isFinite(B.logLoss)&&B.logLoss>A.logLoss*1.03)reasons.push('logloss_regression');
 if(B.latencyMs==null||B.latencyMs>250||B.failureRate>0)reasons.push('performance_or_stability_unverified');
 const strata={};for(const x of pairs){const k=x.world+'|'+x.boss;(strata[k]||=[]).push(x);}
 for(const [k,xs] of Object.entries(strata)){const base=xs.map(x=>map.get(x.pairId)),mA=metrics(base),mB=metrics(xs);if(xs.length<10||mB.maeMinutes>mA.maeMinutes*1.02||(mB.windowAccuracy??0)<(mA.windowAccuracy??0)-.02)reasons.push('boss_regression_or_insufficient:'+k);}
 return {passed:reasons.length===0,reasons,samples:pairs.length,champion:A,candidate:B,lowerImprovement95:lower,policy:{primaryMetric:'paired_mae_improvement',minSamples,minimumGain:.05,minAbsoluteLowerCiMinutes:1,maxBossRegression:.02,maxP95Regression:.05,maxTailOver180Increase:.02,maxLatencyMs:250,calibrationMustNotWorsen:true}};
}
export function datasetSnapshot(store,features,context={}){
 const body={schema:1,featureVersion:features.version,asOf:features.asOf,world:features.values.world,boss:features.values.boss,events:structuredClone(features.rows),contextEvents:structuredClone(features.contextRows||[]),analogExamples:structuredClone(features.analogExamples||[]),features:structuredClone(features.values),context:structuredClone(context)};
 const id='dataset_'+digest(body);if(!store[id])store[id]={id,hash:digest(body),...body};return store[id];
}
export function verifyDataset(dataset){const {id,hash,...body}=dataset;return id==='dataset_'+digest(body)&&hash===digest(body);}

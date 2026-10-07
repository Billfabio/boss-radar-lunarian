import {mean,quantile,digest} from './feature-store.mjs';
import {MODEL_FAMILY_VERSION} from '../prediction/version.mjs';
export const MODEL_SPECS={
 adaptive_ensemble:{name:'Ensemble adaptativo',version:MODEL_FAMILY_VERSION,status:'Champion',features:['mean10','median','hour','weekday','driftScore']},
 robust_interval:{name:'Intervalo robusto com memória longa',version:'1.0.0',status:'Shadow',features:['median','mean5','stddev','driftScore']},
 empirical_survival:{name:'Sobrevivência empírica',version:'1.0.0',status:'Shadow',features:['elapsedHours','median','samples']}
};
export function candidatePrediction(name,features){
 const xs=features.intervals,v=features.values,last=features.rows.at(-1)?.estimatedAt;if(xs.length<5||last==null||v.preciseSamples<5)return null;
 let center=quantile(xs,.5);
 if(name==='robust_interval'){const recent=quantile(xs.slice(-10),.5),share=v.driftScore>=40?.4:.2;center=(1-share)*center+share*recent;}
 if(!['robust_interval','empirical_survival'].includes(name))throw new Error('Modelo desconhecido');
 const spread=Math.max(.5,quantile(xs.map(x=>Math.abs(x-center)),.8));
 return {predictedAt:Math.round(last+center*3600000),windowStart:Math.round(last+(center-spread)*3600000),windowEnd:Math.round(last+(center+spread)*3600000),parameters:{longHistoryWeight:name==='robust_interval'?(v.driftScore>=40?.6:.8):1,intervals:xs.length},confidence:null};
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
 const body={schema:1,featureVersion:features.version,asOf:features.asOf,world:features.values.world,boss:features.values.boss,events:structuredClone(features.rows),features:structuredClone(features.values),context:structuredClone(context)};
 const id='dataset_'+digest(body);if(!store[id])store[id]={id,hash:digest(body),...body};return store[id];
}
export function verifyDataset(dataset){const {id,hash,...body}=dataset;return id==='dataset_'+digest(body)&&hash===digest(body);}

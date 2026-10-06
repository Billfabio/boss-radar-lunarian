import {predictAdaptive} from '../prediction/adaptive-engine.mjs';
import {learnMethodResult} from '../learning/model-performance.mjs';
import {calibrateConfidence,calibrationReport} from '../learning/calibration.mjs';
const H=3600000,DAY=86400000;
const confirmed=e=>/^confirmed_/.test(e.status)&&!e.anomaly&&!['CONFLITANTE','SUSPEITO','DESCARTADO'].includes(e.qualityStatus)&&['appearance','kill'].includes(e.eventType);
const precise=e=>(e.evidence||[]).some(x=>['minute','hour'].includes(x.precision)||x.manual&&x.detail?.correction);
const avg=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;
const q=(a,p)=>{if(!a.length)return null;const s=[...a].sort((x,y)=>x-y),x=(s.length-1)*p,i=Math.floor(x),f=x-i;return s[i]+((s[i+1]??s[i])-s[i])*f;};
function rowsFor(events,boss,world){return events.filter(e=>e.boss===boss&&e.world===world&&confirmed(e)).sort((a,b)=>a.estimatedAt-b.estimatedAt);}
function methodsFor(prior){
 const ints=[];for(let i=1;i<prior.length;i++){const d=prior[i].estimatedAt-prior[i-1].estimatedAt;if(d>H&&d<180*DAY)ints.push(d);}
 if(ints.length<2)return [];
 const last=prior.at(-1).estimatedAt,historicalMean=avg(ints),recent=ints.slice(-Math.min(10,ints.length)),weights=recent.map((_,i)=>Math.pow(.72,recent.length-1-i)),recentWeighted=recent.reduce((n,v,i)=>n+v*weights[i],0)/weights.reduce((a,b)=>a+b,0),median=q(ints,.5),recentMean=avg(recent),lastInterval=ints.at(-1);
 return [
  {name:'historical_mean',predictedAt:last+historicalMean,baseline:true},
  {name:'last_interval',predictedAt:last+lastInterval,baseline:true},
  {name:'empirical_median',predictedAt:last+median,windowStart:last+q(ints,.2),windowEnd:last+q(ints,.8),baseline:true},
  {name:'recent_mean_10',predictedAt:last+recentMean,baseline:true},
  {name:'recent_weighted',predictedAt:last+recentWeighted}
 ];
}
function summarize(rows){
 const errors=rows.map(x=>x.errorMinutes).filter(Number.isFinite),hits=rows.filter(x=>x.windowHit).length;
 return {samples:rows.length,predictions:rows.length,preciseSamples:errors.length,maeMinutes:errors.length?Math.round(errors.reduce((a,b)=>a+b,0)/errors.length*10)/10:null,medianErrorMinutes:errors.length?Math.round(q(errors,.5)*10)/10:null,windowAccuracy:rows.length?Math.round(1000*hits/rows.length)/10:null};
}
export function runHistoricalBacktest(events,world,{minTrain=5,maxPerBoss=5000}={}){
 const bosses=[...new Set(events.filter(e=>e.world===world&&confirmed(e)).map(e=>e.boss))],all=[],perBoss=[],models={},calibrationHistory=[];
 for(const boss of bosses){
  const rows=rowsFor(events,boss,world).slice(-maxPerBoss),results=[];
  for(let i=minTrain;i<rows.length;i++){
   const prior=rows.slice(0,i),actual=rows[i],baseMethods=methodsFor(prior),adaptive=predictAdaptive(prior,boss,world,models,actual.estimatedAt-1);
   let calibrated=null;if(adaptive.status==='ready'){calibrated=calibrateConfidence(adaptive.confidence,calibrationHistory,world,boss);if(calibrated.samples<20)calibrated=calibrateConfidence(adaptive.confidence,calibrationHistory,world,null);}
   const methods=[...baseMethods];
   if(adaptive.status==='ready'){
    for(const m of adaptive.methods||[])if(!methods.some(x=>x.name===m.name))methods.push({name:m.name,predictedAt:m.predictedAt,windowStart:adaptive.windowStart,windowEnd:adaptive.windowEnd});
    methods.push({name:'adaptive_ensemble',predictedAt:adaptive.predictedCenterAt,windowStart:adaptive.windowStart,windowEnd:adaptive.windowEnd});
   }
   for(const m of methods){
    if(!Number.isFinite(m.predictedAt))continue;
    const minuteEligible=precise(actual),error=minuteEligible?Math.abs(actual.estimatedAt-m.predictedAt)/60000:null,windowStart=Number.isFinite(m.windowStart)?m.windowStart:m.predictedAt-12*H,windowEnd=Number.isFinite(m.windowEnd)?m.windowEnd:m.predictedAt+12*H,windowHit=minuteEligible?actual.estimatedAt>=windowStart&&actual.estimatedAt<=windowEnd:Math.max(actual.startAt||actual.estimatedAt,windowStart)<=Math.min(actual.endAt||actual.estimatedAt,windowEnd);
    const splitRatio=(i-minTrain)/Math.max(1,rows.length-minTrain),split=splitRatio<.6?'development':splitRatio<.8?'validation':'test';
    const rec={boss,world,eventId:actual.id,actualAt:actual.estimatedAt,resolvedAt:actual.estimatedAt,actualPrecision:minuteEligible?'time':'day',trainSamples:i,split,model:m.name,predictedAt:Math.round(m.predictedAt),errorMinutes:error==null?null:Math.round(error*10)/10,windowHit,confidenceRaw:m.name==='adaptive_ensemble'&&adaptive.status==='ready'?adaptive.confidence:null,confidence:m.name==='adaptive_ensemble'&&calibrated?calibrated.calibrated:null};
    results.push(rec);all.push(rec);
   }
   if(adaptive.status==='ready'){const ensemble=results.at(-1)?.model==='adaptive_ensemble'?results.at(-1):results.findLast?.(x=>x.eventId===actual.id&&x.model==='adaptive_ensemble');if(ensemble)calibrationHistory.push({boss,world,resolvedAt:actual.estimatedAt,confidenceRaw:adaptive.confidence,confidence:calibrated?.calibrated??adaptive.confidence,windowHit:ensemble.windowHit,errorMinutes:ensemble.errorMinutes});}
   if(adaptive.status==='ready'&&precise(actual))for(const m of adaptive.methods||[])if(Number.isFinite(m.predictedAt))learnMethodResult(models,boss,world,m.name,Math.abs(actual.estimatedAt-m.predictedAt)/60000,actual.estimatedAt>=adaptive.windowStart&&actual.estimatedAt<=adaptive.windowEnd,actual.estimatedAt);
  }
  const names=[...new Set(results.map(x=>x.model))],modelStats=names.map(name=>({model:name,...summarize(results.filter(x=>x.model===name))})).sort((a,b)=>(a.maeMinutes??Infinity)-(b.maeMinutes??Infinity));
  const best=modelStats.find(x=>x.maeMinutes!=null);perBoss.push({boss,events:rows.length,testedEvents:Math.max(0,rows.length-minTrain),bestModel:best?.model||null,models:modelStats});
 }
 const modelNames=[...new Set(all.map(x=>x.model))],overallModels=modelNames.map(name=>({model:name,...summarize(all.filter(x=>x.model===name))})).sort((a,b)=>(a.maeMinutes??Infinity)-(b.maeMinutes??Infinity));
 const byModel=Object.fromEntries(modelNames.map(name=>{const rows=all.filter(x=>x.model===name);return [name,{development:summarize(rows.filter(x=>x.split==='development')),validation:summarize(rows.filter(x=>x.split==='validation')),test:summarize(rows.filter(x=>x.split==='test'))}];}));
 const ensembleRows=all.filter(x=>x.model==='adaptive_ensemble'),temporalValidation={development:summarize(ensembleRows.filter(x=>x.split==='development')),validation:summarize(ensembleRows.filter(x=>x.split==='validation')),test:summarize(ensembleRows.filter(x=>x.split==='test')),byModel};
 const calibration=calibrationReport(calibrationHistory,world),calibrationBySplit={
   development:calibrationReport(ensembleRows.filter(x=>x.split==='development'),world),
   validation:calibrationReport(ensembleRows.filter(x=>x.split==='validation'),world),
   test:calibrationReport(ensembleRows.filter(x=>x.split==='test'),world)
 };
 return {world,generatedAt:Date.now(),eventsEvaluated:new Set(all.map(x=>x.eventId)).size,preciseEventsEvaluated:new Set(all.filter(x=>x.actualPrecision==='time').map(x=>x.eventId)).size,predictionsEvaluated:all.length,overallModels,perBoss:perBoss.sort((a,b)=>(b.testedEvents||0)-(a.testedEvents||0)||a.boss.localeCompare(b.boss)),temporalValidation,calibration,calibrationBySplit,recentResults:all.slice(-500)};
}

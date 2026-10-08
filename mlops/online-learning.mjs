import {digest} from './feature-store.mjs';
import {qualityGate,verifyDataset} from './models.mjs';
import {ensureMLOps} from './service.mjs';
import {predictAdaptive} from '../prediction/adaptive-engine.mjs';
import {learnMethodResult} from '../learning/model-performance.mjs';
const key=(boss,world)=>world+'|'+boss.toLowerCase();
export function proposeOnlineUpdate(intel,boss,world,at=Date.now()){
 const s=ensureMLOps(intel),k=key(boss,world),existing=s.rollouts[k];if(existing&&existing.status==='canary')return existing;
 const rows=intel.forecasts.filter(x=>x.boss===boss&&x.world===world&&x.resolvedAt&&x.resolvedAt<=at&&Number.isFinite(x.errorMinutes)).sort((a,b)=>a.createdAt-b.createdAt).slice(-250);
 if(rows.length<125)return {status:'insufficient',samples:rows.length};
 const split=Math.floor(rows.length*.6),train=rows.slice(0,split),holdout=rows.slice(split),first=holdout[0].createdAt;
 const acceptedTrain=train.filter(x=>Math.max(x.resolvedAt,x.outcomeUpdatedAt||0)<first),proposed={};for(const row of acceptedTrain)for(const method of row.methods||[])if(Number.isFinite(method.actualErrorMinutes))learnMethodResult(proposed,boss,world,method.name,method.actualErrorMinutes,method.hit,row.resolvedAt);
 const firstRun=s.runs.find(x=>x.forecastId===holdout[0].id&&x.mode==='Champion'),prior=firstRun&&s.datasets[firstRun.datasetId]?.context.models?.[k],next=proposed[k];if(!prior||!next)return {status:'insufficient',samples:0};
 // Retain the long-history active parameters; cap each proposed change to ten percent.
 for(const [name,m] of Object.entries(next.methods)){const p=prior.methods[name];if(p?.emaErrorMinutes!=null)m.emaErrorMinutes=Math.max(p.emaErrorMinutes*.9,Math.min(p.emaErrorMinutes*1.1,m.emaErrorMinutes));if(p?.emaHitRate!=null)m.emaHitRate=Math.max(p.emaHitRate-.05,Math.min(p.emaHitRate+.05,m.emaHitRate));}
 const baseline=[],candidate=[];let leakagePassed=true;
 for(const row of holdout){const run=s.runs.filter(x=>x.forecastId===row.id&&x.mode==='Champion').sort((a,b)=>b.asOf-a.asOf)[0],ds=run&&s.datasets[run.datasetId];if(!ds||!verifyDataset(ds)||acceptedTrain.some(x=>Math.max(x.resolvedAt,x.outcomeUpdatedAt||0)>=run.asOf)){leakagePassed=false;continue;}
 const start=performance.now(),p=predictAdaptive(ds.events,boss,world,structuredClone(proposed),run.asOf);if(p.status!=='ready')continue;
 const b={pairId:row.id,boss,world,errorMinutes:row.errorMinutes,windowHit:row.windowHit,confidence:row.confidence,latencyMs:0};baseline.push(b);candidate.push({...b,errorMinutes:Math.abs(row.actualAt-p.predictedCenterAt)/60000,windowHit:row.actualAt>=p.windowStart&&row.actualAt<=p.windowEnd,confidence:p.confidence,latencyMs:performance.now()-start});
 }
 const gate=qualityGate(baseline,candidate,{temporalPassed:true,leakagePassed});
 const update={id:'update_'+digest({k,train:train.map(x=>x.id),parameters:next}),boss,world,at,status:gate.passed?'canary':'rejected',percentage:gate.passed?5:0,models:proposed,previous:structuredClone(intel.models),gate,startedAt:at,stageStartedAt:at,stage:0};s.rollouts[k]=update;s.timeline.push({type:gate.passed?'canary_started':'online_update_rejected',at,boss,world,updateId:update.id,reasons:gate.reasons});return update;
}
export function modelsForPrediction(intel,boss,world,forecastKey){
 const s=ensureMLOps(intel),roll=s.rollouts[key(boss,world)];if(roll?.status!=='canary')return {models:intel.models,rollout:null};
 const bucket=parseInt(digest(forecastKey).slice(0,8),16)%100,selected=bucket<roll.percentage;
 return {models:selected?roll.models:intel.models,rollout:{id:roll.id,selected,percentage:roll.percentage,bucket}};
}
export function monitorCanary(intel,boss,world,at=Date.now()){
 const s=ensureMLOps(intel),k=key(boss,world),roll=s.rollouts[k];if(roll?.status!=='canary')return null;
 const rows=intel.forecasts.filter(x=>x.boss===boss&&x.world===world&&x.createdAt>=roll.stageStartedAt&&x.resolvedAt&&x.rollout?.id===roll.id&&x.rollout.selected&&Number.isFinite(x.errorMinutes));
 if(rows.length<20)return {status:'monitoring',samples:rows.length};
 const mae=rows.reduce((n,x)=>n+x.errorMinutes,0)/rows.length,hit=rows.filter(x=>x.windowHit).length/rows.length,base=roll.gate.champion;
 if(mae>base.maeMinutes*1.02||hit<(base.windowAccuracy??0)-.02){roll.status='rolled_back';roll.percentage=0;s.timeline.push({type:'automatic_rollback',at,boss,world,updateId:roll.id,mae,hit});return roll;}
 if(rows.length<50)return {status:'monitoring',samples:rows.length};
 roll.stage++;roll.percentage=[5,20,50,100][roll.stage]??100;roll.stageStartedAt=at;
 if(roll.stage>=4){intel.models[k]=structuredClone(roll.models[k]);roll.status='promoted';s.timeline.push({type:'online_update_promoted',at,boss,world,updateId:roll.id});}else s.timeline.push({type:'canary_advanced',at,boss,world,percentage:roll.percentage});return roll;
}

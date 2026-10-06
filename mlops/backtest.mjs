import {buildFeatures,availableAt,trustedEvent,digest} from './feature-store.mjs';
import {candidatePrediction,datasetSnapshot,qualityGate,metrics} from './models.mjs';
import {ensureMLOps} from './service.mjs';
import {predictAdaptive} from '../prediction/adaptive-engine.mjs';
import {calibrateConfidence} from '../learning/calibration.mjs';
export function temporalExperiment(intel,world,modelId,at=Date.now()){
 const s=ensureMLOps(intel),events=intel.events.filter(e=>e.world===world&&trustedEvent(e)&&availableAt(e)!=null&&availableAt(e)<=at).sort((a,b)=>a.estimatedAt-b.estimatedAt),base=[],candidate=[],history=[],excluded=[];
 for(const actual of events){
 const previous=events.filter(e=>e.boss===actual.boss&&e.estimatedAt<actual.estimatedAt).at(-1);if(!previous)continue;
 const asOf=availableAt(previous);if(asOf>=actual.estimatedAt){excluded.push({eventId:actual.id,reason:'previous_event_not_available_before_target'});continue;}
 const f=buildFeatures(events,actual.boss,world,asOf),p=predictAdaptive(f.rows,actual.boss,world,{},asOf),start=performance.now(),c=candidatePrediction(modelId,f);if(p.status!=='ready'||!c||f.values.preciseSamples<5)continue;
 if(!(actual.evidence||[]).some(x=>['minute','hour'].includes(x.precision)&&x.quality?.traceable&&['CONFIRMADO','PROVÁVEL'].includes(x.quality?.status)))continue;
 const ds=datasetSnapshot(s.datasets,f,{experiment:modelId}),pairId=actual.id,common={pairId,boss:actual.boss,world,asOf,datasetId:ds.id,resolvedAt:availableAt(actual),actualAt:actual.estimatedAt};
 const prior=history.filter(x=>x.resolvedAt<asOf),bCal=calibrateConfidence(p.confidence,prior.filter(x=>x.modelId==='adaptive_ensemble'),world,actual.boss),cCal=calibrateConfidence(p.confidence,prior.filter(x=>x.modelId===modelId),world,actual.boss);
 const b={...common,modelId:'adaptive_ensemble',errorMinutes:Math.abs(actual.estimatedAt-p.predictedCenterAt)/60000,windowHit:actual.estimatedAt>=p.windowStart&&actual.estimatedAt<=p.windowEnd,confidence:bCal.samples>=20?bCal.calibrated:null,confidenceRaw:p.confidence,latencyMs:0};
 const r={...common,modelId,errorMinutes:Math.abs(actual.estimatedAt-c.predictedAt)/60000,windowHit:actual.estimatedAt>=c.windowStart&&actual.estimatedAt<=c.windowEnd,confidence:cCal.samples>=20?cCal.calibrated:null,confidenceRaw:p.confidence,latencyMs:performance.now()-start};
 base.push(b);candidate.push(r);history.push(b,r);
 }
 const cut=Math.floor(candidate.length*.6),validationEnd=Math.floor(candidate.length*.8),validation=qualityGate(base.slice(cut,validationEnd),candidate.slice(cut,validationEnd),{minSamples:20,temporalPassed:true,leakagePassed:true}),test=qualityGate(base.slice(validationEnd),candidate.slice(validationEnd),{minSamples:20,temporalPassed:true,leakagePassed:true});
 const result={id:'experiment_'+digest({world,modelId,at,datasets:candidate.map(x=>x.datasetId)}),world,modelId,at,samples:candidate.length,datasetIds:[...new Set(candidate.map(x=>x.datasetId))],excluded,development:metrics(candidate.slice(0,cut)),validation,test,temporalPassed:candidate.length>=100&&validation.passed&&test.passed,leakagePassed:candidate.every(x=>s.datasets[x.datasetId].events.every(e=>availableAt(e)<=x.asOf&&e.estimatedAt<=x.asOf)),rows:candidate};
 s.backtests.push(result);return result;
}

import {buildFeatures,FEATURE_DEFINITIONS,digest} from './feature-store.mjs';
import {MODEL_SPECS,candidatePrediction,datasetSnapshot,verifyDataset,qualityGate,survivalCurve,metrics} from './models.mjs';
import {selfCritique,errorAnalysis,discoverPatterns,featureImportance,sourceRelationships} from './analysis.mjs';
import {predictAdaptive} from '../prediction/adaptive-engine.mjs';
import {calibrateConfidence} from '../learning/calibration.mjs';
import {appendLedger} from '../event-sourcing/ledger.mjs';
import {recordLabShadowPredictions} from './lab.mjs';

export function ensureMLOps(intel){
 intel.mlops ||= {schema:1,datasets:{},registry:{},runs:[],errors:{},timeline:[],updates:{},rollouts:{},backtests:[]};
 const s=intel.mlops;if(s.schema!==1)throw new Error('Versão MLOps não suportada');
 for(const [id,spec] of Object.entries(MODEL_SPECS)){s.registry[id] ||= {id,...spec,createdAt:Date.now(),parameters:{},datasetIds:[],promotedBy:null,promotedAt:null};const row=s.registry[id];if(row.version!==spec.version){row.versionHistory||=[];row.versionHistory.push({version:row.version,changedAt:Date.now(),metrics:row.metrics||null});row.version=spec.version;row.datasetIds=[];delete row.metrics;delete row.lastGate;row.lastGateByWorld={};}}
 return s;
}
function note(s,type,detail,at){const row={id:'change_'+digest({type,detail,at}),type,at,...detail};if(!s.timeline.some(x=>x.id===row.id))s.timeline.push(row);}
export function recordPrediction(intel,forecast,asOf,activeModels=intel.models){
 const s=ensureMLOps(intel),features=buildFeatures(intel.events,forecast.boss,forecast.world,asOf),models=structuredClone(activeModels),context={models,sources:structuredClone(intel.sources),predictionEvents:structuredClone(intel.events.filter(e=>e.boss===forecast.boss&&e.world===forecast.world&&e.estimatedAt<=asOf)),configuration:{timezone:'America/Sao_Paulo',featureVersion:features.version}};
 const ds=datasetSnapshot(s.datasets,features,context),raw=predictAdaptive(ds.context.predictionEvents,forecast.boss,forecast.world,structuredClone(models),asOf);
 for(const model of Object.values(s.registry))if(!model.datasetIds.includes(ds.id))model.datasetIds.push(ds.id);
 const critique=selfCritique(forecast,features,Object.values(s.errors)),identity=forecast.id+'|'+ds.id;
 if(s.runs.some(x=>x.identity===identity))return {datasetId:ds.id,features:features.values,critique};
 const artifact={identity,forecastId:forecast.id,boss:forecast.boss,world:forecast.world,datasetId:ds.id,asOf,featureVersion:features.version,features:structuredClone(features.values),weights:structuredClone(forecast.methods||[]),output:structuredClone(forecast),rawPrediction:structuredClone(raw),rawHash:digest(raw),mode:'Champion',modelId:'adaptive_ensemble',modelVersion:MODEL_SPECS.adaptive_ensemble.version};
 artifact.immutableHash=digest({output:artifact.output,features:artifact.features,weights:artifact.weights,rawPrediction:artifact.rawPrediction,datasetId:artifact.datasetId,asOf});s.runs.push(artifact);
 for(const id of Object.keys(MODEL_SPECS).filter(x=>x!=='adaptive_ensemble')){
 const start=performance.now(),prediction=candidatePrediction(id,features);if(!prediction)continue;
 const historical=s.runs.filter(x=>!x.experimentId&&x.modelId===id&&x.modelVersion===MODEL_SPECS[id].version&&x.world===forecast.world&&x.resolvedAt&&Math.max(x.resolvedAt,x.outcomeUpdatedAt||0)<asOf).map(x=>({...x,confidenceRaw:x.confidenceRaw,confidence:x.confidence})),cal=calibrateConfidence(forecast.confidenceRaw??forecast.confidence,historical,forecast.world,forecast.boss);
 const shadow={identity:identity+'|'+id,forecastId:forecast.id,pairId:forecast.id,boss:forecast.boss,world:forecast.world,datasetId:ds.id,asOf,modelId:id,modelVersion:MODEL_SPECS[id].version,mode:'Shadow',...prediction,confidenceRaw:forecast.confidenceRaw??forecast.confidence,confidence:cal.samples>=20?cal.calibrated:null,calibrationSamples:cal.samples,latencyMs:performance.now()-start};s.runs.push(shadow);
 }
 recordLabShadowPredictions(intel,forecast,asOf,features,ds.id);
 note(s,'prediction_recorded',{forecastId:forecast.id,datasetId:ds.id,boss:forecast.boss,world:forecast.world},asOf);
 return {datasetId:ds.id,features:features.values,critique};
}
export function resolveMLOps(intel,forecast,event){
 const s=ensureMLOps(intel);s.errors[forecast.id]=errorAnalysis(forecast,event);
 const champion=s.runs.filter(x=>x.forecastId===forecast.id&&x.mode==='Champion').sort((a,b)=>b.asOf-a.asOf)[0];
 for(const run of s.runs.filter(x=>x.forecastId===forecast.id)){
 if(run.mode==='Champion'&&run!==champion)continue;
 const precise=forecast.actualPrecision==='time';run.actualAt=event.estimatedAt;run.resolvedAt=forecast.resolvedAt;run.outcomeUpdatedAt=forecast.outcomeUpdatedAt||forecast.resolvedAt;run.pairId=forecast.id;run.superseded=false;
 run.errorMinutes=precise?Math.abs(event.estimatedAt-(run.predictedAt??run.output.predictedCenterAt))/60000:null;run.windowHit=event.estimatedAt>=(run.windowStart??run.output.windowStart)&&event.estimatedAt<=(run.windowEnd??run.output.windowEnd);
 if(run.mode==='Champion'){run.confidence=run.output.confidence;run.latencyMs=0;}
 }
 // A proposal is staged; active weights are updated only by a subsequent temporal gate.
 s.updates[forecast.id]={id:forecast.id,boss:forecast.boss,world:forecast.world,status:'pending_validation',resolvedAt:forecast.resolvedAt,maxRelativeParameterStep:.1};
 note(s,'outcome_resolved',{forecastId:forecast.id,boss:forecast.boss,world:forecast.world,errorMinutes:forecast.errorMinutes,causes:s.errors[forecast.id].causes},forecast.resolvedAt);
}
export function replayPrediction(intel,forecastId){
 const s=ensureMLOps(intel),run=s.runs.filter(x=>x.forecastId===forecastId&&x.mode==='Champion').sort((a,b)=>b.asOf-a.asOf)[0];if(!run)throw new Error('Previsão sem snapshot reproduzível');
 const ds=s.datasets[run.datasetId];if(!ds||!verifyDataset(ds))throw new Error('Dataset ausente ou alterado');
 if(digest({output:run.output,features:run.features,weights:run.weights,rawPrediction:run.rawPrediction,datasetId:run.datasetId,asOf:run.asOf})!==run.immutableHash)throw new Error('Snapshot da previsão alterado');
 // Outcome fields are appended later; immutable prediction is verified independently.
 const raw=predictAdaptive(ds.context.predictionEvents,run.boss,run.world,structuredClone(ds.context.models),run.asOf);
 if(digest(raw)!==run.rawHash)throw new Error('Divergência na reprodução do motor');
 if(raw.predictedCenterAt!==run.output.predictedCenterAt)throw new Error('Centro publicado diverge do snapshot do motor');
 return {forecastId,datasetId:ds.id,verified:true,features:ds.features,rawPrediction:raw,publishedPrediction:run.output};
}
export function evaluateModel(intel,id,world,at=Date.now()){
 const s=ensureMLOps(intel);if(!MODEL_SPECS[id]||id==='adaptive_ensemble')throw new Error('Candidato inválido');
 const runs=s.runs.filter(x=>x.world===world&&x.resolvedAt&&x.resolvedAt<=at&&Number.isFinite(x.errorMinutes)),base=runs.filter(x=>x.mode==='Champion'),candidate=runs.filter(x=>x.modelId===id);
 const latest=new Map();for(const x of candidate.sort((a,b)=>a.asOf-b.asOf))latest.set(x.pairId,x);const candidates=[...latest.values()];
 const validation=s.backtests.findLast(x=>x.world===world&&x.modelId===id&&x.temporalPassed&&x.leakagePassed);
 const gate=qualityGate(base,candidates,{temporalPassed:!!validation,leakagePassed:candidates.length>0&&candidates.every(x=>verifyDataset(s.datasets[x.datasetId]))&&!!validation});
 s.registry[id].metrics=metrics(candidates);s.registry[id].lastGate=gate;s.registry[id].lastGateByWorld ||= {};s.registry[id].lastGateByWorld[world]=gate;s.registry[id].lastValidatedAt=at;
 if(gate.passed&&s.registry[id].status==='Shadow'){s.registry[id].status='Challenger';s.registry[id].promotedAt=at;s.registry[id].promotedBy='quality_gate';note(s,'challenger_validated',{modelId:id,world,gate},at);}
 return gate;
}
export function dashboard(intel,world,asOf=Date.now()){
 const s=ensureMLOps(intel),bosses=[...new Set(intel.events.filter(x=>x.world===world).map(x=>x.boss))],errors=Object.values(s.errors).filter(x=>x.world===world),causes={};for(const e of errors)for(const cause of e.causes)causes[cause]=(causes[cause]||0)+1;
 const measured=new Map();for(const run of s.runs.filter(x=>x.world===world&&x.resolvedAt).sort((a,b)=>a.asOf-b.asOf))measured.set(run.modelId+'|'+run.pairId,run);
 const scopedRegistry=Object.values(s.registry).map(x=>({...x,metrics:metrics([...measured.values()].filter(r=>r.modelId===x.id&&r.modelVersion===x.version)),lastGate:x.lastGateByWorld?.[world]||null}));
 return {champion:scopedRegistry.find(x=>x.id==='adaptive_ensemble'),registry:scopedRegistry,datasets:Object.values(s.datasets).filter(x=>x.world===world).map(x=>({id:x.id,asOf:x.asOf,boss:x.boss,events:x.events.length,hash:x.hash})).slice(-100),features:FEATURE_DEFINITIONS,shadowModels:scopedRegistry.filter(x=>x.status==='Shadow'),pendingUpdates:Object.values(s.updates).filter(x=>x.world===world).length,errorCauses:causes,errorMemory:errors.slice(-50),timeline:s.timeline.filter(x=>!x.world||x.world===world).slice(-100),rollouts:s.rollouts,backtests:s.backtests.filter(x=>x.world===world).slice(-20),sourceGraph:sourceRelationships(intel.events,world),report:{generatedAt:asOf,resolved:errors.length,largestProblem:Object.entries(causes).sort((a,b)=>b[1]-a[1])[0]?.[0]||'insufficient_resolved_forecasts',precision:metrics([...measured.values()].filter(x=>x.mode==='Champion')),learningStatus:'Propostas aguardam comparação temporal; nenhum modelo muda por um único dado.'},bosses:bosses.map(boss=>{const f=buildFeatures(intel.events,boss,world,asOf);return {boss,features:f.values,survival:survivalCurve(f),patterns:discoverPatterns(intel.events,boss,world,asOf),importance:featureImportance(intel.events,boss,world,asOf)};})};
}

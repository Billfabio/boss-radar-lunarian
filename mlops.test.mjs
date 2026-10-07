import test from 'node:test';
import assert from 'node:assert/strict';
import {buildFeatures,knownRows,availableAt,digest} from './mlops/feature-store.mjs';
import {datasetSnapshot,verifyDataset,survivalCurve,qualityGate,candidatePrediction} from './mlops/models.mjs';
import {ensureMLOps,recordPrediction,replayPrediction,resolveMLOps,evaluateModel,dashboard} from './mlops/service.mjs';
import {temporalExperiment} from './mlops/backtest.mjs';
import {selfCritique,poisoningSignal,featureImportance,sourceRelationships} from './mlops/analysis.mjs';
import {modelsForPrediction,monitorCanary,proposeOnlineUpdate} from './mlops/online-learning.mjs';
import {predictAdaptive} from './prediction/adaptive-engine.mjs';
import {resolveForecasts} from './learning/model-performance.mjs';
import {TaskQueue} from './runtime/task-queue.mjs';
import {ensureAILab,createLabExperiment,beginExperiment,finishExperiment,refreshLiveExperiment,approveExperiment,applyLabModel,monitorLabCanary,aiLabDashboard} from './mlops/lab.mjs';
const H=3600000,T=Date.parse('2025-01-01T00:00:00Z');
function event(i,overrides={}){const at=T+i*72*H;return {id:'e'+i,boss:'Boss',world:'World',estimatedAt:at,startAt:at,endAt:at,updatedAt:at+60000,eventType:'appearance',status:'confirmed_auto',qualityStatus:'CONFIRMADO',dataQualityScore:95,confidence:.95,consensus:{confidence:.95},evidence:[{evidenceId:'x'+i,sourceId:'rubinot-official',sourceRef:'https://example.org/event/'+i,collectionMethod:'official_json',boss:'Boss',world:'World',eventType:'appearance',estimatedAt:at,startAt:at,endAt:at,precision:'minute',confidence:.95,collectedAt:at+60000,reportedAt:at+60000,processedAt:at+60000,quality:{version:'2.0.0',status:'CONFIRMADO',score:95,traceable:true,eligibleForLearning:true}}],...overrides};}
const rows=n=>Array.from({length:n},(_,i)=>event(i));
function intel(n=25){return {events:rows(n),models:{},sources:{},forecasts:[],ledger:[]};}
function forecast(s,id='f1'){const asOf=availableAt(s.events.at(-1))+1,p=predictAdaptive(s.events,'Boss','World',{},asOf);return {id,boss:'Boss',world:'World',baseEventId:p.baseEventId,baseEventAt:p.baseEventAt,createdAt:asOf,predictedCenterAt:p.predictedCenterAt,windowStart:p.windowStart,windowEnd:p.windowEnd,confidence:p.confidence,sampleSize:p.sampleSize,methods:p.methods,drift:p.drift,calibration:{samples:0}};}
test('Feature Store excludes late knowledge, future observations, quarantine and future corrections',()=>{const es=rows(20),asOf=availableAt(es[10])+1;assert.equal(buildFeatures(es,'Boss','World',asOf).values.samples,11);es[2].updatedAt=asOf+100;es[3].evidence[0].processedAt=asOf+100;es[4].qualityStatus='SUSPEITO';assert.equal(knownRows(es,'Boss','World',asOf).length,8);assert.equal(buildFeatures(es,'Boss','World',asOf).values.mean5,72);});
test('Dataset identity is deterministic, immutable and changes on configuration or correction',()=>{const es=rows(20),asOf=availableAt(es.at(-1))+1,f=buildFeatures(es,'Boss','World',asOf),store={},a=datasetSnapshot(store,f,{weights:{x:1}}),b=datasetSnapshot(store,f,{weights:{x:1}});assert.equal(a.id,b.id);es[0].estimatedAt+=123;assert.ok(verifyDataset(a));assert.notEqual(datasetSnapshot(store,f,{weights:{x:2}}).id,a.id);a.events[0].estimatedAt++;assert.equal(verifyDataset(a),false);});
test('Shadow predictions are persisted separately and replay survives current history changes',()=>{const s=intel(),f=forecast(s),asOf=f.createdAt;const result=recordPrediction(s,f,asOf);assert.equal(s.mlops.runs.filter(x=>x.mode==='Shadow').length,3);assert.equal(s.mlops.registry.robust_interval.status,'Shadow');assert.ok(result.datasetId);const replay=replayPrediction(s,f.id);assert.equal(replay.rawPrediction.predictedCenterAt,f.predictedCenterAt);s.events[0].estimatedAt+=H;s.models={};assert.equal(replayPrediction(s,f.id).verified,true);assert.equal(s.forecasts.length,0);});
test('Replay rejects changes to prediction and dataset independently',()=>{const s=intel(),f=forecast(s);recordPrediction(s,f,f.createdAt);s.mlops.runs[0].output.confidence++;assert.throws(()=>replayPrediction(s,f.id),/Snapshot/);});
test('Controlled resolution measures outcomes without changing active method weights',()=>{const s=intel(),f=forecast(s),next=event(25);s.forecasts=[f];const prior=digest(s.models);const resolved=resolveForecasts(s.forecasts,next,s.models,{controlled:true});assert.equal(resolved.length,1);assert.deepEqual(s.models['World|boss'].methods,{});resolveMLOps(s,f,next);assert.equal(s.mlops.updates[f.id].status,'pending_validation');assert.ok(s.mlops.errors[f.id]);resolveMLOps(s,f,next);assert.equal(Object.keys(s.mlops.errors).length,1);assert.equal(proposeOnlineUpdate(s,'Boss','World').status,'insufficient');});
test('Quarantined outcomes cannot update the forecast book',()=>{const s=intel(),f=forecast(s),bad=event(25,{qualityStatus:'SUSPEITO'});assert.equal(resolveForecasts([f],bad,s.models,{controlled:true}).length,0);assert.equal(f.resolvedAt,undefined);});
test('Quality gate requires significant paired gain, calibration, temporal audit and each boss',()=>{const a=Array.from({length:60},(_,i)=>({pairId:String(i),boss:'A',world:'World',errorMinutes:100,windowHit:true,confidence:100,latencyMs:1})),b=a.map(x=>({...x,errorMinutes:70}));assert.ok(qualityGate(a,b,{temporalPassed:true,leakagePassed:true}).passed);assert.equal(qualityGate(a,b).passed,false);const worse=b.map((x,i)=>i<20?{...x,boss:'B',errorMinutes:120}:x),base=a.map((x,i)=>i<20?{...x,boss:'B'}:x);assert.equal(qualityGate(base,worse,{temporalPassed:true,leakagePassed:true}).passed,false);assert.equal(qualityGate(a,b.map(x=>({...x,confidence:null})),{temporalPassed:true,leakagePassed:true}).passed,false);});
test('Survival conditional horizons are monotonic, bounded and abstain on unsupported tails',()=>{const f=buildFeatures(rows(30),'Boss','World',availableAt(event(29))+1),curve=survivalCurve(f);assert.equal(curve.status,'ready');assert.ok(curve.horizons.every((h,i)=>h.probability>=0&&h.probability<=1&&(!i||h.probability>=curve.horizons[i-1].probability)));f.values.elapsedHours=100;assert.equal(survivalCurve(f).status,'insufficient_tail');assert.equal(survivalCurve(buildFeatures(rows(3),'Boss','World',T+1000*H)).status,'insufficient');});
test('Temporal experiments exclude hindsight and record exactly available datasets',()=>{const s=intel(35),r=temporalExperiment(s,'World','robust_interval',T+4000*H);assert.ok(r.samples>0);assert.ok(r.leakagePassed);assert.equal(r.temporalPassed,false);for(const ds of Object.values(s.mlops.datasets))assert.ok(ds.events.every(e=>availableAt(e)<=ds.asOf));for(const e of s.events)e.updatedAt=T+5000*H;assert.equal(temporalExperiment(s,'World','robust_interval',T+6000*H).samples,0);});
test('Self critique requests confirmation on conflict and suppresses exact time',()=>{const s=intel(),f=buildFeatures(s.events,'Boss','World',T+2000*H),c=selfCritique({boss:'Boss',world:'World',confidence:90,probability:80,excluded:{conflicts:1},calibration:{samples:0}},f);assert.ok(c.needsConfirmation);assert.equal(c.canPublishExact,false);assert.ok(c.confidenceCap<90);});
test('Poisoning detector ignores day-only repetition and flags precise source bursts',()=>{const es=rows(15),obs=es[0].evidence[0];for(const e of es){e.evidence[0].estimatedAt=obs.estimatedAt;e.evidence[0].processedAt=obs.processedAt;}assert.equal(poisoningSignal({...obs,evidenceId:'new'},es).kind,'repeated_precise_timestamp');assert.equal(poisoningSignal({...obs,precision:'day'},es),null);});
test('Feature importance is measured only after enough temporal folds',()=>{assert.equal(featureImportance(rows(20),'Boss','World',T+3000*H).status,'insufficient');const r=featureImportance(rows(60),'Boss','World',T+6000*H);assert.equal(r.status,'no_positive_gain');assert.equal(r.productionEligible,false);assert.ok(r.features.every(x=>x.importance==null));});
test('Canary selection is deterministic and regression rolls back',()=>{const s=intel();ensureMLOps(s);s.mlops.rollouts['World|boss']={id:'u',status:'canary',models:{candidate:true},percentage:5,stage:0,stageStartedAt:1,gate:{champion:{maeMinutes:10,windowAccuracy:1}}};assert.deepEqual(modelsForPrediction(s,'Boss','World','same'),modelsForPrediction(s,'Boss','World','same'));s.forecasts=Array.from({length:20},(_,i)=>({boss:'Boss',world:'World',createdAt:2,resolvedAt:3,errorMinutes:20,windowHit:false,rollout:{id:'u',selected:true}}));assert.equal(monitorCanary(s,'Boss','World',4).status,'rolled_back');assert.equal(modelsForPrediction(s,'Boss','World','same').models,s.models);});
test('Queue retries only declared idempotent jobs and preserves dead letters while processing recovers',async()=>{const letters=[],q=new TaskQueue({deadLetters:letters});assert.throws(()=>q.enqueue('unsafe',async()=>{}, {maxAttempts:2}),/idempotente/);let attempts=0;await assert.rejects(q.enqueue('bad',async()=>{attempts++;throw new Error('failure');},{idempotent:true,maxAttempts:3,payload:{eventId:'e'}}));assert.equal(attempts,3);assert.equal(letters[0].attempts,3);assert.equal(letters[0].payload.eventId,'e');assert.equal(await q.enqueue('good',async()=>42),42);assert.equal(q.stats().deadLetterCount,1);});
test('Registry and dashboard preserve Champion and show unavailable metrics honestly',()=>{const s=intel(0),d=dashboard(s,'World',T);assert.equal(d.champion.status,'Champion');assert.equal(d.shadowModels.length,5);assert.equal(d.report.precision.maeMinutes,null);assert.equal(evaluateModel(s,'robust_interval','World',T).passed,false);assert.equal(s.mlops.registry.robust_interval.status,'Shadow');});


function labBacktest(n=120){
 const pairs=Array.from({length:n},(_,i)=>({pairId:'p'+i,boss:'Boss',world:'World',asOf:1000+i,resolvedAt:2000+i,datasetId:'d'+i,championErrorMinutes:100,challengerErrorMinutes:60,championWindowHit:true,challengerWindowHit:true,championConfidence:90,challengerConfidence:90,challengerLatencyMs:2,improvementMinutes:40}));
 const rows=x=>x.map(p=>({pairId:p.pairId,boss:p.boss,world:p.world,errorMinutes:p.challengerErrorMinutes,windowHit:p.challengerWindowHit,confidence:p.challengerConfidence,latencyMs:p.challengerLatencyMs}));
 const base=x=>x.map(p=>({pairId:p.pairId,boss:p.boss,world:p.world,errorMinutes:p.championErrorMinutes,windowHit:p.championWindowHit,confidence:p.championConfidence,latencyMs:0}));
 const cut=Math.floor(n*.6),v=Math.floor(n*.8),cmp=(a,b)=>qualityGate(base(pairs.slice(a,b)),rows(pairs.slice(a,b)),{minSamples:20,temporalPassed:true,leakagePassed:true});
 return {id:'bt-lab',samples:n,datasetIds:[],excluded:[],development:{},developmentComparison:cmp(0,cut),validation:cmp(cut,v),test:cmp(v,n),split:{development:[0,cut],validation:[cut,v],holdout:[v,n]},temporalPassed:true,leakagePassed:true,rows:rows(pairs),pairs};
}
test('AI Lab deduplicates hypotheses and keeps automatic model promotion disabled',()=>{
 const s=intel();ensureMLOps(s);const lab=ensureAILab(s);assert.equal(lab.autoModelPromotion,false);
 const a=createLabExperiment(s,{hypothesis:'Dar maior peso aos intervalos recentes melhora Boss.',world:'World',modelId:'robust_interval'}),b=createLabExperiment(s,{hypothesis:'  Dar maior peso aos intervalos recentes melhora Boss.  ',world:'World',modelId:'robust_interval'});
 assert.equal(a.duplicate,false);assert.equal(b.duplicate,true);assert.equal(a.experiment.id,b.experiment.id);
});
test('AI Lab requires temporal holdout and enters Shadow only after historical gates',()=>{
 const s=intel();ensureMLOps(s);const x=createLabExperiment(s,{hypothesis:'Intervalo robusto reduz o erro temporal do Boss fora da amostra.',world:'World',modelId:'robust_interval'}).experiment;beginExperiment(s,x.id,1000);
 const done=finishExperiment(s,x.id,labBacktest(),{runtimeMs:50,at:2000});assert.equal(done.status,'SHADOW');assert.equal(done.result.historical.historicalGate.passed,true);assert.equal(done.result.historical.overfitRisk.detected,false);assert.equal(done.result.decision,'ENTER_SHADOW');
});
test('AI Lab live Shadow requires future paired samples before promotion eligibility',()=>{
 const s=intel(30);ensureMLOps(s);const exp=createLabExperiment(s,{hypothesis:'Robust interval melhora Boss em eventos futuros reais.',world:'World',modelId:'robust_interval'}).experiment;beginExperiment(s,exp.id,1);finishExperiment(s,exp.id,labBacktest(),{runtimeMs:10,at:2});
 const f=buildFeatures(s.events,'Boss','World',availableAt(s.events.at(-1))+1),ds=datasetSnapshot(s.mlops.datasets,f,{experiment:'live'});
 for(let i=0;i<30;i++){s.mlops.runs.push({pairId:'live'+i,forecastId:'live'+i,mode:'Champion',modelId:'adaptive_ensemble',world:'World',boss:'Boss',datasetId:ds.id,asOf:3+i,resolvedAt:100+i,errorMinutes:100,windowHit:true,confidence:90,latencyMs:0});s.mlops.runs.push({pairId:'live'+i,forecastId:'live'+i,mode:'Shadow',experimentId:exp.id,modelId:'robust_interval',modelVersion:'1.0.0',world:'World',boss:'Boss',datasetId:ds.id,asOf:3+i,resolvedAt:100+i,errorMinutes:60,windowHit:true,confidence:90,confidenceRaw:90,latencyMs:2});}
 const r=refreshLiveExperiment(s,exp.id,1000);assert.equal(r.status,'ELIGIBLE_FOR_PROMOTION');assert.equal(r.live.samples,30);assert.equal(r.result.recommendation,'PROMOTE');
 const canary=approveExperiment(s,exp.id,{actor:'tester',reason:'all gates pass',at:1001});assert.equal(canary.percentage,10);assert.equal(s.mlops.lab.autoModelPromotion,false);
});
test('AI Lab Canary selection is deterministic and uses challenger calibration only after enough shadow samples',()=>{
 const s=intel(30);ensureMLOps(s);const exp=createLabExperiment(s,{hypothesis:'Robust interval melhora o Boss com shadow calibrado.',world:'World',modelId:'robust_interval'}).experiment;beginExperiment(s,exp.id,1);finishExperiment(s,exp.id,labBacktest(),{runtimeMs:10,at:2});
 const f=buildFeatures(s.events,'Boss','World',availableAt(s.events.at(-1))+1),ds=datasetSnapshot(s.mlops.datasets,f,{experiment:'live'});
 for(let i=0;i<30;i++){s.mlops.runs.push({pairId:'z'+i,forecastId:'z'+i,mode:'Champion',modelId:'adaptive_ensemble',world:'World',boss:'Boss',datasetId:ds.id,asOf:3+i,resolvedAt:100+i,errorMinutes:100,windowHit:true,confidence:90,latencyMs:0});s.mlops.runs.push({pairId:'z'+i,forecastId:'z'+i,mode:'Shadow',experimentId:exp.id,modelId:'robust_interval',modelVersion:'1.0.0',world:'World',boss:'Boss',datasetId:ds.id,asOf:3+i,resolvedAt:100+i,errorMinutes:60,windowHit:true,confidence:90,confidenceRaw:90,latencyMs:2});}
 refreshLiveExperiment(s,exp.id,1000);approveExperiment(s,exp.id,{at:1001});const base={...predictAdaptive(s.events,'Boss','World',{},T+3000*H),confidenceRaw:90,confidence:90};let key='';for(let i=0;i<10000;i++){const k='key'+i;if(parseInt(digest(k).slice(0,8),16)%100<10){key=k;break;}}
 const a=applyLabModel(s,base,'Boss','World',key,T+3000*H),b=applyLabModel(s,base,'Boss','World',key,T+3000*H);assert.equal(a.rollout.selected,true);assert.equal(a.prediction.labModelId,'robust_interval');assert.equal(a.prediction.predictedCenterAt,b.prediction.predictedCenterAt);assert.ok(a.prediction.calibration.samples>=20);
});
test('AI Lab Canary auto-rolls back on severe real-world regression',()=>{
 const s=intel(30);ensureMLOps(s);const exp=createLabExperiment(s,{hypothesis:'Robust interval deve manter cauda de erro controlada.',world:'World',modelId:'robust_interval'}).experiment;beginExperiment(s,exp.id,1);finishExperiment(s,exp.id,labBacktest(),{runtimeMs:10,at:2});
 const f=buildFeatures(s.events,'Boss','World',availableAt(s.events.at(-1))+1),ds=datasetSnapshot(s.mlops.datasets,f,{experiment:'rollback-live'});
 for(let i=0;i<30;i++){s.mlops.runs.push({pairId:'rb'+i,forecastId:'rb'+i,mode:'Champion',modelId:'adaptive_ensemble',world:'World',boss:'Boss',datasetId:ds.id,asOf:3+i,resolvedAt:100+i,errorMinutes:100,windowHit:true,confidence:90,latencyMs:0});s.mlops.runs.push({pairId:'rb'+i,forecastId:'rb'+i,mode:'Shadow',experimentId:exp.id,modelId:'robust_interval',modelVersion:'1.0.0',world:'World',boss:'Boss',datasetId:ds.id,asOf:3+i,resolvedAt:100+i,errorMinutes:60,windowHit:true,confidence:90,confidenceRaw:90,latencyMs:2});}
 assert.equal(refreshLiveExperiment(s,exp.id,1000).status,'ELIGIBLE_FOR_PROMOTION');const canary=approveExperiment(s,exp.id,{at:1001});
 s.forecasts=Array.from({length:20},(_,i)=>({id:'cf'+i,boss:'Boss',world:'World',createdAt:1002,resolvedAt:1003,actualAt:100000+i,errorMinutes:200,windowHit:false,confidence:90,labRollout:{id:canary.id,selected:true,latencyMs:2},labBaseline:{predictedCenterAt:100000+i,windowStart:99000+i,windowEnd:101000+i,confidence:90}}));
 const result=monitorLabCanary(s,'Boss','World',1004);assert.equal(result.status,'ROLLED_BACK');assert.equal(exp.status,'REJECTED');
});
test('AI Lab dashboard exposes sample-aware leaderboard and model card without fictitious metrics',()=>{
 const s=intel(0);ensureMLOps(s);const d=aiLabDashboard(s,'World',T);assert.equal(d.policy.auto_model_promotion,false);assert.equal(d.champion.modelId,'adaptive_ensemble');assert.equal(d.champion.metrics.samples,0);assert.ok(Array.isArray(d.leaderboard.overall));assert.equal(d.featureVersion,'1.3.0');
});


test('AI Lab parameter variants have distinct identities and reproducible reports',()=>{
 const s=intel(40);ensureMLOps(s);
 const a=createLabExperiment(s,{hypothesis:'Peso recente de 20 por cento melhora Boss.',world:'World',boss:'Boss',modelId:'robust_interval',parameters:{recentWindow:10,recentShare:.2,driftRecentShare:.4}}).experiment;
 const b=createLabExperiment(s,{hypothesis:'Peso recente de 40 por cento melhora Boss.',world:'World',boss:'Boss',modelId:'robust_interval',parameters:{recentWindow:10,recentShare:.4,driftRecentShare:.6}}).experiment;
 assert.notEqual(a.fingerprint,b.fingerprint);beginExperiment(s,a.id,1);const bt=temporalExperiment(s,'World','robust_interval',T+5000*H,{boss:'Boss',parameters:a.parameters});const done=finishExperiment(s,a.id,bt,{runtimeMs:5,at:2});assert.deepEqual(done.result.report.configuration.parameters,a.parameters);assert.equal(done.result.report.configuration.boss,'Boss');assert.ok(done.datasetVersion);
});
test('AI Lab measured ablation creates a real parameterized challenger instead of a label-only experiment',()=>{
 const s=intel(40);ensureMLOps(s);const exp=createLabExperiment(s,{hypothesis:'Remover intervalos recentes não piora o Boss.',kind:'ablation',world:'World',boss:'Boss',modelId:'robust_interval',features:['recentIntervals'],parameters:{recentWindow:10,recentShare:0,driftRecentShare:0,ablateRecent:true}}).experiment;
 beginExperiment(s,exp.id,1);const bt=temporalExperiment(s,'World','robust_interval',T+5000*H,{boss:'Boss',parameters:exp.parameters});assert.equal(bt.parameters.ablateRecent,true);assert.ok(bt.pairs.every(x=>Number.isFinite(x.challengerErrorMinutes)));
});
test('AI Lab smart retraining does not invent a trigger when baseline is insufficient',()=>{
 const s=intel(0);ensureMLOps(s);const d=aiLabDashboard(s,'World',T);assert.equal(d.championDegradation.status,'INSUFFICIENT_DATA');assert.equal(d.retraining.status,'NO_RETRAIN_NEEDED');assert.match(d.retraining.note,/Idade do Champion/);
});
test('AI Lab robustness probe is deterministic and explicitly not an accuracy claim',()=>{
 const s=intel(40);ensureMLOps(s);const a=aiLabDashboard(s,'World',T+5000*H).robustness,b=aiLabDashboard(s,'World',T+5000*H).robustness;assert.equal(a.accuracyNotMeasured,true);assert.deepEqual(a.rows,b.rows);
});


test('AI Lab Feature Store v1.3 exposes source coverage only when historically supplied and derives non-causal regime signal',()=>{
 const es=rows(30),asOf=availableAt(es.at(-1))+1,a=buildFeatures(es,'Boss','World',asOf),b=buildFeatures(es,'Boss','World',asOf,{sourceCoverage:.73});
 assert.equal(a.version,'1.3.0');assert.equal(a.values.sourceCoverage,null);assert.equal(b.values.sourceCoverage,.73);assert.ok(['STABLE','TRANSITION','HIGH_DRIFT'].includes(b.values.regimeSignal));
});

test('AI Lab robustness includes missing-source and conflict scenarios without claiming accuracy',()=>{
 const s=intel(40);ensureMLOps(s);const d=aiLabDashboard(s,'World',T+5000*H),names=new Set((d.robustness.rows||[]).flatMap(x=>x.scenarios.map(y=>y.scenario)));
 assert.equal(d.robustness.accuracyNotMeasured,true);assert.ok(names.has('sources_offline'));assert.ok(names.has('source_quality_50pct'));assert.ok(names.has('conflict_high_drift'));
});


test('Graph context features are as-known-at safe and drive only the experiment challenger',()=>{
 const es=rows(12),last=es.at(-1).estimatedAt,srcAt=last+2*H,asOf=last+5*H,src=event(99,{id:'source-event',boss:'Source',estimatedAt:srcAt,startAt:srcAt,endAt:srcAt,updatedAt:srcAt+60000});
 src.evidence=[{...es[0].evidence[0],evidenceId:'source-evidence',boss:'Source',estimatedAt:srcAt,startAt:srcAt,endAt:srcAt,collectedAt:srcAt+60000,reportedAt:srcAt+60000,processedAt:srcAt+60000}];
 const f=buildFeatures([...es,src],'Boss','World',asOf,{relatedBoss:'Source'});assert.equal(f.values.relatedBossAfterLastTarget,true);assert.ok(f.values.relatedBossHoursAgo>2.9&&f.values.relatedBossHoursAgo<3.1);assert.ok(f.contextRows.some(x=>x.id==='source-event'));
 const c=candidatePrediction('graph_context_interval',f,{sourceBoss:'Source',windowHours:6,windowStartHours:0,medianDelayHours:8,graphWeight:.35,direction:'POSITIVE'});assert.equal(c.parameters.graphApplied,true);assert.ok(c.predictedAt>=asOf);
 const late=structuredClone(src);late.id='late-source';late.updatedAt=asOf+H;late.evidence[0].evidenceId='late-source-evidence';late.evidence[0].processedAt=asOf+H;late.evidence[0].collectedAt=asOf+H;late.evidence[0].reportedAt=asOf+H;const safe=buildFeatures([...es,late],'Boss','World',asOf,{relatedBoss:'Source'});assert.equal(safe.values.relatedBossHoursAgo,null);
});


test('A promoted graph model falls back to the base Champion when its relationship degrades',()=>{
 const s=intel(30);ensureMLOps(s);const lab=ensureAILab(s),exp=createLabExperiment(s,{hypothesis:'A relação Source para Boss melhora a previsão temporal fora da amostra.',world:'World',boss:'Boss',modelId:'graph_context_interval',kind:'graph_feature',features:['f'],parameters:{sourceBoss:'Source',windowStartHours:0,windowHours:6,medianDelayHours:8,graphWeight:.35,direction:'POSITIVE',featureId:'f',relationId:'r'}}).experiment;
 lab.champions['World|boss']={modelId:'graph_context_interval',modelVersion:'1.0.0',experimentId:exp.id,scope:'World|boss',promotedAt:1};
 s.discovery={temporalKnowledge:{featureRegistry:{f:{id:'f',status:'TESTING'}},relationshipRegistry:{r:{id:'r',status:'DEGRADED'}}}};
 const base=predictAdaptive(s.events,'Boss','World',{},T+3000*H),result=applyLabModel(s,base,'Boss','World','key',T+3000*H);
 assert.equal(result.prediction,base);assert.equal(result.rollout.selected,false);assert.equal(result.rollout.reason,'graph_feature_not_active_or_relationship_degraded');
});


test('Analog Forecasting uses only historically resolved states and abstains with insufficient neighbors',()=>{
 const es=rows(30),asOf=availableAt(es.at(-1))+1,f=buildFeatures(es,'Boss','World',asOf,{includeAnalog:true});
 assert.equal(f.version,'1.3.0');assert.ok(f.values.analogStateSamples>=20);assert.ok(f.values.analogBestSimilarity>.9);assert.ok(f.analogExamples.every(x=>x.maxContextAvailableAt<=x.evaluatedAt&&x.outcomeAvailableAt<=asOf&&x.outcomeAt>x.evaluatedAt));
 const p=candidatePrediction('analog_state_interval',f,{neighbors:12,minSimilarity:.45});assert.ok(p);assert.ok(Math.abs((p.predictedAt-es.at(-1).estimatedAt)/H-72)<1);
 const sparseRows=rows(6),sparse=buildFeatures(sparseRows,'Boss','World',availableAt(sparseRows.at(-1))+1,{includeAnalog:true});assert.equal(candidatePrediction('analog_state_interval',sparse,{neighbors:12,minSimilarity:.45}),null);
 const store={},ds=datasetSnapshot(store,f,{experiment:'analog_state_interval'});assert.equal(ds.analogExamples.length,f.analogExamples.length);assert.equal(verifyDataset(ds),true);
});

test('Server Save challenger requires an explicit known schedule and valid statistical bucket',()=>{
 const es=rows(20),asOf=availableAt(es.at(-1))+1,without=buildFeatures(es,'Boss','World',asOf),withSave=buildFeatures(es,'Boss','World',asOf,{serverSaveHour:6});
 const params={bucketFromHours:0,bucketToHours:6,saveLift:2.2,serverSaveWeight:.25};
 assert.equal(without.values.serverSaveHours,null);assert.equal(candidatePrediction('server_save_context_interval',without,params),null);
 assert.ok(Number.isFinite(withSave.values.serverSaveHours));const p=candidatePrediction('server_save_context_interval',withSave,params);assert.ok(p);assert.equal(p.parameters.serverSaveApplied,true);assert.ok(p.predictedAt>=es.at(-1).estimatedAt);
 assert.equal(candidatePrediction('server_save_context_interval',withSave,{...params,saveLift:1}),null);
});


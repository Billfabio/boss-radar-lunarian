import {MODEL_SPECS,metrics,qualityGate,verifyDataset,candidatePrediction,datasetSnapshot} from './models.mjs';
import {buildFeatures,digest,FEATURE_VERSION} from './feature-store.mjs';
import {featureImportance} from './analysis.mjs';
import {calibrateConfidence} from '../learning/calibration.mjs';
import {MODEL_FAMILY_VERSION,CODE_VERSION} from '../prediction/version.mjs';
import {serverSaveAnalysis} from '../discovery/context-analysis.mjs';

const STATUSES=new Set(['PROPOSED','RUNNING','FAILED','INCONCLUSIVE','REJECTED','SHADOW','CHALLENGER','ELIGIBLE_FOR_PROMOTION','PROMOTED','ARCHIVED']);
const scopeKey=(world,boss)=>world+'|'+String(boss||'*').toLowerCase();
const round=(n,d=2)=>Number.isFinite(n)?Math.round(n*10**d)/10**d:null;
const avg=a=>{const x=a.filter(Number.isFinite);return x.length?x.reduce((n,v)=>n+v,0)/x.length:null;};
const variance=(a,m)=>a.length>1?a.reduce((n,x)=>n+(x-m)**2,0)/(a.length-1):null;
const erf=x=>{const sign=x<0?-1:1,a=Math.abs(x),t=1/(1+.3275911*a),y=1-(((((1.061405429*t-1.453152027)*t+1.421413741)*t-.284496736)*t+.254829592)*t)*Math.exp(-a*a);return sign*y;};
const normalCdf=z=>(1+erf(z/Math.SQRT2))/2;
const experimentFingerprint=input=>digest({hypothesis:String(input.hypothesis||'').trim().toLowerCase().replace(/\s+/g,' '),kind:input.kind||'model',world:input.world,boss:input.boss||null,modelId:input.modelId||null,features:[...(input.features||[])].sort(),parameters:input.parameters||{}});
function mlops(intel){if(!intel?.mlops)throw new Error('MLOps não inicializado');return intel.mlops;}
function serverSaveScheduleAt(intel,world,at){return (intel.discovery?.serverSaveSchedules||[]).filter(x=>x.world===world&&Number.isFinite(x.knownAt)&&x.knownAt<=at&&Number.isFinite(x.validFrom)&&x.validFrom<=at&&Number.isFinite(Number(x.hour))).sort((a,b)=>b.validFrom-a.validFrom)[0]||null;}
function syncGraphFeature(intel,exp,status,at,reason){
 if(exp?.kind!=='graph_feature'||!exp.parameters?.featureId)return;
 const k=intel.discovery?.temporalKnowledge,f=k?.featureRegistry?.[exp.parameters.featureId];if(!f)return;
 f.status=status;f.productionEligible=status==='ACTIVE';f.lastUpdatedAt=at;f.versions||=[];f.versions.push({at,status,experimentId:exp.id,reason});
 const r=k.relationshipRegistry?.[f.relationId];if(r){if(status==='ACTIVE')r.status='ACTIVE';else if(status==='VALIDATED'&&r.status!=='DEGRADED')r.status='VALIDATED';else if(status==='TESTING'&&r.status==='DISCOVERED')r.status='TESTING';else if(status==='REJECTED'&&!['ACTIVE','DEGRADED'].includes(r.status))r.status='REJECTED';r.lastUpdatedAt=at;}
}
export function ensureAILab(intel){
 const s=mlops(intel);s.lab ||= {schema:1,autoModelPromotion:false,experiments:{},sequence:0,knowledge:[],suggestions:[],decisions:[],canaries:{},champions:{},championHistory:[],policy:{primaryMetric:'paired_mae_improvement',minHistoricalSamples:100,minHoldoutSamples:20,minShadowEvents:30,minRelativeMaeGain:.05,minAbsoluteCiGainMinutes:1,maxP95Regression:.05,maxTail180Increase:.02,maxLatencyMs:250,maxCanaryRegression:.02,maxCanaryP95Regression:.1,canaryStages:[10,25,50,100],minCanaryStageEvents:20,maxConcurrentExperiments:1,maxExperimentRuntimeMs:30000},createdAt:Date.now()};
 const l=s.lab;if(l.schema!==1)throw new Error('Versão AI Lab não suportada');l.experiments||={};l.knowledge||=[];l.suggestions||=[];l.decisions||=[];l.canaries||={};l.champions||={};l.championHistory||=[];l.policy||={};l.autoModelPromotion=false;
 return l;
}
function nextExperimentId(l,at){l.sequence=(Number(l.sequence)||0)+1;return 'EXP-'+new Date(at).toISOString().slice(0,10).replaceAll('-','')+'-'+String(l.sequence).padStart(4,'0');}
function pairedStats(pairs=[]){
 const diffs=pairs.map(x=>x.improvementMinutes).filter(Number.isFinite),n=diffs.length;if(!n)return {samples:0,meanImprovementMinutes:null,ci95:null,pValue:null,significant:false};
 const mean=avg(diffs),v=variance(diffs,mean),se=v==null?null:Math.sqrt(v/n),z=se&&se>0?mean/se:null,ci=se==null?null:[mean-1.96*se,mean+1.96*se],p=z==null?null:2*(1-normalCdf(Math.abs(z)));
 return {samples:n,meanImprovementMinutes:round(mean),ci95:ci?.map(x=>round(x)),pValue:p==null?null:round(p,6),significant:!!ci&&ci[0]>1};
}
function rowsFromPairs(pairs,side){
 return pairs.map(p=>({pairId:p.pairId,boss:p.boss,world:p.world,errorMinutes:side==='champion'?p.championErrorMinutes:p.challengerErrorMinutes,windowHit:side==='champion'?p.championWindowHit:p.challengerWindowHit,confidence:side==='champion'?p.championConfidence:p.challengerConfidence,latencyMs:side==='champion'?0:p.challengerLatencyMs}));
}
function comparePairs(pairs){
 const champion=metrics(rowsFromPairs(pairs,'champion')),challenger=metrics(rowsFromPairs(pairs,'challenger')),stats=pairedStats(pairs),relative=champion.maeMinutes&&challenger.maeMinutes!=null?(champion.maeMinutes-challenger.maeMinutes)/champion.maeMinutes:null;
 return {samples:pairs.length,champion,challenger,paired:stats,relativeMaeImprovement:relative,relativeMaeImprovementPct:relative==null?null:round(relative*100,1)};
}
function walkForward(pairs,folds=5){
 if(pairs.length<40)return {status:'INSUFFICIENT_SAMPLE',folds:[],samples:pairs.length};
 const sorted=[...pairs].sort((a,b)=>a.resolvedAt-b.resolvedAt||String(a.pairId).localeCompare(String(b.pairId))),warm=Math.max(20,Math.floor(sorted.length*.4)),remaining=sorted.length-warm,step=Math.max(1,Math.floor(remaining/folds)),out=[];
 for(let i=0;i<folds;i++){const start=warm+i*step,end=i===folds-1?sorted.length:Math.min(sorted.length,start+step);if(end<=start)continue;const test=sorted.slice(start,end),cmp=comparePairs(test);out.push({fold:i+1,trainSamples:start,testSamples:test.length,startAt:test[0]?.resolvedAt||null,endAt:test.at(-1)?.resolvedAt||null,...cmp});}
 const gains=out.map(x=>x.relativeMaeImprovement).filter(Number.isFinite),positive=gains.filter(x=>x>0).length;return {status:out.length>=3?'MEASURED':'INSUFFICIENT_SAMPLE',folds:out,samples:sorted.length,positiveFolds:positive,totalFolds:out.length,medianRelativeGain:gains.length?[...gains].sort((a,b)=>a-b)[Math.floor(gains.length/2)]:null,stable:out.length>=3&&positive>=Math.ceil(out.length*.6)};
}
function overfitRisk(backtest,walk){
 const dev=backtest.developmentComparison?.candidate?.maeMinutes,val=backtest.validation?.candidate?.maeMinutes,test=backtest.test?.candidate?.maeMinutes,devBase=backtest.developmentComparison?.champion?.maeMinutes,testBase=backtest.test?.champion?.maeMinutes;
 const devGain=devBase&&dev!=null?(devBase-dev)/devBase:null,testGain=testBase&&test!=null?(testBase-test)/testBase:null,reasons=[];
 if(Number.isFinite(devGain)&&Number.isFinite(testGain)&&devGain>.1&&testGain<=0)reasons.push('development_gain_disappears_on_holdout');
 if(Number.isFinite(devGain)&&Number.isFinite(testGain)&&devGain>.1&&testGain<devGain*.5)reasons.push('holdout_gain_less_than_half_of_development');
 if(walk.status==='MEASURED'&&!walk.stable)reasons.push('walk_forward_instability');
 return {detected:reasons.length>0,reasons,developmentGainPct:devGain==null?null:round(devGain*100,1),holdoutGainPct:testGain==null?null:round(testGain*100,1)};
}
function historicalGate(backtest,walk,policy){
 const reasons=[],holdout=backtest.test||{},cmp={champion:holdout.champion||{},challenger:holdout.candidate||{}},stats=pairedStats((backtest.pairs||[]).slice(backtest.split?.holdout?.[0]||0));
 if(backtest.samples<policy.minHistoricalSamples)reasons.push('INSUFFICIENT_SAMPLE');
 if(!backtest.leakagePassed)reasons.push('LEAKAGE_AUDIT_FAILED');
 if(!backtest.temporalPassed)reasons.push('TEMPORAL_GATE_FAILED');
 if(walk.status!=='MEASURED'||!walk.stable)reasons.push('WALK_FORWARD_UNSTABLE');
 if(stats.samples<policy.minHoldoutSamples)reasons.push('HOLDOUT_TOO_SMALL');
 if(!stats.significant)reasons.push('PAIRED_IMPROVEMENT_NOT_SIGNIFICANT');
 if(Number.isFinite(cmp.champion.maeMinutes)&&Number.isFinite(cmp.challenger.maeMinutes)&&cmp.challenger.maeMinutes>=cmp.champion.maeMinutes*(1-policy.minRelativeMaeGain))reasons.push('MAE_GAIN_BELOW_POLICY');
 if(Number.isFinite(cmp.champion.p95ErrorMinutes)&&Number.isFinite(cmp.challenger.p95ErrorMinutes)&&cmp.challenger.p95ErrorMinutes>cmp.champion.p95ErrorMinutes*(1+policy.maxP95Regression))reasons.push('P95_REGRESSION');
 if(Number.isFinite(cmp.champion.tailOver180Pct)&&Number.isFinite(cmp.challenger.tailOver180Pct)&&cmp.challenger.tailOver180Pct>cmp.champion.tailOver180Pct+policy.maxTail180Increase)reasons.push('TAIL_RISK_REGRESSION');
 if(cmp.challenger.calibrationError==null||cmp.champion.calibrationError==null)reasons.push('CALIBRATION_NOT_YET_MEASURED');
 else if(cmp.challenger.calibrationError>cmp.champion.calibrationError)reasons.push('CALIBRATION_REGRESSION');
 if(Number.isFinite(cmp.challenger.latencyMs)&&cmp.challenger.latencyMs>policy.maxLatencyMs)reasons.push('LATENCY_BUDGET_EXCEEDED');
 return {passed:reasons.length===0,reasons,primaryMetric:policy.primaryMetric,paired:stats,holdout:cmp};
}
function knowledgeRow(exp,at=Date.now()){return {experimentId:exp.id,hypothesis:exp.hypothesis,world:exp.world,boss:exp.boss||null,modelId:exp.modelId,kind:exp.kind,status:exp.status,result:exp.result?.decision||null,holdoutImprovementPct:exp.result?.historical?.holdoutImprovementPct??null,sampleSize:exp.result?.sampleSize||0,createdAt:exp.createdAt,completedAt:exp.completedAt||at};}
export function createLabExperiment(intel,input,at=Date.now()){
 const l=ensureAILab(intel),hypothesis=String(input.hypothesis||'').trim();if(hypothesis.length<12)throw new Error('Hipótese precisa explicar claramente o que deve melhorar');
 const modelId=String(input.modelId||'');if(!MODEL_SPECS[modelId]||modelId==='adaptive_ensemble')throw new Error('Challenger inválido');
 const world=String(input.world||'').trim();if(!world)throw new Error('Servidor obrigatório');const boss=input.boss?String(input.boss).trim():null,fp=experimentFingerprint({...input,hypothesis,modelId,world,boss});
 const duplicate=Object.values(l.experiments).find(x=>x.fingerprint===fp&&x.status!=='ARCHIVED');if(duplicate)return {experiment:duplicate,duplicate:true};
 const id=nextExperimentId(l,at),exp={id,fingerprint:fp,hypothesis,kind:String(input.kind||'model'),world,boss,modelId,modelVersion:MODEL_SPECS[modelId].version,features:[...(input.features||MODEL_SPECS[modelId].features||[])],parameters:structuredClone(input.parameters||{}),datasetVersion:null,featureVersion:FEATURE_VERSION,codeVersion:CODE_VERSION,randomSeed:input.randomSeed??null,createdAt:at,createdBy:String(input.createdBy||'system'),status:'PROPOSED',history:[{at,status:'PROPOSED',reason:'experiment_created'}],result:null,shadowStartedAt:null,live:null,canaryId:null};
 l.experiments[id]=exp;return {experiment:exp,duplicate:false};
}
export function beginExperiment(intel,id,at=Date.now()){
 const l=ensureAILab(intel),exp=l.experiments[id];if(!exp)throw new Error('Experimento não encontrado');if(!['PROPOSED','FAILED','INCONCLUSIVE'].includes(exp.status))throw new Error('Experimento não pode iniciar neste estado');
 if(Object.values(l.experiments).filter(x=>x.status==='RUNNING').length>=l.policy.maxConcurrentExperiments)throw new Error('Budget do AI Lab ocupado por outro experimento');
 exp.status='RUNNING';exp.startedAt=at;exp.history.push({at,status:'RUNNING',reason:'execution_started'});return exp;
}
export function finishExperiment(intel,id,backtest,{runtimeMs=0,at=Date.now()}={}){
 const l=ensureAILab(intel),s=mlops(intel),exp=l.experiments[id];if(!exp)throw new Error('Experimento não encontrado');if(exp.status!=='RUNNING')throw new Error('Experimento não está em execução');if(!s.backtests.some(x=>x.id===backtest.id))s.backtests.push(backtest);
 const walk=walkForward(backtest.pairs||[]),overfit=overfitRisk(backtest,walk),gate=historicalGate(backtest,walk,l.policy),holdout=backtest.test||{},holdoutGain=holdout.champion?.maeMinutes&&holdout.candidate?.maeMinutes!=null?100*(holdout.champion.maeMinutes-holdout.candidate.maeMinutes)/holdout.champion.maeMinutes:null;
 const bossRows=(backtest.pairs||[]).reduce((m,p)=>{(m[p.boss]||=[]).push(p);return m;},{}),perBoss=Object.entries(bossRows).map(([boss,pairs])=>({boss,...comparePairs(pairs)})).sort((a,b)=>(b.samples||0)-(a.samples||0));
 const result={backtestId:backtest.id,sampleSize:backtest.samples,datasetIds:backtest.datasetIds,temporalPassed:backtest.temporalPassed,leakagePassed:backtest.leakagePassed,walkForward:walk,holdout,holdoutImprovementPct:holdoutGain==null?null:round(holdoutGain,1),overfitRisk:overfit,historicalGate:gate,perBoss,runtimeMs:round(runtimeMs,2),resourceCost:{runtimeMs:round(runtimeMs,2),samples:backtest.samples,msPerSample:backtest.samples?round(runtimeMs/backtest.samples,4):null},decision:gate.passed&&!overfit.detected?'ENTER_SHADOW':backtest.samples<l.policy.minHistoricalSamples?'INCONCLUSIVE':'REJECT'};
 exp.datasetVersion=digest(backtest.datasetIds||[]);exp.result={historical:result,sampleSize:backtest.samples,decision:result.decision,report:{hypothesis:exp.hypothesis,configuration:{kind:exp.kind,world:exp.world,boss:exp.boss,modelId:exp.modelId,modelVersion:exp.modelVersion,features:exp.features,parameters:exp.parameters,datasetVersion:digest(backtest.datasetIds||[]),featureVersion:exp.featureVersion,codeVersion:exp.codeVersion,randomSeed:exp.randomSeed},baseline:result.historicalGate?.holdout?.champion||null,result:result.historicalGate?.holdout?.challenger||null,significance:result.historicalGate?.paired||null,impact:{holdoutMaeImprovementPct:result.holdoutImprovementPct,walkForwardStable:result.walkForward?.stable??false,overfitRisk:result.overfitRisk?.detected??false,runtimeMs:result.runtimeMs},limitations:[...(backtest.samples<l.policy.minHistoricalSamples?['insufficient_historical_sample']:[]),...(result.historicalGate?.holdout?.challenger?.calibrationError==null?['calibration_not_measured']:[]),...(result.overfitRisk?.detected?['overfit_risk']:[])],decision:result.decision}};exp.completedAt=at;
 if(runtimeMs>l.policy.maxExperimentRuntimeMs){exp.status='REJECTED';exp.result.decision='REJECT';exp.result.historical.historicalGate.reasons.push('EXPERIMENT_RUNTIME_BUDGET_EXCEEDED');}
 else if(result.decision==='ENTER_SHADOW'){exp.status='SHADOW';exp.shadowStartedAt=at;syncGraphFeature(intel,exp,'TESTING',at,'historical_gate_passed_enter_shadow');}
 else{exp.status=result.decision==='INCONCLUSIVE'?'INCONCLUSIVE':'REJECTED';if(exp.status==='REJECTED')syncGraphFeature(intel,exp,'REJECTED',at,'historical_gate_failed');}
 exp.history.push({at,status:exp.status,reason:exp.result.decision});l.knowledge.unshift(knowledgeRow(exp,at));if(l.knowledge.length>5000)l.knowledge.length=5000;
 const registry=s.registry[exp.modelId];if(registry){registry.experimentIds||=[];if(!registry.experimentIds.includes(exp.id))registry.experimentIds.push(exp.id);}
 return exp;
}
export function failExperiment(intel,id,error,at=Date.now()){
 const l=ensureAILab(intel),exp=l.experiments[id];if(!exp)throw new Error('Experimento não encontrado');exp.status='FAILED';exp.failedAt=at;exp.error=String(error?.message||error).slice(0,500);exp.history.push({at,status:'FAILED',reason:exp.error});return exp;
}
function livePairs(intel,exp,at){
 const s=mlops(intel),specific=s.runs.filter(x=>x.experimentId===exp.id),candidate=(specific.length?specific:s.runs.filter(x=>!x.experimentId&&x.modelId===exp.modelId)).filter(x=>x.modelId===exp.modelId&&x.world===exp.world&&(!exp.boss||x.boss===exp.boss)&&x.resolvedAt&&x.resolvedAt<=at&&x.asOf>=exp.shadowStartedAt&&Number.isFinite(x.errorMinutes));
 const latest=new Map();for(const x of candidate.sort((a,b)=>a.asOf-b.asOf))latest.set(x.pairId,x);
 const champion=new Map(s.runs.filter(x=>x.mode==='Champion'&&x.world===exp.world&&x.resolvedAt&&x.resolvedAt<=at).map(x=>[x.pairId,x]));
 return [...latest.values()].filter(x=>champion.has(x.pairId)).map(x=>{const b=champion.get(x.pairId);return {pairId:x.pairId,boss:x.boss,world:x.world,asOf:x.asOf,resolvedAt:x.resolvedAt,datasetId:x.datasetId,championErrorMinutes:b.errorMinutes,challengerErrorMinutes:x.errorMinutes,championWindowHit:!!b.windowHit,challengerWindowHit:!!x.windowHit,championConfidence:b.confidence??null,challengerConfidence:x.confidence??null,challengerLatencyMs:x.latencyMs??null,improvementMinutes:b.errorMinutes-x.errorMinutes};});
}
export function recordLabShadowPredictions(intel,forecast,asOf,features,datasetId){
 const l=ensureAILab(intel),s=mlops(intel),created=[];
 for(const exp of Object.values(l.experiments)){
  if(!['SHADOW','CHALLENGER','ELIGIBLE_FOR_PROMOTION'].includes(exp.status)||exp.world!==forecast.world||(exp.boss&&exp.boss!==forecast.boss)||!exp.shadowStartedAt||asOf<exp.shadowStartedAt)continue;
  const needsOwnFeatures=['graph_context_interval','analog_state_interval','server_save_context_interval'].includes(exp.modelId),saveSchedule=exp.modelId==='server_save_context_interval'?serverSaveScheduleAt(intel,forecast.world,asOf):null,expFeatures=exp.modelId==='graph_context_interval'?buildFeatures(intel.events,forecast.boss,forecast.world,asOf,{relatedBoss:exp.parameters?.sourceBoss||null}):exp.modelId==='analog_state_interval'?buildFeatures(intel.events,forecast.boss,forecast.world,asOf,{includeAnalog:true}):exp.modelId==='server_save_context_interval'?buildFeatures(intel.events,forecast.boss,forecast.world,asOf,{serverSaveHour:saveSchedule?Number(saveSchedule.hour):null}):features,experimentDataset=needsOwnFeatures?datasetSnapshot(s.datasets,expFeatures,{experimentId:exp.id,modelId:exp.modelId,parameters:structuredClone(exp.parameters||{}),sourceDatasetId:datasetId,serverSaveSchedule:saveSchedule?{id:saveSchedule.id||null,hour:Number(saveSchedule.hour),knownAt:saveSchedule.knownAt,validFrom:saveSchedule.validFrom,sourceRef:saveSchedule.sourceRef||null}:null}):s.datasets[datasetId],runDatasetId=experimentDataset?.id||datasetId,identity=forecast.id+'|'+runDatasetId+'|'+exp.id;if(s.runs.some(x=>x.identity===identity))continue;
  const start=performance.now(),prediction=candidatePrediction(exp.modelId,expFeatures,exp.parameters||{});if(!prediction)continue;
  const historical=s.runs.filter(x=>x.experimentId===exp.id&&x.world===forecast.world&&x.boss===forecast.boss&&x.resolvedAt&&x.resolvedAt<asOf),raw=forecast.confidenceRaw??forecast.confidence,cal=calibrateConfidence(raw,historical,forecast.world,forecast.boss);
  const run={identity,experimentId:exp.id,forecastId:forecast.id,pairId:forecast.id,boss:forecast.boss,world:forecast.world,datasetId:runDatasetId,asOf,modelId:exp.modelId,modelVersion:exp.modelVersion,mode:'ExperimentShadow',...prediction,confidenceRaw:raw,confidence:cal.samples>=20?cal.calibrated:null,calibrationSamples:cal.samples,latencyMs:performance.now()-start,parameters:structuredClone(exp.parameters||{})};s.runs.push(run);created.push(run);
 }
 return created;
}
export function refreshLiveExperiment(intel,id,at=Date.now()){
 const l=ensureAILab(intel),s=mlops(intel),exp=l.experiments[id];if(!exp)throw new Error('Experimento não encontrado');if(!['SHADOW','CHALLENGER','ELIGIBLE_FOR_PROMOTION'].includes(exp.status))return exp;
 const pairs=livePairs(intel,exp,at),cmp=comparePairs(pairs),validation=s.backtests.findLast(x=>x.id===exp.result?.historical?.backtestId),datasetsOk=pairs.every(x=>verifyDataset(s.datasets[x.datasetId])),gate=qualityGate(rowsFromPairs(pairs,'champion'),rowsFromPairs(pairs,'challenger'),{temporalPassed:!!validation?.temporalPassed,leakagePassed:datasetsOk,minSamples:l.policy.minShadowEvents});
 exp.live={updatedAt:at,samples:pairs.length,...cmp,gate,reliabilityDiagram:cmp.challenger.reliabilityBins||[],minimumShadowEvents:l.policy.minShadowEvents};
 if(pairs.length<10){exp.status='SHADOW';}
 else if(pairs.length<l.policy.minShadowEvents){exp.status='CHALLENGER';}
 else if(gate.passed){exp.status='ELIGIBLE_FOR_PROMOTION';exp.result.recommendation='PROMOTE';syncGraphFeature(intel,exp,'VALIDATED',at,'live_shadow_quality_gate_passed');}
 else{const severe=Number.isFinite(cmp.champion.maeMinutes)&&Number.isFinite(cmp.challenger.maeMinutes)&&cmp.challenger.maeMinutes>cmp.champion.maeMinutes*1.1||Number.isFinite(cmp.champion.p95ErrorMinutes)&&Number.isFinite(cmp.challenger.p95ErrorMinutes)&&cmp.challenger.p95ErrorMinutes>cmp.champion.p95ErrorMinutes*1.2;exp.status=severe?'REJECTED':'CHALLENGER';exp.result.recommendation=severe?'REJECT':'WAIT';if(severe)syncGraphFeature(intel,exp,'REJECTED',at,'live_shadow_regression');}
 exp.history.push({at,status:exp.status,reason:exp.result.recommendation||'shadow_refresh',samples:pairs.length});return exp;
}
export function refreshAllExperiments(intel,world,at=Date.now()){const l=ensureAILab(intel);for(const exp of Object.values(l.experiments))if(exp.world===world&&['SHADOW','CHALLENGER','ELIGIBLE_FOR_PROMOTION'].includes(exp.status))refreshLiveExperiment(intel,exp.id,at);return l;}
function activeChampion(l,world,boss){return l.champions[scopeKey(world,boss)]||l.champions[scopeKey(world,null)]||{modelId:'adaptive_ensemble',modelVersion:MODEL_FAMILY_VERSION,scope:scopeKey(world,null),promotedAt:null};}
export function approveExperiment(intel,id,{actor='site-admin',reason='Aprovado após revisão dos gates',at=Date.now()}={}){
 const l=ensureAILab(intel),exp=l.experiments[id];if(!exp)throw new Error('Experimento não encontrado');refreshLiveExperiment(intel,id,at);if(exp.status!=='ELIGIBLE_FOR_PROMOTION')throw new Error('Experimento ainda não está elegível para promoção');
 const scope=scopeKey(exp.world,exp.boss),previous=structuredClone(activeChampion(l,exp.world,exp.boss)),stages=l.policy.canaryStages,idc='CANARY-'+digest({id,at,scope}).slice(0,12),canary={id:idc,experimentId:id,modelId:exp.modelId,modelVersion:exp.modelVersion,world:exp.world,boss:exp.boss||null,scope,status:'CANARY',stage:0,percentage:stages[0],stages:[...stages],startedAt:at,stageStartedAt:at,previousChampion:previous,approvedBy:String(actor),approvalReason:String(reason).slice(0,500)};
 l.canaries[scope]=canary;exp.canaryId=idc;exp.status='CHALLENGER';exp.history.push({at,status:'CHALLENGER',reason:'manual_promotion_approved_canary_started',canaryId:idc});l.decisions.unshift({at,experimentId:id,decision:'APPROVE_CANARY',actor:String(actor),reason:String(reason).slice(0,500),canaryId:idc});return canary;
}
export function rejectExperiment(intel,id,{actor='site-admin',reason='Rejeitado após revisão',at=Date.now()}={}){
 const l=ensureAILab(intel),exp=l.experiments[id];if(!exp)throw new Error('Experimento não encontrado');exp.status='REJECTED';exp.rejectedAt=at;exp.history.push({at,status:'REJECTED',reason:String(reason).slice(0,500)});l.decisions.unshift({at,experimentId:id,decision:'REJECT',actor:String(actor),reason:String(reason).slice(0,500)});l.knowledge.unshift(knowledgeRow(exp,at));return exp;
}
function chooseCanary(l,world,boss,key){
 const specific=l.canaries[scopeKey(world,boss)],global=l.canaries[scopeKey(world,null)],c=[specific,global].find(x=>x?.status==='CANARY');if(c){const bucket=parseInt(digest(String(key)).slice(0,8),16)%100;return {modelId:c.modelId,modelVersion:c.modelVersion,selected:bucket<c.percentage,rollout:{id:c.id,experimentId:c.experimentId,selected:bucket<c.percentage,percentage:c.percentage,bucket,stage:c.stage}};}
 const champion=activeChampion(l,world,boss);if(champion.modelId!=='adaptive_ensemble')return {modelId:champion.modelId,modelVersion:champion.modelVersion,selected:true,rollout:{id:champion.canaryId||'champion',experimentId:champion.experimentId||null,selected:true,percentage:100,champion:true}};
 return {modelId:'adaptive_ensemble',modelVersion:MODEL_FAMILY_VERSION,selected:false,rollout:null};
}
export function applyLabModel(intel,basePrediction,boss,world,key,asOf=Date.now()){
 const l=ensureAILab(intel),selection=chooseCanary(l,world,boss,key);if(!selection.selected||selection.modelId==='adaptive_ensemble'||basePrediction.status!=='ready')return {prediction:basePrediction,rollout:selection.rollout,baseline:null};
 const experiment=selection.rollout?.experimentId?l.experiments[selection.rollout.experimentId]:null;
 if(selection.modelId==='graph_context_interval'&&selection.rollout?.champion){const feature=intel.discovery?.temporalKnowledge?.featureRegistry?.[experiment?.parameters?.featureId],relation=intel.discovery?.temporalKnowledge?.relationshipRegistry?.[experiment?.parameters?.relationId];if(feature?.status!=='ACTIVE'||relation?.status==='DEGRADED'||relation?.status==='ARCHIVED')return {prediction:basePrediction,rollout:{...selection.rollout,selected:false,reason:'graph_feature_not_active_or_relationship_degraded'},baseline:null};}
 const saveSchedule=selection.modelId==='server_save_context_interval'?serverSaveScheduleAt(intel,world,asOf):null,f=buildFeatures(intel.events,boss,world,asOf,{relatedBoss:selection.modelId==='graph_context_interval'?experiment?.parameters?.sourceBoss||null:null,includeAnalog:selection.modelId==='analog_state_interval',serverSaveHour:saveSchedule?Number(saveSchedule.hour):null}),c=candidatePrediction(selection.modelId,f,experiment?.parameters||{});if(!c)return {prediction:basePrediction,rollout:{...selection.rollout,selected:false,reason:'candidate_insufficient_features'},baseline:null};
 const historical=mlops(intel).runs.filter(x=>x.modelId===selection.modelId&&(!experiment||x.experimentId===experiment.id)&&x.world===world&&x.boss===boss&&x.resolvedAt&&x.resolvedAt<asOf),raw=basePrediction.confidenceRaw??basePrediction.confidence,cal=calibrateConfidence(raw,historical,world,boss),last=f.rows.at(-1)?.estimatedAt,lower=last==null?null:(c.windowStart-last)/3600000,upper=last==null?null:(c.windowEnd-last)/3600000,hits=lower==null?0:f.intervals.filter(x=>x>=lower&&x<=upper).length,probability=f.intervals.length?round(100*(hits+1)/(f.intervals.length+2),1):null;
 if(cal.samples<20)return {prediction:basePrediction,rollout:{...selection.rollout,selected:false,reason:'candidate_calibration_insufficient',calibrationSamples:cal.samples},baseline:null};
 const baseline=structuredClone(basePrediction);
 const spec=MODEL_SPECS[selection.modelId],prediction={...basePrediction,predictedCenterAt:c.predictedAt,likelyAt:basePrediction.likelyAt?c.predictedAt:null,windowStart:c.windowStart,windowEnd:c.windowEnd,uncertaintyMs:Math.round((c.windowEnd-c.windowStart)/2),confidenceRaw:raw,confidence:cal.calibrated,calibration:cal,probability,probabilityDistribution:[],bestProbabilitySlot:null,labModelId:selection.modelId,labModelVersion:selection.modelVersion,graphContext:selection.modelId==='graph_context_interval'?{featureId:experiment?.parameters?.featureId||null,relationId:experiment?.parameters?.relationId||null,sourceBoss:experiment?.parameters?.sourceBoss||null,relatedBossHoursAgo:f.values.relatedBossHoursAgo,relatedBossAfterLastTarget:f.values.relatedBossAfterLastTarget,graphApplied:!!c.parameters?.graphApplied,graphTargetHours:c.parameters?.graphTargetHours??null}:null,methods:[{name:selection.modelId,label:spec.name,predictedAt:c.predictedAt,weight:1,normalizedWeight:1,samples:c.parameters?.intervals||f.values.samples}],explain:[...(basePrediction.explain||[]),'AI Lab Canary: '+spec.name+' '+selection.modelVersion+' foi selecionado deterministicamente para esta previsão após aprovação manual. Confiança calibrada somente com resultados Shadow do próprio Challenger.']};
 return {prediction,rollout:selection.rollout,baseline};
}
function canaryRows(intel,canary){
 return intel.forecasts.filter(x=>x.labRollout?.id===canary.id&&x.labRollout.selected&&x.createdAt>=canary.stageStartedAt&&x.resolvedAt&&Number.isFinite(x.errorMinutes)&&Number.isFinite(x.actualAt)).map(x=>({pairId:x.id,boss:x.boss,world:x.world,resolvedAt:x.resolvedAt,championErrorMinutes:Math.abs(x.actualAt-x.labBaseline.predictedCenterAt)/60000,challengerErrorMinutes:x.errorMinutes,championWindowHit:x.actualAt>=x.labBaseline.windowStart&&x.actualAt<=x.labBaseline.windowEnd,challengerWindowHit:!!x.windowHit,championConfidence:x.labBaseline.confidence,challengerConfidence:x.confidence,challengerLatencyMs:x.labRollout.latencyMs??null,improvementMinutes:Math.abs(x.actualAt-x.labBaseline.predictedCenterAt)/60000-x.errorMinutes}));
}
export function monitorLabCanary(intel,boss,world,at=Date.now()){
 const l=ensureAILab(intel),scope=scopeKey(world,boss),canary=l.canaries[scope]||l.canaries[scopeKey(world,null)];if(canary?.status!=='CANARY')return null;
 const pairs=canaryRows(intel,canary),cmp=comparePairs(pairs);canary.metrics=cmp;canary.samples=pairs.length;canary.lastEvaluatedAt=at;
 if(pairs.length<l.policy.minCanaryStageEvents)return {status:'MONITORING',...canary};
 const severe=Number.isFinite(cmp.champion.maeMinutes)&&Number.isFinite(cmp.challenger.maeMinutes)&&cmp.challenger.maeMinutes>cmp.champion.maeMinutes*(1+l.policy.maxCanaryRegression)||Number.isFinite(cmp.champion.p95ErrorMinutes)&&Number.isFinite(cmp.challenger.p95ErrorMinutes)&&cmp.challenger.p95ErrorMinutes>cmp.champion.p95ErrorMinutes*(1+l.policy.maxCanaryP95Regression);
 if(severe){canary.status='ROLLED_BACK';canary.rolledBackAt=at;canary.rollbackReason='automatic_canary_regression';const exp=l.experiments[canary.experimentId];if(exp){exp.status='REJECTED';exp.history.push({at,status:'REJECTED',reason:'automatic_canary_regression'});syncGraphFeature(intel,exp,'REJECTED',at,'automatic_canary_regression');}l.decisions.unshift({at,experimentId:canary.experimentId,decision:'AUTO_ROLLBACK',actor:'system',reason:canary.rollbackReason,canaryId:canary.id});return canary;}
 const nextStage=canary.stage+1;if(nextStage<canary.stages.length){canary.stage=nextStage;canary.percentage=canary.stages[nextStage];canary.stageStartedAt=at;canary.samples=0;l.decisions.unshift({at,experimentId:canary.experimentId,decision:'CANARY_ADVANCE',actor:'system',reason:'stage_metrics_healthy',percentage:canary.percentage,canaryId:canary.id});return canary;}
 canary.status='PROMOTED';canary.promotedAt=at;const exp=l.experiments[canary.experimentId],champ={modelId:canary.modelId,modelVersion:canary.modelVersion,experimentId:canary.experimentId,canaryId:canary.id,scope:canary.scope,promotedAt:at,metrics:cmp};l.championHistory.unshift({scope:canary.scope,from:canary.previousChampion,to:champ,at});l.champions[canary.scope]=champ;if(exp){exp.status='PROMOTED';exp.promotedAt=at;exp.history.push({at,status:'PROMOTED',reason:'canary_completed'});syncGraphFeature(intel,exp,'ACTIVE',at,'canary_completed');}l.decisions.unshift({at,experimentId:canary.experimentId,decision:'PROMOTE',actor:'system_after_manual_canary_approval',reason:'all_canary_stages_passed',canaryId:canary.id});return canary;
}
export function rollbackLabChampion(intel,{world,boss=null,actor='site-admin',reason='Rollback manual',at=Date.now()}={}){
 const l=ensureAILab(intel),scope=scopeKey(world,boss),current=l.champions[scope];if(!current)throw new Error('Não existe Champion específico neste escopo');
 const history=l.championHistory.find(x=>x.scope===scope&&x.to?.experimentId===current.experimentId),previous=history?.from||{modelId:'adaptive_ensemble',modelVersion:MODEL_FAMILY_VERSION,scope,promotedAt:null};
 if(previous.modelId==='adaptive_ensemble')delete l.champions[scope];else l.champions[scope]=structuredClone(previous);
 const c=l.canaries[scope];if(c&&c.status!=='ROLLED_BACK'){c.status='ROLLED_BACK';c.rolledBackAt=at;c.rollbackReason=String(reason).slice(0,500);}l.decisions.unshift({at,experimentId:current.experimentId||null,decision:'MANUAL_ROLLBACK',actor:String(actor),reason:String(reason).slice(0,500),scope});return activeChampion(l,world,boss);
}
function bhAdjusted(experiments){
 const rows=experiments.map(x=>({id:x.id,p:x.live?.paired?.pValue??x.result?.historical?.historicalGate?.paired?.pValue})).filter(x=>Number.isFinite(x.p)).sort((a,b)=>a.p-b.p),m=rows.length;let prev=1;
 for(let i=m-1;i>=0;i--){const q=Math.min(prev,rows[i].p*m/(i+1));rows[i].q=round(q,6);prev=q;}return Object.fromEntries(rows.map(x=>[x.id,x.q]));
}
function leaderboardRows(intel,world){
 const s=mlops(intel),latest=new Map();for(const r of s.runs.filter(x=>!x.experimentId&&x.world===world&&x.resolvedAt&&Number.isFinite(x.errorMinutes)).sort((a,b)=>a.asOf-b.asOf))latest.set(r.modelId+'|'+r.pairId,r);
 const rows=[...latest.values()],overall=Object.keys(MODEL_SPECS).map(id=>({modelId:id,name:MODEL_SPECS[id].name,version:MODEL_SPECS[id].version,...metrics(rows.filter(x=>x.modelId===id))})).sort((a,b)=>(a.maeMinutes??Infinity)-(b.maeMinutes??Infinity));
 const bosses=[...new Set(rows.map(x=>x.boss))],perBoss=bosses.map(boss=>{const models=Object.keys(MODEL_SPECS).map(id=>({modelId:id,...metrics(rows.filter(x=>x.boss===boss&&x.modelId===id))})).filter(x=>x.samples).sort((a,b)=>(a.maeMinutes??Infinity)-(b.maeMinutes??Infinity));return {boss,best:models[0]||null,models};}).sort((a,b)=>(b.best?.samples||0)-(a.best?.samples||0));
 return {overall,perBoss};
}
function featureSummary(intel,world,at){
 const bosses=[...new Set(intel.events.filter(x=>x.world===world).map(x=>x.boss))],measured=bosses.map(boss=>({boss,result:featureImportance(intel.events,boss,world,at)})).filter(x=>x.result.status!=='insufficient'),gain=new Map(),unused=new Map();
 for(const row of measured){for(const f of row.result.features||[]){const x=gain.get(f.name)||[];if(Number.isFinite(f.maeIncreaseHours)){x.push(f.maeIncreaseHours);if(f.maeIncreaseHours<=0)unused.set(f.name,(unused.get(f.name)||0)+1);}gain.set(f.name,x);}}
 return {measuredBosses:measured.length,topUseful:[...gain].map(([name,x])=>({name,bosses:x.length,meanMaeIncreaseHours:round(avg(x),3)})).sort((a,b)=>b.meanMaeIncreaseHours-a.meanMaeIncreaseHours),oftenUseless:[...unused].map(([name,bosses])=>({name,bosses})).sort((a,b)=>b.bosses-a.bosses),perBoss:measured.slice(0,100)};
}

function errorClusters(intel,world){
 const rows=Object.values(mlops(intel).errors||{}).filter(x=>x.world===world),byCause={},byBoss={};
 for(const e of rows){for(const cause of e.causes||['unknown'])(byCause[cause]||=[]).push(e);const b=byBoss[e.boss]||={boss:e.boss,samples:0,largeErrors:0,totalError:0};b.samples++;if(Number.isFinite(e.errorMinutes)){b.totalError+=e.errorMinutes;if(e.errorMinutes>120)b.largeErrors++;}byBoss[e.boss]=b;}
 return {samples:rows.length,causes:Object.entries(byCause).map(([cause,x])=>({cause,samples:x.length,maeMinutes:round(avg(x.map(e=>e.errorMinutes)),1)})).sort((a,b)=>b.samples-a.samples),bosses:Object.values(byBoss).map(x=>({...x,maeMinutes:x.samples?round(x.totalError/x.samples,1):null,totalError:undefined})).sort((a,b)=>b.largeErrors-a.largeErrors||b.samples-a.samples).slice(0,50)};
}
function championDegradation(intel,world,at=Date.now()){
 const l=ensureAILab(intel),champ=activeChampion(l,world,null),modelId=champ.modelId||'adaptive_ensemble';
 let rows;
 if(modelId==='adaptive_ensemble')rows=mlops(intel).runs.filter(x=>x.mode==='Champion'&&x.world===world&&x.resolvedAt&&x.resolvedAt<=at&&Number.isFinite(x.errorMinutes)).sort((a,b)=>a.resolvedAt-b.resolvedAt);
 else rows=intel.forecasts.filter(x=>x.world===world&&x.resolvedAt&&x.resolvedAt<=at&&(x.activeModel||'adaptive_ensemble')===modelId&&Number.isFinite(x.errorMinutes)).sort((a,b)=>a.resolvedAt-b.resolvedAt).map(x=>({pairId:x.id,boss:x.boss,world:x.world,errorMinutes:x.errorMinutes,windowHit:x.windowHit,confidence:x.confidence,latencyMs:0}));
 if(rows.length<60)return {status:'INSUFFICIENT_DATA',samples:rows.length,modelId,reason:'São necessárias pelo menos 60 previsões resolvidas do Champion ativo.'};
 const recent=rows.slice(-20),prior=rows.slice(-60,-20),a=metrics(prior),b=metrics(recent),maeChange=a.maeMinutes?((b.maeMinutes-a.maeMinutes)/a.maeMinutes):null,p95Change=a.p95ErrorMinutes?((b.p95ErrorMinutes-a.p95ErrorMinutes)/a.p95ErrorMinutes):null,windowDrop=(a.windowAccuracy??0)-(b.windowAccuracy??0),detected=(maeChange??0)>.15&&((p95Change??0)>.1||windowDrop>.05);
 return {status:detected?'CHAMPION_DEGRADATION':'STABLE',modelId,samples:rows.length,prior:a,recent:b,maeChangePct:maeChange==null?null:round(maeChange*100,1),p95ChangePct:p95Change==null?null:round(p95Change*100,1),windowAccuracyDropPoints:round(windowDrop*100,1),detected};
}
function smartRetraining(intel,world,at,degradation){
 const l=ensureAILab(intel),completed=Object.values(l.experiments).filter(x=>x.world===world&&x.completedAt).sort((a,b)=>b.completedAt-a.completedAt),lastExperimentAt=completed[0]?.completedAt||0,newEvents=intel.events.filter(e=>e.world===world&&/^confirmed_/.test(e.status)&&e.eventType!=='absence'&&!e.anomaly&&!['CONFLITANTE','SUSPEITO','DESCARTADO'].includes(e.qualityStatus)&&(e.updatedAt||e.estimatedAt)>lastExperimentAt).length,errors=Object.values(mlops(intel).errors||{}).filter(x=>x.world===world),driftErrors=errors.filter(x=>x.causes?.includes('drift')&&(x.resolvedAt||0)>lastExperimentAt).length,reasons=[];
 if(degradation.detected)reasons.push('champion_degradation');
 if(driftErrors>=3)reasons.push('repeated_drift_errors');
 if(newEvents>=30)reasons.push('enough_new_validated_events');
 const champion=activeChampion(l,world,null),modelAgeMs=champion.promotedAt?at-champion.promotedAt:null;
 return {status:reasons.length?'RECOMMEND_EXPERIMENT':'NO_RETRAIN_NEEDED',reasons,newValidatedEvents:newEvents,driftErrors,lastExperimentAt:lastExperimentAt||null,championAgeMs:modelAgeMs,note:'Idade do Champion é apenas contexto e nunca dispara retreino sozinha.'};
}
function robustnessProbe(intel,world,at=Date.now()){
 const bosses=[...new Set(intel.events.filter(x=>x.world===world).map(x=>x.boss))].slice(0,30),rows=[];
 for(const boss of bosses){const f=buildFeatures(intel.events,boss,world,at);if(f.values.preciseSamples<5||f.intervals.length<5)continue;
  for(const modelId of ['robust_interval','empirical_survival']){const base=candidatePrediction(modelId,f);if(!base)continue;
   const noisy=structuredClone(f);noisy.intervals=noisy.intervals.map((x,i)=>x*(i%2?1.05:.95));
   const outlier=structuredClone(f);if(outlier.intervals.length)outlier.intervals[outlier.intervals.length-1]*=3;
   const missing=structuredClone(f);missing.values.preciseSamples=Math.floor(missing.values.preciseSamples*.5);missing.intervals=missing.intervals.slice(0,Math.max(3,missing.intervals.length-3));
   const lowQuality=structuredClone(f);lowQuality.values.sourceReliability=Number.isFinite(lowQuality.values.sourceReliability)?lowQuality.values.sourceReliability*.5:null;lowQuality.values.confirmations=Math.floor((lowQuality.values.confirmations||0)*.5);lowQuality.values.sourceCoverage=.5;
   const sourceOffline=structuredClone(f);sourceOffline.values.sourceReliability=0;sourceOffline.values.confirmations=0;sourceOffline.values.sourceCoverage=0;
   const conflict=structuredClone(f);conflict.values.anomalyScore=Math.min(1,(conflict.values.anomalyScore||0)+.5);conflict.values.driftScore=Math.max(.8,conflict.values.driftScore||0);conflict.values.regimeSignal='HIGH_DRIFT';
   const scenarios=[['noise_5pct',noisy],['last_interval_outlier_x3',outlier],['reduced_recent_history',missing],['source_quality_50pct',lowQuality],['sources_offline',sourceOffline],['conflict_high_drift',conflict]].map(([scenario,features])=>{const p=candidatePrediction(modelId,features),shift=p?Math.abs(p.predictedAt-base.predictedAt)/60000:null;return {scenario,available:!!p,predictionShiftMinutes:round(shift,1)};});
   rows.push({boss,modelId,samples:f.values.samples,preciseSamples:f.values.preciseSamples,scenarios,maxShiftMinutes:Math.max(0,...scenarios.map(x=>x.predictionShiftMinutes||0)),abstentions:scenarios.filter(x=>!x.available).length});
  }
 }
 return {status:rows.length?'MEASURED':'INSUFFICIENT_DATA',method:'deterministic_feature_perturbation',accuracyNotMeasured:true,note:'Mede estabilidade da previsão sob perturbações controladas; não substitui backtest de acurácia.',rows:rows.sort((a,b)=>b.maxShiftMinutes-a.maxShiftMinutes).slice(0,100)};
}
function crossBossHypotheses(intel,world,at=Date.now()){
 const H=3600000,windowMs=12*H,events=intel.events.filter(e=>e.world===world&&/^confirmed_/.test(e.status)&&e.eventType!=='absence'&&!e.anomaly&&!['CONFLITANTE','SUSPEITO','DESCARTADO'].includes(e.qualityStatus)&&Number.isFinite(e.estimatedAt)&&e.estimatedAt<=at).sort((a,b)=>a.estimatedAt-b.estimatedAt);
 if(events.length<100)return {status:'INSUFFICIENT_DATA',tests:0,hypotheses:[]};
 const counts=new Map();for(const e of events)counts.set(e.boss,(counts.get(e.boss)||0)+1);const bosses=[...counts.entries()].filter(([,n])=>n>=30).sort((a,b)=>b[1]-a[1]).slice(0,25).map(x=>x[0]),first=events[0].estimatedAt,last=events.at(-1).estimatedAt,span=Math.max(windowMs,last-first),tests=[];
 for(const a of bosses){const aa=events.filter(e=>e.boss===a);for(const b of bosses){if(a===b)continue;const bb=events.filter(e=>e.boss===b),n=aa.length;if(n<30||bb.length<10)continue;let hits=0;for(const x of aa)if(bb.some(y=>y.estimatedAt>x.estimatedAt&&y.estimatedAt<=x.estimatedAt+windowMs))hits++;const observed=hits/n,baseline=Math.min(.95,bb.length*windowMs/span);if(baseline<=0||baseline>=1)continue;const se=Math.sqrt(baseline*(1-baseline)/n),z=se?((observed-baseline)/se):0,p=1-normalCdf(z),rr=observed/baseline;tests.push({fromBoss:a,toBoss:b,samples:n,hits,observedRate:round(observed,4),baselineRate:round(baseline,4),riskRatio:round(rr,2),pValue:round(p,6)});}}
 const sorted=tests.filter(x=>Number.isFinite(x.pValue)).sort((a,b)=>a.pValue-b.pValue),m=sorted.length;let prev=1;for(let i=m-1;i>=0;i--){sorted[i].qValue=round(Math.min(prev,sorted[i].pValue*m/(i+1)),6);prev=sorted[i].qValue;}
 return {status:m?'MEASURED':'INSUFFICIENT_DATA',tests:m,method:'12h_post_event_rate_vs_background_with_BH_FDR',hypothesisOnly:true,hypotheses:sorted.filter(x=>x.samples>=30&&x.hits>=5&&x.riskRatio>=1.5&&x.qValue<=.05).slice(0,30),note:'Correlação exploratória, não causal. Só pode virar feature após experimento temporal independente.'};
}
function weeklyAIReview(intel,world,at=Date.now()){
 const l=ensureAILab(intel),start=at-7*86400000,rows=Object.values(l.experiments).filter(x=>x.world===world&&x.createdAt>=start),completed=rows.filter(x=>x.completedAt>=start),statusCounts={};for(const x of rows)statusCounts[x.status]=(statusCounts[x.status]||0)+1;
 return {from:start,to:at,created:rows.length,completed:completed.length,promoted:completed.filter(x=>x.status==='PROMOTED').length,rejected:completed.filter(x=>x.status==='REJECTED').length,inconclusive:completed.filter(x=>x.status==='INCONCLUSIVE').length,eligible:rows.filter(x=>x.status==='ELIGIBLE_FOR_PROMOTION').length,statusCounts};
}
export function suggestExperiments(intel,world,at=Date.now()){
 const l=ensureAILab(intel),errors=Object.values(mlops(intel).errors||{}).filter(x=>x.world===world),suggestions=[];
 const byBoss=new Map();for(const e of errors){const x=byBoss.get(e.boss)||[];x.push(e);byBoss.set(e.boss,x);}
 for(const [boss,rows] of byBoss){const high=rows.filter(x=>Number.isFinite(x.errorMinutes)&&x.errorMinutes>120),drift=rows.filter(x=>x.causes?.includes('drift'));if(high.length>=3)suggestions.push({hypothesis:'Dar maior peso aos intervalos recentes reduz os erros extremos de '+boss+'.',world,boss,modelId:'robust_interval',reason:'repeated_large_errors',support:high.length});if(drift.length>=3)suggestions.push({hypothesis:'Um modelo robusto com memória recente melhora '+boss+' durante períodos de drift.',world,boss,modelId:'robust_interval',reason:'drift_cluster',support:drift.length});}
 const features=featureSummary(intel,world,at);for(const f of features.oftenUseless.slice(0,3))if(f.bosses>=3){const parameters={recentWindow:10,recentShare:.2,driftRecentShare:.4,...(f.name==='recentIntervals'?{ablateRecent:true,recentShare:0,driftRecentShare:0}:f.name==='median'?{ablateHistory:true,recentShare:1,driftRecentShare:1}:{})};suggestions.push({hypothesis:'Remover a feature '+f.name+' não piora o desempenho e reduz complexidade.',world,boss:null,modelId:'robust_interval',kind:'ablation',features:[f.name],parameters,reason:'measured_ablation_candidate',support:f.bosses});}
 const analogCandidates=[...new Set(intel.events.filter(e=>e.world===world&&/^confirmed_/.test(e.status)&&e.eventType!=='absence').map(e=>e.boss))].map(boss=>({boss,features:buildFeatures(intel.events,boss,world,at,{includeAnalog:true})})).filter(x=>x.features.values.analogStateSamples>=20&&(x.features.values.analogBestSimilarity??0)>=.45).sort((a,b)=>(b.features.values.analogStateSamples-a.features.values.analogStateSamples)||((b.features.values.analogBestSimilarity??0)-(a.features.values.analogBestSimilarity??0))).slice(0,10);
 for(const x of analogCandidates)suggestions.push({hypothesis:'Estados históricos semelhantes melhoram a previsão temporal de '+x.boss+' em relação ao Champion atual.',world,boss:x.boss,modelId:'analog_state_interval',kind:'analog_state',features:['bossesLast6h','bossesLast12h','bossesLast24h','uniqueBossesLast24h'],parameters:{neighbors:12,minSimilarity:.45},reason:'similar_historical_states_available',support:x.features.values.analogStateSamples,bestSimilarity:round(x.features.values.analogBestSimilarity,3)});
 const saveAnalysis=intel.discovery?serverSaveAnalysis(intel.discovery,world,at):{results:[]};for(const row of saveAnalysis.results||[]){for(const bucket of row.buckets||[]){if(bucket.status!=='CANDIDATE_SIGNAL'||!(bucket.lift>1))continue;suggestions.push({hypothesis:'A posição dentro do ciclo de Server Save melhora a previsão temporal de '+row.boss+' em comparação ao Champion atual.',world,boss:row.boss,modelId:'server_save_context_interval',kind:'server_save_context',features:['serverSaveHours'],parameters:{bucketFromHours:bucket.fromHours,bucketToHours:bucket.toHours,saveLift:bucket.lift,serverSaveWeight:.25},reason:'server_save_bucket_signal',support:bucket.eventSamples,lift:round(bucket.lift,2),adjustedSignificance:bucket.test?.q??null});}}
 const graphHypotheses=Object.values(intel.discovery?.temporalKnowledge?.hypotheses||{}).filter(x=>x.world===world&&x.eligibleForExperiment).sort((a,b)=>(b.rankScore||0)-(a.rankScore||0)).slice(0,20);
 for(const h of graphHypotheses)suggestions.push({hypothesis:h.hypothesis,world,boss:h.boss,modelId:'graph_context_interval',kind:'graph_feature',features:[h.featureId],parameters:structuredClone(h.parameters),reason:'knowledge_graph_relationship',support:h.support,rankScore:h.rankScore,lift:h.lift});
 const existing=new Set(Object.values(l.experiments).map(x=>x.fingerprint));l.suggestions=suggestions.filter(x=>!existing.has(experimentFingerprint(x))).map(x=>({...x,id:'SUG-'+digest(x).slice(0,16),createdAt:at})).slice(0,100);return l.suggestions;
}
export function aiLabDashboard(intel,world,at=Date.now()){
 const l=refreshAllExperiments(intel,world,at),experiments=Object.values(l.experiments).filter(x=>x.world===world).sort((a,b)=>b.createdAt-a.createdAt),q=bhAdjusted(experiments);for(const e of experiments)e.falseDiscoveryQ=q[e.id]??null;
 const board=leaderboardRows(intel,world),features=featureSummary(intel,world,at),degradation=championDegradation(intel,world,at),retraining=smartRetraining(intel,world,at,degradation),clusters=errorClusters(intel,world),robustness=robustnessProbe(intel,world,at),crossBoss=crossBossHypotheses(intel,world,at),weekly=weeklyAIReview(intel,world,at),suggestions=suggestExperiments(intel,world,at),championGlobal=activeChampion(l,world,null),championRegistry={global:championGlobal,byBoss:Object.entries(l.champions).filter(([k])=>k.startsWith(world+'|')&&!k.endsWith('|*')).map(([scope,x])=>({scope,...x}))};
 const championMetrics=board.overall.find(x=>x.modelId===(championGlobal.modelId||'adaptive_ensemble'))||null,promoted=experiments.filter(x=>x.status==='PROMOTED'),improvements=promoted.map(x=>x.result?.historical?.holdoutImprovementPct).filter(Number.isFinite),recent=improvements.slice(-5),learningVelocity=improvements.length>=2?round(improvements.at(-1)-improvements[0],2):null,diminishingReturns=recent.length>=3&&recent.every(x=>Math.abs(x)<2);
 return {policy:{...l.policy,auto_model_promotion:false},champion:{...championGlobal,name:MODEL_SPECS[championGlobal.modelId]?.name||championGlobal.modelId,metrics:championMetrics,modelCard:{objective:'Prever janela temporal de próxima aparição sem usar informação futura.',data:'Somente eventos confirmados/validados elegíveis para aprendizado.',features:MODEL_SPECS[championGlobal.modelId]?.features||[],limitations:championMetrics?.samples?[]:['Amostra de previsões resolvidas ainda insuficiente para métricas completas.'],validatedAt:championGlobal.promotedAt||null}},challengers:experiments.filter(x=>['CHALLENGER','ELIGIBLE_FOR_PROMOTION'].includes(x.status)),shadowModels:experiments.filter(x=>x.status==='SHADOW'),experiments,suggestions,leaderboard:board,features,canaries:Object.values(l.canaries).filter(x=>x.world===world),decisions:l.decisions.filter(x=>!x.world||x.world===world).slice(0,200),knowledge:l.knowledge.filter(x=>x.world===world).slice(0,200),datasetVersions:Object.values(mlops(intel).datasets).filter(x=>x.world===world).slice(-100).map(x=>({id:x.id,boss:x.boss,asOf:x.asOf,featureVersion:x.featureVersion,hash:x.hash,events:x.events.length})),featureVersion:FEATURE_VERSION,codeVersion:CODE_VERSION,learningVelocity,diminishingReturns,championDegradation:degradation,retraining,errorClusters:clusters,robustness,crossBossHypotheses:crossBoss,weeklyReview:weekly,generatedAt:at};
}
export function archiveExperiment(intel,id,{actor='site-admin',reason='Arquivado',at=Date.now()}={}){const l=ensureAILab(intel),e=l.experiments[id];if(!e)throw new Error('Experimento não encontrado');e.status='ARCHIVED';e.archivedAt=at;e.history.push({at,status:'ARCHIVED',reason:String(reason).slice(0,500)});l.decisions.unshift({at,experimentId:id,decision:'ARCHIVE',actor:String(actor),reason:String(reason).slice(0,500)});return e;}

import {MODEL_SPECS,metrics,qualityGate,verifyDataset,candidatePrediction} from './models.mjs';
import {buildFeatures,digest,FEATURE_VERSION} from './feature-store.mjs';
import {featureImportance} from './analysis.mjs';
import {calibrateConfidence} from '../learning/calibration.mjs';
import {MODEL_FAMILY_VERSION,CODE_VERSION} from '../prediction/version.mjs';

const STATUSES=new Set(['PROPOSED','RUNNING','FAILED','INCONCLUSIVE','REJECTED','SHADOW','CHALLENGER','ELIGIBLE_FOR_PROMOTION','PROMOTED','ARCHIVED']);
const scopeKey=(world,boss)=>world+'|'+String(boss||'*').toLowerCase();
const round=(n,d=2)=>Number.isFinite(n)?Math.round(n*10**d)/10**d:null;
const avg=a=>{const x=a.filter(Number.isFinite);return x.length?x.reduce((n,v)=>n+v,0)/x.length:null;};
const variance=(a,m)=>a.length>1?a.reduce((n,x)=>n+(x-m)**2,0)/(a.length-1):null;
const erf=x=>{const sign=x<0?-1:1,a=Math.abs(x),t=1/(1+.3275911*a),y=1-(((((1.061405429*t-1.453152027)*t+1.421413741)*t-.284496736)*t+.254829592)*t)*Math.exp(-a*a);return sign*y;};
const normalCdf=z=>(1+erf(z/Math.SQRT2))/2;
const experimentFingerprint=input=>digest({hypothesis:String(input.hypothesis||'').trim().toLowerCase().replace(/\s+/g,' '),kind:input.kind||'model',world:input.world,boss:input.boss||null,modelId:input.modelId||null,features:[...(input.features||[])].sort(),parameters:input.parameters||{}});
function mlops(intel){if(!intel?.mlops)throw new Error('MLOps não inicializado');return intel.mlops;}
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
 const l=ensureAILab(intel),s=mlops(intel),exp=l.experiments[id];if(!exp)throw new Error('Experimento não encontrado');if(exp.status!=='RUNNING')throw new Error('Experimento não está em execução');
 const walk=walkForward(backtest.pairs||[]),overfit=overfitRisk(backtest,walk),gate=historicalGate(backtest,walk,l.policy),holdout=backtest.test||{},holdoutGain=holdout.champion?.maeMinutes&&holdout.candidate?.maeMinutes!=null?100*(holdout.champion.maeMinutes-holdout.candidate.maeMinutes)/holdout.champion.maeMinutes:null;
 const bossRows=(backtest.pairs||[]).reduce((m,p)=>{(m[p.boss]||=[]).push(p);return m;},{}),perBoss=Object.entries(bossRows).map(([boss,pairs])=>({boss,...comparePairs(pairs)})).sort((a,b)=>(b.samples||0)-(a.samples||0));
 const result={backtestId:backtest.id,sampleSize:backtest.samples,datasetIds:backtest.datasetIds,temporalPassed:backtest.temporalPassed,leakagePassed:backtest.leakagePassed,walkForward:walk,holdout,holdoutImprovementPct:holdoutGain==null?null:round(holdoutGain,1),overfitRisk:overfit,historicalGate:gate,perBoss,runtimeMs:round(runtimeMs,2),resourceCost:{runtimeMs:round(runtimeMs,2),samples:backtest.samples,msPerSample:backtest.samples?round(runtimeMs/backtest.samples,4):null},decision:gate.passed&&!overfit.detected?'ENTER_SHADOW':backtest.samples<l.policy.minHistoricalSamples?'INCONCLUSIVE':'REJECT'};
 exp.datasetVersion=digest(backtest.datasetIds||[]);exp.result={historical:result,sampleSize:backtest.samples,decision:result.decision};exp.completedAt=at;
 if(runtimeMs>l.policy.maxExperimentRuntimeMs){exp.status='REJECTED';exp.result.decision='REJECT';exp.result.historical.historicalGate.reasons.push('EXPERIMENT_RUNTIME_BUDGET_EXCEEDED');}
 else if(result.decision==='ENTER_SHADOW'){exp.status='SHADOW';exp.shadowStartedAt=at;}
 else exp.status=result.decision==='INCONCLUSIVE'?'INCONCLUSIVE':'REJECTED';
 exp.history.push({at,status:exp.status,reason:exp.result.decision});l.knowledge.unshift(knowledgeRow(exp,at));if(l.knowledge.length>5000)l.knowledge.length=5000;
 const registry=s.registry[exp.modelId];if(registry){registry.experimentIds||=[];if(!registry.experimentIds.includes(exp.id))registry.experimentIds.push(exp.id);}
 return exp;
}
export function failExperiment(intel,id,error,at=Date.now()){
 const l=ensureAILab(intel),exp=l.experiments[id];if(!exp)throw new Error('Experimento não encontrado');exp.status='FAILED';exp.failedAt=at;exp.error=String(error?.message||error).slice(0,500);exp.history.push({at,status:'FAILED',reason:exp.error});return exp;
}
function livePairs(intel,exp,at){
 const s=mlops(intel),candidate=s.runs.filter(x=>x.modelId===exp.modelId&&x.world===exp.world&&(!exp.boss||x.boss===exp.boss)&&x.resolvedAt&&x.resolvedAt<=at&&x.asOf>=exp.shadowStartedAt&&Number.isFinite(x.errorMinutes));
 const latest=new Map();for(const x of candidate.sort((a,b)=>a.asOf-b.asOf))latest.set(x.pairId,x);
 const champion=new Map(s.runs.filter(x=>x.mode==='Champion'&&x.world===exp.world&&x.resolvedAt&&x.resolvedAt<=at).map(x=>[x.pairId,x]));
 return [...latest.values()].filter(x=>champion.has(x.pairId)).map(x=>{const b=champion.get(x.pairId);return {pairId:x.pairId,boss:x.boss,world:x.world,asOf:x.asOf,resolvedAt:x.resolvedAt,datasetId:x.datasetId,championErrorMinutes:b.errorMinutes,challengerErrorMinutes:x.errorMinutes,championWindowHit:!!b.windowHit,challengerWindowHit:!!x.windowHit,championConfidence:b.confidence??null,challengerConfidence:x.confidence??null,challengerLatencyMs:x.latencyMs??null,improvementMinutes:b.errorMinutes-x.errorMinutes};});
}
export function refreshLiveExperiment(intel,id,at=Date.now()){
 const l=ensureAILab(intel),s=mlops(intel),exp=l.experiments[id];if(!exp)throw new Error('Experimento não encontrado');if(!['SHADOW','CHALLENGER','ELIGIBLE_FOR_PROMOTION'].includes(exp.status))return exp;
 const pairs=livePairs(intel,exp,at),cmp=comparePairs(pairs),validation=s.backtests.findLast(x=>x.id===exp.result?.historical?.backtestId),datasetsOk=pairs.every(x=>verifyDataset(s.datasets[x.datasetId])),gate=qualityGate(rowsFromPairs(pairs,'champion'),rowsFromPairs(pairs,'challenger'),{temporalPassed:!!validation?.temporalPassed,leakagePassed:datasetsOk,minSamples:l.policy.minShadowEvents});
 exp.live={updatedAt:at,samples:pairs.length,...cmp,gate,reliabilityDiagram:cmp.challenger.reliabilityBins||[],minimumShadowEvents:l.policy.minShadowEvents};
 if(pairs.length<10){exp.status='SHADOW';}
 else if(pairs.length<l.policy.minShadowEvents){exp.status='CHALLENGER';}
 else if(gate.passed){exp.status='ELIGIBLE_FOR_PROMOTION';exp.result.recommendation='PROMOTE';}
 else{const severe=Number.isFinite(cmp.champion.maeMinutes)&&Number.isFinite(cmp.challenger.maeMinutes)&&cmp.challenger.maeMinutes>cmp.champion.maeMinutes*1.1||Number.isFinite(cmp.champion.p95ErrorMinutes)&&Number.isFinite(cmp.challenger.p95ErrorMinutes)&&cmp.challenger.p95ErrorMinutes>cmp.champion.p95ErrorMinutes*1.2;exp.status=severe?'REJECTED':'CHALLENGER';exp.result.recommendation=severe?'REJECT':'WAIT';}
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
 const f=buildFeatures(intel.events,boss,world,asOf),c=candidatePrediction(selection.modelId,f);if(!c)return {prediction:basePrediction,rollout:{...selection.rollout,selected:false,reason:'candidate_insufficient_features'},baseline:null};
 const historical=mlops(intel).runs.filter(x=>x.modelId===selection.modelId&&x.world===world&&x.boss===boss&&x.resolvedAt&&x.resolvedAt<asOf),raw=basePrediction.confidenceRaw??basePrediction.confidence,cal=calibrateConfidence(raw,historical,world,boss),last=f.rows.at(-1)?.estimatedAt,lower=last==null?null:(c.windowStart-last)/3600000,upper=last==null?null:(c.windowEnd-last)/3600000,hits=lower==null?0:f.intervals.filter(x=>x>=lower&&x<=upper).length,probability=f.intervals.length?round(100*(hits+1)/(f.intervals.length+2),1):null;
 if(cal.samples<20)return {prediction:basePrediction,rollout:{...selection.rollout,selected:false,reason:'candidate_calibration_insufficient',calibrationSamples:cal.samples},baseline:null};
 const baseline={modelId:'adaptive_ensemble',predictedCenterAt:basePrediction.predictedCenterAt,windowStart:basePrediction.windowStart,windowEnd:basePrediction.windowEnd,confidence:basePrediction.confidence,probability:basePrediction.probability};
 const spec=MODEL_SPECS[selection.modelId],prediction={...basePrediction,predictedCenterAt:c.predictedAt,likelyAt:basePrediction.likelyAt?c.predictedAt:null,windowStart:c.windowStart,windowEnd:c.windowEnd,uncertaintyMs:Math.round((c.windowEnd-c.windowStart)/2),confidenceRaw:raw,confidence:cal.calibrated,calibration:cal,probability,probabilityDistribution:[],bestProbabilitySlot:null,labModelId:selection.modelId,labModelVersion:selection.modelVersion,methods:[{name:selection.modelId,label:spec.name,predictedAt:c.predictedAt,weight:1,normalizedWeight:1,samples:c.parameters?.intervals||f.values.samples}],explain:[...(basePrediction.explain||[]),'AI Lab Canary: '+spec.name+' '+selection.modelVersion+' foi selecionado deterministicamente para esta previsão após aprovação manual. Confiança calibrada somente com resultados Shadow do próprio Challenger.']};
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
 if(severe){canary.status='ROLLED_BACK';canary.rolledBackAt=at;canary.rollbackReason='automatic_canary_regression';const exp=l.experiments[canary.experimentId];if(exp){exp.status='REJECTED';exp.history.push({at,status:'REJECTED',reason:'automatic_canary_regression'});}l.decisions.unshift({at,experimentId:canary.experimentId,decision:'AUTO_ROLLBACK',actor:'system',reason:canary.rollbackReason,canaryId:canary.id});return canary;}
 const nextStage=canary.stage+1;if(nextStage<canary.stages.length){canary.stage=nextStage;canary.percentage=canary.stages[nextStage];canary.stageStartedAt=at;canary.samples=0;l.decisions.unshift({at,experimentId:canary.experimentId,decision:'CANARY_ADVANCE',actor:'system',reason:'stage_metrics_healthy',percentage:canary.percentage,canaryId:canary.id});return canary;}
 canary.status='PROMOTED';canary.promotedAt=at;const exp=l.experiments[canary.experimentId],champ={modelId:canary.modelId,modelVersion:canary.modelVersion,experimentId:canary.experimentId,canaryId:canary.id,scope:canary.scope,promotedAt:at,metrics:cmp};l.championHistory.unshift({scope:canary.scope,from:canary.previousChampion,to:champ,at});l.champions[canary.scope]=champ;if(exp){exp.status='PROMOTED';exp.promotedAt=at;exp.history.push({at,status:'PROMOTED',reason:'canary_completed'});}l.decisions.unshift({at,experimentId:canary.experimentId,decision:'PROMOTE',actor:'system_after_manual_canary_approval',reason:'all_canary_stages_passed',canaryId:canary.id});return canary;
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
 const s=mlops(intel),latest=new Map();for(const r of s.runs.filter(x=>x.world===world&&x.resolvedAt&&Number.isFinite(x.errorMinutes)).sort((a,b)=>a.asOf-b.asOf))latest.set(r.modelId+'|'+r.pairId,r);
 const rows=[...latest.values()],overall=Object.keys(MODEL_SPECS).map(id=>({modelId:id,name:MODEL_SPECS[id].name,version:MODEL_SPECS[id].version,...metrics(rows.filter(x=>x.modelId===id))})).sort((a,b)=>(a.maeMinutes??Infinity)-(b.maeMinutes??Infinity));
 const bosses=[...new Set(rows.map(x=>x.boss))],perBoss=bosses.map(boss=>{const models=Object.keys(MODEL_SPECS).map(id=>({modelId:id,...metrics(rows.filter(x=>x.boss===boss&&x.modelId===id))})).filter(x=>x.samples).sort((a,b)=>(a.maeMinutes??Infinity)-(b.maeMinutes??Infinity));return {boss,best:models[0]||null,models};}).sort((a,b)=>(b.best?.samples||0)-(a.best?.samples||0));
 return {overall,perBoss};
}
function featureSummary(intel,world,at){
 const bosses=[...new Set(intel.events.filter(x=>x.world===world).map(x=>x.boss))],measured=bosses.map(boss=>({boss,result:featureImportance(intel.events,boss,world,at)})).filter(x=>x.result.status!=='insufficient'),gain=new Map(),unused=new Map();
 for(const row of measured){for(const f of row.result.features||[]){const x=gain.get(f.name)||[];if(Number.isFinite(f.maeIncreaseHours))x.push(f.maeIncreaseHours);gain.set(f.name,x);}for(const f of row.result.unusedFeatures||[])unused.set(f,(unused.get(f)||0)+1);}
 return {measuredBosses:measured.length,topUseful:[...gain].map(([name,x])=>({name,bosses:x.length,meanMaeIncreaseHours:round(avg(x),3)})).sort((a,b)=>b.meanMaeIncreaseHours-a.meanMaeIncreaseHours),oftenUseless:[...unused].map(([name,bosses])=>({name,bosses})).sort((a,b)=>b.bosses-a.bosses),perBoss:measured.slice(0,100)};
}
export function suggestExperiments(intel,world,at=Date.now()){
 const l=ensureAILab(intel),errors=Object.values(mlops(intel).errors||{}).filter(x=>x.world===world),suggestions=[];
 const byBoss=new Map();for(const e of errors){const x=byBoss.get(e.boss)||[];x.push(e);byBoss.set(e.boss,x);}
 for(const [boss,rows] of byBoss){const high=rows.filter(x=>Number.isFinite(x.errorMinutes)&&x.errorMinutes>120),drift=rows.filter(x=>x.causes?.includes('drift'));if(high.length>=3)suggestions.push({hypothesis:'Dar maior peso aos intervalos recentes reduz os erros extremos de '+boss+'.',world,boss,modelId:'robust_interval',reason:'repeated_large_errors',support:high.length});if(drift.length>=3)suggestions.push({hypothesis:'Um modelo robusto com memória recente melhora '+boss+' durante períodos de drift.',world,boss,modelId:'robust_interval',reason:'drift_cluster',support:drift.length});}
 const features=featureSummary(intel,world,at);for(const f of features.oftenUseless.slice(0,3))if(f.bosses>=3)suggestions.push({hypothesis:'Remover a feature '+f.name+' não piora o desempenho e reduz complexidade.',world,boss:null,modelId:'robust_interval',kind:'ablation',features:[f.name],reason:'ablation_candidate',support:f.bosses});
 const existing=new Set(Object.values(l.experiments).map(x=>x.fingerprint));l.suggestions=suggestions.filter(x=>!existing.has(experimentFingerprint(x))).map(x=>({...x,id:'SUG-'+digest(x).slice(0,16),createdAt:at})).slice(0,100);return l.suggestions;
}
export function aiLabDashboard(intel,world,at=Date.now()){
 const l=refreshAllExperiments(intel,world,at),experiments=Object.values(l.experiments).filter(x=>x.world===world).sort((a,b)=>b.createdAt-a.createdAt),q=bhAdjusted(experiments);for(const e of experiments)e.falseDiscoveryQ=q[e.id]??null;
 const board=leaderboardRows(intel,world),features=featureSummary(intel,world,at),suggestions=suggestExperiments(intel,world,at),championGlobal=activeChampion(l,world,null),championRegistry={global:championGlobal,byBoss:Object.entries(l.champions).filter(([k])=>k.startsWith(world+'|')&&!k.endsWith('|*')).map(([scope,x])=>({scope,...x}))};
 const championMetrics=board.overall.find(x=>x.modelId===(championGlobal.modelId||'adaptive_ensemble'))||null,promoted=experiments.filter(x=>x.status==='PROMOTED'),improvements=promoted.map(x=>x.result?.historical?.holdoutImprovementPct).filter(Number.isFinite),recent=improvements.slice(-5),learningVelocity=improvements.length>=2?round(improvements.at(-1)-improvements[0],2):null,diminishingReturns=recent.length>=3&&recent.every(x=>Math.abs(x)<2);
 return {policy:{...l.policy,auto_model_promotion:false},champion:{...championGlobal,name:MODEL_SPECS[championGlobal.modelId]?.name||championGlobal.modelId,metrics:championMetrics,modelCard:{objective:'Prever janela temporal de próxima aparição sem usar informação futura.',data:'Somente eventos confirmados/validados elegíveis para aprendizado.',features:MODEL_SPECS[championGlobal.modelId]?.features||[],limitations:championMetrics?.samples?[]:['Amostra de previsões resolvidas ainda insuficiente para métricas completas.'],validatedAt:championGlobal.promotedAt||null}},challengers:experiments.filter(x=>['CHALLENGER','ELIGIBLE_FOR_PROMOTION'].includes(x.status)),shadowModels:experiments.filter(x=>x.status==='SHADOW'),experiments,suggestions,leaderboard:board,features,canaries:Object.values(l.canaries).filter(x=>x.world===world),decisions:l.decisions.filter(x=>!x.world||x.world===world).slice(0,200),knowledge:l.knowledge.filter(x=>x.world===world).slice(0,200),datasetVersions:Object.values(mlops(intel).datasets).filter(x=>x.world===world).slice(-100).map(x=>({id:x.id,boss:x.boss,asOf:x.asOf,featureVersion:x.featureVersion,hash:x.hash,events:x.events.length})),featureVersion:FEATURE_VERSION,codeVersion:CODE_VERSION,learningVelocity,diminishingReturns,generatedAt:at};
}
export function archiveExperiment(intel,id,{actor='site-admin',reason='Arquivado',at=Date.now()}={}){const l=ensureAILab(intel),e=l.experiments[id];if(!e)throw new Error('Experimento não encontrado');e.status='ARCHIVED';e.archivedAt=at;e.history.push({at,status:'ARCHIVED',reason:String(reason).slice(0,500)});l.decisions.unshift({at,experimentId:id,decision:'ARCHIVE',actor:String(actor),reason:String(reason).slice(0,500)});return e;}

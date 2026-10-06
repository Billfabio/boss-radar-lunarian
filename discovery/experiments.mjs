import {digest} from '../mlops/feature-store.mjs';
import {eventsAsOf,horizonLabel} from './canonical-events.mjs';
import {probabilities,signalFeatures,buildCases} from './signals.mjs';
import {probabilityMetrics,pairedSign,adjustFDR,mean,clamp} from './statistics.mjs';
import {addTimingTargets,timingComparison,timingMetrics} from './timing.mjs';
export function multiFeatureProbability(train,features,keys=[]){
 const base=probabilities(train,features).baseline;if(!keys.length)return base;let logOdds=Math.log(base/(1-base));
 for(const key of keys){const p=probabilities(train,features,key).signal;logOdds+=(Math.log(p/(1-p))-Math.log(base/(1-base)))/Math.sqrt(keys.length);}
 return clamp(1/(1+Math.exp(-logOdds)));
}
export function hierarchicalProbability(own,pooled,features,{cluster=null}={}){
 const parent=pooled.filter(r=>r.features.elapsedFraction===features.elapsedFraction&&(!cluster||r.features.cluster===cluster)),population=parent.length>=30?parent:pooled;
 const prior=population.length?(population.reduce((s,r)=>s+r.y,0)+1)/(population.length+2):.5,local=own.filter(r=>r.features.elapsedFraction===features.elapsedFraction);
 return {probability:clamp((local.reduce((s,r)=>s+r.y,0)+20*prior)/(local.length+20)),ownSamples:local.length,parentSamples:population.length,confidenceCap:Math.min(.9,local.length/(local.length+20)),status:population.length>=30?'EXPERIMENTAL':'AMOSTRA_INSUFICIENTE'};
}
export function recipeProbability(train,pool,features,recipe){
 if(recipe.algorithm==='hierarchical')return hierarchicalProbability(train,pool,features,{cluster:recipe.cluster||(features.cluster==='unknown'?null:features.cluster)}).probability;
 if(recipe.algorithm==='global')return multiFeatureProbability(pool.length>=30?pool:train,features,recipe.keys||['recentDensity','previousBoss','regime']);
 return multiFeatureProbability(train,features,recipe.keys||[]);
}
export function recipeGate(rows,{minSamples=50,minDays=20,alpha=.05}={}){
 const baseline=probabilityMetrics(rows,'baseline'),challenger=probabilityMetrics(rows,'signal'),sign=pairedSign(rows),days=new Set(rows.map(r=>Math.floor(r.at/86400000))).size,gain=baseline.brier>0?(baseline.brier-challenger.brier)/baseline.brier:null;
 const passed=rows.length>=minSamples&&days>=minDays&&sign.p<=alpha&&gain>=.05&&challenger.brier<baseline.brier&&challenger.logLoss<=baseline.logLoss&&challenger.ece<=baseline.ece&&challenger.ece<=.1;
 return {passed,baseline,challenger,...sign,days,gain,alpha,reasons:passed?[]:['Exige amostra prospectiva independente, ganho de Brier ≥5%, teste pareado, log loss/calibração sem regressão e ECE ≤10%.']};
}
export function runAdvancedExperiments(d,world,asOf=Date.now()){
 const bosses=[...new Set(eventsAsOf(d,world,asOf).map(e=>e.boss))].slice(0,100),cases=new Map(bosses.map(b=>[b,addTimingTargets(d,world,b,buildCases({...d,analysisAsOf:asOf},world,b),asOf)])),pool=[...cases.values()].flat(),results=[];
 for(const boss of bosses){const own=cases.get(boss),a=Math.floor(own.length*.6),b=Math.floor(own.length*.8);
  // Recipe declared before looking at either holdout; test-selected features are not reused.
  const recipes=[{algorithm:'global',keys:['recentDensity','previousBoss','regime']},{algorithm:'hierarchical',keys:[]},{algorithm:'features',keys:['hour','weekday','recentDensity','previousBoss','serverSavePhase','publicNewsDensity']}];
  for(const recipe of recipes){const folds=[];for(let i=a;i<own.length;i++){const current=own[i],train=own.slice(0,i).filter(r=>r.knownAt<=current.at),parent=pool.filter(r=>r.knownAt<=current.at);if(train.length<10||parent.length<30)continue;folds.push({at:current.at,y:current.y,baseline:probabilities(train,current.features).baseline,signal:recipeProbability(train,parent,current.features,recipe),split:i<b?'validation':'test',timing:timingComparison(train,current,recipe.keys),ablations:Object.fromEntries(recipe.keys.map(key=>[key,recipeProbability(train,parent,current.features,{...recipe,keys:recipe.keys.filter(k=>k!==key)})]))});}
   const validation=recipeGate(folds.filter(f=>f.split==='validation'),{minSamples:20,minDays:10}),test=recipeGate(folds.filter(f=>f.split==='test'),{minSamples:20,minDays:10}),datasetHash=digest({world,boss,own,recipe}),id='EXP-'+digest({datasetHash,recipe}).slice(0,20);
   const ablation=recipe.keys.map(key=>{const rows=folds.filter(f=>f.split==='test');return {feature:key,withBrier:probabilityMetrics(rows,'signal').brier,withoutBrier:mean(rows.map(r=>(r.ablations[key]-r.y)**2)),productionEligible:false};});
   results.push({id,world,boss,at:asOf,datasetHash,recipe,signal:recipe.algorithm==='features'?recipe.keys.join('+'):recipe.algorithm,hypothesis:'Contexto '+recipe.algorithm+' melhora previsão fora da amostra',samples:own.length,discoverySamples:a,validation:{...validation,without:validation.baseline,withSignal:validation.challenger},test:{...test,timing:timingMetrics(folds.filter(f=>f.split==='test')),without:test.baseline,withSignal:test.challenger},ablation,status:'EM_TESTE',productionEligible:false,shadowRequired:true});
  }
 }
 adjustFDR(results,'validation','BY');adjustFDR(results,'test','BY');for(const r of results){r.status=r.discoverySamples<30||r.test.withSignal.samples<20||r.validation.withSignal.samples<20?'AMOSTRA_INSUFICIENTE':r.validation.passed&&r.test.passed&&r.validation.q<=.05&&r.test.q<=.05?'SHADOW_MODE':'REJEITADO';if(!d.experiments.some(e=>e.id===r.id))d.experiments.push(r);}return results;
}
export function ensureProspective(d){d.policies||=[];d.prospective||=[];d.datasets||={};d.governanceHistory||=[];}
export function stagePolicies(d,world,at=Date.now()){
 ensureProspective(d);for(const e of d.experiments.filter(e=>e.world===world&&e.status==='SHADOW_MODE'&&(e.horizonHours==null||e.horizonHours===6))){if(d.policies.some(p=>p.experimentId===e.id))continue;d.policies.push({id:'POL-'+digest(e.id).slice(0,20),kind:'signal',world,boss:e.boss,experimentId:e.id,recipe:e.recipe||{algorithm:'features',keys:[e.signal]},status:'SHADOW_MODE',createdAt:at,stageStartedAt:at,percentage:0,stage:0,productionEligible:false,retrospectiveHash:e.datasetHash});}
 return d.policies.filter(p=>p.world===world);
}
export function recordProspective(d,world,asOf=Date.now()){
 ensureProspective(d);const active=d.policies.filter(p=>p.kind==='signal'&&p.world===world&&['SHADOW_MODE','CHALLENGER','CANARY','PRODUCAO'].includes(p.status)),events=eventsAsOf(d,world,asOf),cache=new Map();
 const cases=boss=>{if(!cache.has(boss))cache.set(boss,buildCases({...d,analysisAsOf:asOf},world,boss).filter(r=>r.knownAt<=asOf));return cache.get(boss);},pool=[...new Set(events.map(e=>e.boss))].slice(0,100).flatMap(cases);
 const created=[];for(const p of active){if(d.prospective.some(f=>f.policyId===p.id&&asOf-f.at<6*3600000&&asOf>=f.at))continue;const train=cases(p.boss);if(train.length<30)continue;const features=signalFeatures(events,d.context.filter(c=>c.world===world),p.boss,asOf,d),datasetHash=digest({train,pool,features,recipe:p.recipe});d.datasets[datasetHash]||={hash:datasetHash,createdAt:asOf,world,boss:p.boss,train:structuredClone(train),pool:structuredClone(pool),features:structuredClone(features),recipe:structuredClone(p.recipe)};
  const baseline=probabilities(train,features).baseline,signal=recipeProbability(train,pool,features,p.recipe),row={id:'PF-'+digest({p:p.id,asOf}).slice(0,24),policyId:p.id,world,boss:p.boss,at:asOf,endAt:asOf+6*3600000,datasetHash,features,baseline,signal,status:'ABERTA',y:null};row.immutableHash=digest({policyId:row.policyId,at:row.at,endAt:row.endAt,datasetHash,features,baseline,signal});d.prospective.push(row);created.push(row);
 }return created;
}
export function resolveProspective(d,world,asOf=Date.now()){
 ensureProspective(d);const events=eventsAsOf(d,world,asOf),changed=[];for(const f of d.prospective.filter(f=>f.world===world&&f.endAt<=asOf)){const observed=horizonLabel([],d.coverage,f.boss,world,f.at,f.endAt-f.at,asOf),label=horizonLabel(events,d.coverage,f.boss,world,f.at,f.endAt-f.at,asOf);if(observed.value!==0||label.value==null){if(f.y!=null){f.y=null;f.status='INVALIDADA';changed.push(f);}else f.status='COBERTURA_INSUFICIENTE';continue;}
  if(f.y!==label.value){if(f.y!=null){f.outcomeHistory||=[];f.outcomeHistory.push({y:f.y,resolvedAt:f.resolvedAt});f.correctedAt=asOf;}f.y=label.value;f.knownAt=Math.max(label.knownAt,observed.knownAt,asOf);f.resolvedAt=asOf;f.status='RESOLVIDA';changed.push(f);}}
 for(const p of d.policies.filter(p=>p.world===world&&['CANARY','PRODUCAO'].includes(p.status))){const rows=d.prospective.filter(f=>f.policyId===p.id&&f.at>=p.stageStartedAt&&f.status==='RESOLVIDA');if(changed.some(f=>f.policyId===p.id&&(f.correctedAt||f.status==='INVALIDADA'))){p.status='REVERTIDA';p.percentage=0;p.productionEligible=false;p.rollbackAt=asOf;p.rollbackReason='Correção/remoção invalidou evidência';continue;}if(rows.length>=20){const a=probabilityMetrics(rows,'baseline'),b=probabilityMetrics(rows,'signal');if(b.brier>a.brier*1.02||b.logLoss>a.logLoss*1.02||b.ece>.1){p.status='REVERTIDA';p.percentage=0;p.productionEligible=false;p.rollbackAt=asOf;p.rollbackReason='Regressão prospectiva';}}}
 return changed;
}
export function advancePolicy(d,id,at=Date.now()){
 ensureProspective(d);const p=d.policies.find(p=>p.id===id);if(!p)throw new Error('Política inexistente');const gates=d.policies.filter(x=>x.kind==='signal'&&x.world===p.world).map(x=>({id:x.id,test:recipeGate(d.prospective.filter(f=>f.policyId===x.id&&f.at>=x.stageStartedAt&&f.status==='RESOLVIDA'&&f.knownAt<=at))}));adjustFDR(gates,'test','BY');const gate=gates.find(g=>g.id===id).test;gate.passed&&=gate.q<=.05;p.lastGate=gate;if(!gate.passed)throw new Error(gate.reasons.join(' ')||'Controle de falsas descobertas rejeitou a promoção');
 if(p.status==='SHADOW_MODE'){p.status='CHALLENGER';p.qualityGateAt=at;}else if(p.status==='CHALLENGER'){p.status='CANARY';p.stage=0;p.percentage=5;p.stageStartedAt=at;}else if(p.status==='CANARY'){const stages=[5,20,50,100];if(p.stage===3){p.status='PRODUCAO';p.percentage=100;p.productionEligible=true;}else{p.stage++;p.percentage=stages[p.stage];p.stageStartedAt=at;}}else throw new Error('Etapa não promovível');d.governanceHistory.push({policyId:id,at,status:p.status,percentage:p.percentage,gate});return {id:p.id,status:p.status,percentage:p.percentage,gate};
}
export function governedSignal(d,world,boss,asOf,eventKey){
 ensureProspective(d);const policies=d.policies.filter(p=>p.kind==='signal'&&p.world===world&&p.boss===boss&&p.createdAt<=asOf).map(p=>{
 const historical=d.governanceHistory.filter(h=>h.policyId===p.id&&h.at<=asOf).at(-1);return historical?{...p,status:historical.status,percentage:historical.percentage}:{...p,status:'SHADOW_MODE',percentage:0};
 }).filter(p=>['CANARY','PRODUCAO'].includes(p.status)&&!(p.rollbackAt&&p.rollbackAt<=asOf));for(const p of policies){const selected=parseInt(digest({policyId:p.id,eventKey}).slice(0,8),16)%100<p.percentage;if(!selected)continue;const latest=d.prospective.filter(f=>f.policyId===p.id&&f.at<=asOf&&f.endAt>asOf).at(-1);if(!latest)continue;const ds=d.datasets[latest.datasetHash];if(!ds||digest({train:ds.train,pool:ds.pool,features:ds.features,recipe:ds.recipe})!==ds.hash)throw new Error('Dataset prospectivo alterado');return {probability:latest.signal,policyId:p.id,status:p.status,horizonHours:(latest.endAt-asOf)/3600000,windowStart:latest.at,windowEnd:latest.endAt,issuedAt:latest.at,expiresAt:latest.endAt,validated:true};}return null;
}

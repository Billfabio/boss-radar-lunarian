import {eventsAsOf,horizonLabel} from './canonical-events.mjs';
import {buildCases} from './signals.mjs';
import {fitTurnbull,intervalSamples,survivalForecast} from './survival.mjs';
import {clamp,probabilityMetrics} from './statistics.mjs';
const H=3600000,HORIZONS=[2,6,12,24,48,72],cache=new Map();
function rawAt(d,world,boss,asOf,hours){const events=eventsAsOf(d,world,asOf).filter(e=>e.boss===boss),last=events.at(-1);if(!last)return null;if(asOf>last.spawn.upper&&horizonLabel([],d.coverage,boss,world,last.spawn.upper,asOf-last.spawn.upper,asOf).value!==0)return null;const fit=fitTurnbull(intervalSamples(d,world,boss,asOf)),forecast=survivalForecast(fit,Math.max(0,(asOf-last.spawn.upper)/H),[hours]);return forecast.cumulative[0]?.probability??null;}
export function calibrateHorizon(d,world,boss,hours,asOf){
 const key=world+'|'+boss+'|'+hours+'|'+asOf+'|'+d.versions.length+'|'+d.coverage.length;let learned=cache.get(key);
 if(!learned){const cases=buildCases({...d,analysisAsOf:asOf},world,boss,hours),rows=[];for(const row of cases){if(row.knownAt>asOf)continue;const raw=rawAt(d,world,boss,row.at,hours);if(raw!=null)rows.push({...row,raw});}
  const cut=Math.floor(rows.length*.6),train=rows.slice(0,cut),holdout=rows.slice(cut),bins=Array.from({length:5},(_,bin)=>{const own=train.filter(r=>Math.min(4,Math.floor(r.raw*5))===bin);return {samples:own.length,p:own.length>=10?clamp((own.reduce((s,r)=>s+r.y,0)+1)/(own.length+2)):null};}),measured=holdout.filter(r=>bins[Math.min(4,Math.floor(r.raw*5))].p!=null).map(r=>({...r,p:bins[Math.min(4,Math.floor(r.raw*5))].p})),metrics=probabilityMetrics(measured,'p'),baseline=probabilityMetrics(measured,'raw');
  learned={bins,metrics,baseline,samples:rows.length,trainSamples:train.length,holdoutSamples:measured.length,passed:train.length>=30&&measured.length>=20&&metrics.ece<=.1&&metrics.brier<=baseline.brier&&metrics.logLoss<=baseline.logLoss};if(cache.size>=500)cache.clear();cache.set(key,learned);
 }
 const raw=rawAt(d,world,boss,asOf,hours),bin=raw==null?null:learned.bins[Math.min(4,Math.floor(raw*5))],eligible=learned.passed&&bin?.p!=null;
 return {hours,probability:eligible?bin.p:null,rawProbability:raw,status:eligible?'CALIBRADO':learned.samples<50?'AMOSTRA_INSUFICIENTE':'CALIBRACAO_REJEITADA',samples:learned.samples,trainSamples:learned.trainSamples,holdoutSamples:learned.holdoutSamples,metrics:learned.metrics,baseline:learned.baseline};
}
export function calibratedForecast(d,world,boss,asOf=Date.now()){
 const coverage=d.coverage.filter(c=>!c.candidateId&&c.verified&&c.world===world&&c.boss===boss&&c.knownAt<=asOf&&c.endAt<=asOf),latest=coverage.sort((a,b)=>b.endAt-a.endAt)[0];
 if(!latest||asOf-latest.endAt>15*60000)return {boss,world,asOf,status:'COBERTURA_DESATUALIZADA',horizons:[],bins:[],probability:null,productionEligible:false};
 const horizons=HORIZONS.map(h=>calibrateHorizon(d,world,boss,h,asOf)),six=horizons.find(h=>h.hours===6),all=horizons.every(h=>h.status==='CALIBRADO'),monotonic=all&&horizons.every((h,i)=>!i||h.probability>=horizons[i-1].probability);let previous=0;
 const bins=monotonic?horizons.map((h,i)=>{const probability=h.probability-previous;previous=h.probability;return {from:asOf+(i?HORIZONS[i-1]:0)*H,to:asOf+h.hours*H,probability};}):[];
 return {boss,world,asOf,status:monotonic?'DISTRIBUICAO_CALIBRADA':all?'MONOTONICIDADE_REJEITADA':'CALIBRACAO_PARCIAL',horizons,bins,remainingMass:monotonic?1-previous:null,probability:six?.probability??null,productionEligible:false,definition:'CDF condicional com censura, calibração por horizonte em holdout temporal; massa residual após 72h'};
}

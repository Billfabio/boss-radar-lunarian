import {eventsAsOf,horizonLabel} from './canonical-events.mjs';
const H=3600000;
export function intervalSamples(d,world,boss,asOf){
 const events=eventsAsOf(d,world,asOf).filter(e=>e.boss===boss),samples=[];
 for(let i=1;i<events.length;i++){const a=events[i-1],b=events[i];
  if(horizonLabel([],d.coverage,boss,world,a.spawn.upper,b.spawn.upper-a.spawn.upper,asOf).value!==0)continue;
  const lower=Math.max(0,(b.spawn.lower-a.spawn.upper)/H),upper=(b.spawn.upper-a.spawn.lower)/H;
  if(upper>0&&upper<=180*24)samples.push({lower,upper,knownAt:Math.max(a.availableAt,b.availableAt),eventId:b.id,censoring:lower===upper?'exact':'interval'});
 }
 const last=events.at(-1);if(last){const coverage=d.coverage.filter(c=>!c.candidateId&&c.verified&&c.world===world&&c.boss===boss&&c.knownAt<=asOf&&c.endAt>last.spawn.upper).sort((a,b)=>a.startAt-b.startAt);let through=last.spawn.upper;for(const c of coverage){if(c.startAt>through)break;through=Math.max(through,Math.min(asOf,c.endAt));}
  if(through>last.spawn.upper)samples.push({lower:(through-last.spawn.upper)/H,upper:null,knownAt:asOf,eventId:last.id,censoring:'right'});
 }
 return samples;
}
// Discrete nonparametric interval-censored likelihood, fitted by self-consistency EM.
// The support uses interval endpoints plus an explicit right-censored tail.
export function fitTurnbull(samples,{maxIterations=1000,tolerance=1e-9}={}){
 const rows=samples.filter(s=>Number.isFinite(s.lower)&&s.lower>=0&&(s.upper==null||Number.isFinite(s.upper)&&s.upper>=s.lower));
 if(rows.length<5)return {status:'AMOSTRA_INSUFICIENTE',samples:rows.length,support:[],masses:[]};
 const values=[...new Set(rows.flatMap(s=>s.upper==null?[s.lower]:[s.lower,s.upper]))].sort((a,b)=>a-b);
 // Exact observations and interval boundaries are retained; a tail cell handles right censoring.
 const support=[...values,null],membership=rows.map(s=>support.map((t,j)=>s.upper==null?(t==null||t>s.lower):s.lower===s.upper?t===s.upper:t!=null&&t>s.lower&&t<=s.upper));
 const usable=support.map((_,j)=>membership.some(m=>m[j]));let masses=support.map((_,j)=>usable[j]?1/usable.filter(Boolean).length:0),logLikelihood=-Infinity,iterations=0,converged=false;
 for(;iterations<maxIterations;iterations++){const totals=membership.map(m=>m.reduce((n,on,j)=>n+(on?masses[j]:0),0));if(totals.some(t=>t<=0))return {status:'SUPORTE_INCOMPATIVEL',samples:rows.length,support:[],masses:[]};
  const next=masses.map((p,j)=>p*membership.reduce((n,m,i)=>n+(m[j]?1/totals[i]:0),0)/rows.length),delta=Math.max(...next.map((p,j)=>Math.abs(p-masses[j])));masses=next;
  const likelihood=membership.reduce((n,m)=>n+Math.log(m.reduce((s,on,j)=>s+(on?masses[j]:0),0)),0);if(likelihood+1e-8<logLikelihood)throw new Error('Likelihood de sobrevivência regrediu');logLikelihood=likelihood;
  if(delta<tolerance){converged=true;iterations++;break;}
 }
 return {status:converged?'AJUSTADO':'NAO_CONVERGIU',samples:rows.length,support,masses,iterations,logLikelihood,exact:rows.filter(s=>s.lower===s.upper).length,intervalCensored:rows.filter(s=>s.upper!=null&&s.lower<s.upper).length,rightCensored:rows.filter(s=>s.upper==null).length,version:'turnbull-discrete-1'};
}
export function survivalForecast(fit,elapsedHours,horizons=[2,6,12,24,48,72]){
 if(fit.status!=='AJUSTADO')return {status:fit.status,cumulative:[],bins:[],remainingMass:null};
 const remaining=fit.support.reduce((n,t,j)=>n+(t==null||t>elapsedHours?fit.masses[j]:0),0);if(remaining<1e-8)return {status:'CAUDA_INSUFICIENTE',cumulative:[],bins:[],remainingMass:null};
 const cumulative=horizons.map(hours=>({hours,probability:fit.support.reduce((n,t,j)=>n+(t!=null&&t>elapsedHours&&t<=elapsedHours+hours?fit.masses[j]:0),0)/remaining}));let previous=0;
 const bins=cumulative.map((p,i)=>{const probability=Math.max(0,p.probability-previous);previous=p.probability;return {fromHours:i?horizons[i-1]:0,toHours:p.hours,probability};});
 return {status:'EXPERIMENTAL_NAO_CALIBRADO',cumulative,bins,remainingMass:Math.max(0,1-previous),conditionalOn:'nenhum novo spawn até o landmark observado',samples:fit.samples,censoring:{exact:fit.exact,interval:fit.intervalCensored,right:fit.rightCensored}};
}
export function survivalForBoss(d,world,boss,asOf){const events=eventsAsOf(d,world,asOf).filter(e=>e.boss===boss),last=events.at(-1),fit=fitTurnbull(intervalSamples(d,world,boss,asOf));return {boss,world,asOf,fit,forecast:last?survivalForecast(fit,Math.max(0,(asOf-last.spawn.upper)/H)):{status:'AMOSTRA_INSUFICIENTE',cumulative:[],bins:[]}};}

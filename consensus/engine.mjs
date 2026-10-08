import {independenceKeys} from './independence.mjs';
const clamp=(n,a=0,b=1)=>Math.max(a,Math.min(b,n));
const median=a=>{if(!a.length)return null;const s=[...a].sort((x,y)=>x-y),m=Math.floor(s.length/2);return s.length%2?s[m]:(s[m-1]+s[m])/2;};
function weightedMedian(rows){
 const sorted=[...rows].sort((a,b)=>a.value-b.value),total=sorted.reduce((n,x)=>n+x.weight,0);let c=0;
 for(const x of sorted){c+=x.weight;if(c>=total/2)return x.value;}return sorted.at(-1)?.value??null;
}
export function consensusForEvidence(evidence=[],sources={}){
 const usable=evidence.filter(x=>sources[x.sourceId]?.active!==false&&(!x.quality||['CONFIRMADO','PROVÁVEL'].includes(x.quality.status))&&!x.anomaly);
 if(!usable.length)return {status:'SUSPEITO',centerAt:null,confidence:0,sourceCount:0,confirmations:0,conflict:false,confirmingSources:[]};
 const contributions=new Map(),groups=independenceKeys(usable,sources);for(const x of usable){const key=groups.get(x),weight=(sources[x.sourceId]?.effectiveWeight??sources[x.sourceId]?.baseWeight??.5)*((x.quality?.score??50)/100)*x.confidence,old=contributions.get(key);if(!old||weight>old.weight)contributions.set(key,{x,value:x.estimatedAt,weight});}
 const rows=[...contributions.values()],independentSourceCount=rows.length;
 const centerAt=Math.round(weightedMedian(rows)),sourceIds=[...new Set(usable.map(x=>x.sourceId))];
 const precise=usable.filter(x=>['minute','hour'].includes(x.precision)),spread=precise.length>=2?Math.max(...precise.map(x=>x.estimatedAt))-Math.min(...precise.map(x=>x.estimatedAt)):0;
 const rangesOverlap=Math.max(...usable.map(x=>x.startAt))<=Math.min(...usable.map(x=>x.endAt));
 const minuteOnly=precise.length>=2&&precise.every(x=>x.precision==='minute'),preciseConflictThreshold=minuteOnly?45*60000:90*60000;
 const conflict=precise.length>=2?spread>preciseConflictThreshold:(!rangesOverlap&&sourceIds.length>=2);
 const deviations=rows.map(r=>Math.abs(r.value-centerAt)),mad=median(deviations)||0,agreement=clamp(1-mad/(6*3600000));
 const evidenceStrength=1-Math.exp(-independentSourceCount/2),quality=rows.reduce((n,r)=>n+(r.x.quality?.score??50),0)/rows.length/100;
 const confidence=conflict?Math.min(.45,quality*.5):clamp(.18+.32*evidenceStrength+.28*agreement+.22*quality);
 let status='AGUARDANDO_CONFIRMAÇÃO';
 if(conflict)status='CONFLITANTE';
 else if(independentSourceCount>=2&&confidence>=.82)status='CONFIRMADO';
 else if(confidence>=.62)status='PROVÁVEL';
 return {status,centerAt,confidence,sourceCount:sourceIds.length,independentSourceCount,confirmations:usable.length,conflict,spreadMs:spread,conflictThresholdMs:precise.length>=2?preciseConflictThreshold:null,agreement:Math.round(agreement*100),confirmingSources:sourceIds};
}

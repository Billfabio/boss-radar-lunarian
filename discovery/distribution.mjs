import {median} from './statistics.mjs';
export function spawnDistribution(events,boss,asOf){
 const own=events.filter(e=>e.boss===boss).sort((a,b)=>a.spawn.estimate-b.spawn.estimate),last=own.at(-1),intervals=[];
 for(let i=1;i<own.length;i++){const a=own[i-1].spawn,b=own[i].spawn,lower=Math.max(0,b.lower-a.upper),upper=b.upper-a.lower;if(upper>0&&upper<180*86400000)intervals.push({lower,upper});}
 if(!last||intervals.length<10)return {status:'AMOSTRA_INSUFICIENTE',bins:[],samples:intervals.length};
 const elapsed=Math.max(0,asOf-last.spawn.estimate),possible=intervals.filter(i=>i.upper>elapsed),definite=intervals.filter(i=>i.lower>elapsed);
 if(definite.length<5)return {status:'CAUDA_INSUFICIENTE',bins:[],samples:intervals.length};
 const cumulative=[];for(let hours=0;hours<=72;hours+=6){const end=elapsed+hours*3600000,lower=possible.filter(i=>i.lower>elapsed&&i.upper<=end).length/possible.length,upper=Math.min(1,possible.filter(i=>i.upper>elapsed&&i.lower<=end).length/definite.length);cumulative.push({hours,lower,upper:hours===0?0:upper});}
 const bins=cumulative.slice(1).map((p,i)=>({from:asOf+cumulative[i].hours*3600000,to:asOf+p.hours*3600000,massLower:Math.max(0,p.lower-cumulative[i].upper),massUpper:Math.min(1,Math.max(0,p.upper-cumulative[i].lower))}));
 return {status:'EXPERIMENTAL_NAO_CALIBRADO',samples:intervals.length,bins,cumulative,medianIntervalHours:median(intervals.map(i=>(i.lower+i.upper)/2/3600000)),reason:'Limites empíricos com censura de intervalo, condicionais à ausência de novo spawn conhecido; não são probabilidades calibradas nem garantem soma de massas igual a 1.'};
}

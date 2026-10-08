import {eventsAsOf} from './canonical-events.mjs';
import {mean,median,adjustFDR} from './statistics.mjs';
import {intervalSamples} from './survival.mjs';
const H=3600000;
function rankP(a,b){const rows=[...a.map(v=>({v,g:0})),...b.map(v=>({v,g:1}))].sort((a,b)=>a.v-b.v);let rankSum=0,ties=0;
 for(let i=0;i<rows.length;){let j=i+1;while(j<rows.length&&rows[j].v===rows[i].v)j++;const rank=(i+1+j)/2;for(let k=i;k<j;k++)if(rows[k].g===0)rankSum+=rank;ties+=(j-i)**3-(j-i);i=j;}
 const n=a.length,m=b.length,N=n+m,U=rankSum-n*(n+1)/2,variance=n*m/12*((N+1)-ties/(N*(N-1)));if(variance<=0)return 1;
 const z=Math.max(0,(Math.abs(U-n*m/2)-.5)/Math.sqrt(variance)),t=1/(1+.2316419*z),normalTail=Math.exp(-z*z/2)/Math.sqrt(2*Math.PI)*(t*.319381530+t*t*-.356563782+t**3*1.781477937+t**4*-1.821255978+t**5*1.330274429);return Math.min(1,2*normalTail);
}
export function detectBreakpoints(d,world,asOf){
 const events=eventsAsOf(d,world,asOf),attempts=[];
 for(const boss of [...new Set(events.map(e=>e.boss))]){const supported=intervalSamples(d,world,boss,asOf).filter(s=>s.censoring==='exact'),intervals=supported.map(s=>({value:s.upper,at:events.find(e=>e.id===s.eventId)?.spawn.estimate})).filter(x=>x.value>0&&x.value<4320&&x.at);
  for(let i=20;i<=intervals.length-20;i++){const before=intervals.slice(i-20,i).map(x=>x.value),after=intervals.slice(i,i+20).map(x=>x.value),a=median(before),b=median(after),change=a?(b-a)/a:0;
   attempts.push({id:world+'|'+boss+'|'+intervals[i].at,boss,world,breakAt:intervals[i].at,detectedAt:asOf,samplesBefore:20,samplesAfter:20,medianBeforeHours:a,medianAfterHours:b,meanBeforeHours:mean(before),meanAfterHours:mean(after),relativeChange:change,test:{p:Math.abs(change)>=.2?rankP(before,after):1},productionEligible:false});
  }
 }
 adjustFDR(attempts,'test','BY');const approved=attempts.filter(x=>x.test.q<=.05).sort((a,b)=>a.test.q-b.test.q),selected=[];
 for(const point of approved){if(selected.some(x=>x.boss===point.boss&&Math.abs(x.breakAt-point.breakAt)<30*24*H))continue;const context=d.context.filter(c=>c.world===world&&c.knownAt<=asOf&&Math.abs(c.startAt-point.breakAt)<=7*24*H),publications=(d.publications||[]).filter(p=>p.availableAt<=asOf&&Math.abs((p.publishedAt||p.publishedLower||p.availableAt)-point.breakAt)<=7*24*H);selected.push({...point,status:'REGIME_CANDIDATO',relatedContext:context.map(c=>({id:c.id,type:c.type,startAt:c.startAt})),relatedPublications:publications.map(p=>({id:p.id,title:p.title,verifiedExecution:false})),causalityProven:false});}
 return {world,asOf,status:attempts.length?'ANALISADO':'AMOSTRA_INSUFICIENTE',hypotheses:attempts.length,breakpoints:selected};
}
export function clusterBosses(d,world,asOf){
 const events=eventsAsOf(d,world,asOf),rows=[];
 for(const boss of [...new Set(events.map(e=>e.boss))]){const own=events.filter(e=>e.boss===boss&&e.spawn.lower===e.spawn.upper),ints=intervalSamples(d,world,boss,asOf).filter(s=>s.censoring==='exact').map(s=>s.upper).filter(v=>v>0&&v<4320);if(ints.length<8)continue;const average=mean(ints),cv=Math.sqrt(mean(ints.map(v=>(v-average)**2)))/average,hours=own.map(e=>((e.spawn.estimate/H)-3)%24),x=mean(hours.map(h=>Math.cos(h/24*2*Math.PI))),y=mean(hours.map(h=>Math.sin(h/24*2*Math.PI))),concentration=Math.sqrt(x*x+y*y);rows.push({boss,samples:own.length,medianHours:median(ints),variability:cv,hourConcentration:concentration,vector:[Math.log1p(median(ints)),cv,concentration]});}
 if(rows.length<3)return {world,asOf,status:'AMOSTRA_INSUFICIENTE',clusters:[],bosses:rows.map(r=>({...r,cluster:null}))};
 const centers=[0,1,2].map(j=>mean(rows.map(r=>r.vector[j]))),scales=centers.map((m,j)=>Math.sqrt(mean(rows.map(r=>(r.vector[j]-m)**2)))||1),vectors=rows.map(r=>r.vector.map((v,j)=>(v-centers[j])/scales[j])),dist=(a,b)=>a.reduce((n,v,j)=>n+(v-b[j])**2,0),k=Math.min(4,Math.max(2,Math.floor(Math.sqrt(rows.length)))),medoids=[0];
 while(medoids.length<k){let best=-1,score=-1;vectors.forEach((v,i)=>{if(medoids.includes(i))return;const s=Math.min(...medoids.map(j=>dist(v,vectors[j])));if(s>score){score=s;best=i;}});medoids.push(best);}
 let assignments=[];for(let iteration=0;iteration<20;iteration++){assignments=vectors.map(v=>medoids.map((i,g)=>({g,d:dist(v,vectors[i])})).sort((a,b)=>a.d-b.d||a.g-b.g)[0].g);let changed=false;
  for(let g=0;g<k;g++){const members=assignments.map((a,i)=>a===g?i:-1).filter(i=>i>=0);if(!members.length)continue;const best=members.map(i=>({i,total:members.reduce((n,j)=>n+dist(vectors[i],vectors[j]),0)})).sort((a,b)=>a.total-b.total||a.i-b.i)[0].i;if(best!==medoids[g]){medoids[g]=best;changed=true;}}if(!changed)break;
 }
 return {world,asOf,status:'DESCRITIVO',method:'deterministic standardized k-medoids',productionEligible:false,bosses:rows.map((r,i)=>({...r,cluster:'C'+assignments[i]})),clusters:medoids.map((m,g)=>({id:'C'+g,representative:rows[m].boss,members:rows.filter((r,i)=>assignments[i]===g).map(r=>r.boss),medianHours:rows[m].medianHours,variability:rows[m].variability,hourConcentration:rows[m].hourConcentration}))};
}

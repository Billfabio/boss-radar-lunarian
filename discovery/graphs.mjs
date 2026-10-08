import {horizonLabel} from './canonical-events.mjs';
import {mean,median,wilson,adjustFDR} from './statistics.mjs';
const H=3600000,DAY=24*H;
const WINDOWS=[[0,1],[1,3],[3,6],[6,12],[12,24],[24,48],[48,72]];
const quantile=(a,q)=>{if(!a.length)return null;const s=[...a].sort((x,y)=>x-y),p=(s.length-1)*q,i=Math.floor(p),f=p-i;return s[i]+(s[Math.min(i+1,s.length-1)]-s[i])*f;};
const erf=x=>{const sign=x<0?-1:1,a=Math.abs(x),t=1/(1+.3275911*a),y=1-(((((1.061405429*t-1.453152027)*t+1.421413741)*t-.284496736)*t+.254829592)*t)*Math.exp(-a*a);return sign*y;};
const normalCdf=z=>(1+erf(z/Math.SQRT2))/2;
function twoProportionP(k1,n1,k0,n0){
 if(!n1||!n0)return 1;const p1=k1/n1,p0=k0/n0,pooled=(k1+k0)/(n1+n0),se=Math.sqrt(Math.max(0,pooled*(1-pooled)*(1/n1+1/n0)));if(!se)return p1===p0?1:0;return Math.min(1,2*(1-normalCdf(Math.abs((p1-p0)/se))));
}
function observedLabel(events,coverage,boss,world,start,end,asOf){
 if(end>asOf)return null;const observed=horizonLabel([],coverage,boss,world,start,end-start,asOf);if(observed.value!==0)return null;const label=horizonLabel(events,coverage,boss,world,start,end-start,asOf);return label.value==null?null:label.value;
}
function baselineWindows(events,coverage,boss,world,asOf,durationMs){
 const relevant=events.filter(e=>e.world===world),first=relevant[0]?.spawn?.lower,last=Math.min(asOf,relevant.at(-1)?.spawn?.upper??asOf);if(!Number.isFinite(first)||last-first<durationMs)return [];
 const maxWindows=1000,total=Math.floor((last-first)/durationMs),stride=Math.max(1,Math.ceil(total/maxWindows)),rows=[];
 for(let i=0;i<total;i+=stride){const start=first+i*durationMs,end=start+durationMs,label=observedLabel(events,coverage,boss,world,start,end,asOf);if(label!=null)rows.push({at:start,y:label});}
 return rows;
}
function relationshipWindow(events,coverage,anchors,to,world,asOf,lo,hi,baselineCache){
 const duration=(hi-lo)*H,labels=[],delays=[],occurrenceIds=[];
 for(const a of anchors){const start=a.spawn.estimate+lo*H,end=a.spawn.estimate+hi*H,label=observedLabel(events,coverage,to,world,start,end,asOf);if(label==null)continue;labels.push({at:a.spawn.estimate,y:label,id:a.id});if(label){const b=events.find(e=>e.boss===to&&e.world===world&&e.spawn.lower>start&&e.spawn.upper<=end);if(b){delays.push((b.spawn.estimate-a.spawn.estimate)/H);occurrenceIds.push(b.id);}}}
 const key=to+'|'+duration,baseline=baselineCache.get(key)||baselineWindows(events,coverage,to,world,asOf,duration);baselineCache.set(key,baseline);
 const k=labels.filter(x=>x.y===1).length,n=labels.length,bk=baseline.filter(x=>x.y===1).length,bn=baseline.length,conditional=n?k/n:null,base=bn?bk/bn:null,lift=conditional!=null&&base>0?conditional/base:null,p=conditional!=null&&base!=null?twoProportionP(k,n,bk,bn):1;
 const recentCut=asOf-90*DAY,recent=labels.filter(x=>x.at>=recentCut),older=labels.filter(x=>x.at<recentCut),rp=recent.length?mean(recent.map(x=>x.y)):null,op=older.length?mean(older.map(x=>x.y)):null,drift=recent.length>=10&&older.length>=10&&op!=null?Math.abs(rp-op):null;
 return {fromHours:lo,toHours:hi,samples:n,occurrences:k,baselineSamples:bn,baselineOccurrences:bk,conditionalProbability:conditional,baselineProbability:base,lift,ci95:n?wilson(k,n):null,baselineCi95:bn?wilson(bk,bn):null,test:{p,q:null},direction:conditional==null||base==null?'UNKNOWN':conditional>base?'POSITIVE':conditional<base?'NEGATIVE':'NEUTRAL',delayHours:{p25:quantile(delays,.25),median:median(delays),p75:quantile(delays,.75),mean:mean(delays)},recentStrength:rp,previousStrength:op,driftScore:drift,relationshipDrift:drift!=null&&drift>=.2,anchorIds:labels.map(x=>x.id).filter(Boolean).slice(0,200),occurrenceIds:[...new Set(occurrenceIds)].slice(0,200)};
}
function sequenceMining(events){
 const exact=events.filter(e=>e.spawn.lower===e.spawn.upper).sort((a,b)=>a.spawn.estimate-b.spawn.estimate),pairs=new Map(),triples=new Map(),fromCounts=new Map(),targetCounts=new Map();let transitions=0;
 for(let i=1;i<exact.length;i++){const a=exact[i-1],b=exact[i],delay=(b.spawn.estimate-a.spawn.estimate)/H;if(delay<=0||delay>72)continue;transitions++;fromCounts.set(a.boss,(fromCounts.get(a.boss)||0)+1);targetCounts.set(b.boss,(targetCounts.get(b.boss)||0)+1);const key=a.boss+' → '+b.boss,row=pairs.get(key)||{pattern:key,bosses:[a.boss,b.boss],occurrences:0,delays:[]};row.occurrences++;row.delays.push(delay);pairs.set(key,row);}
 for(let i=2;i<exact.length;i++){const a=exact[i-2],b=exact[i-1],c=exact[i],d1=(b.spawn.estimate-a.spawn.estimate)/H,d2=(c.spawn.estimate-b.spawn.estimate)/H,span=d1+d2;if(d1<=0||d2<=0||d1>72||d2>72||span>72)continue;const key=[a.boss,b.boss,c.boss].join(' → '),row=triples.get(key)||{pattern:key,bosses:[a.boss,b.boss,c.boss],occurrences:0,delays1:[],delays2:[]};row.occurrences++;row.delays1.push(d1);row.delays2.push(d2);triples.set(key,row);}
 const rows=[];
 for(const x of pairs.values()){const [a,b]=x.bosses,n=fromCounts.get(a)||0,bgN=Math.max(0,transitions-n),bgK=Math.max(0,(targetCounts.get(b)||0)-x.occurrences),conditional=n?x.occurrences/n:null,baseline=bgN?bgK/bgN:null,lift=conditional!=null&&baseline>0?conditional/baseline:null,p=baseline==null?1:twoProportionP(x.occurrences,n,bgK,bgN);rows.push({...x,kind:'PAIR',samples:n,baselineSamples:bgN,probability:conditional,baselineProbability:baseline,lift,ci95:n?wilson(x.occurrences,n):null,test:{p,q:null},intervalHours:{p25:quantile(x.delays,.25),median:median(x.delays),p75:quantile(x.delays,.75)},productionEligible:false,causalityProven:false,delays:undefined});}
 for(const x of triples.values()){const [a,b,c]=x.bosses,prefix=pairs.get(a+' → '+b),bc=pairs.get(b+' → '+c),n=prefix?.occurrences||0,bTotal=fromCounts.get(b)||0,bgN=Math.max(0,bTotal-n),bgK=Math.max(0,(bc?.occurrences||0)-x.occurrences),conditional=n?x.occurrences/n:null,baseline=bgN?bgK/bgN:(transitions?(targetCounts.get(c)||0)/transitions:null),lift=conditional!=null&&baseline>0?conditional/baseline:null,p=bgN?twoProportionP(x.occurrences,n,bgK,bgN):1;rows.push({...x,kind:'TRIPLE',samples:n,baselineSamples:bgN,probability:conditional,baselineProbability:baseline,lift,ci95:n?wilson(x.occurrences,n):null,test:{p,q:null},interval1Hours:{p25:quantile(x.delays1,.25),median:median(x.delays1),p75:quantile(x.delays1,.75)},interval2Hours:{p25:quantile(x.delays2,.25),median:median(x.delays2),p75:quantile(x.delays2,.75)},productionEligible:false,causalityProven:false,delays1:undefined,delays2:undefined});}
 adjustFDR(rows,'test','BY');
 for(const x of rows){const min=x.kind==='PAIR'?10:8,enough=x.occurrences>=min&&x.samples>=20&&x.baselineSamples>=20,material=x.lift!=null&&(x.lift>=1.5||x.lift<=.67),significant=x.test.q!=null&&x.test.q<=.05;x.status=!enough?'INSUFFICIENT_SAMPLE':significant&&material?'DISCOVERED':'REJECTED';x.confidence=x.status==='DISCOVERED'?Math.max(0,Math.min(1,1-x.test.q)):null;x.note='Sequência temporal exploratória; baseline contrastivo e FDR não demonstram causalidade.';}
 return rows.sort((a,b)=>(a.status==='DISCOVERED'?0:1)-(b.status==='DISCOVERED'?0:1)||b.occurrences-a.occurrences).slice(0,500);
}
export function bossGraph(events,coverage,experiments,world,asOf){
 const allBosses=[...new Set(events.filter(e=>e.world===world).map(e=>e.boss))],counts=new Map(allBosses.map(b=>[b,events.filter(e=>e.world===world&&e.boss===b&&e.spawn.lower===e.spawn.upper).length])),bosses=allBosses.filter(b=>(counts.get(b)||0)>=5).sort((a,b)=>(counts.get(b)||0)-(counts.get(a)||0)).slice(0,60),edges=[],tests=[],baselineCache=new Map();
 if(!bosses.length)return {nodes:allBosses,edges:[],sequences:sequenceMining(events),status:'insufficient_sample',numberOfTests:0,analyzedBosses:0,skippedBosses:allBosses.length,note:'Nenhum boss possui cinco aparições exatas para análise relacional.'};
 for(const from of bosses)for(const to of bosses){if(from===to)continue;const anchors=events.filter(e=>e.world===world&&e.boss===from&&e.spawn.lower===e.spawn.upper),influence=[];
  for(const [lo,hi] of WINDOWS){const row=relationshipWindow(events,coverage,anchors,to,world,asOf,lo,hi,baselineCache);influence.push(row);if(row.samples>=10&&row.baselineSamples>=20)tests.push({from,to,row,test:row.test});}
  edges.push({from,to,windows:influence,productionEligible:false,causalityProven:false,status:'TESTED'});
 }
 adjustFDR(tests,'test','BY');
 for(const edge of edges){for(const w of edge.windows){const enough=w.samples>=20&&w.baselineSamples>=30&&w.occurrences>=5,material=w.lift!=null&&(w.lift>=1.5||w.lift<=.67),significant=w.test.q!=null&&w.test.q<=.05;w.status=!enough?'INSUFFICIENT_SAMPLE':significant&&material?'CANDIDATE_RELATIONSHIP':'REJECTED';w.confidence=w.status==='CANDIDATE_RELATIONSHIP'?Math.max(0,Math.min(1,1-w.test.q)):null;w.qualityScore=w.status==='CANDIDATE_RELATIONSHIP'?Math.round(100*Math.min(1,(w.samples/100))*Math.min(1,Math.abs(Math.log(Math.max(.01,w.lift)))/Math.log(3))*Math.max(.25,1-(w.driftScore||0))):0;}
  const candidates=edge.windows.filter(w=>w.status==='CANDIDATE_RELATIONSHIP');edge.status=candidates.length?'CANDIDATE_RELATIONSHIP':edge.windows.some(w=>w.status==='REJECTED')?'REJECTED':'INSUFFICIENT_SAMPLE';edge.bestWindow=candidates.sort((a,b)=>b.qualityScore-a.qualityScore)[0]||null;
  const exp=experiments.filter(e=>e.world===world&&e.boss===edge.to&&e.signal==='after:'+edge.from).at(-1);edge.predictiveValueProven=exp?.status==='SHADOW_MODE';edge.experimentId=exp?.id??null;
 }
 return {nodes:allBosses,analyzedBosses:bosses.length,skippedBosses:Math.max(0,allBosses.length-bosses.length),edges:edges.filter(e=>e.status!=='INSUFFICIENT_SAMPLE'||e.windows.some(w=>w.occurrences)),sequences:sequenceMining(events),status:'statistical_association_only',numberOfTests:tests.length,falseDiscoveryMethod:'Benjamini-Yekutieli',windows:WINDOWS,note:'Associações temporais não implicam causalidade. Relações candidatas ainda exigem experimento temporal e Shadow.'};
}
export function sourceGraph(events){
 const pairs=new Map(),latencies=new Map();
 for(const e of events){const perSource=new Map();for(const x of e.evidence){const earlier=perSource.get(x.sourceId);if(!earlier||(x.publishedAt??Infinity)<(earlier.publishedAt??Infinity))perSource.set(x.sourceId,x);}
  const rows=[...perSource.values()];const detections=new Map();for(const evidence of e.evidence){if(!Number.isFinite(evidence.detectedAt))continue;const previous=detections.get(evidence.sourceId);if(!previous||evidence.detectedAt<previous.detectedAt)detections.set(evidence.sourceId,evidence);}
  for(const x of detections.values()){if(Number.isFinite(x.detectedAt)&&e.spawn.lower===e.spawn.upper&&x.detectedAt>=e.spawn.upper){const a=latencies.get(x.sourceId)||[];a.push((x.detectedAt-e.spawn.estimate)/60000);latencies.set(x.sourceId,a);}}
  for(const a of rows)for(const b of rows){if(a.sourceId===b.sourceId||!Number.isFinite(a.publishedAt)||!Number.isFinite(b.publishedAt)||b.publishedAt<=a.publishedAt)continue;
   const key=a.sourceId+'|'+b.sourceId,p=pairs.get(key)||{from:a.sourceId,to:b.sourceId,samples:0,matches:0,lags:[]};p.samples++;if(a.payloadHash&&a.payloadHash===b.payloadHash){p.matches++;p.lags.push((b.publishedAt-a.publishedAt)/60000);}pairs.set(key,p);}
 }
 return {nodes:[...new Set(events.flatMap(e=>e.evidence.map(x=>x.sourceId)))],edges:[...pairs.values()].map(p=>{const rate=p.samples?p.matches/p.samples:0,confidence=p.samples>=30?Math.min(1,p.samples/100)*rate:null;return {from:p.from,to:p.to,samples:p.samples,matches:p.matches,copyEvidenceRate:rate,meanLagMinutes:mean(p.lags),medianLagMinutes:median(p.lags),confidence,status:p.samples>=30&&rate>=.95?'DEPENDENCIA_SUSPEITA':p.samples>=30?'REJECTED':'INSUFFICIENT_SAMPLE',weightApplied:false,reason:'Ordem de publicação e conteúdo idêntico sugerem dependência; não comprovam cópia nem direção causal.'};}),latencies:[...latencies].map(([sourceId,rows])=>({sourceId,samples:rows.length,meanMinutes:mean(rows),medianMinutes:median(rows)}))};
}

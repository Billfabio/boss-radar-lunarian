import {horizonLabel} from './canonical-events.mjs';
import {mean,median,wilson} from './statistics.mjs';
export function bossGraph(events,coverage,experiments,world,asOf){
 const bosses=[...new Set(events.map(e=>e.boss))],edges=[],windows=[[0,2],[2,6],[6,12],[12,24]];
 if(bosses.length>100)return {nodes:bosses,edges:[],status:'limite de 100 bosses; segmente a análise'};
 for(const from of bosses)for(const to of bosses){if(from===to)continue;
  const anchors=events.filter(e=>e.boss===from&&e.spawn.lower===e.spawn.upper),influence=[];
  for(const [lo,hi] of windows){const labels=[],intervals=[],occurrencesAt=[];for(const a of anchors){const start=a.spawn.estimate+lo*3600000,end=a.spawn.estimate+hi*3600000;
    // Only windows fully observable count in the denominator.
    const observed=horizonLabel([],coverage,to,world,start,end-start,asOf);if(observed.value!==0)continue;const label=horizonLabel(events,coverage,to,world,start,end-start,asOf);if(label.value==null)continue;labels.push(label.value);if(label.value){const b=events.find(e=>e.boss===to&&e.spawn.lower>start&&e.spawn.upper<=end);if(b){intervals.push((b.spawn.estimate-a.spawn.estimate)/3600000);occurrencesAt.push(b.spawn.estimate);}}}
   influence.push({fromHours:lo,toHours:hi,samples:labels.length,occurrences:labels.filter(Boolean).length,probability:labels.length>=20?mean(labels):null,ci95:labels.length>=20?wilson(labels.filter(Boolean).length,labels.length):null,meanIntervalHours:mean(intervals),medianIntervalHours:median(intervals),lastOccurrence:occurrencesAt.length?Math.max(...occurrencesAt):null});
  }
  if(influence.some(w=>w.occurrences)){const exp=experiments.filter(e=>e.world===world&&e.boss===to&&e.signal==='after:'+from).at(-1);edges.push({from,to,windows:influence,lastOccurrence:Math.max(...influence.map(w=>w.lastOccurrence||0))||null,predictiveValueProven:exp?.status==='SHADOW_MODE',experimentId:exp?.id??null,productionEligible:false,status:influence.some(w=>w.samples>=20)?'DESCRITIVO':'AMOSTRA_INSUFICIENTE'});}
 }
 const sequences=new Map();for(let i=2;i<events.length;i++){const triple=events.slice(i-2,i+1);if(triple[2].spawn.upper-triple[0].spawn.lower>24*3600000||triple[0].spawn.upper>=triple[1].spawn.lower||triple[1].spawn.upper>=triple[2].spawn.lower)continue;const key=triple.map(e=>e.boss).join(' → ');sequences.set(key,(sequences.get(key)||0)+1);}
 return {nodes:bosses,edges,sequences:[...sequences].map(([pattern,occurrences])=>({pattern,occurrences,status:occurrences>=20?'DESCOBERTA':'AMOSTRA_INSUFICIENTE',productionEligible:false})),status:'descriptive_only'};
}
export function sourceGraph(events){
 const pairs=new Map(),latencies=new Map();
 for(const e of events){const perSource=new Map();for(const x of e.evidence){const earlier=perSource.get(x.sourceId);if(!earlier||(x.publishedAt??Infinity)<(earlier.publishedAt??Infinity))perSource.set(x.sourceId,x);}
  const rows=[...perSource.values()];const detections=new Map();for(const evidence of e.evidence){if(!Number.isFinite(evidence.detectedAt))continue;const previous=detections.get(evidence.sourceId);if(!previous||evidence.detectedAt<previous.detectedAt)detections.set(evidence.sourceId,evidence);}
  for(const x of detections.values()){if(Number.isFinite(x.detectedAt)&&e.spawn.lower===e.spawn.upper&&x.detectedAt>=e.spawn.upper){const a=latencies.get(x.sourceId)||[];a.push((x.detectedAt-e.spawn.estimate)/60000);latencies.set(x.sourceId,a);}}
  for(const a of rows)for(const b of rows){if(a.sourceId===b.sourceId||!Number.isFinite(a.publishedAt)||!Number.isFinite(b.publishedAt)||b.publishedAt<=a.publishedAt)continue;
   const key=a.sourceId+'|'+b.sourceId,p=pairs.get(key)||{from:a.sourceId,to:b.sourceId,samples:0,matches:0,lags:[]};p.samples++;if(a.payloadHash&&a.payloadHash===b.payloadHash){p.matches++;p.lags.push((b.publishedAt-a.publishedAt)/60000);}pairs.set(key,p);}
 }
 return {nodes:[...new Set(events.flatMap(e=>e.evidence.map(x=>x.sourceId)))],edges:[...pairs.values()].map(p=>({from:p.from,to:p.to,samples:p.samples,matches:p.matches,copyEvidenceRate:p.matches/p.samples,meanLagMinutes:mean(p.lags),medianLagMinutes:median(p.lags),status:p.samples>=30&&p.matches/p.samples>=.95?'DEPENDENCIA_SUSPEITA':'AMOSTRA_INSUFICIENTE',weightApplied:false,reason:'Ordem de publicação e conteúdo idêntico sugerem dependência; não comprovam cópia nem direção causal.'})),latencies:[...latencies].map(([sourceId,rows])=>({sourceId,samples:rows.length,meanMinutes:mean(rows),medianMinutes:median(rows)}))};
}

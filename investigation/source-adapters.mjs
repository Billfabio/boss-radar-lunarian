import {SOURCE_DEFINITIONS} from '../sources/registry.mjs';
import {freshnessScore,investigationDigest} from './evidence.mjs';

const clamp=(n,a=0,b=1)=>Math.max(a,Math.min(b,n));
export function sourceHealth(source,now=Date.now()){
 if(!source||source.active===false)return 'OFFLINE';
 if(source.circuitState==='OPEN')return source.circuitReason==='technical'?'ERROR':'DEGRADED';
 if(source.circuitState==='HALF_OPEN')return 'DEGRADED';
 if((source.consecutiveFailures||0)>=2)return 'DEGRADED';
 if(source.lastSuccess&&now-source.lastSuccess>30*60000)return 'STALE';
 return 'HEALTHY';
}
function publicSource(snapshot,id){return (snapshot?.sources||[]).find(x=>x.id===id)||null;}
export function adapterFor(id,snapshot,now=Date.now()){
 const source=publicSource(snapshot,id),definition=SOURCE_DEFINITIONS[id]||{},health=sourceHealth(source||definition,now);
 return {
  id,name:source?.name||definition.name||id,kind:source?.kind||definition.kind||'external',
  getSourceHealth(){return health;},
  getReliability(){return {value:clamp(Number(source?.reliability??Math.round((definition.baseWeight??.5)*100))/100),samples:Number(source?.evaluatedRecords)||0};},
  getLatency(){return {averageMs:Number(source?.averageLatencyMs)||null,averageDelayMinutes:Number(source?.averageDelayMinutes)||null};},
  getRecentEvents(boss,world){return (snapshot?.events||[]).filter(e=>e.boss===boss&&e.world===world&&(e.evidence||[]).some(x=>x.sourceId===id));},
  checkBoss(candidate){
   const reliability=this.getReliability(),definitionKind=this.kind,rows=[];
   for(const event of this.getRecentEvents(candidate.boss,candidate.world)){
    if(!Number.isFinite(event.estimatedAt)||Math.abs(event.estimatedAt-(candidate.estimatedAt||candidate.firstEvidenceAt||event.estimatedAt))>3*3600000)continue;
    for(const e of (event.evidence||[]).filter(x=>x.sourceId===id)){
     const observedAt=Number(e.sourceObservedAt)||Number(e.collectedAt)||Number(e.processedAt)||event.estimatedAt,quality=clamp(Number(e.quality?.score??50)/100),fresh=freshnessScore(observedAt,now,3*3600000);
     const type=id==='rubinot-official'?'OFFICIAL_SIGNAL':definitionKind==='manual'?'MANUAL_SIGNAL':definitionKind==='external'?'API_SIGNAL':'WEBSITE_SIGNAL';
     rows.push({id:'inv-src-'+investigationDigest([candidate.id,id,e.evidenceId].join('|')).slice(0,28),candidateId:candidate.id,type,sourceId:id,sourceKind:definitionKind,boss:candidate.boss,world:candidate.world,observedAt,receivedAt:Number(e.processedAt)||now,estimatedAt:Number(e.estimatedAt)||event.estimatedAt,independenceKey:'source:'+(source?.dependencyGroup||id),reliability:reliability.value,sampleSize:reliability.samples,freshness:fresh,evidenceStrength:clamp((.45+.55*reliability.value)*(.5+.5*quality)*fresh),positive:true,negative:false,canConfirm:definition.eventEvidence!==false,sourceHealth:health,detail:{eventId:event.id,evidenceId:e.evidenceId,qualityScore:e.quality?.score??null,precision:e.precision||null}});
    }
   }
   return rows;
  }
 };
}
export function createSourceAdapters(snapshot,now=Date.now()){
 const ids=new Set([...Object.keys(SOURCE_DEFINITIONS),...(snapshot?.sources||[]).map(x=>x.id)]);
 return [...ids].map(id=>adapterFor(id,snapshot,now));
}
export function collectAdapterEvidence(candidate,snapshot,now=Date.now()){
 const adapters=createSourceAdapters(snapshot,now),evidence=[];for(const adapter of adapters)if(adapter.id!=='whatsapp-group')evidence.push(...adapter.checkBoss(candidate));
 return {adapters,evidence};
}

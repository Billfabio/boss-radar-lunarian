import {digest,trustedEvent} from '../mlops/feature-store.mjs';
import {independenceKeys} from '../consensus/independence.mjs';
import {consensusForEvidence} from '../consensus/engine.mjs';
const valid=n=>Number.isFinite(n)&&n>0;
const first=a=>a.filter(valid).sort((x,y)=>x-y)[0]??null;
export function canonicalEvent(event,sources={},recordedAt=Date.now()){
 const evidence=(event.evidence||[]).filter(x=>sources[x.sourceId]?.active!==false&&!x.anomaly&&x.quality?.traceable&&x.quality?.eligibleForLearning!==false&&['CONFIRMADO','PROVÁVEL'].includes(x.quality?.status));
 const independent=new Set(independenceKeys(evidence,sources).values());
 const availableAt=Math.max(recordedAt,event.updatedAt||0,...evidence.map(x=>Math.max(x.processedAt||0,x.collectedAt||0,x.reportedAt||0)));
 // A kill proves the boss existed earlier, not its spawn time. Keep it quarantined
 // for spawn analysis unless explicit spawn evidence accompanies it.
 const confirmed=trustedEvent(event)&&evidence.some(x=>x.eventType==='appearance');
 const appearances=evidence.filter(x=>x.eventType==='appearance'),mixed=appearances.length&&evidence.some(x=>x.eventType==='kill')&&!Number.isFinite(event.manualOverrideAt),lower=mixed?Math.min(...appearances.map(x=>x.startAt)):event.startAt,upper=mixed?Math.max(...appearances.map(x=>x.endAt)):event.endAt,estimate=mixed?consensusForEvidence(appearances,sources).centerAt:event.estimatedAt;
 return {id:'BOSS-'+digest({id:event.id,world:event.world,boss:event.boss}).slice(0,24),legacyId:event.id,boss:event.boss,world:event.world,eventType:event.eventType,status:confirmed?'CONFIRMADO':'QUARENTENA',spawn:{lower,upper,estimate,uncertaintyMs:Math.max(0,upper-lower)/2,censored:lower!==upper},firstDetectionAt:first(evidence.map(x=>x.detectedAt)),firstPublicationAt:first(evidence.map(x=>x.publishedAt)),firstCollectionAt:first(evidence.map(x=>x.collectedAt)),firstConfirmationAt:first(evidence.map(x=>x.confirmedAt)),availableAt,confidence:event.confidence,sourceCount:new Set(evidence.map(x=>x.sourceId)).size,independentSourceCount:independent.size,confirmations:new Set(evidence.map(x=>x.confirmedBy||x.sourceId)).size,evidence:evidence.map(x=>({id:x.evidenceId,sourceId:x.sourceId,confirmedBy:x.confirmedBy??null,spawnLower:x.startAt,spawnUpper:x.endAt,detectedAt:x.detectedAt??null,publishedAt:x.publishedAt??null,collectedAt:x.collectedAt,processedAt:x.processedAt,confirmedAt:x.confirmedAt??null,confidence:x.confidence,quality:x.quality.score,payloadHash:x.detail?.payloadHash||null})),freshnessScore:Math.exp(-Math.max(0,recordedAt-upper)/(30*86400000))*100};
}
export function captureCanonical(intel,at=Date.now()){
 const d=intel.discovery;
 for(const event of intel.events||[]){const current=canonicalEvent(event,intel.sources,at),hash=digest({...current,availableAt:0,freshnessScore:0});const previous=d.current[current.id];if(previous?.hash===hash)continue;
  const version={hash,at:current.availableAt,event:current};d.versions.push(version);d.current[current.id]=version;
 }
 const live=new Set((intel.events||[]).map(x=>'BOSS-'+digest({id:x.id,world:x.world,boss:x.boss}).slice(0,24)));for(const id of Object.keys(d.current)){if(!live.has(id)){const previous=d.current[id];d.versions.push({at,event:{...previous.event,availableAt:at,status:'REMOVIDO'},hash:digest({id,removed:at})});delete d.current[id];}}
}
export function eventsAsOf(discovery,world,asOf){
 const byId=new Map();for(const v of discovery.versions){if(v.at<=asOf&&v.event.world===world){const prev=byId.get(v.event.id);if(!prev||prev.at<=v.at)byId.set(v.event.id,v);}}
 return [...byId.values()].map(v=>v.event).filter(e=>e.status==='CONFIRMADO'&&e.spawn.upper<=asOf).sort((a,b)=>a.spawn.estimate-b.spawn.estimate);
}
export function horizonLabel(events,coverage,boss,world,anchor,horizonMs,asOf){
 const end=anchor+horizonMs;if(end>asOf)return {value:null,reason:'janela ainda aberta'};
 const possible=events.filter(e=>e.boss===boss&&e.world===world&&e.status==='CONFIRMADO'&&e.availableAt<=asOf&&e.spawn.upper>anchor&&e.spawn.lower<=end);
 if(possible.some(e=>e.spawn.lower>anchor&&e.spawn.upper<=end))return {value:1,knownAt:Math.max(end,...possible.map(e=>e.availableAt))};
 if(possible.length)return {value:null,reason:'intervalo censurado atravessa limite'};
 const sessions=coverage.filter(c=>!c.candidateId&&c.world===world&&c.boss===boss&&c.verified&&c.knownAt<=asOf&&c.endAt>anchor&&c.startAt<end).sort((a,b)=>a.startAt-b.startAt);
 let through=anchor;for(const s of sessions){if(s.startAt>through)break;through=Math.max(through,s.endAt);if(through>=end)return {value:0,knownAt:Math.max(end,...sessions.filter(x=>x.startAt<=end).map(x=>x.knownAt))};}
 return {value:null,reason:'sem cobertura contínua verificada'};
}

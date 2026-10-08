import {ensureDiscovery,registerCandidate,sourceSample,evaluateSources,reviewCandidate} from './service.mjs';
import {eventsAsOf} from './canonical-events.mjs';
import {configureCollector,collectPublicSources,collectAuthorizedDiscord,parseBossJSON} from './collectors.mjs';
import {stageSource,advanceSource,monitorSources,sourceContribution} from './source-governance.mjs';
import {advancePolicy,recordProspective,resolveProspective,governedSignal} from './experiments.mjs';
import {activateDependency,bayesianUpdate} from './fusion.mjs';
import {knowledgeGraph} from './knowledge.mjs';
import {queryTemporalKnowledge} from './temporal-knowledge.mjs';
import {intelligenceRedTeam} from './red-team.mjs';
import {makeObservation} from '../normalization/observations.mjs';
import {recomputeEvent} from '../deduplication/events.mjs';
import {digest} from '../mlops/feature-store.mjs';
export async function discoveryControl(intel,operation,input,at=Date.now()){
 const d=ensureDiscovery(intel),events=eventsAsOf(d,input.world,at);
 if(operation==='collector')return configureCollector(d,input,at);
 if(operation==='collect')return collectPublicSources(d,{register:registerCandidate,sample:sourceSample,at});
 if(operation==='advance'){const p=d.policies.find(p=>p.id===input.id);return p?.kind==='source'?advanceSource(d,input.id,[...new Set(d.versions.map(v=>v.event.world))].flatMap(w=>eventsAsOf(d,w,at)),evaluateSources,at):advancePolicy(d,input.id,at);}
 if(operation==='dependency')return activateDependency(d,input.id,intel.sources,at);
 if(operation==='red-team'){const result=intelligenceRedTeam(intel,input.world,at);d.redTeamHistory.push(result);return result;}
 if(operation==='knowledge')return knowledgeGraph(intel,input.world,at,{offset:input.offset,limit:input.limit});
 if(operation==='graph-query')return queryTemporalKnowledge(intel,input.world,input,Number.isFinite(input.asOf)?Math.min(input.asOf,at):at);
 if(operation==='evidence')return windowEvidence(intel,input.world,input.boss,input.startAt,input.endAt,input.prior,at);
 if(operation==='schedule'){
  if(!Number.isFinite(input.hour)||input.hour<0||input.hour>=24||!String(input.sourceRef||'').trim()||!Number.isFinite(input.validFrom)||input.validFrom>at)throw new Error('Server save exige hora de Brasília, validade e origem verificável');
  const row={id:'SAVE-'+digest({world:input.world,hour:input.hour,at}).slice(0,20),world:input.world,hour:input.hour,validFrom:input.validFrom,knownAt:at,sourceRef:String(input.sourceRef).slice(0,500)};d.serverSaveSchedules.push(row);return row;
 }
 if(operation==='automatic'){if(typeof input.enabled!=='boolean')throw new Error('Configuração inválida');d.automaticCollection=input.enabled;return {enabled:d.automaticCollection,intervalMinutes:60};}
 if(operation==='discord'){
  if(input.authorized!==true||!/^\d{16,22}$/.test(input.channelId))throw new Error('Canal exige autorização explícita');
  d.discordConfig={authorized:true,channelId:input.channelId,configuredAt:at};return {configured:true,tokenStored:false};
 }
 if(operation==='discord-collect'){
  const messages=await collectAuthorizedDiscord(d.discordConfig||{}),candidate=registerCandidate(d,{name:'Discord autorizado '+d.discordConfig.channelId,url:'https://discord.com/channels/@me/'+d.discordConfig.channelId},at);let added=0;
  for(const m of messages){try{for(const row of parseBossJSON(m.content,m.collectedAt)){sourceSample(d,{...row,publishedAt:m.publishedAt,sourceId:candidate.id},m.collectedAt);added++;}}catch{}}
  if(messages.length)d.discordConfig.after=messages.map(m=>m.id).sort((a,b)=>BigInt(a)<BigInt(b)?-1:1).at(-1);
  return {messages:messages.length,samples:added,mode:'shadow'};
 }
 throw new Error('Operação inválida');
}
export function prospectiveTick(intel,world,at=Date.now()){
 const d=ensureDiscovery(intel);resolveProspective(d,world,at);recordProspective(d,world,at);monitorSources(d,eventsAsOf(d,world,at),evaluateSources,at);
}
export function governedObservations(intel,at=Date.now()){
 const d=ensureDiscovery(intel),rows=[];
 for(const c of d.candidates){
  const policy=d.policies.find(p=>p.kind==='source'&&p.sourceId===c.id&&['CANARY','PRODUCAO'].includes(p.status)),existing=intel.sources[c.id];
  if(!policy){if(existing&&existing.active!==false){existing.active=false;existing.circuitState='OPEN';existing.suspendedUntil=at+86400000;for(const event of intel.events.filter(e=>e.evidence.some(x=>x.sourceId===c.id)))recomputeEvent(event,intel.sources);}continue;}
  const m=policy.lastGate,quality=m?.precision;if(!m?.validationGate?.passed||quality==null)continue;
  intel.sources[c.id]||={id:c.id,name:c.name,kind:'public-governed',active:true,baseWeight:.7,alpha:1+Math.min(50,m.independentlyMatched),beta:1+Math.min(50,m.falsePositives||0),circuitState:'CLOSED',suspendedUntil:0,recentOutcomes:[]};
  intel.sources[c.id].active=true;
  for(const s of c.samples){if(s.admittedAt||s.collectedAt<policy.createdAt||!sourceContribution(d,c,s))continue;
   rows.push({sample:s,observation:makeObservation({evidenceId:s.id,boss:s.boss,world:s.world,sourceId:c.id,sourceRef:c.url,collectionMethod:c.collector,eventType:'appearance',precision:s.spawnLower===s.spawnUpper?'minute':'range',startAt:s.spawnLower,endAt:s.spawnUpper,detectedAt:s.detectedAt,publishedAt:s.publishedAt,collectedAt:s.collectedAt,processedAt:at,confidence:Math.min(.7,quality),detail:{payloadHash:s.payloadHash,sourcePolicyId:policy.id}})});
  }
 }
 return rows;
}
export function signalOverlay(intel,prediction,at){
 const signal=governedSignal(ensureDiscovery(intel),prediction.world,prediction.boss,at,prediction.baseEventId||prediction.boss);
 return signal?{...prediction,signalProbability:signal}:prediction;
}
export function windowEvidence(intel,world,boss,startAt,endAt,prior,at=Date.now()){
 if(!Number.isFinite(startAt)||!Number.isFinite(endAt)||startAt>=endAt||endAt>at)throw new Error('Janela de evidência inválida');
 const d=ensureDiscovery(intel),events=eventsAsOf(d,world,at),metrics=evaluateSources(d,events,at,world),evidence=[];
 for(const c of d.candidates){const m=metrics.find(m=>m.id===c.id);if(!c.productionEligible||!m.validationGate.passed||m.negativeControls<10)continue;const relevant=c.samples.filter(s=>s.boss===boss&&s.world===world&&s.collectedAt<=at&&s.spawnLower>=startAt&&s.spawnUpper<=endAt);if(!relevant.length)continue;evidence.push({sourceId:c.id,dependencyGroup:intel.sources[c.id]?.dependencyGroup,validated:true,samples:m.independentlyMatched,sensitivity:m.sensitivity,falsePositiveRate:m.falsePositiveRate,positive:true});}
 return bayesianUpdate(prior,evidence,{confirmed:events.some(e=>e.boss===boss&&e.spawn.lower>startAt&&e.spawn.upper<=endAt)});
}

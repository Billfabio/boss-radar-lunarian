import {consensusForEvidence} from '../consensus/engine.mjs';
import {recomputeEvent} from '../deduplication/events.mjs';
import {makeObservation} from '../normalization/observations.mjs';
import {eventsAsOf} from './canonical-events.mjs';
import {bayesianUpdate} from './fusion.mjs';
export function intelligenceRedTeam(intel,world,asOf=Date.now()){
 const events=(intel.events||[]).filter(e=>e.world===world&&e.evidence?.length),base=events.find(e=>e.evidence.some(x=>!x.anomaly&&x.quality?.eligibleForLearning));if(!base)return {world,asOf,status:'AMOSTRA_INSUFICIENTE',checks:[],productionDataChanged:false};const evidence=structuredClone(base.evidence.find(x=>!x.anomaly&&x.quality?.eligibleForLearning)),sources=structuredClone(intel.sources),checks=[],single=consensusForEvidence([evidence],sources);
 const repeat=Array.from({length:20},(_,i)=>({...evidence,evidenceId:evidence.evidenceId+'-repeat-'+i})),repeated=consensusForEvidence(repeat,sources);checks.push({name:'20 confirmações repetidas',passed:repeated.confidence<=single.confidence+1e-9});
 const sameActor=Array.from({length:20},(_,i)=>({...evidence,sourceId:'channel-'+i,confirmedBy:'same-contributor',evidenceId:'contributor-'+i})),actorResult=consensusForEvidence(sameActor,{});checks.push({name:'Um contribuinte em 20 canais',passed:actorResult.independentSourceCount===1&&actorResult.status!=='CONFIRMADO'});
 const copies=['original','replica1','replica2'].map(sourceId=>({...evidence,sourceId})),copySources=Object.fromEntries(copies.map(x=>[x.sourceId,{baseWeight:.7,dependencyGroup:'known-copy-group'}]));checks.push({name:'Fontes dependentes',passed:consensusForEvidence(copies,copySources).independentSourceCount===1});
 let futureRejected=false;try{makeObservation({...evidence,precision:'minute',estimatedAt:asOf+86400000,startAt:asOf+86400000,endAt:asOf+86400000,processedAt:asOf});}catch{futureRejected=true;}checks.push({name:'Timestamp futuro',passed:futureRejected});
 const posterior=bayesianUpdate(.2,Array.from({length:20},()=>({sourceId:'one',validated:true,samples:100,sensitivity:.95,falsePositiveRate:.1,positive:true})));checks.push({name:'Confiança adversarial Bayesiana',passed:posterior.independentEvidence===1&&posterior.probability<.5});
 const visible=eventsAsOf(intel.discovery,world,asOf);checks.push({name:'Histórico sem versões futuras',passed:visible.every(e=>e.availableAt<=asOf&&e.spawn.upper<=asOf)});
 let impossibleRejected=false;try{makeObservation({...evidence,startAt:asOf,endAt:asOf-1000,processedAt:asOf});}catch{impossibleRejected=true;}checks.push({name:'Intervalo impossível',passed:impossibleRejected});
 const untrusted=Array.from({length:20},(_,i)=>({...evidence,sourceId:'untrusted-'+i,anomaly:{kind:'unvalidated_source'}}));checks.push({name:'Padrões artificiais de fontes sem validação',passed:consensusForEvidence(untrusted,{}).confidence===0});
 const poisoned=[evidence,...Array.from({length:20},(_,i)=>({...evidence,evidenceId:'changed-'+i,estimatedAt:asOf+24*3600000,anomaly:{kind:'impossible_timestamp'}}))];checks.push({name:'Timestamps alterados em lote',passed:consensusForEvidence(poisoned,sources).centerAt===single.centerAt});
 const cloned=structuredClone(base);cloned.evidence=repeat;recomputeEvent(cloned,sources);checks.push({name:'Spam na fusão',passed:Number.isFinite(cloned.confidence)&&cloned.confidence<=Math.max(base.confidence,single.confidence)+.05});return {world,asOf,status:checks.every(c=>c.passed)?'APROVADO':'FALHOU',checks,productionDataChanged:false};
}

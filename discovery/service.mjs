import {digest} from '../mlops/feature-store.mjs';
import {captureCanonical,eventsAsOf,horizonLabel} from './canonical-events.mjs';
import {runDiscovery} from './signals.mjs';
import {bossGraph,sourceGraph} from './graphs.mjs';
import {liveProbability,predictability,historicalReplay} from './live.mjs';
import {PUBLIC_CANDIDATES} from './public-candidates.mjs';
import {spawnDistribution} from './distribution.mjs';
import {mean} from './statistics.mjs';
import {runAdvancedExperiments,ensureProspective,stagePolicies,recordProspective,resolveProspective,advancePolicy} from './experiments.mjs';
import {detectBreakpoints,clusterBosses} from './regimes.mjs';
import {collectPublicSources,configureCollector,collectAuthorizedDiscord,parseBossJSON} from './collectors.mjs';
import {stageSource,advanceSource,monitorSources} from './source-governance.mjs';
import {dependencyProposal,activateDependency} from './fusion.mjs';
import {knowledgeGraph} from './knowledge.mjs';
import {intelligenceRedTeam} from './red-team.mjs';
import {calibratedForecast} from './calibrated-forecast.mjs';
import {controlSearch} from './search-control.mjs';
export const SOURCE_STATES=['DESCOBERTA','EM_ANALISE','TESTE','VALIDADA','ATIVA','BAIXA_QUALIDADE','BLOQUEADA','DESCARTADA'];
const CONTEXT_TYPES=['server_save','restart','maintenance','update','hotfix','special_event','reset'];
export function ensureDiscovery(intel,at=Date.now()){
 intel.discovery||={schemaVersion:1,createdAt:at,current:{},versions:[],coverage:[],context:[],candidates:[],experiments:[],runs:[]};if(!intel.discovery.publicCandidatesSeeded){for(const row of PUBLIC_CANDIDATES)registerCandidate(intel.discovery,row,at);intel.discovery.publicCandidatesSeeded=true;}const d=intel.discovery;d.schemaVersion=2;for(const key of ['regimeHistory','clusterHistory','serverSaveSchedules','publications','collectionRuns','redTeamHistory','configurationVersions','alertHistory'])d[key]||=[];ensureProspective(d);return d;
}
export function registerCandidate(d,input,at=Date.now()){
 if(d.candidates.length>=100)throw new Error('Limite de 100 fontes candidatas');
 const url=new URL(input.url);if(url.protocol!=='https:'||url.username||url.password||url.port||/^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[)/i.test(url.hostname))throw new Error('Use URL pública HTTPS sem credenciais');
 if(d.candidates.some(x=>x.url===url.href))return d.candidates.find(x=>x.url===url.href);
 if(!String(input.name||'').trim()||String(input.name).length>140)throw new Error('Nome de fonte inválido');
 const row={id:'SRC-'+digest(url.href).slice(0,20),name:String(input.name),url:url.href,status:'DESCOBERTA',mode:'shadow',discoveredAt:at,samples:[],productionEligible:false,collector:'none',reason:'Fonte registrada; acesso público, qualidade e autorização ainda precisam ser verificados.'};d.candidates.push(row);return row;
}
export function sourceSample(d,input,at=Date.now()){
 const candidate=d.candidates.find(c=>c.id===input.sourceId);if(!candidate||['BLOQUEADA','DESCARTADA'].includes(candidate.status))throw new Error('Fonte indisponível para avaliação');
 if(candidate.samples.length>=10000)throw new Error('Limite de amostras da fonte');
 if(typeof input.boss!=='string'||!input.boss.trim()||input.boss.length>140||typeof input.world!=='string'||!input.world.trim()||input.world.length>80||!Number.isFinite(input.detectedAt)||input.detectedAt<=0||input.detectedAt>at||!Number.isFinite(input.spawnLower)||input.spawnLower<=0||!Number.isFinite(input.spawnUpper)||input.spawnLower>input.spawnUpper||input.spawnUpper>input.detectedAt)throw new Error('Amostra temporal inválida');
 if(input.publishedAt!=null&&(!Number.isFinite(input.publishedAt)||input.publishedAt>at||input.publishedAt<=0)||input.payloadHash!=null&&!/^[a-f0-9]{64}$/.test(input.payloadHash))throw new Error('Proveniência temporal ou hash inválido');
 const row={id:digest({sourceId:input.sourceId,boss:input.boss,world:input.world,spawnLower:input.spawnLower,spawnUpper:input.spawnUpper}),boss:input.boss,world:input.world,spawnLower:input.spawnLower,spawnUpper:input.spawnUpper,detectedAt:input.detectedAt,publishedAt:input.publishedAt??null,payloadHash:input.payloadHash??null,collectedAt:at};
 if(!candidate.samples.some(s=>s.id===row.id))candidate.samples.push(row);if(!['VALIDADA','ATIVA'].includes(candidate.status))candidate.status='TESTE';return {added:true,mode:candidate.mode,influencesPredictions:false,confirmsBosses:false,sendsAlerts:false};
}
export function evaluateSources(d,events,asOf,world=null){
 return d.candidates.map(c=>{const samples=c.samples.filter(s=>s.collectedAt<=asOf&&(!world||s.world===world)),matched=[],unresolved=[];
  for(const s of samples){const match=events.find(e=>e.boss===s.boss&&e.world===s.world&&e.spawn.lower<=s.spawnUpper&&e.spawn.upper>=s.spawnLower&&!e.evidence.some(x=>x.sourceId===c.id));if(match)matched.push({sample:s,event:match});else unresolved.push(s);}
  const independentCoverage=d.coverage.filter(x=>x.candidateId!==c.id&&x.knownAt<=asOf),falsePositives=unresolved.filter(s=>horizonLabel(events,independentCoverage,s.boss,s.world,s.spawnLower-1,s.spawnUpper-s.spawnLower+2,asOf).value===0);
  const testedCoverage=d.coverage.filter(x=>x.candidateId===c.id&&x.knownAt<=asOf),expected=events.filter(e=>!e.evidence.some(x=>x.sourceId===c.id)&&testedCoverage.some(x=>x.boss===e.boss&&x.world===e.world&&x.startAt<=e.spawn.lower&&x.endAt>=e.spawn.upper)),found=expected.filter(e=>samples.some(s=>s.world===e.world&&s.boss===e.boss&&s.spawnLower<=e.spawn.upper&&s.spawnUpper>=e.spawn.lower)),precision=matched.length+falsePositives.length?matched.length/(matched.length+falsePositives.length):null,recall=expected.length?found.length/expected.length:null,latencies=matched.filter(m=>m.event.spawn.lower===m.event.spawn.upper&&m.sample.detectedAt>=m.event.spawn.upper).map(m=>(m.sample.detectedAt-m.event.spawn.estimate)/60000).sort((a,b)=>a-b),duration=samples.length?(Math.max(...samples.map(s=>s.collectedAt))-Math.min(...samples.map(s=>s.collectedAt)))/86400000:0;
  const gate={passed:matched.length>=50&&expected.length>=50&&duration>=20&&precision>=.95&&recall>=.8&&latencies.length>=30&&latencies[Math.floor(.95*(latencies.length-1))]<=15,reasons:[]};if(!gate.passed)gate.reasons.push('Exige 50 confirmações independentes, 50 eventos esperados, 20 dias, precisão ≥95%, recall ≥80% e p95 de detecção ≤15min com 30 horários precisos.');
  let negativeControls=0,negativeFalsePositives=0;
  const seen=new Set();for(const coverage of testedCoverage){for(let start=Math.ceil(coverage.startAt/3600000)*3600000;start+3600000<=Math.min(coverage.endAt,asOf);start+=3600000){const key=coverage.world+'|'+coverage.boss+'|'+start;if(seen.has(key)||seen.size>=50000)continue;seen.add(key);const truth=horizonLabel(events,independentCoverage,coverage.boss,coverage.world,start,3600000,asOf);if(truth.value!==0)continue;negativeControls++;if(samples.some(s=>s.boss===coverage.boss&&s.world===coverage.world&&s.spawnLower>start&&s.spawnUpper<=start+3600000))negativeFalsePositives++;}}
  return {id:c.id,name:c.name,url:c.url,status:c.status,mode:c.mode,samples:samples.length,independentlyMatched:matched.length,unresolved:unresolved.length-falsePositives.length,precision,falsePositives:falsePositives.length,falseDiscoveryRate:precision==null?null:1-precision,negativeControls,negativeFalsePositives,falsePositiveRate:negativeControls>=10?(negativeFalsePositives+1)/(negativeControls+2):null,sensitivity:expected.length>=50?(found.length+1)/(expected.length+2):null,falseNegativeRate:recall==null?null:1-recall,meanLatencyMinutes:mean(latencies),validationGate:gate,productionEligible:!!c.productionEligible,reason:'Validação exige ground truth independente e cobertura; nenhuma fonte é ativada automaticamente.'};
 });
}
export function addContext(d,input,at=Date.now()){
 if(!CONTEXT_TYPES.includes(input.type)||typeof input.world!=='string'||!input.world.trim()||input.world.length>80||!Number.isFinite(input.startAt)||input.startAt<=0||input.startAt>at||typeof input.sourceRef!=='string'||!input.sourceRef.trim()||input.sourceRef.length>500)throw new Error('Evento de contexto inválido');
 if(d.context.length>=10000)throw new Error('Limite de eventos de contexto');
 const row={id:'CTX-'+digest({type:input.type,world:input.world,startAt:input.startAt,sourceRef:input.sourceRef}).slice(0,20),world:input.world,type:input.type,startAt:input.startAt,endAt:input.endAt??input.startAt,knownAt:at,publishedAt:Number.isFinite(input.publishedAt)&&input.publishedAt<=at?input.publishedAt:null,sourceRef:input.sourceRef};if(!Number.isFinite(row.endAt)||row.endAt<row.startAt||row.endAt>at)throw new Error('Intervalo de contexto inválido');if(!d.context.some(x=>x.id===row.id))d.context.push(row);return row;
}
export function addCoverage(d,input,at=Date.now()){
 if(!input.verified||input.continuous!==true||typeof input.boss!=='string'||!input.boss.trim()||input.boss.length>140||typeof input.world!=='string'||!input.world.trim()||input.world.length>80||!Number.isFinite(input.startAt)||!Number.isFinite(input.endAt)||input.startAt<=0||input.startAt>=input.endAt||input.endAt>at||input.endAt-input.startAt>7*86400000||!String(input.sourceRef||'').trim())throw new Error('Cobertura exige monitoramento contínuo verificado, origem e intervalo fechado');
 if(input.candidateId&&!d.candidates.some(c=>c.id===input.candidateId))throw new Error('Fonte candidata inválida');if(d.coverage.length>=50000)throw new Error('Limite de coberturas');const row={id:'COV-'+digest(input).slice(0,20),boss:input.boss,world:input.world,startAt:input.startAt,endAt:input.endAt,sourceRef:String(input.sourceRef).slice(0,500),candidateId:input.candidateId||null,verified:true,continuous:true,knownAt:at};if(!d.coverage.some(x=>x.id===row.id))d.coverage.push(row);return row;
}
export function reviewCandidate(d,input,at=Date.now()){
 const c=d.candidates.find(x=>x.id===input.sourceId);if(!c||!['EM_ANALISE','TESTE','BAIXA_QUALIDADE','BLOQUEADA','DESCARTADA','VALIDADA'].includes(input.status))throw new Error('Transição de fonte inválida; ativação exige pipeline de produção');
 if(input.status==='VALIDADA'){const worlds=[...new Set(d.versions.map(v=>v.event.world))],e=evaluateSources(d,worlds.flatMap(world=>eventsAsOf(d,world,at)),at).find(x=>x.id===c.id);if(!e.validationGate.passed)throw new Error(e.validationGate.reasons.join(' '));c.lastGate=e.validationGate;}
 c.status=input.status;c.reviewedAt=at;c.mode='shadow';c.productionEligible=false;if(c.status==='VALIDADA')stageSource(d,c,at);else for(const p of (d.policies||[]).filter(p=>p.kind==='source'&&p.sourceId===c.id)){p.status='REVERTIDA';p.percentage=0;p.productionEligible=false;}return {id:c.id,status:c.status,productionEligible:false};
}
export function discoveryDashboard(intel,world,asOf=Date.now()){
 const d=ensureDiscovery(intel),events=eventsAsOf(d,world,asOf),runs=d.runs.filter(r=>r.world===world&&r.at<=asOf),latest=runs.at(-1),experiments=d.experiments.filter(e=>latest?.experiments.includes(e.id)),scores=predictability(experiments),probabilities=[...new Set(events.map(e=>e.boss))].slice(0,100).map(boss=>liveProbability(d,world,boss,asOf));
 const diagnosticEvents=structuredClone(events);for(const c of d.candidates)for(const sample of c.samples.filter(s=>s.world===world&&s.collectedAt<=asOf)){const e=diagnosticEvents.find(e=>e.boss===sample.boss&&e.spawn.lower<=sample.spawnUpper&&e.spawn.upper>=sample.spawnLower);if(e)e.evidence.push({sourceId:c.id,publishedAt:sample.publishedAt,detectedAt:sample.detectedAt,payloadHash:sample.payloadHash});}
 const forecast=[...new Set(events.map(e=>e.boss))].slice(0,100).map(boss=>calibratedForecast(d,world,boss,asOf));
 const sources=sourceGraph(diagnosticEvents),relationships=bossGraph(events,d.coverage,experiments,world,asOf);
 const topDiscoveries=experiments.filter(e=>e.status==='SHADOW_MODE').map(e=>({text:e.signal+' reduziu Brier de '+e.boss+' em '+(e.test.gain*100).toFixed(1)+'% no holdout; aguarda Shadow prospectivo.',experimentId:e.id}));
 return {world,asOf,dependencyPolicies:(d.dependencyPolicies||[]).filter(p=>p.world===world&&p.createdAt<=asOf),policies:d.policies.filter(p=>p.createdAt<=asOf&&(p.world===world||p.kind==='source')),prospectiveSummary:{issued:d.prospective.filter(p=>p.world===world&&p.at<=asOf).length,resolved:d.prospective.filter(p=>p.world===world&&p.resolvedAt<=asOf).length},regimes:d.regimeHistory.filter(r=>r.world===world&&r.asOf<=asOf).at(-1)||null,clusters:d.clusterHistory.filter(r=>r.world===world&&r.asOf<=asOf).at(-1)||null,publications:d.publications.filter(p=>p.availableAt<=asOf).slice(-50),collectionRuns:d.collectionRuns.filter(r=>r.at<=asOf).slice(-5),redTeam:d.redTeamHistory.filter(r=>r.world===world&&r.asOf<=asOf).at(-1)||null,knowledge:knowledgeGraph(intel,world,asOf,{limit:100}),survivalForecasts:forecast,canonicalEventCount:events.length,events:events.slice(-50),experiments,bossGraph:relationships,sourceGraph:sources,candidates:evaluateSources(d,events,asOf,world),context:d.context.filter(c=>c.world===world&&c.knownAt<=asOf),coverageSessions:d.coverage.filter(c=>c.world===world&&c.knownAt<=asOf).length,predictability:scores,live:probabilities,nextBestBoss:forecast.filter(p=>p.probability!=null).map(p=>({...p,samples:p.horizons.find(h=>h.hours===6)?.samples||0})).sort((a,b)=>b.probability-a.probability),distributions:[...new Set(events.map(e=>e.boss))].slice(0,100).map(boss=>({boss,...spawnDistribution(events,boss,asOf)})),topDiscoveries,lastRun:latest??null,limitations:['Histórico anterior à captura não é reconstruído retroativamente.','Ausência de confirmação não é ausência de spawn; rótulos negativos exigem cobertura contínua.','Promoções exigem Shadow prospectivo, Challenger, canário e quality gate; estados disponíveis no painel.','Probabilidades experimentais usam horizonte de 6h; outros horizontes e alertas exigem validação.']};
}
export function discover(intel,world,asOf=Date.now()){
 const d=ensureDiscovery(intel);captureCanonical(intel,asOf);
 const regimes=detectBreakpoints(d,world,asOf),clusters=clusterBosses(d,world,asOf);
 if(!d.regimeHistory.some(r=>r.world===world&&r.asOf===asOf))d.regimeHistory.push(regimes);
 if(!d.clusterHistory.some(r=>r.world===world&&r.asOf===asOf))d.clusterHistory.push(clusters);
 const run=runDiscovery(d,world,asOf),advanced=runAdvancedExperiments(d,world,asOf);
 const horizons=[2,12,24].flatMap(h=>runDiscovery(d,world,asOf,h).results);run.results.push(...advanced,...horizons);controlSearch(d,world,run.datasetHash,run.results,asOf);d.runs.push({...run,id:'ALL-'+run.datasetHash.slice(0,20),results:undefined,experiments:run.results.map(e=>e.id)});
 stagePolicies(d,world,asOf);resolveProspective(d,world,asOf);recordProspective(d,world,asOf);
 dependencyProposal(d,eventsAsOf(d,world,asOf),world,asOf);return {...run,regimes,clusters};
}
export {historicalReplay,captureCanonical};

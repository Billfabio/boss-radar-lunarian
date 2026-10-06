import {mean,probabilityMetrics,clamp} from './statistics.mjs';
import {eventsAsOf} from './canonical-events.mjs';
import {buildCases,probabilities,signalFeatures} from './signals.mjs';
import {replaySettings,replayAlerts} from './history.mjs';
import {digest} from '../mlops/feature-store.mjs';
export function liveProbability(d,world,boss,asOf=Date.now()){
 const visible=eventsAsOf(d,world,asOf),features=signalFeatures(visible,d.context.filter(c=>c.world===world),boss,asOf);
 const model={...d,analysisAsOf:asOf},cases=buildCases(model,world,boss),predictions=[];
 for(let i=30;i<cases.length;i++){const r=cases[i],train=cases.slice(0,i).filter(x=>x.knownAt<=r.at);if(train.length<30)continue;predictions.push({...r,p:probabilities(train,r.features).baseline});}
 const train=cases.filter(c=>c.knownAt<=asOf);if(train.length<30)return {boss,world,asOf,status:'AMOSTRA_INSUFICIENTE',probability:null,samples:train.length,horizonHours:6};
 const raw=probabilities(train,features).baseline,bin=Math.floor(raw*5),calibration=predictions.filter(r=>Math.floor(r.p*5)===bin),cut=Math.floor(calibration.length*.6),fitting=calibration.slice(0,cut),holdout=calibration.slice(cut);
 if(fitting.length<30||holdout.length<20)return {boss,world,asOf,status:'CALIBRACAO_INSUFICIENTE',probability:null,rawProbability:raw,samples:train.length,calibrationSamples:calibration.length,horizonHours:6};
 const calibrated=clamp((fitting.reduce((s,r)=>s+r.y,0)+1)/(fitting.length+2)),metrics=probabilityMetrics(holdout.map(r=>({...r,adjusted:calibrated})),'adjusted'),baseline=probabilityMetrics(holdout,'p');
 const valid=metrics.ece<=.1&&metrics.brier<=baseline.brier&&metrics.logLoss<=baseline.logLoss;
 return {boss,world,asOf,status:valid?'CALIBRADO':'CALIBRACAO_REJEITADA',probability:valid?calibrated:null,rawProbability:raw,horizonHours:6,samples:train.length,calibrationSamples:calibration.length,metrics,baseline,productionEligible:false,distribution:null,reason:'Probabilidade experimental para 6h; distribuição de vários horizontes exige calibração própria.'};
}
export function predictability(experiments){
 const bosses=[...new Set(experiments.map(e=>e.boss))];return bosses.map(boss=>{const evaluated=experiments.filter(e=>e.boss===boss&&e.test.withSignal.samples>=20&&e.status!=='AMOSTRA_INSUFICIENTE'),best=evaluated.filter(e=>e.status==='SHADOW_MODE').sort((a,b)=>b.test.gain-a.test.gain)[0];
  if(!best)return {boss,score:null,status:'SEM_VALOR_PREDITIVO_COMPROVADO',usefulHorizonHours:null,samples:evaluated.at(-1)?.test.withSignal.samples??0};
  // Skill relative to the baseline, penalized by calibration; never a claimed accuracy percentage.
  return {boss,score:Math.round(100*Math.max(0,Math.min(1,best.test.gain))*(1-best.test.withSignal.ece)),status:'SKILL_FORA_DA_AMOSTRA',usefulHorizonHours:Math.max(...evaluated.filter(e=>e.status==='SHADOW_MODE').map(e=>e.horizonHours||6)),samples:best.test.withSignal.samples,experimentId:best.id,definition:'100 × ganho relativo de Brier × (1 − ECE) no holdout; não é probabilidade de acerto'};
 });
}
export function historicalReplay(d,world,startAt,endAt,stepMinutes=60,forecastRuns=[]){
 if(!Number.isFinite(startAt)||!Number.isFinite(endAt)||startAt>=endAt||endAt-startAt>86400000||endAt>Date.now()||!Number.isFinite(stepMinutes)||stepMinutes<15||stepMinutes>360)throw new Error('Selecione até 24h históricas e passos entre 15 e 360 minutos');
 const snapshots=forecastRuns.filter(r=>r.world===world&&['Champion','Shadow','Challenger'].includes(r.mode)&&r.asOf<=endAt&&r.output).sort((a,b)=>a.asOf-b.asOf);for(const r of snapshots){if(digest({output:r.output,features:r.features,weights:r.weights,rawPrediction:r.rawPrediction,datasetId:r.datasetId,asOf:r.asOf})!==r.immutableHash)throw new Error('Snapshot histórico da previsão alterado');}
 const timeline=[];for(let at=startAt;at<=endAt;at+=stepMinutes*60000){const events=eventsAsOf(d,world,at),bosses=[...new Set(events.map(e=>e.boss))],issued=new Map();for(const r of snapshots.filter(r=>r.asOf<=at))issued.set(r.forecastId,r);
 const predictions=[...issued.values()].map(r=>({forecastId:r.forecastId,boss:r.boss,issuedAt:r.asOf,mode:r.mode,modelVersion:r.modelVersion,windowStart:r.output.windowStart,windowEnd:r.output.windowEnd,confidence:r.output.confidence,likelyAt:r.output.likelyAt??null}));
 timeline.push({at,events:events.map(e=>({id:e.id,boss:e.boss,spawn:e.spawn,availableAt:e.availableAt})),context:d.context.filter(c=>c.world===world&&c.knownAt<=at),predictions,probabilities:bosses.slice(0,100).map(boss=>liveProbability(d,world,boss,at)),settings:replaySettings(d,world,at),prospective:(d.prospective||[]).filter(f=>f.world===world&&f.at<=at&&f.endAt>at).map(f=>({id:f.id,boss:f.boss,issuedAt:f.at,windowEnd:f.endAt,baseline:f.baseline,probability:f.signal,datasetHash:f.datasetHash})),publications:(d.publications||[]).filter(p=>p.availableAt<=at),alerts:replayAlerts(d,world,Math.max(startAt-1,at-stepMinutes*60000),at),alertsStatus:replaySettings(d,world,at)?'Histórico virtual; nenhum envio':'Configurações anteriores não disponíveis'});}
 return {world,startAt,endAt,timeline,mode:'historical_read_only',futureVisible:false,limitation:'Eventos anteriores à implantação não possuem versões históricas confiáveis e permanecem indisponíveis antes da captura.'};
}

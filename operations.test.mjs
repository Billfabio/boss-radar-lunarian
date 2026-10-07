import test from 'node:test';
import assert from 'node:assert/strict';
import {runDecisionCycle,ensureOperations,applyAttentionAction,operationsMetrics,dailyOperationsReview,DECISION_ENGINE_VERSION} from './operations/engine.mjs';

const H=3600000,T=Date.parse('2026-10-07T12:00:00Z');
function prediction(boss='Ferumbras',overrides={}){
 return {boss,world:'Lunarian',status:'ready',phase:'monitoring',probability:68,confidence:82,predictionScore:86,dataQualityScore:90,uncertaintyMs:2*H,intervalRecentMs:72*H,intervalAverageMs:80*H,windowStart:T+2*H,windowEnd:T+5*H,predictedCenterAt:T+3.5*H,probabilityDistribution:[{from:T+2*H,to:T+3*H,probability:30},{from:T+3*H,to:T+4*H,probability:45},{from:T+4*H,to:T+5*H,probability:25}],noveltySafety:{noveltyScore:.12},drift:{detected:false,score:5},...overrides};
}
function source(id,{reliability=90,health='HEALTHY',delay=10,first=40,eventEvidence=true,requests=0}={}){
 return {id,name:id,active:true,eventEvidence,reliability,requests,circuitState:health==='ERROR'?'OPEN':'CLOSED',circuitReason:health==='ERROR'?'technical':null,averageDelayMinutes:delay,averageLatencyMs:1000};
}
function context({coverage=100,predictions=[prediction()],candidate=null,sourceHealth='HEALTHY'}={}){
 const intelSources=[source('rubinot-official'),source('otbosstracker',{reliability:84,delay:20,first:25}),source('whatsapp-group',{reliability:78,delay:3,first:55})],invSources=intelSources.map(s=>({id:s.id,name:s.name,reliability:s.reliability,firstDetectionRate:s.id==='whatsapp-group'?55:s.id==='rubinot-official'?40:25,health:sourceHealth,latency:{averageDelayMinutes:s.averageDelayMinutes}}));
 return {world:'Lunarian',intelligence:{predictions,sources:intelSources,events:[]},investigation:{sources:invSources,cases:[]},whatsapp:{coverage:{coveragePct:coverage},health:{browserConnected:true,whatsappDetected:true},candidates:candidate?[candidate]:[]},system:{safeMode:{level:'NORMAL'}},settings:{progress:{Ferumbras:{favorite:false}}}};
}
test('Decision priority is operationally higher when the same prediction has poor detection coverage',()=>{
 const highState={},lowState={},hi=runDecisionCycle(highState,context({coverage:100}),T).bosses[0],lo=runDecisionCycle(lowState,context({coverage:25,sourceHealth:'DEGRADED'}),T).bosses[0];
 assert.equal(hi.status,'MEASURED');assert.equal(lo.status,'MEASURED');assert.ok(lo.missedDetectionRisk>hi.missedDetectionRisk);assert.ok(lo.informationGapScore>hi.informationGapScore);assert.ok(lo.priorityScore>hi.priorityScore);assert.equal(lo.modelProbability,hi.modelProbability);
});
test('Decision engine can prioritize a current Lunarian signal without inventing a prediction probability',()=>{
 const candidate={id:'c1',boss:'Ferumbras',world:'Lunarian',status:'PENDING',score:88,firstEvidenceAt:T-2*60000,lastEvidenceAt:T-30000,evidence:[{authorHash:'a',receivedAt:T-60000},{authorHash:'b',receivedAt:T-30000}]},row=runDecisionCycle({},context({predictions:[],candidate}),T).bosses[0];
 assert.equal(row.status,'MEASURED');assert.equal(row.modelProbability,null);assert.ok(row.priorityScore>=50);assert.equal(row.state,'POSSIBLE_SIGNAL');assert.equal(row.signals.independentReporters,2);
});
test('Decision engine remains insufficient when neither prediction nor operational signal exists',()=>{
 const row=runDecisionCycle({},context({predictions:[]}),T).bosses[0];assert.equal(row.status,'INSUFFICIENT_DATA');assert.equal(row.priorityScore,null);assert.equal(row.state,'INSUFFICIENT_DATA');
});
test('Next Best Source uses measured reliability latency health and information gap',()=>{
 const c=context({coverage:45,sourceHealth:'HEALTHY'});c.investigation.sources[0].reliability=98;c.investigation.sources[0].firstDetectionRate=80;c.investigation.sources[0].latency={averageDelayMinutes:2};c.investigation.sources[1].reliability=60;c.investigation.sources[1].firstDetectionRate=10;c.investigation.sources[1].latency={averageDelayMinutes:90};
 const row=runDecisionCycle({},c,T).bosses[0];assert.equal(row.nextBestSource.sourceId,'rubinot-official');assert.ok(row.nextBestSource.valueOfInformation>0);assert.ok(row.sourceRanking[0].valueOfInformation>=row.sourceRanking[1].valueOfInformation);
});
test('Follow closely changes refresh cadence but never model probability or priority formula input',()=>{
 const state={},before=runDecisionCycle(state,context({coverage:80}),T).bosses[0];applyAttentionAction(state,{world:'Lunarian',boss:'Ferumbras',action:'FOLLOW_CLOSELY'},T+1000);const after=runDecisionCycle(state,context({coverage:80}),T+60000).bosses[0];
 assert.equal(before.modelProbability,after.modelProbability);assert.equal(after.attention.followClosely,true);assert.ok(after.polling.intervalMs<=60000);assert.equal(DECISION_ENGINE_VERSION,'1.0.0');
});
test('Operations metrics are prospective and report insufficient data before enough confirmed events',()=>{
 const state={};ensureOperations(state,T);runDecisionCycle(state,context(),T);const m=operationsMetrics(state,context().intelligence,'Lunarian',T+H);assert.equal(m.status,'INSUFFICIENT_DATA');assert.equal(m.confirmedEvents,0);assert.equal(m.top1HitRate,null);
});

test('Decision challenger runs only in Shadow and backtest stays insufficient before prospective sample',()=>{
 const state={},c=context({coverage:55});runDecisionCycle(state,c,T);const row=state.operations.current.bosses[0],metrics=operationsMetrics(state,c.intelligence,'Lunarian',T+H);
 assert.equal(state.operations.decisionChampion.status,'CHAMPION');assert.equal(state.operations.challengers[0].status,'SHADOW');assert.ok(Number.isFinite(row.shadowPriority.score));assert.equal(metrics.decisionModels.autoPromotion,false);assert.equal(metrics.decisionModels.decision,'INSUFFICIENT_DATA');assert.equal(metrics.decisionModels.challengers[0].status,'SHADOW');
});
test('Daily operations review exposes real investigation detection path without inventing missing signals',()=>{
 const state={},c=context();c.investigation.cases=[{id:'i1',candidateId:'c1',boss:'Ferumbras',world:'Lunarian',status:'CONFIRMED',decidedAt:T+10*60000,evidence:[{id:'e1',sourceId:'whatsapp-group',positive:true,canConfirm:true,observedAt:T,evidenceStrength:.7},{id:'e2',sourceId:'rubinot-official',positive:true,canConfirm:true,observedAt:T+2*60000,evidenceStrength:.95}]}];runDecisionCycle(state,c,T);const d=dailyOperationsReview(state,c.intelligence,c.investigation,'Lunarian',T+H);
 assert.equal(d.detectionPaths.length,1);assert.equal(d.detectionPaths[0].firstSignal.sourceId,'whatsapp-group');assert.equal(d.detectionPaths[0].decisiveSignal.sourceId,'rubinot-official');assert.equal(d.status,'INSUFFICIENT_DATA');
});


import test from 'node:test';
import assert from 'node:assert/strict';
import {createInvestigationEngine} from './investigation/engine.mjs';
import {assessCandidate,calibrateCandidate,historicalContext} from './investigation/scoring.mjs';
import {sourceHealth} from './investigation/source-adapters.mjs';

const candidate=(at=Date.now())=>({id:'cand-1',boss:'Ferumbras',world:'Lunarian',firstEvidenceAt:at,lastEvidenceAt:at,estimatedAt:at,evidence:[
 {id:'wa-1',bossCandidates:[{name:'Ferumbras',matchType:'EXACT',similarity:1}],contextClassification:'POSSIBLE_REPORT',messageTimestamp:at,capturedTimestamp:at+100,receivedAt:at+200,authorHash:'a'.repeat(64),reporter:{samples:100,reliability:92}},
 {id:'wa-2',bossCandidates:[{name:'Ferumbras',matchType:'EXACT',similarity:1}],contextClassification:'CONFIRMATION',messageTimestamp:at+1000,capturedTimestamp:at+1100,receivedAt:at+1200,authorHash:'b'.repeat(64),reporter:{samples:80,reliability:90}}
]});
const emptySnapshot=world=>({sources:[{id:'whatsapp-group',name:'WhatsApp',kind:'community',active:true,reliability:80,evaluatedRecords:20,circuitState:'CLOSED'}],events:[],predictions:[]});

test('candidate confidence stays explicitly uncalibrated with insufficient human decisions',()=>{
 const a=assessCandidate({evidence:[{id:'1',positive:true,negative:false,canConfirm:true,independenceKey:'a',sourceKind:'community',sourceHealth:'HEALTHY',evidenceStrength:.8,freshness:1,estimatedAt:1000}],history:{plausibility:.7,anomaly:{score:.1,level:'LOW'}},coveragePct:99,decisions:[]});
 assert.equal(a.calibration.status,'INSUFFICIENT_DATA');assert.equal(a.calibration.value,null);assert.notEqual(a.recommendation,'CONFIRM_RECOMMENDED');
});

test('prediction compatibility is context only and cannot act as independent confirmation',()=>{
 const at=10*86400000,snapshot={events:[],predictions:[{boss:'Ferumbras',status:'ready',windowStart:at-60000,windowEnd:at+60000,confidence:95}]},h=historicalContext(candidate(at),snapshot);
 assert.equal(h.predictionCompatibility.level,'HIGH');
 const a=assessCandidate({evidence:[],history:h,coveragePct:100,decisions:Array.from({length:30},(_,i)=>({rawScore:90,outcome:'CONFIRMED'}))});
 assert.equal(a.consensus.independentEvidence,0);assert.notEqual(a.recommendation,'CONFIRM_RECOMMENDED');
});

test('calibration needs at least twenty resolved decisions in the score band',()=>{
 const few=Array.from({length:19},()=>({rawScore:85,outcome:'CONFIRMED'}));assert.equal(calibrateCandidate(85,few).status,'INSUFFICIENT_DATA');
 const enough=Array.from({length:20},(_,i)=>({rawScore:85,outcome:i<17?'CONFIRMED':'REJECTED'}));assert.equal(calibrateCandidate(85,enough).status,'CALIBRATED');
});

test('source health distinguishes unavailable and degraded sources from no signal',()=>{
 assert.equal(sourceHealth({active:false}),'OFFLINE');assert.equal(sourceHealth({active:true,circuitState:'OPEN',circuitReason:'technical'}),'ERROR');assert.equal(sourceHealth({active:true,circuitState:'HALF_OPEN'}),'DEGRADED');
});

test('investigation starts automatically, remains human-gated and learns only after decision',async()=>{
 const state={whatsapp:{coverageSegments:[{startAt:Date.now()-86400000,endAt:Date.now()}]}},writes=[];let saved=0;
 const engine=createInvestigationEngine({state,persist:async()=>{saved++;},broadcast:()=>{},getSnapshot:emptySnapshot,refreshSources:async()=>{}});
 const c=await engine.investigate(candidate(),{forceSources:true});assert.equal(c.status,'ACTIVE');assert.ok(c.rawScore>0);assert.equal(state.investigation.decisions.length,0);assert.equal(c.calibrationStatus,'INSUFFICIENT_DATA');
 await engine.recordDecision(candidate(),{outcome:'CONFIRMED',finalBoss:'Ferumbras',finalAt:Date.now()-1000});assert.equal(state.investigation.decisions.length,1);assert.equal(state.investigation.cases[0].status,'CONFIRMED');assert.ok(state.investigation.reporterProfiles['a'.repeat(64)]);assert.ok(saved>0);
});

test('investigation safe failure preserves candidate and requires manual review',async()=>{
 const state={whatsapp:{coverageSegments:[]}},engine=createInvestigationEngine({state,persist:async()=>{},broadcast:()=>{},getSnapshot:emptySnapshot,refreshSources:async()=>{throw new Error('offline');}});
 const c=await engine.investigate(candidate(),{forceSources:true});assert.equal(c.status,'MANUAL_REVIEW_REQUIRED');assert.equal(c.recommendation,'REVIEW_RECOMMENDED');assert.match(c.sourceError,/offline/);
});

test('missed detection is only declared when Lunarian coverage supports the conclusion',async()=>{
 const now=Date.now(),event={id:'ev-1',boss:'Ferumbras',world:'Lunarian',status:'confirmed_consensus',eventType:'appearance',estimatedAt:now-5*60000,confirmingSources:['otbosstracker']};
 const state={whatsapp:{coverageSegments:[]}},engine=createInvestigationEngine({state,persist:async()=>{},broadcast:()=>{},getSnapshot:emptySnapshot});
 await engine.reconcileConfirmed({events:[event]});assert.equal(state.investigation.missed[0].kind,'COVERAGE_INSUFFICIENT');
 const state2={whatsapp:{coverageSegments:[{startAt:event.estimatedAt-20*60000,endAt:event.estimatedAt+20*60000}]}},engine2=createInvestigationEngine({state:state2,persist:async()=>{},broadcast:()=>{},getSnapshot:emptySnapshot});
 await engine2.reconcileConfirmed({events:[event]});assert.equal(state2.investigation.missed[0].kind,'MISSED_DETECTION');
});

test('backtest uses immutable decision snapshots instead of recomputing future evidence',async()=>{
 const state={whatsapp:{coverageSegments:[]}},engine=createInvestigationEngine({state,persist:async()=>{},broadcast:()=>{},getSnapshot:emptySnapshot});
 for(let i=0;i<3;i++){const c={...candidate(Date.now()+i),id:'cand-'+i};await engine.investigate(c);await engine.recordDecision(c,{outcome:i<2?'CONFIRMED':'REJECTED',finalAt:Date.now()});}
 const b=engine.backtest();assert.equal(b.temporal,true);assert.equal(b.samples,3);assert.match(b.note,/snapshot imutável/);
});

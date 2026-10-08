import {traceEvents} from './operational-state.mjs';

const STAGE={
 MESSAGE_CAPTURED:1,EVIDENCE_CREATED:2,CANDIDATE_CREATED:3,CANDIDATE_UPDATED:3,CANDIDATE_NOTIFICATION_PLANNED:4,
 CANDIDATE_INVESTIGATION_QUEUED:5,INVESTIGATION_PROCESSED:6,HUMAN_DECISION_QUEUED:7,INVESTIGATION_DECISION_PROCESSED:8,
 CONFIRMED_EVENT_QUEUED_FOR_INTELLIGENCE:9,INTELLIGENCE_INGESTED:10,PREDICTION_UPDATED:11,OUTBOX_ENQUEUED:0,OUTBOX_DELIVERED:0,
 OUTBOX_RETRY_SCHEDULED:0,OUTBOX_DEAD_LETTER:0,INCIDENT_OPENED:0,INCIDENT_RESOLVED:0
};
const terminal=new Set(['INTELLIGENCE_INGESTED','INVESTIGATION_DECISION_PROCESSED']);
export function replayCorrelation(state,correlationId){
 const events=traceEvents(state,correlationId).sort((a,b)=>a.sequence-b.sequence),violations=[];let highest=0,terminalSeen=false;
 for(const e of events){const stage=STAGE[e.type]??0;if(stage&&stage<highest&&!['CANDIDATE_UPDATED'].includes(e.type))violations.push({sequence:e.sequence,type:e.type,kind:'OUT_OF_ORDER',previousStage:highest,currentStage:stage});if(stage)highest=Math.max(highest,stage);if(terminal.has(e.type)){if(terminalSeen&&e.type==='INTELLIGENCE_INGESTED')violations.push({sequence:e.sequence,type:e.type,kind:'DUPLICATE_TERMINAL_EFFECT'});terminalSeen=true;}}
 const pending=state.operational?.outbox?.filter(x=>x.correlationId===correlationId&&x.status==='PENDING').map(x=>({id:x.id,kind:x.kind,attempts:x.attempts,nextAttemptAt:x.nextAttemptAt,priority:x.priority}))||[];
 const dlq=(state.pipelineDeadLetters||[]).filter(x=>x.correlationId===correlationId&&x.status==='failed').map(x=>({id:x.id,name:x.name,error:x.error,attempts:x.attempts,at:x.at}));
 const candidate=(state.whatsapp?.candidates||[]).find(x=>x.correlationId===correlationId)||null;
 const evidence=(state.whatsapp?.communityEvidence||[]).filter(x=>x.correlationId===correlationId);
 const investigation=(state.investigation?.cases||[]).find(x=>x.candidateId===candidate?.id)||null;
 const checks=(state.groupChecks||[]).filter(x=>x.correlationId===correlationId);
 return {correlationId,status:events.length?'REPLAYED':'NOT_FOUND',events,violations,pending,deadLetters:dlq,state:{evidenceIds:evidence.map(x=>x.id),candidate:candidate?{id:candidate.id,status:candidate.status,boss:candidate.boss,world:candidate.world}:null,investigation:investigation?{id:investigation.id,status:investigation.status,recommendation:investigation.recommendation}:null,checkIds:checks.map(x=>x.id)},replaySafe:violations.length===0&&dlq.length===0};
}

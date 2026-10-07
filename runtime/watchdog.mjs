import {appendOperationalEvent,componentView,componentViews,heartbeat,openIncident,recoveryAllowed,noteRecoveryAttempt,resetRecovery,resolveIncident,reliabilitySummary,evaluateSafeMode,ensureOperational} from './operational-state.mjs';

const severityFor=status=>status==='FAILED'?'critical':status==='UNAVAILABLE'?'high':'medium';
export function createWatchdog({state,persist=async()=>{},broadcast=()=>{},recoveries={},context=()=>({})}={}){
 ensureOperational(state);let checking=false,lastCheckAt=0;
 async function beat(id,input={},at=Date.now()){const row=heartbeat(state,id,input,at);if(row.status==='HEALTHY'){resetRecovery(state,id,at);for(const incident of state.operational.incidents.filter(x=>x.status==='OPEN'&&x.component===id))resolveIncident(state,incident.id,{autoRecovered:!!state.operational.recovery[id]?.lastAttemptAt,resolution:'Componente voltou a responder aos checks reais.'},at);}return row;}
 async function attemptRecovery(c,incident,at){
  const fn=recoveries[c.id];if(!fn||!recoveryAllowed(state,c.id,at))return false;
  heartbeat(state,c.id,{status:'RECOVERING',reason:'Auto-recovery em andamento.',critical:c.critical,expectedIntervalMs:c.expectedIntervalMs,staleAfterMs:c.staleAfterMs,metrics:c.metrics,details:c.details},at);
  appendOperationalEvent(state,'AUTO_RECOVERY_STARTED',{component:c.id,incidentId:incident.id},{at,correlationId:incident.correlationId});
  try{const result=await fn({component:c,incident,at}),finishedAt=Math.max(at,Date.now()),healthy=result?.ok!==false&&result?.healthy!==false,error=healthy?'':result?.error||result?.reason||'Recovery executou, mas a saúde não foi validada';const recovery=noteRecoveryAttempt(state,c.id,{ok:healthy,error,correlationId:incident.correlationId},finishedAt);incident.recoveryAttempts=recovery.attempts;if(healthy){heartbeat(state,c.id,{status:'HEALTHY',reason:result.reason||'Recuperação validada.',critical:c.critical,expectedIntervalMs:c.expectedIntervalMs,staleAfterMs:c.staleAfterMs,metrics:result.metrics||c.metrics,details:result.details||c.details},finishedAt);resolveIncident(state,incident.id,{autoRecovered:true,resolution:result.reason||'Auto-recovery validado.'},finishedAt);return true;}if(recovery.manualRequired){incident.severity='critical';incident.reason=(incident.reason?incident.reason+' · ':'')+'Auto-recovery esgotado; atenção manual necessária.';}return false;}
  catch(e){const finishedAt=Math.max(at,Date.now()),recovery=noteRecoveryAttempt(state,c.id,{ok:false,error:e?.message||e,correlationId:incident.correlationId},finishedAt);incident.recoveryAttempts=recovery.attempts;if(recovery.manualRequired){incident.severity='critical';incident.reason=(incident.reason?incident.reason+' · ':'')+'Auto-recovery esgotado; atenção manual necessária.';}return false;}
 }
 async function check(at=Date.now()){
  if(checking)return publicState(at);checking=true;try{lastCheckAt=at;heartbeat(state,'backend',{status:'HEALTHY',reason:'Watchdog executando.',critical:true,expectedIntervalMs:60000,staleAfterMs:180000,activityAt:at},at);
   for(const c of componentViews(state,at)){
    if(c.id==='backend')continue;
    if(['UNAVAILABLE','FAILED'].includes(c.effectiveStatus)||c.effectiveStatus==='DEGRADED'&&c.critical){
      const {incident}=openIncident(state,{component:c.id,kind:c.stale?'HEARTBEAT_TIMEOUT':'COMPONENT_DEGRADED',severity:severityFor(c.effectiveStatus),reason:c.reason,startedAt:c.lastHealthyAt||c.lastHeartbeatAt||at,correlationId:'health:'+c.id},at);
      await attemptRecovery(c,incident,at);
    }else if(c.effectiveStatus==='HEALTHY'){
      for(const incident of state.operational.incidents.filter(x=>x.status==='OPEN'&&x.component===c.id))resolveIncident(state,incident.id,{autoRecovered:!!state.operational.recovery[c.id]?.lastAttemptAt,resolution:'Health check validou recuperação.'},at);
    }
   }
   const ctx=context()||{};evaluateSafeMode(state,ctx,at);await persist();broadcast('health',{at,safeMode:state.operational.safeMode});return publicState(at);
  }finally{checking=false;}
 }
 function publicState(at=Date.now()){const summary=reliabilitySummary(state,at);return {...summary,lastCheckAt,recovery:structuredClone(state.operational.recovery),openIncidents:state.operational.incidents.filter(x=>x.status==='OPEN').slice(0,100),recentIncidents:state.operational.incidents.slice(0,200)};}
 function markManualIncident(input,at=Date.now()){const row=openIncident(state,input,at);void persist();broadcast('health',{at});return row.incident;}
 async function resolve(id,input={}){const x=resolveIncident(state,id,{autoRecovered:false,resolution:input.resolution||'Resolvido manualmente.',rootCause:input.rootCause||''},Date.now());if(!x)throw new Error('Incidente não encontrado');await persist();broadcast('health',{at:Date.now()});return x;}
 async function retry(component){const c=componentView(state,component);const incident=state.operational.incidents.find(x=>x.status==='OPEN'&&x.component===component);if(!incident)throw new Error('Nenhum incidente aberto para este componente');const r=state.operational.recovery[component];if(r){r.manualRequired=false;r.attempts=Math.min(r.attempts,2);r.nextAttemptAt=0;}await attemptRecovery(c,incident,Date.now());await persist();return publicState();}
 return {beat,check,publicState,markManualIncident,resolve,retry,get lastCheckAt(){return lastCheckAt;}};
}

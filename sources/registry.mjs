export const SOURCE_DEFINITIONS={
  'rubinot-catalog':{name:'RubinOT Tools · catálogo',kind:'catalog',baseWeight:.95,active:true,eventEvidence:false},
  'rubinot-official':{name:'RubinOT · estatísticas oficiais',kind:'official',baseWeight:.9,active:true,eventEvidence:true},
  'otbosstracker':{name:'OT Boss Tracker',kind:'community',baseWeight:.82,active:true,eventEvidence:true},
  'manual-panel':{name:'Confirmação manual no painel',kind:'manual',baseWeight:.97,active:true,eventEvidence:true},
  'whatsapp-group':{name:'WhatsApp · grupo autorizado',kind:'community',baseWeight:.76,active:true,eventEvidence:true},
  'group-import':{name:'Rodada do grupo',kind:'manual',baseWeight:.88,active:true,eventEvidence:true},
  'rubinot-hub':{name:'RubinOT Hub / RubinOTBosses',kind:'community',baseWeight:.7,active:false,eventEvidence:true,note:'Conector preparado. Ative apenas quando houver endpoint/API pública e autorização compatível.'},
  'external-api':{name:'API externa configurável',kind:'external',baseWeight:.7,active:false,eventEvidence:true,note:'Reservado para integrações futuras autorizadas.'}
};
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
export function ensureSources(value={}){
  for(const [id,d] of Object.entries(SOURCE_DEFINITIONS)){
    const old=value[id]||{};
    value[id]={id,name:d.name,kind:d.kind,baseWeight:d.baseWeight,active:d.active,eventEvidence:d.eventEvidence,note:d.note||'',alpha:Number(old.alpha)||8*d.baseWeight,beta:Number(old.beta)||8*(1-d.baseWeight),requests:Number(old.requests)||0,successes:Number(old.successes)||0,records:Number(old.records)||0,errors:Number(old.errors)||0,evaluatedRecords:Number(old.evaluatedRecords)||0,correctRecords:Number(old.correctRecords)||0,incorrectRecords:Number(old.incorrectRecords)||0,duplicates:Number(old.duplicates)||0,totalErrorMs:Number(old.totalErrorMs)||0,preciseEvaluatedRecords:Number(old.preciseEvaluatedRecords)||0,preciseCorrectRecords:Number(old.preciseCorrectRecords)||0,preciseTotalErrorMs:Number(old.preciseTotalErrorMs)||0,totalDelayMs:Number(old.totalDelayMs)||0,delaySamples:Number(old.delaySamples)||0,consistencySum:Number(old.consistencySum)||0,consistencySamples:Number(old.consistencySamples)||0,consecutiveFailures:Number(old.consecutiveFailures)||0,circuitState:old.circuitState||'CLOSED',circuitReason:old.circuitReason||null,qualityRecoverySuccesses:Number(old.qualityRecoverySuccesses)||0,suspendedUntil:Number(old.suspendedUntil)||0,lastAttempt:Number(old.lastAttempt)||0,lastSuccess:Number(old.lastSuccess)||0,lastRecordAt:Number(old.lastRecordAt)||0,lastLatencyMs:Number(old.lastLatencyMs)||0,totalLatencyMs:Number(old.totalLatencyMs)||0,lastError:String(old.lastError||''),recentOutcomes:Array.isArray(old.recentOutcomes)?old.recentOutcomes.slice(-100):[],...old};value[id].recentOutcomes=Array.isArray(value[id].recentOutcomes)?value[id].recentOutcomes.slice(-100):[];
  }
  return value;
}
export function sourceWeight(source){
  const posterior=source.alpha/(source.alpha+source.beta);
  const circuit=source.circuitState==='OPEN'&&source.suspendedUntil>Date.now()?.15:source.circuitState==='HALF_OPEN'?.65:1;
  const consistency=source.consistencySamples?clamp(source.consistencySum/source.consistencySamples,.2,1):1;
  const recent=(source.recentOutcomes||[]).slice(-30),recentAccuracy=recent.length>=5?recent.reduce((n,x)=>n+(x.correct?1:0),0)/recent.length:null,recentFactor=recentAccuracy==null?posterior:recentAccuracy;
  return clamp((source.baseWeight*.38+posterior*.32+recentFactor*.2+.1*consistency)*circuit,.05,.99);
}
export function noteSource(sources,id,{ok,records=0,latencyMs=0,error='',at=Date.now()}={}){
  ensureSources(sources);const s=sources[id];if(!s)return;
  s.requests++;s.lastAttempt=at;s.lastLatencyMs=Math.max(0,Math.round(latencyMs));s.totalLatencyMs=(Number(s.totalLatencyMs)||0)+s.lastLatencyMs;
  if(ok){
    s.successes++;s.lastSuccess=at;s.consecutiveFailures=0;if(records>0){s.records+=records;s.lastRecordAt=at;}
    if(s.circuitState==='HALF_OPEN'&&s.circuitReason==='quality'){s.lastError='Fonte em recuperação de qualidade; aguardando evidências corretas.';}
    else{s.lastError='';s.circuitState='CLOSED';s.circuitReason=null;s.qualityRecoverySuccesses=0;s.suspendedUntil=0;}
  } else {
    s.errors++;s.consecutiveFailures=(s.consecutiveFailures||0)+1;s.lastError=String(error||'Falha na fonte').slice(0,300);
    if(s.consecutiveFailures>=3){s.circuitState='OPEN';s.circuitReason='technical';s.qualityRecoverySuccesses=0;s.suspendedUntil=at+Math.min(30*60000,5*60000*Math.pow(2,Math.min(3,s.consecutiveFailures-3)));}
  }
}
export function sourcePublic(sources){
  ensureSources(sources);return Object.values(sources).map(s=>({...s,reliability:Math.round(sourceWeight(s)*100),successRate:s.requests?Math.round(100*s.successes/s.requests):null,accuracyRate:s.evaluatedRecords?Math.round(1000*s.correctRecords/s.evaluatedRecords)/10:null,averageErrorMinutes:s.preciseEvaluatedRecords?Math.round((s.preciseTotalErrorMs||0)/s.preciseEvaluatedRecords/6000)/10:null,preciseAccuracyRate:s.preciseEvaluatedRecords?Math.round(1000*(s.preciseCorrectRecords||0)/s.preciseEvaluatedRecords)/10:null,averageDelayMinutes:s.delaySamples?Math.round((s.totalDelayMs||0)/s.delaySamples/6000)/10:null,consistency:s.consistencySamples?Math.round(1000*s.consistencySum/s.consistencySamples)/10:null,averageLatencyMs:s.requests?Math.round((s.totalLatencyMs||0)/s.requests):null,recentAccuracy:(s.recentOutcomes||[]).length>=5?Math.round(1000*(s.recentOutcomes||[]).slice(-30).filter(x=>x.correct).length/Math.min(30,(s.recentOutcomes||[]).length))/10:null,recentSamples:Math.min(30,(s.recentOutcomes||[]).length)})).sort((a,b)=>Number(b.active)-Number(a.active)||b.reliability-a.reliability);
}

export function noteDuplicate(sources,id){ensureSources(sources);const s=sources[id];if(s)s.duplicates=(s.duplicates||0)+1;}
export function noteEvidenceOutcome(sources,id,{correct,errorMs=0,delayMs=null,consistency=null,precision=null,at=Date.now(),updateCircuit=true}={}){
 ensureSources(sources);const s=sources[id];if(!s)return;s.evaluatedRecords=(s.evaluatedRecords||0)+1;if(correct)s.correctRecords=(s.correctRecords||0)+1;else s.incorrectRecords=(s.incorrectRecords||0)+1;
 if(Number.isFinite(errorMs)){s.totalErrorMs=(s.totalErrorMs||0)+Math.max(0,errorMs);if(['minute','hour'].includes(precision)){s.preciseEvaluatedRecords=(s.preciseEvaluatedRecords||0)+1;s.preciseTotalErrorMs=(s.preciseTotalErrorMs||0)+Math.max(0,errorMs);if(correct)s.preciseCorrectRecords=(s.preciseCorrectRecords||0)+1;}}
 if(Number.isFinite(delayMs)){s.totalDelayMs=(s.totalDelayMs||0)+Math.max(0,delayMs);s.delaySamples=(s.delaySamples||0)+1;}
 if(Number.isFinite(consistency)){s.consistencySum=(s.consistencySum||0)+clamp(consistency,0,1);s.consistencySamples=(s.consistencySamples||0)+1;}
 s.recentOutcomes ||= [];s.recentOutcomes.push({at,correct:!!correct,errorMs:Number.isFinite(errorMs)?Math.max(0,errorMs):null,precision:precision||null,consistency:Number.isFinite(consistency)?clamp(consistency,0,1):null});if(s.recentOutcomes.length>100)s.recentOutcomes.splice(0,s.recentOutcomes.length-100);
 if(updateCircuit&&s.kind!=='manual'){
   if(s.circuitState==='HALF_OPEN'&&s.circuitReason==='quality'){
     if(correct){s.qualityRecoverySuccesses=(s.qualityRecoverySuccesses||0)+1;if(s.qualityRecoverySuccesses>=3){s.circuitState='CLOSED';s.circuitReason=null;s.suspendedUntil=0;s.lastError='';s.qualityRecoverySuccesses=0;}}
     else{s.qualityRecoverySuccesses=0;s.circuitState='OPEN';s.suspendedUntil=Math.max(s.suspendedUntil||0,at+15*60000);s.lastError='Recuperação de qualidade falhou; fonte novamente em quarentena.';}
   }else{
     const recent=s.recentOutcomes.slice(-12),accuracy=recent.length?recent.reduce((n,x)=>n+(x.correct?1:0),0)/recent.length:1;
     if(recent.length>=8&&accuracy<.35){s.circuitState='OPEN';s.circuitReason='quality';s.qualityRecoverySuccesses=0;s.suspendedUntil=Math.max(s.suspendedUntil||0,at+15*60000);s.lastError='Fonte suspensa por deterioração recente da qualidade dos dados.';}
   }
 }
}
export function canAttemptSource(sources,id,now=Date.now()){
 ensureSources(sources);const s=sources[id];if(!s||!s.active)return false;
 if(s.circuitState==='OPEN'&&s.suspendedUntil>now)return false;
 if(s.circuitState==='OPEN'&&s.suspendedUntil<=now)s.circuitState='HALF_OPEN';
 return true;
}

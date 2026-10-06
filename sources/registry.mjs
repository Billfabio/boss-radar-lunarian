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
    value[id]={id,name:d.name,kind:d.kind,baseWeight:d.baseWeight,active:d.active,eventEvidence:d.eventEvidence,note:d.note||'',alpha:Number(old.alpha)||8*d.baseWeight,beta:Number(old.beta)||8*(1-d.baseWeight),requests:Number(old.requests)||0,successes:Number(old.successes)||0,records:Number(old.records)||0,errors:Number(old.errors)||0,lastAttempt:Number(old.lastAttempt)||0,lastSuccess:Number(old.lastSuccess)||0,lastRecordAt:Number(old.lastRecordAt)||0,lastLatencyMs:Number(old.lastLatencyMs)||0,totalLatencyMs:Number(old.totalLatencyMs)||0,lastError:String(old.lastError||''),...old};
  }
  return value;
}
export function sourceWeight(source){
  const posterior=source.alpha/(source.alpha+source.beta);
  return clamp(source.baseWeight*.55+posterior*.45,.2,.99);
}
export function noteSource(sources,id,{ok,records=0,latencyMs=0,error='',at=Date.now()}={}){
  ensureSources(sources);const s=sources[id];if(!s)return;
  s.requests++;s.lastAttempt=at;s.lastLatencyMs=Math.max(0,Math.round(latencyMs));s.totalLatencyMs=(Number(s.totalLatencyMs)||0)+s.lastLatencyMs;
  if(ok){s.successes++;s.lastSuccess=at;s.lastError='';if(records>0){s.records+=records;s.lastRecordAt=at;}}
  else{s.errors++;s.lastError=String(error||'Falha na fonte').slice(0,300);}
}
export function sourcePublic(sources){
  ensureSources(sources);return Object.values(sources).map(s=>({...s,reliability:Math.round(sourceWeight(s)*100),successRate:s.requests?Math.round(100*s.successes/s.requests):null,averageLatencyMs:s.requests?Math.round((s.totalLatencyMs||0)/s.requests):null})).sort((a,b)=>Number(b.active)-Number(a.active)||b.reliability-a.reliability);
}

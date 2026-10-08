import {createHash} from 'node:crypto';

export const EVIDENCE_TYPES=new Set(['COMMUNITY_REPORT','COMMUNITY_CONFIRMATION','COMMUNITY_NEGATION','WEBSITE_SIGNAL','API_SIGNAL','MANUAL_SIGNAL','SCREENSHOT_SIGNAL','HISTORICAL_SIGNAL','MODEL_SIGNAL','OFFICIAL_SIGNAL']);
const MIN=60000,clamp=(n,a=0,b=1)=>Math.max(a,Math.min(b,n));
export const investigationDigest=value=>createHash('sha256').update(String(value)).digest('hex');

export function freshnessScore(observedAt,now=Date.now(),halfLifeMs=45*MIN){
 if(!Number.isFinite(observedAt))return .55;
 const age=Math.max(0,now-observedAt);return clamp(Math.pow(.5,age/Math.max(MIN,halfLifeMs)),.08,1);
}
export function profilePosterior(profile,boss=null){
 const scoped=boss&&profile?.byBoss?.[boss],p=scoped||profile||{},alpha=Number(p.alpha)||2,beta=Number(p.beta)||2,samples=Math.max(0,alpha+beta-4);
 return {value:alpha/(alpha+beta),samples,alpha,beta,scope:scoped?'boss':'global'};
}
export function contextEvidenceType(context){
 if(context==='CONFIRMATION')return 'COMMUNITY_CONFIRMATION';
 if(context==='NEGATION')return 'COMMUNITY_NEGATION';
 if(context==='CORRECTION')return 'COMMUNITY_REPORT';
 return 'COMMUNITY_REPORT';
}
export function contextStrength(context){
 return {CONFIRMATION:.9,POSSIBLE_REPORT:.76,CORRECTION:.82,NEGATION:.78,QUESTION:.12,SPECULATION:.16,UNKNOWN:.08}[context]??.08;
}
export function communityEvidence(candidate,reporterProfiles={},now=Date.now()){
 return (candidate.evidence||[]).map(row=>{
  const match=(row.bossCandidates||[]).find(x=>x.name===candidate.boss)||(row.bossCandidates||[])[0],profile=row.authorHash?profilePosterior(reporterProfiles[row.authorHash],candidate.boss):{value:.5,samples:0,scope:'anonymous'};
  const fallback=row.reporter?.samples?Math.max(.05,Math.min(.99,Number(row.reporter.reliability)/100)):.5,reliability=profile.samples?profile.value:fallback;
  const observedAt=Number(row.messageTimestamp)||Number(row.capturedTimestamp)||Number(row.receivedAt)||now,freshness=freshnessScore(observedAt,now),similarity=clamp(Number(match?.similarity)||0);
  const strength=clamp(contextStrength(row.contextClassification)*(.55+.45*similarity)*(.55+.45*reliability)*freshness),textHash=row.textHash||investigationDigest(String(row.text||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim()).slice(0,20);
  const positive=['POSSIBLE_REPORT','CONFIRMATION','CORRECTION'].includes(row.contextClassification),negative=row.contextClassification==='NEGATION';
  return {id:'inv-wa-'+investigationDigest(row.id||row.messageFingerprint).slice(0,28),candidateId:candidate.id,type:contextEvidenceType(row.contextClassification),sourceId:'whatsapp-group',sourceKind:'community',boss:candidate.boss,world:candidate.world,observedAt,receivedAt:Number(row.receivedAt)||now,estimatedAt:Number(row.messageTimestamp)||null,authorHash:row.authorHash||null,independenceKey:row.authorHash?'reporter:'+row.authorHash:'message:'+String(row.id||''),reliability,sampleSize:profile.samples,freshness,matchSimilarity:similarity,evidenceStrength:strength,positive,negative,canConfirm:positive||negative,contextClassification:row.contextClassification,sourceHealth:'HEALTHY',detail:{matchType:match?.matchType||null,matched:match?.matched||null,textHash}};
 });
}
export function updateProfile(store,key,boss,success,weight=1,at=Date.now()){
 if(!key)return null;let p=store[key];if(!p)p=store[key]={alpha:2,beta:2,byBoss:{},lastAt:at};p.byBoss||={};
 const days=Math.max(0,(at-(p.lastAt||at))/86400000),decay=Math.pow(.5,days/120);
 p.alpha=2+(Math.max(2,Number(p.alpha)||2)-2)*decay;p.beta=2+(Math.max(2,Number(p.beta)||2)-2)*decay;
 p.alpha+=success?weight:0;p.beta+=success?0:weight;
 if(boss){let b=p.byBoss[boss];if(!b)b=p.byBoss[boss]={alpha:2,beta:2,lastAt:at};const bd=Math.max(0,(at-(b.lastAt||at))/86400000),d=Math.pow(.5,bd/120);b.alpha=2+(b.alpha-2)*d;b.beta=2+(b.beta-2)*d;b.alpha+=success?weight:0;b.beta+=success?0:weight;b.lastAt=at;}
 p.lastAt=at;return p;
}

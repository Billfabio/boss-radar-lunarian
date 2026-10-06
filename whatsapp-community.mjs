import {createHash} from 'node:crypto';
const H=3600000,MIN=60000,digest=v=>createHash('sha256').update(String(v)).digest('hex');
const pos=new Set(['POSSIBLE_REPORT','CONFIRMATION','CORRECTION']);
export function evidenceId(e){return 'wae-'+digest(e.messageFingerprint||JSON.stringify([e.group,e.messageTimestamp,e.normalizedText])).slice(0,28);}
export function candidateScore(evidence){
 const rows=evidence||[],people=new Set(rows.map(x=>x.authorHash).filter(Boolean)).size,groups=new Map();
 for(const x of rows){const key=x.authorHash||'anonymous';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(x);}
 const match=rows.reduce((m,x)=>Math.max(m,...(x.bossCandidates||[]).map(c=>Number(c.similarity)||0)),0);
 const positives=[...groups.values()].filter(g=>g.some(x=>pos.has(x.contextClassification))).length;
 const confirmations=[...groups.values()].filter(g=>g.some(x=>x.contextClassification==='CONFIRMATION')).length;
 return Math.max(0,Math.min(99,Math.round(25+match*35+Math.min(20,people*5)+Math.min(15,positives*3)+Math.min(10,confirmations*5))));
}
export function mergeEvidence(candidates,evidence,{windowMs=15*MIN}={}){
 const boss=evidence.bossCandidates?.[0]?.name;if(!boss)return null;
 const at=Number(evidence.messageTimestamp)||Number(evidence.capturedTimestamp)||Date.now();
 let c=candidates.find(x=>x.status==='PENDING'&&x.world===evidence.world&&x.boss===boss&&Math.abs((x.lastEvidenceAt||x.firstEvidenceAt)-at)<=windowMs);
 if(!c&&!pos.has(evidence.contextClassification))return null;
 if(!c){c={id:'cand-'+digest([evidence.world,boss,Math.floor(at/windowMs)].join('|')).slice(0,24),boss,world:evidence.world,status:'PENDING',firstEvidenceAt:at,lastEvidenceAt:at,evidenceIds:[],createdAt:Date.now(),updatedAt:Date.now(),investigation:{status:'PENDING'}};candidates.unshift(c);}
 if(!c.evidenceIds.includes(evidence.id))c.evidenceIds.push(evidence.id);
 c.firstEvidenceAt=Math.min(c.firstEvidenceAt,at);c.lastEvidenceAt=Math.max(c.lastEvidenceAt,at);c.updatedAt=Date.now();return c;
}
export function enrichCandidate(candidate,evidence){
 const rows=(evidence||[]).filter(x=>candidate.evidenceIds.includes(x.id));
 const people=new Set(rows.map(x=>x.authorHash).filter(Boolean));
 candidate.participants=people.size;candidate.messages=rows.length;candidate.score=candidateScore(rows);
 candidate.exactMatches=rows.reduce((n,x)=>n+((x.bossCandidates||[]).some(c=>c.matchType==='EXACT'||c.matchType==='ALIAS')?1:0),0);
 candidate.fuzzyMatches=rows.reduce((n,x)=>n+((x.bossCandidates||[]).some(c=>c.matchType==='FUZZY')?1:0),0);
 candidate.contexts=Object.fromEntries([...new Set(rows.map(x=>x.contextClassification))].map(k=>[k,rows.filter(x=>x.contextClassification===k).length]));
 candidate.estimatedAt=rows.filter(x=>pos.has(x.contextClassification)).map(x=>x.messageTimestamp).filter(Number.isFinite).sort((a,b)=>a-b)[0]||candidate.firstEvidenceAt;
 return candidate;
}
export function latencyPercentiles(values=[]){const a=values.filter(Number.isFinite).sort((x,y)=>x-y);const q=p=>a.length?a[Math.min(a.length-1,Math.floor((a.length-1)*p))]:null;return {count:a.length,p50:q(.5),p95:q(.95),p99:q(.99)};}
export const WHATSAPP_POSITIVE_CONTEXTS=pos;

import {digest} from '../mlops/feature-store.mjs';
import {ensureProspective} from './experiments.mjs';
export function stageSource(d,candidate,at=Date.now()){
 ensureProspective(d);if(candidate.status!=='VALIDADA')throw new Error('Fonte ainda não validada');let policy=d.policies.find(p=>p.kind==='source'&&p.sourceId===candidate.id&&p.status!=='REVERTIDA');if(policy)return policy;
 policy={id:'SOURCE-POL-'+digest({id:candidate.id,at}).slice(0,20),kind:'source',sourceId:candidate.id,status:'SHADOW_MODE',createdAt:at,stageStartedAt:at,percentage:0,stage:0,productionEligible:false,validationHash:digest(candidate.lastGate)};d.policies.push(policy);return policy;
}
export function prospectiveSourceMetrics(d,policy,events,evaluate,at){
 const candidate=d.candidates.find(c=>c.id===policy.sourceId),copy={...d,candidates:[{...candidate,samples:candidate.samples.filter(s=>s.collectedAt>policy.stageStartedAt&&s.collectedAt<=at&&s.spawnLower>policy.stageStartedAt)}],coverage:d.coverage.filter(c=>c.endAt>policy.stageStartedAt).map(c=>({...c,startAt:Math.max(c.startAt,policy.stageStartedAt)}))};return evaluate(copy,events.filter(e=>e.spawn.lower>policy.stageStartedAt&&e.availableAt<=at),at).find(c=>c.id===candidate.id);
}
export function advanceSource(d,id,events,evaluate,at=Date.now()){
 const p=d.policies.find(p=>p.id===id&&p.kind==='source');if(!p)throw new Error('Política de fonte inválida');const metrics=prospectiveSourceMetrics(d,p,events,evaluate,at);if(!metrics.validationGate.passed)throw new Error(metrics.validationGate.reasons.join(' '));const c=d.candidates.find(c=>c.id===p.sourceId);p.lastGate=metrics;
 if(p.status==='SHADOW_MODE'){p.status='CHALLENGER';p.qualityGateAt=at;}else if(p.status==='CHALLENGER'){p.status='CANARY';p.stage=0;p.percentage=5;p.stageStartedAt=at;}else if(p.status==='CANARY'){const stages=[5,20,50,100];if(p.stage===3){p.status='PRODUCAO';p.productionEligible=true;c.status='ATIVA';c.productionEligible=true;c.mode='active';}else{p.stage++;p.percentage=stages[p.stage];p.stageStartedAt=at;}}else throw new Error('Etapa inválida para promoção');if(p.status==='CANARY')c.mode='canary';d.governanceHistory.push({policyId:p.id,at,status:p.status,percentage:p.percentage,gate:metrics});return p;
}
export function sourceContribution(d,candidate,sample){const p=d.policies?.find(p=>p.kind==='source'&&p.sourceId===candidate.id&&['CANARY','PRODUCAO'].includes(p.status));return !!p&&parseInt(digest({policyId:p.id,eventId:sample.id}).slice(0,8),16)%100<p.percentage;}
export function monitorSources(d,events,evaluate,at=Date.now()){
 for(const p of (d.policies||[]).filter(p=>p.kind==='source'&&['CANARY','PRODUCAO'].includes(p.status))){const m=prospectiveSourceMetrics(d,p,events,evaluate,at);if(m.independentlyMatched<20||m.precision==null)continue;if(m.precision<.9||m.falseNegativeRate!=null&&m.falseNegativeRate>.3){p.status='REVERTIDA';p.percentage=0;p.productionEligible=false;p.rollbackAt=at;const c=d.candidates.find(c=>c.id===p.sourceId);c.status='BAIXA_QUALIDADE';c.mode='shadow';c.productionEligible=false;d.governanceHistory.push({policyId:p.id,at,status:p.status,percentage:0,reason:'Qualidade prospectiva regrediu'});}}
}

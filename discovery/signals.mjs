import {digest} from '../mlops/feature-store.mjs';
import {eventsAsOf,horizonLabel} from './canonical-events.mjs';
import {mean,clamp,probabilityMetrics,pairedSign,adjustFDR} from './statistics.mjs';
export const SIGNAL_VERSION='1.0.0';
const HOUR=3600000;
export function signalFeatures(events,context,boss,asOf){
 const own=events.filter(e=>e.boss===boss),last=own.at(-1),recent=events.filter(e=>e.spawn.upper>asOf-24*HOUR),other=recent.filter(e=>e.boss!==boss),parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',hour:'2-digit',day:'numeric',weekday:'short',hour12:false}).formatToParts(new Date(asOf)).map(x=>[x.type,x.value]));
 const values={hour:String(Math.floor((Number(parts.hour)%24)/6)),weekday:parts.weekday,dayOfMonth:String(Math.floor((Number(parts.day)-1)/7)),elapsed:String(Math.floor(Math.max(0,asOf-(last?.spawn.estimate??asOf))/(12*HOUR))),recentDensity:String(Math.min(5,recent.length)),previousBoss:other.at(-1)?.boss||'none',sequence:other.slice(-2).map(x=>x.boss).join(' → ')||'none'};
 for(const e of other){const lag=(asOf-e.spawn.upper)/HOUR;values['after:'+e.boss]=lag<2?'0–2h':lag<6?'2–6h':lag<12?'6–12h':'12–24h';}
 const known=context.filter(c=>c.knownAt<=asOf&&c.startAt<=asOf).sort((a,b)=>a.startAt-b.startAt);
 for(const type of ['server_save','restart','maintenance','update','hotfix','special_event','reset']){const lastContext=known.filter(c=>c.type===type).at(-1);values['context:'+type]=lastContext?String(Math.min(28,Math.floor((asOf-lastContext.startAt)/(6*HOUR)))):'unknown';}
 values.regime=known.filter(c=>['update','reset'].includes(c.type)).at(-1)?.id||'unknown';
 return values;
}
export function buildCases(d,world,boss,horizonHours=6){
 const versions=d.versions.filter(v=>v.event.world===world);if(!versions.length)return [];
 const first=Math.min(...versions.map(v=>v.at)),last=d.analysisAsOf,step=horizonHours*HOUR;if((last-first)/step>20000)throw new Error('Limite de 20 mil janelas por boss; segmente o histórico');
 // A regular, non-overlapping grid prevents selecting only times before successful spawns.
 const rows=[];for(let at=Math.ceil(first/step)*step;at+step<=last;at+=step){
  if(rows.length>=20000)throw new Error('Limite de 20 mil janelas por boss; segmente o histórico');
  const available=eventsAsOf(d,world,at);if(!available.some(e=>e.boss===boss))continue;
  // Require covered positive windows too: selecting only known successes creates bias.
  const observed=horizonLabel([],d.coverage,boss,world,at,step,last);if(observed.value!==0)continue;
  const outcome=horizonLabel(eventsAsOf(d,world,last),d.coverage,boss,world,at,step,last);if(outcome.value==null)continue;
  // A later correction/removal can invalidate an older positive. The corrected
  // negative label is not available before that revision was recorded either.
  const affectedIds=new Set(d.versions.filter(v=>v.at<=last&&v.event.world===world&&v.event.boss===boss&&v.event.spawn.upper>at&&v.event.spawn.lower<=at+step).map(v=>v.event.id));
  const revisionAt=Math.max(0,...d.versions.filter(v=>v.at<=last&&affectedIds.has(v.event.id)).map(v=>v.at));
  rows.push({at,knownAt:Math.max(outcome.knownAt,observed.knownAt,revisionAt),y:outcome.value,features:signalFeatures(available,d.context.filter(c=>c.world===world),boss,at)});
 }
 return rows;
}
export function probabilities(train,features,key){
 const bucket=train.filter(r=>r.features.elapsed===features.elapsed),local=bucket.length>=10?bucket:train;
 const baseline=(local.reduce((s,r)=>s+r.y,0)+1)/(local.length+2);
 if(!key)return {baseline,signal:baseline};
 const cell=local.filter(r=>(r.features[key]??'none')===(features[key]??'none'));
 // Predeclared shrinkage. No tuning on validation or test.
 const signal=(cell.reduce((s,r)=>s+r.y,0)+20*baseline)/(cell.length+20);
 return {baseline:clamp(baseline),signal:clamp(signal),support:cell.length};
}
function score(rows,key,start,end){
 const result=[];for(let i=start;i<end;i++){const current=rows[i],train=rows.slice(0,i).filter(r=>r.knownAt<=current.at);if(train.length<30)continue;const p=probabilities(train,current.features,key);result.push({at:current.at,y:current.y,...p});}
 const without=probabilityMetrics(result,'baseline'),withSignal=probabilityMetrics(result,'signal'),test=pairedSign(result);
 return {without,withSignal,...test,gain:without.brier>0?(without.brier-withSignal.brier)/without.brier:null,rows:result};
}
export function runDiscovery(d,world,asOf=Date.now()){
 d.analysisAsOf=asOf;
 const events=eventsAsOf(d,world,asOf),bosses=[...new Set(events.map(e=>e.boss))].sort(),experiments=[];
 if(bosses.length>100)throw new Error('Limite de 100 bosses por análise');
 const datasetHash=digest({version:SIGNAL_VERSION,world,evaluationWindowEnd:Math.floor(asOf/(6*HOUR))*6*HOUR,versions:d.versions.filter(v=>v.event.world===world&&v.at<=asOf),coverage:d.coverage.filter(c=>c.world===world&&c.knownAt<=asOf),context:d.context.filter(c=>c.world===world&&c.knownAt<=asOf)});
 for(const boss of bosses){const rows=buildCases(d,world,boss),a=Math.floor(rows.length*.6),b=Math.floor(rows.length*.8),discovery=rows.slice(0,a);
  // The search vocabulary is fixed using discovery data only.
  const keys=[...new Set(discovery.flatMap(r=>Object.keys(r.features)))].filter(k=>k!=='elapsed').sort();
  for(const key of keys){const id='EXP-'+digest({datasetHash,boss,key}).slice(0,20);if(d.experiments.some(e=>e.id===id)){experiments.push(structuredClone(d.experiments.find(e=>e.id===id)));continue;}
   const validation=score(rows,key,a,b),test=score(rows,key,b,rows.length);delete validation.rows;delete test.rows;
   experiments.push({id,datasetHash,version:SIGNAL_VERSION,world,boss,signal:key,hypothesis:key+' acrescenta valor à probabilidade de '+boss+' nas próximas 6h',at:asOf,samples:rows.length,discoverySamples:a,validation,test,ablation:{removedFeature:key,without: test.without,with:test.withSignal,lossIncrease:test.without.brier!=null?test.without.brier-test.withSignal.brier:null},status:'EM_TESTE',productionEligible:false,shadowRequired:true,split:'chronological 60/20/20, expanding walk-forward; outcomes known before training'});
  }
 }
 // All attempted hypotheses count, including failed and negative results.
 adjustFDR(experiments,'validation');adjustFDR(experiments,'test');
 for(const e of experiments){const enough=e.discoverySamples>=30&&e.validation.withSignal.samples>=20&&e.test.withSignal.samples>=20&&e.validation.blocks>=10&&e.test.blocks>=10;
  const valid=s=>s.q<=.05&&s.gain>=.05&&s.withSignal.logLoss<=s.without.logLoss&&s.withSignal.ece<=s.without.ece;
  e.status=!enough?'AMOSTRA_INSUFICIENTE':valid(e.validation)&&valid(e.test)?'SHADOW_MODE':'REJEITADO';e.reason=!enough?'São necessárias 30 janelas de descoberta e 20 em cada holdout, com dez dias independentes por holdout.':e.status==='SHADOW_MODE'?'Ganho fora da amostra; aguarda coleta prospectiva e Challenger.':'Sem ganho consistente de Brier, log loss e calibração após controle FDR.';
  if(!d.experiments.some(x=>x.id===e.id))d.experiments.push(e);
 }
 const run={id:'RUN-'+datasetHash.slice(0,20),world,at:asOf,datasetHash,canonicalEvents:events.length,experiments:experiments.map(e=>e.id),status:experiments.length?'concluído':'AMOSTRA_INSUFICIENTE'};d.runs.push(run);return {...run,results:experiments};
}

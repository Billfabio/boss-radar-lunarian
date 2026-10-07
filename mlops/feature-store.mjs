import {createHash} from 'node:crypto';
import {detectDrift} from '../learning/drift.mjs';
import {mean,quantile,eventIntervals} from './statistics.mjs';
export {mean,quantile} from './statistics.mjs';
export const FEATURE_VERSION='1.1.0';
export const FEATURE_DEFINITIONS={elapsedHours:'Horas desde o último evento conhecido',mean5:'Média dos últimos 5 intervalos em horas',mean10:'Média dos últimos 10 intervalos em horas',mean30:'Média dos últimos 30 intervalos em horas',median:'Mediana dos intervalos em horas',stddev:'Desvio padrão populacional dos intervalos em horas',variability:'Desvio padrão dividido pela média',hour:'Hora local fracionária em America/Sao_Paulo',weekday:'Dia local, domingo = 0',boss:'Nome do boss',world:'Servidor',recentFrequency:'Eventos conhecidos nos últimos 30 dias',trend:'Razão média dos últimos 5 / média histórica',confirmations:'Quantidade de evidências aprovadas',sourceReliability:'Média das confianças das evidências aprovadas',serverSaveHours:'Horas desde server save explicitamente configurado, ou null',samples:'Eventos disponíveis',preciseSamples:'Eventos com evidência de minuto/hora',driftScore:'Score do detector de mudança de regime',anomalyScore:'Fração de eventos disponíveis em quarentena',sourceCoverage:'Cobertura média observável das evidências disponíveis, 0–1 quando informada',regimeSignal:'Sinal experimental de regime derivado do drift score; não é classe causal'};
export function canonicalJson(value){if(Array.isArray(value))return '['+value.map(canonicalJson).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).filter(k=>value[k]!==undefined).sort().map(k=>JSON.stringify(k)+':'+canonicalJson(value[k])).join(',')+'}';return JSON.stringify(value);}
export const digest=x=>createHash('sha256').update(canonicalJson(x)).digest('hex');
export function availableAt(event){
 const evidence=(event.evidence||[]).filter(x=>!x.anomaly&&['CONFIRMADO','PROVÁVEL'].includes(x.quality?.status)&&x.quality?.traceable);
 if(!evidence.length)return null;
 const dates=evidence.map(x=>Math.max(x.collectedAt||0,x.processedAt||0,x.reportedAt||0));
 if(dates.some(x=>!Number.isFinite(x)||x<=0))return null;
 // Current consolidated values may depend on the latest evidence or correction.
 return Math.max(...dates,Number(event.updatedAt)||0);
}
export function trustedEvent(e){return /^confirmed_/.test(e.status)&&['appearance','kill'].includes(e.eventType)&&!e.anomaly&&['CONFIRMADO','PROVÁVEL'].includes(e.qualityStatus)&&(e.evidence||[]).some(x=>x.quality?.traceable&&x.quality?.eligibleForLearning!==false&&!x.anomaly&&['CONFIRMADO','PROVÁVEL'].includes(x.quality?.status));}
export function knownRows(events,boss,world,asOf){return events.filter(e=>e.boss===boss&&e.world===world&&trustedEvent(e)&&Number.isFinite(e.estimatedAt)&&e.estimatedAt<=asOf&&availableAt(e)!=null&&availableAt(e)<=asOf).sort((a,b)=>a.estimatedAt-b.estimatedAt||String(a.id).localeCompare(String(b.id)));}
export function buildFeatures(events,boss,world,asOf,{serverSaveHour=null,sourceCoverage=null}={}){
 if(!Number.isFinite(asOf))throw new Error('Feature Store exige asOf explícito');
 const rows=knownRows(events,boss,world,asOf),intervals=eventIntervals(rows).map(x=>x/3600000),avg=mean(intervals),last=rows.at(-1);
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',weekday:'short',hour:'numeric',minute:'numeric',hour12:false}).formatToParts(new Date(asOf)).map(x=>[x.type,x.value])),hour=Number(parts.hour)%24+Number(parts.minute)/60;
 const ev=rows.flatMap(e=>(e.evidence||[]).filter(x=>x.quality?.traceable&&!x.anomaly&&['CONFIRMADO','PROVÁVEL'].includes(x.quality?.status)));
 const std=avg==null?null:Math.sqrt(mean(intervals.map(x=>(x-avg)**2))),total=events.filter(e=>e.boss===boss&&e.world===world&&e.estimatedAt<=asOf&&availableAt(e)!=null&&availableAt(e)<=asOf);
 const values={elapsedHours:last?(asOf-last.estimatedAt)/3600000:null,mean5:mean(intervals.slice(-5)),mean10:mean(intervals.slice(-10)),mean30:mean(intervals.slice(-30)),median:quantile(intervals,.5),stddev:std,variability:avg?std/avg:null,hour,weekday:['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(parts.weekday),boss,world,recentFrequency:rows.filter(e=>e.estimatedAt>=asOf-30*86400000).length,trend:avg?mean(intervals.slice(-5))/avg:null,confirmations:ev.length,sourceReliability:mean(ev.map(x=>x.confidence||0)),serverSaveHours:Number.isFinite(serverSaveHour)?(hour-serverSaveHour+24)%24:null,samples:rows.length,preciseSamples:rows.filter(e=>(e.evidence||[]).some(x=>['minute','hour'].includes(x.precision)&&x.quality?.traceable&&!x.anomaly&&['CONFIRMADO','PROVÁVEL'].includes(x.quality?.status))).length,driftScore:detectDrift(rows,boss,world).score||0,anomalyScore:total.length?total.filter(e=>!trustedEvent(e)).length/total.length:0,sourceCoverage:Number.isFinite(sourceCoverage)?Math.max(0,Math.min(1,Number(sourceCoverage))):null,regimeSignal:(detectDrift(rows,boss,world).score||0)>=.7?'HIGH_DRIFT':(detectDrift(rows,boss,world).score||0)>=.35?'TRANSITION':'STABLE'};
 return {version:FEATURE_VERSION,asOf,values,intervals,rows,fingerprint:digest({version:FEATURE_VERSION,asOf,values,rows})};
}

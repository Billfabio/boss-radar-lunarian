import {ensureOperational,appendOperationalEvent,openIncident} from './operational-state.mjs';

const DAY=86400000;
const median=a=>{const x=a.filter(Number.isFinite).sort((a,b)=>a-b);if(!x.length)return null;const m=Math.floor(x.length/2);return x.length%2?x[m]:(x[m-1]+x[m])/2;};
const mad=(a,m)=>{const x=a.filter(Number.isFinite);return x.length?median(x.map(v=>Math.abs(v-m))):null;};
const avg=a=>{const x=a.filter(Number.isFinite);return x.length?x.reduce((n,v)=>n+v,0)/x.length:null;};
const pct=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(b)>1e-9?100*(a-b)/Math.abs(b):null;
const dayKey=at=>new Date(at).toISOString().slice(0,10);

export function ensureReliabilityTelemetry(state){
 const o=ensureOperational(state);o.samples||=[];o.regressions||=[];o.dailyReports||=[];o.weeklyReviews||=[];return o;
}
export function recordReliabilitySample(state,sample,at=Date.now()){
 const o=ensureReliabilityTelemetry(state),row={at,...structuredClone(sample)};o.samples.push(row);
 const cutoff=at-90*DAY;o.samples=o.samples.filter(x=>x.at>=cutoff);return row;
}
function metricDirection(key){return ['coveragePct','reliabilityScore','predictionAccuracy','dataQuality'].includes(key)?'higher':'lower';}
export function detectOperationalRegressions(state,at=Date.now()){
 const o=ensureReliabilityTelemetry(state),recentStart=at-24*3600000,baselineStart=at-15*DAY,baselineEnd=at-2*DAY,recent=o.samples.filter(x=>x.at>=recentStart&&x.at<=at),baseline=o.samples.filter(x=>x.at>=baselineStart&&x.at<baselineEnd);
 const metrics=['captureLatencyP95','outboxOldestAgeMs','errorCount','coveragePct','reliabilityScore','predictionLatencyMs','queueOldestAgeMs'],found=[];
 if(recent.length<6||baseline.length<24)return {status:'INSUFFICIENT_DATA',recentSamples:recent.length,baselineSamples:baseline.length,regressions:[]};
 for(const key of metrics){const a=recent.map(x=>Number(x[key])).filter(Number.isFinite),b=baseline.map(x=>Number(x[key])).filter(Number.isFinite);if(a.length<6||b.length<20)continue;const current=median(a),base=median(b),spread=Math.max(1e-9,(mad(b,base)||0)*1.4826),change=pct(current,base),z=Math.abs(current-base)/spread,direction=metricDirection(key),worse=direction==='higher'?current<base:current>base,relativeBad=direction==='higher'?change<=-20:change>=20;if(worse&&relativeBad&&z>=3){const r={id:'reg-'+key+'-'+dayKey(at),metric:key,current,baseline:base,changePercent:Math.round(change*10)/10,robustZ:Math.round(z*10)/10,detectedAt:at,status:'OPEN',method:'rolling_median_vs_robust_baseline'};found.push(r);if(!o.regressions.some(x=>x.id===r.id&&x.status==='OPEN')){o.regressions.unshift(r);appendOperationalEvent(state,'OPERATIONAL_REGRESSION_DETECTED',r,{at,correlationId:'regression:'+key});openIncident(state,{component:key.includes('prediction')?'prediction-engine':key.includes('capture')||key.includes('coverage')?'lunarian-collector':key.includes('outbox')?'persistent-outbox':key.includes('queue')?'queue-worker':'backend',kind:'OPERATIONAL_REGRESSION',severity:'medium',reason:key+' regrediu '+Math.abs(r.changePercent)+'% versus baseline robusto.',startedAt:recentStart,correlationId:'regression:'+key,metadata:r},at);}}
 }
 for(const old of o.regressions.filter(x=>x.status==='OPEN'&&!found.some(r=>r.metric===x.metric))){const currentMetric=recent.map(x=>Number(x[old.metric])).filter(Number.isFinite);if(currentMetric.length>=6){old.status='RECOVERED';old.recoveredAt=at;appendOperationalEvent(state,'OPERATIONAL_REGRESSION_RECOVERED',{id:old.id,metric:old.metric},{at,correlationId:'regression:'+old.metric});}}
 return {status:'READY',recentSamples:recent.length,baselineSamples:baseline.length,regressions:found};
}
export function buildDailySystemReport(state,at=Date.now()){
 const o=ensureReliabilityTelemetry(state),day=dayKey(at),start=Date.parse(day+'T00:00:00Z'),rows=o.samples.filter(x=>x.at>=start&&x.at<=at);if(rows.length<6)return {day,status:'INSUFFICIENT_DATA',samples:rows.length};
 const incidents=o.incidents.filter(x=>x.startedAt>=start&&x.startedAt<=at),report={day,status:'MEASURED',samples:rows.length,uptimeProxyPct:avg(rows.map(x=>x.healthyComponentPct)),coveragePct:avg(rows.map(x=>x.coveragePct)),errorCount:Math.max(0,...rows.map(x=>Number(x.errorCount)||0)),incidents:incidents.length,autoRecovered:incidents.filter(x=>x.status==='RESOLVED'&&x.autoRecovered).length,candidates:Math.max(0,...rows.map(x=>Number(x.candidates)||0)),confirmedEvents:Math.max(0,...rows.map(x=>Number(x.confirmedEvents)||0)),queueOldestAgeMs:Math.max(0,...rows.map(x=>Number(x.queueOldestAgeMs)||0)),outboxOldestAgeMs:Math.max(0,...rows.map(x=>Number(x.outboxOldestAgeMs)||0)),captureLatencyP95:median(rows.map(x=>x.captureLatencyP95)),predictionLatencyMs:median(rows.map(x=>x.predictionLatencyMs)),reliabilityScore:median(rows.map(x=>x.reliabilityScore)),generatedAt:at};
 const existing=o.dailyReports.findIndex(x=>x.day===day);if(existing>=0)o.dailyReports[existing]=report;else o.dailyReports.unshift(report);o.dailyReports=o.dailyReports.slice(0,120);return report;
}
export function buildWeeklyReview(state,at=Date.now()){
 const o=ensureReliabilityTelemetry(state),current=o.samples.filter(x=>x.at>=at-7*DAY&&x.at<=at),previous=o.samples.filter(x=>x.at>=at-14*DAY&&x.at<at-7*DAY);if(current.length<24||previous.length<24)return {status:'INSUFFICIENT_DATA',currentSamples:current.length,previousSamples:previous.length};
 const metrics=['coveragePct','reliabilityScore','captureLatencyP95','predictionLatencyMs','errorCount'],comparison={};for(const key of metrics){const a=median(current.map(x=>x[key])),b=median(previous.map(x=>x[key]));comparison[key]={current:a,previous:b,changePercent:pct(a,b)==null?null:Math.round(pct(a,b)*10)/10};}
 const review={id:'week-'+dayKey(at),status:'MEASURED',generatedAt:at,currentSamples:current.length,previousSamples:previous.length,comparison};const i=o.weeklyReviews.findIndex(x=>x.id===review.id);if(i>=0)o.weeklyReviews[i]=review;else o.weeklyReviews.unshift(review);o.weeklyReviews=o.weeklyReviews.slice(0,30);return review;
}
export function reliabilityReports(state,at=Date.now()){
 const o=ensureReliabilityTelemetry(state);return {regression:detectOperationalRegressions(state,at),daily:buildDailySystemReport(state,at),weekly:buildWeeklyReview(state,at),recentSamples:o.samples.slice(-288),recentRegressions:o.regressions.slice(0,100),dailyHistory:o.dailyReports.slice(0,30),weeklyHistory:o.weeklyReviews.slice(0,12)};
}

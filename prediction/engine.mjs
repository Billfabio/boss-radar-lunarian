const DAY=86400000,clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const quantile=(arr,q)=>{if(!arr.length)return null;const a=[...arr].sort((x,y)=>x-y),p=(a.length-1)*q,i=Math.floor(p),f=p-i;return a[i]+(a[i+1]??a[i]-a[i])*f;};
const median=a=>quantile(a,.5);
const confirmed=e=>/^confirmed_/.test(e.status)&&!e.anomaly&&['appearance','kill'].includes(e.eventType);
const highPrecision=e=>(e.evidence||[]).some(x=>['minute','hour'].includes(x.precision));
function robustIntervals(events){const xs=[];for(let i=1;i<events.length;i++){const d=events[i].estimatedAt-events[i-1].estimatedAt;if(d>3600000&&d<180*DAY)xs.push(d);}return xs;}
function backtest(events){
 let errors=[],inside=0,total=0;
 for(let i=4;i<events.length;i++){const prior=events.slice(0,i),ints=robustIntervals(prior);if(ints.length<3)continue;const center=median(ints),lo=quantile(ints,.15),hi=quantile(ints,.85),pred=prior.at(-1).estimatedAt+center,actual=events[i].estimatedAt;total++;if(actual>=prior.at(-1).estimatedAt+lo&&actual<=prior.at(-1).estimatedAt+hi)inside++;if(highPrecision(events[i])&&highPrecision(prior.at(-1)))errors.push(Math.abs(actual-pred)/60000);}
 return {samples:total,windowAccuracy:total?inside/total:null,maeMinutes:errors.length?errors.reduce((a,b)=>a+b,0)/errors.length:null,preciseSamples:errors.length};
}
export function predictBoss(events,boss,world,now=Date.now()){
 const rows=events.filter(e=>e.boss===boss&&e.world===world&&confirmed(e)).sort((a,b)=>a.estimatedAt-b.estimatedAt);
 if(rows.length<3)return {boss,world,status:'insufficient',sampleSize:rows.length,confidence:0,probability:0,explain:[`Apenas ${rows.length} aparições confirmadas; são necessárias pelo menos 3 para estimar um intervalo.`]};
 const ints=robustIntervals(rows);if(ints.length<2)return {boss,world,status:'insufficient',sampleSize:rows.length,confidence:0,probability:0,explain:['Histórico insuficiente para calcular intervalos consistentes.']};
 const center=median(ints),q15=quantile(ints,.15),q85=quantile(ints,.85),q05=quantile(ints,.05),q95=quantile(ints,.95),rawMad=median(ints.map(x=>Math.abs(x-center)))||0;
 const last=rows.at(-1),precise=rows.filter(highPrecision);
 const precisionReady=precise.length>=6&&precise.length/rows.length>=.5&&rawMad<=DAY;
 const uncertaintyFloor=precisionReady?Math.max(30*60000,rawMad):Math.max(12*3600000,rawMad);
 const centerAt=last.estimatedAt+center,start=Math.round(Math.min(last.estimatedAt+Math.max(3600000,q15),centerAt-uncertaintyFloor)),end=Math.round(Math.max(last.estimatedAt+Math.max(q15,q85),centerAt+uncertaintyFloor)),mad=Math.max(rawMad,precisionReady?30*60000:12*3600000);
 const consistency=clamp(1-mad/Math.max(center,1),0,1),sampleFactor=1-Math.exp(-ints.length/8),sourceConfidence=median(rows.slice(-10).map(e=>e.confidence))||.5;
 const bt=backtest(rows),backtestFactor=bt.windowAccuracy==null?.55:bt.windowAccuracy;
 const confidence=clamp(.15+.28*sampleFactor+.27*consistency+.18*sourceConfidence+.12*backtestFactor,.12,.96);
 const probability=clamp(.35+.35*sampleFactor+.2*consistency+.1*sourceConfidence,.25,.94);
 const likelyAt=precisionReady?Math.round(centerAt):null;
 const recent=ints.slice(-Math.min(5,ints.length)),older=ints.slice(0,Math.max(0,ints.length-5));let trend='estável';
 if(older.length>=3){const d=median(recent)-median(older);if(d>Math.max(6*3600000,center*.12))trend='intervalos aumentando';else if(d<-Math.max(6*3600000,center*.12))trend='intervalos diminuindo';}
 const phase=now<start?'monitoring':now<=end?'active':'overdue';
 const explain=[`Previsão baseada em ${rows.length} aparições confirmadas e ${ints.length} intervalos históricos.`,`Intervalo robusto mediano: ${(center/DAY).toFixed(1)} dias; dispersão mediana: ${(mad/3600000).toFixed(1)} h.`,`Confiança recente das evidências: ${Math.round(sourceConfidence*100)}%.`];
 if(bt.samples)explain.push(`Backtest: ${Math.round(bt.windowAccuracy*100)}% das ${bt.samples} previsões históricas caíram dentro da janela estimada.`);
 if(!precisionReady)explain.push('Ainda não há histórico horário suficiente para afirmar um minuto provável; o sistema mantém uma janela.');
 return {boss,world,status:'ready',phase,sampleSize:rows.length,lastAt:last.estimatedAt,windowStart:Math.round(start),windowEnd:Math.round(end),likelyAt,confidence:Math.round(confidence*100),probability:Math.round(probability*100),intervalMinMs:Math.round(q05),intervalAverageMs:Math.round(center),intervalMaxMs:Math.round(q95),trend,preciseSamples:precise.length,metrics:{windowAccuracy:bt.windowAccuracy==null?null:Math.round(bt.windowAccuracy*1000)/10,maeMinutes:bt.maeMinutes==null?null:Math.round(bt.maeMinutes),backtestSamples:bt.samples,preciseBacktestSamples:bt.preciseSamples},explain};
}
export function buildPredictions(events,world){const names=[...new Set(events.filter(e=>e.world===world&&confirmed(e)).map(e=>e.boss))];return names.map(name=>predictBoss(events,name,world)).sort((a,b)=>(b.confidence||0)-(a.confidence||0)||a.boss.localeCompare(b.boss));}
export function aggregateMetrics(predictions){
 const ready=predictions.filter(p=>p.status==='ready'),bt=ready.filter(p=>p.metrics.backtestSamples),mae=ready.filter(p=>p.metrics.maeMinutes!=null);
 return {bossesModeled:ready.length,averageConfidence:ready.length?Math.round(ready.reduce((n,p)=>n+p.confidence,0)/ready.length*10)/10:null,windowAccuracy:bt.length?Math.round(bt.reduce((n,p)=>n+p.metrics.windowAccuracy,0)/bt.length*10)/10:null,maeMinutes:mae.length?Math.round(mae.reduce((n,p)=>n+p.metrics.maeMinutes,0)/mae.length):null,backtestSamples:bt.reduce((n,p)=>n+p.metrics.backtestSamples,0),updatedAt:Date.now()};
}

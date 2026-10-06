import {adaptiveMethodWeight} from '../learning/model-performance.mjs';
const DAY=86400000,HOUR=3600000,clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const q=(arr,p)=>{if(!arr.length)return null;const a=[...arr].sort((x,y)=>x-y),x=(a.length-1)*p,i=Math.floor(x),f=x-i;return a[i]+((a[i+1]??a[i])-a[i])*f;};
const median=a=>q(a,.5);
const confirmed=e=>/^confirmed_/.test(e.status)&&!e.anomaly&&['appearance','kill'].includes(e.eventType);
const precise=e=>(e.evidence||[]).some(x=>['minute','hour'].includes(x.precision));
const rowsFor=(events,boss,world)=>events.filter(e=>e.boss===boss&&e.world===world&&confirmed(e)).sort((a,b)=>a.estimatedAt-b.estimatedAt);
const intervals=rows=>rows.slice(1).map((e,i)=>e.estimatedAt-rows[i].estimatedAt).filter(x=>x>HOUR&&x<180*DAY);
const circHour=at=>{const p=new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',hour:'numeric',hour12:false,minute:'numeric'}).formatToParts(new Date(at));const o=Object.fromEntries(p.map(x=>[x.type,x.value]));return (Number(o.hour)%24)+Number(o.minute)/60;};
const weekday=at=>Number(new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',weekday:'short'}).formatToParts(new Date(at)).find(x=>x.type==='weekday')?.value&&new Date(at-3*HOUR).getUTCDay());
function weightedMedian(values,weights){if(!values.length)return null;const a=values.map((v,i)=>[v,weights[i]]).sort((x,y)=>x[0]-y[0]),sum=a.reduce((n,x)=>n+x[1],0);let c=0;for(const [v,w] of a){c+=w;if(c>=sum/2)return v;}return a.at(-1)[0];}
function recencyWeights(n,halfLife=8){return Array.from({length:n},(_,i)=>Math.pow(.5,(n-1-i)/halfLife));}
function robustSpread(xs,center){return median(xs.map(x=>Math.abs(x-center)))||0;}
function nextAtSameLocalTime(baseAt,targetHour,dayOffset=0){
 const d=new Date(baseAt-3*HOUR);d.setUTCDate(d.getUTCDate()+dayOffset);const h=Math.floor(targetHour),m=Math.round((targetHour-h)*60);d.setUTCHours(h,m,0,0);return d.getTime()+3*HOUR;
}
function intervalMethod(rows,kind){
 const ints=intervals(rows);if(ints.length<2)return null;
 if(kind==='recent'){const recent=ints.slice(-Math.min(12,ints.length)),w=recencyWeights(recent.length,4),center=weightedMedian(recent,w),spread=robustSpread(recent,center);return {name:'recent_interval',predictedAt:rows.at(-1).estimatedAt+center,intervalMs:center,spreadMs:spread,samples:recent.length};}
 const center=median(ints),spread=robustSpread(ints,center);return {name:'historical_interval',predictedAt:rows.at(-1).estimatedAt+center,intervalMs:center,spreadMs:spread,samples:ints.length};
}
function hourMethod(rows,intervalCenter){
 const p=rows.filter(precise);if(p.length<8)return null;const hours=p.map(e=>circHour(e.estimatedAt)),w=recencyWeights(hours.length,10);
 // Circular mean, then project near interval-based target day.
 let sx=0,sy=0,sw=0;for(let i=0;i<hours.length;i++){const a=hours[i]/24*2*Math.PI;sx+=Math.cos(a)*w[i];sy+=Math.sin(a)*w[i];sw+=w[i];}
 const mean=((Math.atan2(sy/sw,sx/sw)/(2*Math.PI)*24)+24)%24,target=rows.at(-1).estimatedAt+(intervalCenter||0),baseDay=new Date(target-3*HOUR),candidate=nextAtSameLocalTime(target,mean,0);
 const choices=[candidate-DAY,candidate,candidate+DAY].sort((a,b)=>Math.abs(a-target)-Math.abs(b-target));
 const concentration=Math.sqrt(sx*sx+sy*sy)/sw;
 return {name:'time_of_day',predictedAt:choices[0],samples:p.length,concentration};
}
function weekdayMethod(rows,intervalCenter){
 if(rows.length<10||!intervalCenter)return null;const counts=Array(7).fill(0),recent=rows.slice(-Math.min(40,rows.length)),w=recencyWeights(recent.length,16);recent.forEach((e,i)=>counts[weekday(e.estimatedAt)]+=w[i]);
 const best=counts.indexOf(Math.max(...counts)),target=rows.at(-1).estimatedAt+intervalCenter;let candidate=target,bestDist=Infinity;
 for(let d=-3;d<=3;d++){const x=target+d*DAY;if(weekday(x)===best&&Math.abs(d)<bestDist){candidate=x;bestDist=Math.abs(d);}}
 const share=counts[best]/counts.reduce((a,b)=>a+b,0);
 return {name:'weekday',predictedAt:candidate,samples:recent.length,concentration:share};
}
export function predictAdaptive(events,boss,world,models={},now=Date.now()){
 const rows=rowsFor(events,boss,world);if(rows.length<3)return {boss,world,status:'insufficient',sampleSize:rows.length,confidence:0,probability:0,methods:[],explain:[`Apenas ${rows.length} aparições confirmadas.`]};
 const hist=intervalMethod(rows,'historical'),recent=intervalMethod(rows,'recent');if(!hist)return {boss,world,status:'insufficient',sampleSize:rows.length,confidence:0,probability:0,methods:[],explain:['Histórico insuficiente para estimar intervalo.']};
 const methods=[hist,recent,hourMethod(rows,recent?.intervalMs||hist.intervalMs),weekdayMethod(rows,recent?.intervalMs||hist.intervalMs)].filter(Boolean);
 const weighted=methods.map(m=>{const base=(m.name==='recent_interval'?1.08:(m.name==='historical_interval'?1:(m.name==='time_of_day'?0.72:0.58)));const learned=adaptiveMethodWeight(models,boss,world,m.name,m.name.includes('interval')?24*60:8*60);const dataFactor=clamp(Math.log2((m.samples||1)+1)/5,.25,1);const quality=m.concentration==null?1:clamp(.35+.9*m.concentration,.35,1.2);return {...m,weight:base*learned*dataFactor*quality};});
 const predictedAt=weighted.reduce((n,m)=>n+m.predictedAt*m.weight,0)/weighted.reduce((n,m)=>n+m.weight,0);
 const ints=intervals(rows),globalSpread=Math.max(precise(rows.at(-1))?30*60000:12*HOUR,robustSpread(ints,median(ints)));
 const disagreement=Math.sqrt(weighted.reduce((n,m)=>n+m.weight*Math.pow(m.predictedAt-predictedAt,2),0)/weighted.reduce((n,m)=>n+m.weight,0));
 const uncertainty=Math.max(globalSpread,disagreement,precise(rows.at(-1))?30*60000:12*HOUR),windowStart=Math.round(predictedAt-uncertainty),windowEnd=Math.round(predictedAt+uncertainty);
 const preciseCount=rows.filter(precise).length,exactReady=preciseCount>=8&&preciseCount/rows.length>=.5&&uncertainty<=12*HOUR;
 const likelyAt=exactReady?Math.round(predictedAt):null,sampleFactor=1-Math.exp(-rows.length/18),agreement=clamp(1-disagreement/Math.max(uncertainty,1),0,1),source=median(rows.slice(-20).map(e=>e.confidence))||.5;
 const confidence=clamp(.12+.34*sampleFactor+.25*agreement+.21*source+.08*(exactReady?1:.5),.1,.97),probability=clamp(.28+.4*sampleFactor+.2*agreement+.12*source,.2,.95);
 const full=median(ints),recentInts=ints.slice(-Math.min(10,ints.length)),recentCenter=median(recentInts),trend=recentCenter>full*1.1?'intervalos aumentando':recentCenter<full*.9?'intervalos diminuindo':'estável';
 const hourRows=rows.filter(precise).slice(-20),hours=hourRows.map(e=>circHour(e.estimatedAt)),bucketCounts=Array(8).fill(0);hours.forEach(h=>bucketCounts[Math.floor(h/3)%8]++);const bestBucket=bucketCounts.indexOf(Math.max(...bucketCounts)),hourShare=hours.length?bucketCounts[bestBucket]/hours.length:null;
 const explain=[`Previsão baseada em ${rows.length} aparições confirmadas.`,`Intervalo histórico mediano: ${(full/HOUR).toFixed(1)} h; intervalo recente: ${(recentCenter/HOUR).toFixed(1)} h.`,`O ensemble comparou ${weighted.length} métodos e ponderou cada um pelo desempenho aprendido deste boss.`];
 if(hourShare!=null)explain.push(`Nas últimas ${hourRows.length} aparições com horário, a faixa ${String(bestBucket*3).padStart(2,'0')}:00–${String(bestBucket*3+3).padStart(2,'0')}:00 concentrou ${Math.round(hourShare*100)}% dos registros.`);
 if(!exactReady)explain.push('O histórico temporal ainda não sustenta um minuto exato; a previsão permanece em janela.');
 return {boss,world,status:'ready',phase:now<windowStart?'monitoring':now<=windowEnd?'active':'overdue',sampleSize:rows.length,lastAt:rows.at(-1).estimatedAt,baseEventId:rows.at(-1).id,baseEventAt:rows.at(-1).estimatedAt,windowStart,windowEnd,likelyAt,confidence:Math.round(confidence*100),probability:Math.round(probability*100),intervalMinMs:q(ints,.05),intervalAverageMs:full,intervalRecentMs:recentCenter,intervalMaxMs:q(ints,.95),trend,preciseSamples:preciseCount,hourPattern:hourShare==null?null:{startHour:bestBucket*3,endHour:bestBucket*3+3,share:Math.round(hourShare*100)},methods:weighted.map(m=>({name:m.name,predictedAt:Math.round(m.predictedAt),weight:Math.round(m.weight*1000)/1000,samples:m.samples,concentration:m.concentration==null?null:Math.round(m.concentration*1000)/1000})),explain};
}
export function buildAdaptivePredictions(events,world,models={}){const names=[...new Set(events.filter(e=>e.world===world&&confirmed(e)).map(e=>e.boss))];return names.map(b=>predictAdaptive(events,b,world,models)).sort((a,b)=>(b.confidence||0)-(a.confidence||0)||a.boss.localeCompare(b.boss));}

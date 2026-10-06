const DAY=86400000;
const round=n=>n==null?null:Math.round(n*10)/10;
function summarize(rows){
 const resolved=rows.filter(r=>r.resolvedAt);if(!resolved.length)return {predictions:0,windowAccuracy:null,maeMinutes:null};
 const hits=resolved.filter(r=>r.windowHit).length,errors=resolved.filter(r=>Number.isFinite(r.errorMinutes)).map(r=>r.errorMinutes);
 return {predictions:resolved.length,correct:hits,incorrect:resolved.length-hits,windowAccuracy:round(100*hits/resolved.length),maeMinutes:errors.length?round(errors.reduce((a,b)=>a+b,0)/errors.length):null};
}
export function forecastMetrics(forecasts,world,now=Date.now()){
 const rows=forecasts.filter(r=>r.world===world&&r.resolvedAt);
 const windows={days7:summarize(rows.filter(r=>r.resolvedAt>=now-7*DAY)),days30:summarize(rows.filter(r=>r.resolvedAt>=now-30*DAY)),days90:summarize(rows.filter(r=>r.resolvedAt>=now-90*DAY)),all:summarize(rows)};
 const byBoss=[...new Set(rows.map(r=>r.boss))].map(boss=>({boss,...summarize(rows.filter(r=>r.boss===boss))})).sort((a,b)=>b.predictions-a.predictions||a.boss.localeCompare(b.boss));
 const baseline=windows.days30.predictions>=10?windows.days30:windows.days90;
 const recent=windows.days7;
 let deterioration=null;
 if(recent.predictions>=5&&baseline.predictions>=10){
  const accuracyDrop=baseline.windowAccuracy!=null&&recent.windowAccuracy!=null?baseline.windowAccuracy-recent.windowAccuracy:0;
  const maeRatio=baseline.maeMinutes&&recent.maeMinutes?recent.maeMinutes/baseline.maeMinutes:1;
  if(accuracyDrop>=15||maeRatio>=1.5)deterioration={detected:true,accuracyDrop:round(accuracyDrop),maeRatio:round(maeRatio),message:'Queda significativa na precisão detectada.',possibleCauses:['mudança recente no padrão do boss','fonte externa degradada','coleta atrasada ou incompleta','modelo atual inadequado para o comportamento recente']};
 }
 return {...windows,byBoss,totalResolved:rows.length,deterioration};
}
export function recentForecasts(forecasts,world,limit=200){return forecasts.filter(r=>r.world===world).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)).slice(0,limit);}

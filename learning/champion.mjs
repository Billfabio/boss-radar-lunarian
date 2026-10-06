const round=n=>Math.round(n*10)/10;
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;
const variance=(a,m)=>a.length>1?a.reduce((n,x)=>n+(x-m)**2,0)/(a.length-1):0;
function methodRows(forecasts,name){
 return forecasts.flatMap(f=>{
  const x=name==='adaptive_ensemble'?{actualErrorMinutes:f.errorMinutes,hit:f.windowHit}:[...(f.methods||[]),...(f.challengers||[])].find(m=>m.name===name);
  return x&&Number.isFinite(x.actualErrorMinutes)?[{forecastId:f.id,error:x.actualErrorMinutes,hit:!!x.hit}]:[];
 });
}
export function comparePaired(forecasts,champion,challenger){
 const A=new Map(methodRows(forecasts,champion).map(x=>[x.forecastId,x])),B=new Map(methodRows(forecasts,challenger).map(x=>[x.forecastId,x]));
 const pairs=[...A.keys()].filter(k=>B.has(k)).map(k=>A.get(k).error-B.get(k).error);
 if(pairs.length<30)return {samples:pairs.length,significant:false,reason:'Amostra estatística mínima: 30 previsões pareadas.'};
 const d=mean(pairs),sd=Math.sqrt(variance(pairs,d)),se=sd/Math.sqrt(pairs.length),lower=d-1.96*se,upper=d+1.96*se;
 return {samples:pairs.length,meanErrorImprovement:round(d),ci95:[round(lower),round(upper)],significant:lower>1};
}
export function championChallengerReport(forecasts,boss,world,current='adaptive_ensemble'){
 const rows=forecasts.filter(f=>f.boss===boss&&f.world===world&&f.resolvedAt).sort((a,b)=>(b.resolvedAt||0)-(a.resolvedAt||0)).slice(0,300);
 const allNames=[...new Set(rows.flatMap(f=>[...(f.methods||[]),...(f.challengers||[])].map(m=>m.name)))];
 const stats=[current,...allNames.filter(x=>x!==current)].map(name=>{
  const x=methodRows(rows,name),errors=x.map(r=>r.error);
  return {name,samples:x.length,mae:errors.length?round(mean(errors)):null,hitRate:x.length?round(100*x.filter(r=>r.hit).length/x.length):null};
 }).filter(x=>x.samples);
 const champion=stats.find(x=>x.name===current)||{name:current,samples:0,mae:null,hitRate:null};
 const challengers=stats.filter(x=>x.name!==current).map(x=>{const comparison=comparePaired(rows,current,x.name),relativeImprovement=champion.mae&&x.mae!=null?100*(champion.mae-x.mae)/champion.mae:null,hitRateDelta=x.hitRate!=null&&champion.hitRate!=null?x.hitRate-champion.hitRate:null;return {...x,comparison,relativeImprovementPct:relativeImprovement==null?null:round(relativeImprovement),hitRateDelta:hitRateDelta==null?null:round(hitRateDelta)};}).sort((a,b)=>(a.mae??Infinity)-(b.mae??Infinity));
 const candidate=challengers.find(x=>x.samples>=50&&x.comparison.significant&&x.mae!=null&&champion.mae!=null&&x.mae<champion.mae&&(x.relativeImprovementPct??0)>=5&&(x.hitRateDelta==null||x.hitRateDelta>=-2));
 return {champion,challengers,promotionRecommended:candidate?.name||null,minSamples:50,promotionPolicy:{minimumRelativeMaeImprovementPct:5,minimumPairedSamples:50,maximumHitRateDropPoints:2,requiresSignificantPairedImprovement:true}};
}

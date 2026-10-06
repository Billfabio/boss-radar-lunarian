const round=n=>Math.round(n*10)/10;
function mean(a){return a.length?a.reduce((x,y)=>x+y,0)/a.length:null;}
function variance(a,m){return a.length>1?a.reduce((n,x)=>n+(x-m)**2,0)/(a.length-1):0;}
function methodRows(forecasts,name){return forecasts.flatMap(f=>{const x=name==='adaptive_ensemble'?{actualErrorMinutes:f.errorMinutes,hit:f.windowHit}:[...(f.methods||[]),...(f.challengers||[])].find(m=>m.name===name);return x&&Number.isFinite(x.actualErrorMinutes)?[{forecastId:f.id,error:x.actualErrorMinutes,hit:!!x.hit}]:[];});}
export function comparePaired(forecasts,a,b){
 const A=new Map(methodRows(forecasts,a).map(x=>[x.forecastId,x])),B=new Map(methodRows(forecasts,b).map(x=>[x.forecastId,x])),pairs=[...A.keys()].filter(k=>B.has(k)).map(k=>A.get(k).error-B.get(k).error);
 if(pairs.length<30)return {samples:pairs.length,significant:false,reason:'Amostra mínima: 30 previsões pareadas.'};
 const d=mean(pairs),sd=Math.sqrt(variance(pairs,d)),se=sd/Math.sqrt(pairs.length),lower=d-1.96*se,upper=d+1.96*se;
 return {samples:pairs.length,meanErrorImprovement:round(d),ci95:[round(lower),round(upper)],significant:lower>1};
}
export function championChallengerReport(forecasts,boss,world,current='adaptive_ensemble'){
 const rows=forecasts.filter(f=>f.boss===boss&&f.world===world&&f.resolvedAt).slice(0,300),names=[...new Set(rows.flatMap(f=>[...(f.methods||[]),...(f.challengers||[])].map(m=>m.name))].add?.call?[]:[])];
 const allNames=[...new Set(rows.flatMap(f=>[...(f.methods||[]),...(f.challengers||[])].map(m=>m.name))];
 const stats=[current,...allNames.filter(x=>x!==current)].map(name=>{const x=methodRows(rows,name),errors=x.map(r=>r.error);return {name,samples:x.length,mae:errors.length?round(mean(errors)):null,hitRate:x.length?round(100*x.filter(r=>r.hit).length/x.length):null};}).filter(x=>x.samples);
 const challengers=stats.filter(x=>x.name!==current).map(x=>({...x,comparison:comparePaired(rows,current,x.name)})).sort((a,b)=>(a.mae??Infinity)-(b.mae??Infinity));
 const candidate=challengers.find(x=>x.comparison.significant&&x.mae!=null&&stats.find(s=>s.name===current)?.mae!=null&&x.mae<stats.find(s=>s.name===current).mae);
 return {champion:stats.find(x=>x.name===current)||{name:current,samples:0,mae:null,hitRate:null},challengers,promotionRecommended:candidate?.name||null,minSamples:30};
}

const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const key=(world,boss)=>world+'|'+String(boss).toLowerCase();
export function ensureModel(models,boss,world){
 const k=key(world,boss);models[k] ||= {boss,world,methods:{},resolved:0,lastResolvedAt:0};
 return models[k];
}
function ensureMethod(model,name){model.methods[name] ||= {name,count:0,emaErrorMinutes:null,emaHitRate:null,lastErrorMinutes:null,lastUpdatedAt:0};return model.methods[name];}
export function learnMethodResult(models,boss,world,name,errorMinutes,hit,at=Date.now()){
 const model=ensureModel(models,boss,world),m=ensureMethod(model,name),alpha=m.count<5?.35:.18;
 m.count++;m.lastErrorMinutes=Math.round(errorMinutes*10)/10;
 m.emaErrorMinutes=m.emaErrorMinutes==null?errorMinutes:(1-alpha)*m.emaErrorMinutes+alpha*errorMinutes;
 const h=hit?1:0;m.emaHitRate=m.emaHitRate==null?h:(1-alpha)*m.emaHitRate+alpha*h;m.lastUpdatedAt=at;
 return m;
}
export function adaptiveMethodWeight(models,boss,world,name,scaleMinutes=1440){
 const m=ensureModel(models,boss,world).methods[name];if(!m||!m.count)return 1;
 const experience=1-Math.exp(-m.count/12),errorScore=Math.exp(-Math.max(0,m.emaErrorMinutes||scaleMinutes)/Math.max(60,scaleMinutes)),hit=m.emaHitRate==null?.5:m.emaHitRate;
 return clamp((.35+.65*experience)*(.35+.4*errorScore+.25*hit),.12,1.35);
}
export function recalculateForecastOutcome(forecast,event){
 const actual=event.estimatedAt,precise=(event.evidence||[]).some(x=>(['minute','hour'].includes(x.precision)||x.manual&&x.detail?.correction)&&!x.anomaly&&(!x.quality||['CONFIRMADO','PROVÁVEL'].includes(x.quality.status)));
 forecast.actualEventId=event.id;forecast.actualAt=actual;forecast.actualPrecision=precise?'time':'day';
 forecast.windowHit=precise?actual>=forecast.windowStart&&actual<=forecast.windowEnd:Math.max(event.startAt||actual,forecast.windowStart)<=Math.min(event.endAt||actual,forecast.windowEnd);
 const center=Number.isFinite(forecast.likelyAt)?forecast.likelyAt:(Number.isFinite(forecast.predictedCenterAt)?forecast.predictedCenterAt:null);
 forecast.errorMinutes=precise&&Number.isFinite(center)?Math.round(Math.abs(actual-center)/6000)/10:null;
 forecast.signedErrorMinutes=precise&&Number.isFinite(center)?Math.round((actual-center)/6000)/10:null;
 const tolerance=Math.max(60,(forecast.windowEnd-forecast.windowStart)/120000);
 for(const method of [...(forecast.methods||[]),...(forecast.challengers||[])]){
   if(!Number.isFinite(method.predictedAt))continue;
   if(!precise){method.actualErrorMinutes=null;method.hit=null;continue;}
   const err=Math.abs(actual-method.predictedAt)/60000;method.actualErrorMinutes=Math.round(err*10)/10;method.hit=err<=tolerance;
 }
 return forecast;
}
export function rebuildBossModel(forecasts,models,boss,world){
 const k=key(world,boss);delete models[k];
 const rows=forecasts.filter(f=>f.boss===boss&&f.world===world&&f.resolvedAt&&Number.isFinite(f.actualAt)).sort((a,b)=>a.resolvedAt-b.resolvedAt);
 for(const forecast of rows){for(const method of forecast.methods||[]){if(!Number.isFinite(method.actualErrorMinutes))continue;learnMethodResult(models,boss,world,method.name,method.actualErrorMinutes,!!method.hit,forecast.resolvedAt);}const model=ensureModel(models,boss,world);model.resolved++;model.lastResolvedAt=Math.max(model.lastResolvedAt||0,forecast.resolvedAt||0);}
 return ensureModel(models,boss,world);
}
export function resolveForecasts(forecasts,event,models,{controlled=false}={}){
 if(!/^confirmed_/.test(event.status)||!Number.isFinite(event.estimatedAt)||event.anomaly||['CONFLITANTE','SUSPEITO','DESCARTADO','AGUARDANDO_CONFIRMAÇÃO'].includes(event.qualityStatus))return [];
 const candidates=forecasts.filter(f=>!f.resolvedAt&&f.boss===event.boss&&f.world===event.world&&f.baseEventId&&f.baseEventId!==event.id&&f.baseEventAt<event.estimatedAt&&f.createdAt<event.estimatedAt);
 if(!candidates.length)return [];
 const forecast=candidates.sort((a,b)=>b.baseEventAt-a.baseEventAt||a.createdAt-b.createdAt)[0];
 forecast.resolvedAt=Date.now();recalculateForecastOutcome(forecast,event);
 if(!controlled)for(const method of forecast.methods||[])if(Number.isFinite(method.predictedAt)&&Number.isFinite(method.actualErrorMinutes))learnMethodResult(models,event.boss,event.world,method.name,method.actualErrorMinutes,!!method.hit,forecast.resolvedAt);
 const model=ensureModel(models,event.boss,event.world);model.resolved++;model.lastResolvedAt=forecast.resolvedAt;
 return [forecast];
}
export function modelPublic(models,world){
 return Object.values(models).filter(m=>m.world===world).map(m=>({boss:m.boss,world:m.world,resolved:m.resolved,lastResolvedAt:m.lastResolvedAt,methods:Object.values(m.methods).map(x=>({...x,emaErrorMinutes:x.emaErrorMinutes==null?null:Math.round(x.emaErrorMinutes*10)/10,emaHitRate:x.emaHitRate==null?null:Math.round(x.emaHitRate*1000)/10})).sort((a,b)=>(b.count||0)-(a.count||0))})).sort((a,b)=>b.resolved-a.resolved||a.boss.localeCompare(b.boss));
}

import {eventsAsOf} from './canonical-events.mjs';
import {mean,median} from './statistics.mjs';
export function addTimingTargets(d,world,boss,rows,asOf){
 const events=eventsAsOf(d,world,asOf).filter(e=>e.boss===boss);
 return rows.map(row=>{const next=events.find(e=>e.spawn.lower>row.at&&e.spawn.upper<=row.at+row.horizonHours*3600000);return {...row,waitMinutes:next&&next.spawn.lower===next.spawn.upper?(next.spawn.estimate-row.at)/60000:null};});
}
export function timingComparison(train,current,keys){
 const available=train.filter(r=>r.waitMinutes!=null&&r.knownAt<=current.at),local=available.filter(r=>r.features.elapsed===current.features.elapsed),baseRows=local.length>=10?local:available,baseline=mean(baseRows.map(r=>r.waitMinutes));
 if(current.waitMinutes==null||baseline==null)return null;
 const cell=baseRows.filter(r=>keys.every(k=>r.features[k]===current.features[k])),withSignal=(cell.reduce((s,r)=>s+r.waitMinutes,0)+20*baseline)/(cell.length+20);
 return {baselineErrorMinutes:Math.abs(baseline-current.waitMinutes),signalErrorMinutes:Math.abs(withSignal-current.waitMinutes)};
}
export function timingMetrics(rows){
 const available=rows.filter(r=>r.timing);return {samples:available.length,baselineMAEMinutes:mean(available.map(r=>r.timing.baselineErrorMinutes)),signalMAEMinutes:mean(available.map(r=>r.timing.signalErrorMinutes)),signalMedianErrorMinutes:median(available.map(r=>r.timing.signalErrorMinutes)),definition:'Erro condicional a spawn preciso dentro da janela; não mede erro de todas as janelas. Ausências são avaliadas por Brier/log loss.'};
}

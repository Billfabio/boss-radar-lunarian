const H=3600000;
const median=a=>{if(!a.length)return null;const s=[...a].sort((x,y)=>x-y),m=Math.floor(s.length/2);return s.length%2?s[m]:(s[m-1]+s[m])/2;};
const mad=(a,c)=>median(a.map(x=>Math.abs(x-c)))||0;
export function detectDrift(events,boss,world){
 const rows=events.filter(e=>e.boss===boss&&e.world===world&&/^confirmed_/.test(e.status)&&!e.anomaly&&e.qualityStatus!=='CONFLITANTE'&&e.qualityStatus!=='SUSPEITO'&&e.eventType!=='absence').sort((a,b)=>a.estimatedAt-b.estimatedAt);
 const ints=rows.slice(1).map((e,i)=>e.estimatedAt-rows[i].estimatedAt).filter(x=>x>H&&x<180*24*H);
 if(ints.length<16)return {detected:false,score:0,samples:ints.length,reason:'Dados insuficientes para drift.'};
 const recent=ints.slice(-Math.min(12,Math.floor(ints.length/3))),older=ints.slice(0,-recent.length);if(older.length<8)return {detected:false,score:0,samples:ints.length,reason:'Histórico anterior insuficiente.'};
 const a=median(older),b=median(recent),spread=Math.max(H,mad(older,a)*1.4826,mad(recent,b)*1.4826),relative=Math.abs(b-a)/Math.max(a,H),standardized=Math.abs(b-a)/spread;
 const score=Math.min(100,Math.round(100*(.55*Math.min(1,relative/.25)+.45*Math.min(1,standardized/2.5))));
 const detected=score>=60&&recent.length>=6;
 return {detected,score,samples:ints.length,olderSamples:older.length,recentSamples:recent.length,historicalMedianMs:Math.round(a),recentMedianMs:Math.round(b),changePercent:Math.round((b/a-1)*1000)/10,historyWeightMultiplier:detected?Math.max(.35,1-score/130):1,recentWeightMultiplier:detected?Math.min(1.8,1+score/140):1,reason:detected?'Mudança de padrão detectada.':'Sem mudança estatisticamente relevante.'};
}

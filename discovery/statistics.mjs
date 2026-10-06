export const mean=a=>a.length?a.reduce((s,n)=>s+n,0)/a.length:null;
export const median=a=>{if(!a.length)return null;const s=[...a].sort((a,b)=>a-b);return (s[Math.floor((s.length-1)/2)]+s[Math.floor(s.length/2)])/2;};
export const clamp=p=>Math.max(.001,Math.min(.999,p));
export function probabilityMetrics(rows,key){
 if(!rows.length)return {samples:0,brier:null,logLoss:null,ece:null,recall:null};
 const bins=Array.from({length:10},()=>[]);for(const r of rows)bins[Math.min(9,Math.floor(clamp(r[key])*10))].push(r);
 const positives=rows.filter(x=>x.y===1);
 return {samples:rows.length,brier:mean(rows.map(r=>(r[key]-r.y)**2)),logLoss:mean(rows.map(r=>-r.y*Math.log(clamp(r[key]))-(1-r.y)*Math.log(1-clamp(r[key])))),ece:bins.reduce((s,b)=>s+(b.length?b.length/rows.length*Math.abs(mean(b.map(r=>r[key]))-mean(b.map(r=>r.y))):0),0),recall:positives.length?positives.filter(r=>r[key]>=.5).length/positives.length:null};
}
// One-sided exact paired sign test on non-overlapping daily blocks. Ties do not count.
export function pairedSign(rows){
 const blocks=new Map();for(const r of rows){const day=Math.floor(r.at/86400000);const values=blocks.get(day)||[];values.push((r.baseline-r.y)**2-(r.signal-r.y)**2);blocks.set(day,values);}
 const values=[...blocks.values()].map(mean).filter(n=>Math.abs(n)>1e-12),n=values.length,k=values.filter(x=>x>0).length;
 if(!n)return {p:1,blocks:0};
 // Recurrence in log space avoids overflow with long histories.
 let logTerm=-n*Math.log(2),p=0;for(let i=0;i<=n;i++){if(i>=k)p+=Math.exp(logTerm);logTerm+=Math.log(n-i)-Math.log(i+1);}
 return {p:Math.min(1,p),blocks:n};
}
export function adjustFDR(experiments,field){
 const sorted=experiments.map((e,i)=>({i,p:e[field]?.p??1})).sort((a,b)=>a.p-b.p);let q=1;for(let j=sorted.length-1;j>=0;j--){q=Math.min(q,sorted[j].p*sorted.length/(j+1));experiments[sorted[j].i][field].q=q;}
 return experiments;
}
export function wilson(k,n){if(!n)return null;const z=1.96,p=k/n,d=1+z*z/n,c=(p+z*z/(2*n))/d,h=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d;return [Math.max(0,c-h),Math.min(1,c+h)];}

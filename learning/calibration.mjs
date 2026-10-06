const BINS=[[50,60],[60,70],[70,80],[80,90],[90,101]];
const round=n=>Math.round(n*10)/10;
const confidenceValue=(row,raw)=>raw?Number(row.confidenceRaw??row.confidence):Number(row.confidence??row.confidenceRaw);
function buildReport(forecasts,world,boss,raw){
 const rows=forecasts.filter(f=>f.world===world&&(!boss||f.boss===boss)&&f.resolvedAt&&Number.isFinite(confidenceValue(f,raw)));
 const bins=BINS.map(([lo,hi])=>{
  const x=rows.filter(r=>{const c=confidenceValue(r,raw);return c>=lo&&c<hi;});
  const hits=x.filter(r=>r.windowHit).length,expected=x.length?x.reduce((n,r)=>n+confidenceValue(r,raw),0)/x.length:null,actual=x.length?100*hits/x.length:null;
  return {range:`${lo}–${hi===101?100:hi}%`,min:lo,max:hi===101?100:hi,samples:x.length,expected:expected==null?null:round(expected),actual:actual==null?null:round(actual),gap:expected==null||actual==null?null:round(actual-expected)};
 });
 const n=rows.length,ece=n?bins.reduce((sum,b)=>sum+(b.samples/n)*Math.abs(b.gap||0),0):null;
 return {samples:n,ece:ece==null?null:round(ece),bins,confidenceField:raw?'raw':'calibrated'};
}
export function calibrationReport(forecasts,world,boss=null,{raw=false}={}){
 const final=buildReport(forecasts,world,boss,raw);
 if(!raw){const before=buildReport(forecasts,world,boss,true);final.rawEce=before.ece;final.rawBins=before.bins;}
 return final;
}
export function calibrateConfidence(raw,forecasts,world,boss=null){
 const c=Math.max(0,Math.min(100,Number(raw)||0)),rows=forecasts.filter(f=>f.world===world&&(!boss||f.boss===boss)&&f.resolvedAt&&Number.isFinite(f.confidenceRaw??f.confidence));
 const bin=BINS.find(([lo,hi])=>c>=lo&&c<hi);if(!bin)return {raw:c,calibrated:c,samples:0,method:'identity'};
 const x=rows.filter(r=>{const v=Number(r.confidenceRaw??r.confidence);return v>=bin[0]&&v<bin[1];});
 if(x.length<20)return {raw:c,calibrated:c,samples:x.length,method:'insufficient_calibration_data'};
 const hits=x.filter(r=>r.windowHit).length,priorStrength=10,empirical=100*(hits+priorStrength*c/100)/(x.length+priorStrength),blend=Math.min(.8,x.length/100),calibrated=(1-blend)*c+blend*empirical;
 return {raw:c,calibrated:round(calibrated),samples:x.length,method:'empirical_beta_shrinkage'};
}

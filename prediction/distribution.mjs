const H=3600000;
export function probabilityDistribution(methods=[],centerAt,uncertaintyMs,{slotMinutes=30,slots=8}={}){
 if(!Number.isFinite(centerAt)||!methods.length)return [];
 const step=slotMinutes*60000,start=centerAt-Math.floor(slots/2)*step,raw=[];
 for(let i=0;i<slots;i++){
  const from=start+i*step,to=from+step,mid=(from+to)/2;let score=0;
  for(const m of methods){if(!Number.isFinite(m.predictedAt))continue;const sigma=Math.max(step,Number(m.spreadMs)||uncertaintyMs/2||2*H),z=(mid-m.predictedAt)/sigma;score+=(Number(m.normalizedWeight)||Number(m.weight)||1)*Math.exp(-.5*z*z);}
  raw.push({from,to,score});
 }
 const total=raw.reduce((n,x)=>n+x.score,0)||1,values=raw.map(x=>({...x,probability:100*x.score/total}));
 let rounded=values.map(x=>({...x,probability:Math.round(x.probability*10)/10})),diff=Math.round((100-rounded.reduce((n,x)=>n+x.probability,0))*10)/10;
 if(rounded.length){const idx=rounded.reduce((best,x,i,a)=>x.probability>a[best].probability?i:best,0);rounded[idx].probability=Math.max(0,Math.round((rounded[idx].probability+diff)*10)/10);}
 return rounded.map(({score,...x})=>x);
}

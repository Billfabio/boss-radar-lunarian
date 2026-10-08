export const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
export const quantile=(a,p)=>{if(!a.length)return null;const s=[...a].sort((x,y)=>x-y),n=(s.length-1)*p,i=Math.floor(n);return s[i]+((s[i+1]??s[i])-s[i])*(n-i);};
export const eventIntervals=rows=>rows.slice(1).map((e,i)=>e.estimatedAt-rows[i].estimatedAt).filter(x=>x>3600000&&x<180*86400000);

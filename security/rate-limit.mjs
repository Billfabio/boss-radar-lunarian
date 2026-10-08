export class RateLimiter{
 constructor({windowMs=60000,max=60,maxKeys=10000}={}){this.windowMs=windowMs;this.max=max;this.maxKeys=maxKeys;this.map=new Map();}
 check(key,now=Date.now()){if(this.map.size>this.maxKeys){for(const [k,v] of this.map)if(v.resetAt<=now)this.map.delete(k);if(this.map.size>this.maxKeys)this.map.clear();}
  let row=this.map.get(key);if(!row||row.resetAt<=now){row={count:0,resetAt:now+this.windowMs};this.map.set(key,row);}row.count++;return {allowed:row.count<=this.max,remaining:Math.max(0,this.max-row.count),resetAt:row.resetAt};
 }
}

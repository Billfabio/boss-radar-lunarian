import {randomUUID} from 'node:crypto';
export function createStructuredLogger({state,persist,limit=5000}){
 state.structuredLog ||= [];
 return {
  async write(level,category,message,data={},traceId=''){
   const row={id:'log-'+randomUUID(),at:Date.now(),level,category,message:String(message).slice(0,500),traceId:String(traceId||''),data};
   state.structuredLog.unshift(row);if(state.structuredLog.length>limit)state.structuredLog.length=limit;
   if(level==='error'||level==='warn')await persist();
   return row;
  },
  recent(n=200){return state.structuredLog.slice(0,Math.max(1,Math.min(1000,n)));},
  errorsSince(ms){const since=Date.now()-ms;return state.structuredLog.filter(x=>x.level==='error'&&x.at>=since);}
 };
}

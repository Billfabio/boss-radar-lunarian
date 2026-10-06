import {createHash} from 'node:crypto';
const stable=value=>{
 if(value===null||typeof value!=='object')return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(stable).join(',')+']';
 return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}';
};
const hash=s=>createHash('sha256').update(s).digest('hex');
export function appendLedger(ledger,type,payload,at=Date.now()){
 const previousHash=ledger.at(-1)?.hash||'GENESIS',entry={sequence:ledger.length+1,type,at,payload,previousHash};
 entry.hash=hash(previousHash+'|'+stable({sequence:entry.sequence,type,at,payload}));
 ledger.push(entry);return entry;
}
export function verifyLedger(ledger=[]){
 let previous='GENESIS';for(let i=0;i<ledger.length;i++){const e=ledger[i],expected=hash(previous+'|'+stable({sequence:e.sequence,type:e.type,at:e.at,payload:e.payload}));if(e.previousHash!==previous||e.hash!==expected||e.sequence!==i+1)return {valid:false,index:i,expected,actual:e.hash};previous=e.hash;}return {valid:true,entries:ledger.length,lastHash:previous};
}

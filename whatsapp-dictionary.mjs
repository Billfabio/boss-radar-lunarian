import {createHash} from 'node:crypto';
const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const idFor=name=>'boss-'+createHash('sha256').update(norm(name)).digest('hex').slice(0,16);
export function buildBossDictionary({catalog=[],bosstiary=[],aliases={}}={}){
 const names=[...new Set([...catalog,...bosstiary].map(x=>typeof x==='string'?x:x?.name).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
 const entries=names.map(name=>({boss_id:idFor(name),name,aliases:[...new Set((aliases[name]||[]).map(String).filter(Boolean))]}));
 const version=createHash('sha256').update(JSON.stringify(entries)).digest('hex').slice(0,20);
 return {version,entries};
}
export function dictionaryNames(dictionary){return dictionary.entries.map(x=>x.name);}

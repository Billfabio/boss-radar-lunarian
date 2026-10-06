import {WORLD_IDS} from './official-source.mjs';
export const CATEGORIES={experience:'Experiência',magic:'Magic level',shielding:'Shielding',distance:'Distance',sword:'Sword',axe:'Axe',club:'Club',fist:'Fist',fishing:'Fishing',dromelevel:'Drome level',linked_tasks:'Linked tasks',exp_today:'Experiência de hoje',achievements:'Pontos de conquista',battlepass:'Battle Pass',charmunlockpoints:'Charm unlock points',prestigepoints:'Prestígio',totalweeklytasks:'Tasks semanais',totalbountypoints:'Bounty points',charmtotalpoints:'Charm points totais',bosstotalpoints:'Boss points totais'};
const cache=new Map(),inflight=new Map();
export function findRankings(sets,name){return sets.map(s=>{const row=s.players?.find(p=>p.name?.toLowerCase()===name.toLowerCase());return {category:s.category,label:CATEGORIES[s.category],status:s.error?'unavailable':row?'found':'not-listed',value:row?.value??null,rank:row?.rank??null,totalListed:s.players?.length||0,cachedAt:s.cachedAt||null,fetchedAt:s.fetchedAt,error:s.error||null};});}
async function collect(world){
 const id=WORLD_IDS[world];if(!id)throw new Error('Mundo sem identificação oficial');
 const categories=Object.keys(CATEGORIES),sets=[];
 for(let i=0;i<categories.length;i+=3){
  const batch=await Promise.all(categories.slice(i,i+3).map(async category=>{
   try{const r=await fetch(`https://rubinot.com.br/api/highscores?world=${id}&category=${category}&vocation=0`,{signal:AbortSignal.timeout(8000),headers:{Accept:'application/json'}});if(!r.ok)throw new Error(`HTTP ${r.status}`);const json=await r.json();if(!Array.isArray(json.players))throw new Error('Formato desconhecido');return {category,players:json.players,cachedAt:json.cachedAt,fetchedAt:Date.now()};}
   catch(e){return {category,error:e.message,fetchedAt:Date.now()};}
  }));sets.push(...batch);
  if(batch.some(s=>s.error==='HTTP 429')){for(const category of categories.slice(i+3))sets.push({category,error:'Limite temporário da fonte; próxima consulta em 15 minutos',fetchedAt:Date.now()});break;}
 }
 cache.set(world,{sets,at:Date.now()});return sets;
}
export async function characterRankings(world,name){
 let entry=cache.get(world),sets;
 if(entry && Date.now()-entry.at<900000)sets=entry.sets;
 else {if(!inflight.has(world))inflight.set(world,collect(world).finally(()=>inflight.delete(world)));sets=await inflight.get(world);}
 return {source:'https://rubinot.com.br/highscores',world,rows:findRankings(sets,name),note:'Consulta às 20 categorias públicas do mundo, com todas as vocações. Ausência no ranking não significa valor zero. As listas são limitadas pela fonte.'};
}

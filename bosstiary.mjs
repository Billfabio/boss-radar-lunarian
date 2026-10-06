export const STAGES={Bane:[25,100,300],Archfoe:[5,20,60],Nemesis:[1,3,5],Bestiary:[2,3,5]};
export const canonical=name=>String(name).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
export function entryFor(name,entries){const key=canonical(name)==='feroxa'?'feroxamortal':canonical(name);return entries.find(b=>canonical(b.name)===key);}
export function resolvedProgress(name,saved,entries){
 const entry=entryFor(name,entries),old=saved||{};
 const target=entry?.target||old.target||1,kills=old.kills||0;
 return {...old,kills,target,category:entry?.category||null,known:old.known??!!saved,completed:!!(old.known??saved)&&!!(entry||old.targetConfirmed)&&kills>=target,favorite:!!old.favorite,muted:!!old.muted};
}
export function parseTotals(text,names){
 const lines=text.trim().split(/\r?\n/),seen=new Set();
 return lines.map((line,index)=>{
  const match=line.trim().match(/^(.+?)\s*[;=\t]\s*(\d+)\s*$/);
  if(!match)throw new Error(`Linha ${index+1}: use Nome do boss; quantidade`);
  const name=names.find(n=>canonical(n)===canonical(match[1]));
  if(!name)throw new Error(`Linha ${index+1}: boss não encontrado: ${match[1]}`);
  if(seen.has(name))throw new Error(`Boss repetido: ${name}`);
  seen.add(name);const kills=Number(match[2]);
  if(kills>100000)throw new Error(`Quantidade muito alta: ${name}`);
  return {name,kills};
 });
}

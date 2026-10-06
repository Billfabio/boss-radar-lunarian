import {canonical} from './bosstiary.mjs';
export function brasiliaDate(now=Date.now()){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(now));const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));return `${p.year}-${p.month}-${p.day}`;}
export function validDate(date){if(!/^\d{4}-\d{2}-\d{2}$/.test(date||''))return false;const d=new Date(date+'T12:00:00-03:00');return Number.isFinite(+d)&&brasiliaDate(+d)===date;}
const aliases={pantera:'Midnight Panther',panther:'Midnight Panther',murius:'General Murius',cavebear:'Undead Cavebear',crustacea:'Crustacea Gigantica'};
function matchBoss(text,names){const key=canonical(text);const alias=aliases[key];return names.find(n=>canonical(n)===canonical(alias||text))||null;}
function resultOf(text){const s=text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');if(/nao (?:achei|acharam|encontrei|encontraram|estava|estavam|encontrado)|ausente|nao encontrado|vazio|❌|❎/.test(s))return 'vazio';if(/encontrei|encontrado|encontraram|estava|estavam|presente|acharam|achei|✅/.test(s))return 'encontrado';return null;}
export function parseGroupText(text,names,defaults={}){
 if(typeof text!=='string'||text.length>40000)throw new Error('Cole até 40 mil caracteres por rodada.');
 let context=defaults.result??'vazio';const rows=[];
 for(const raw of text.split(/\r?\n/)){
  let line=raw.trim();if(!line)continue;
  const stamp=line.match(/^\[?(\d{1,2}):(\d{2})(?:,?\s+(\d{1,2})\/(\d{1,2})\/(\d{2,4}))?\]?\s*(?:[^:]{1,60}:\s*)?/);
  let time=defaults.time||'',date=defaults.date;
  if(stamp){time=stamp[1].padStart(2,'0')+':'+stamp[2];if(stamp[3])date=(stamp[5].length===2?'20'+stamp[5]:stamp[5])+'-'+stamp[4].padStart(2,'0')+'-'+stamp[3].padStart(2,'0');line=line.slice(stamp[0].length);}
  line=line.replace(/^[•*\-]\s*/,'');const result=resultOf(line)||context;
  const cleaned=line.replace(/❌|❎|✅/g,'').replace(/\s*(?:;|=|:|\s)\s*(?:n[aã]o (?:estavam?|encontrad[oa]s?|achei|encontrei)|vazio|ausente|presente|encontrado|estavam?)\s*$/i,'').replace(/^(?:n[aã]o (?:estavam?|encontrad[oa]s?|achei|encontrei)|ausentes?|vazios?|estavam?|encontrad[oa]s?|presentes?|achei|encontrei)\s*[:\-]?\s*/i,'').trim();
  if(!cleaned&&resultOf(line)){context=result;continue;}
  // Section headings set the default; they never create observations.
  if(/^(?:bosses?\s+)?(?:n[aã]o estavam|n[aã]o encontrados|ausentes|vazios|encontrados|presentes|estavam)\s*:?$/i.test(line)){context=result;continue;}
  for(const part of cleaned.split(/\s*[,;]\s*/).filter(Boolean)){
   const boss=matchBoss(part,names);rows.push({boss:boss||'',text:part,result,date,time,favorable:'unknown'});
  }
 }
 if(rows.length>200)throw new Error('Use até 200 bosses por rodada.');
 return rows;
}
export function checkKey(c){return JSON.stringify([c.world,canonical(c.boss),c.date,c.time||'',c.result]);}
export function validateGroupRows(input,names,worlds,now=Date.now()){
 if(!worlds.includes(input.world)||!Array.isArray(input.rows)||!input.rows.length||input.rows.length>200)throw new Error('Rodada inválida. Escolha o mundo e até 200 bosses.');
 const seen=new Set();return input.rows.map(row=>{
  const boss=names.find(n=>canonical(n)===canonical(row.boss));
  if(!boss||!validDate(row.date)||row.date>brasiliaDate(now)||row.date<'2020-01-01'||!['vazio','encontrado'].includes(row.result)||!['yes','no','unknown'].includes(row.favorable)||row.time&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(row.time))throw new Error('Confira o boss, resultado, data e horário de cada linha. Datas futuras não são aceitas.');
  const c={boss,world:input.world,date:row.date,time:row.time||null,result:row.result,favorable:row.favorable,origin:'group',at:Date.parse(row.date+'T'+(row.time||'12:00')+':00-03:00'),precision:row.time?'minute':'day'};
  const key=checkKey(c);if(seen.has(key))throw new Error('Há uma checagem repetida na prévia. Remova a linha duplicada.');seen.add(key);return c;
 });
}
function interval(found,total){if(!total)return [0,1];const z=1.96,p=found/total,a=1+z*z/total,b=(p+z*z/(2*total))/a,c=z*Math.sqrt((p*(1-p)+z*z/(4*total))/total)/a;return [Math.max(0,b-c),Math.min(1,b+c)];}
export function groupPatterns(records,world){
 const grouped=new Map();for(const c of records.filter(c=>c.world===world)){
  const name=c.boss;if(!grouped.has(name))grouped.set(name,[]);grouped.get(name).push(c);
 }
 return [...grouped].map(([boss,checks])=>{
  // Each day and three-hour block contributes at most one observation. A sighting wins
  // over an absence in the same block; this is availability when checked, not a spawn.
  const blocks=new Map(),days=new Map();
  for(const c of checks){const bucket=c.time?Math.floor(Number(c.time.slice(0,2))/3):null,key=c.date+'|'+bucket;const old=blocks.get(key);if(!old||c.result==='encontrado')blocks.set(key,c);const day=days.get(c.date);if(!day||c.result==='encontrado')days.set(c.date,c);}
  const hours=Array.from({length:8},(_,bucket)=>{const samples=[...blocks.values()].filter(c=>c.time&&Math.floor(Number(c.time.slice(0,2))/3)===bucket),found=samples.filter(c=>c.result==='encontrado').length;return {bucket,start:bucket*3,end:bucket*3+3,total:samples.length,found,days:new Set(samples.map(c=>c.date)).size,bounds:interval(found,samples.length)};});
  const eligible=hours.filter(h=>h.total>=10&&h.days>=5&&h.found>=3).sort((a,b)=>b.bounds[0]-a.bounds[0]);const best=eligible[0];const others=hours.filter(h=>h!==best&&h.total>=10&&h.days>=5);const recommended=best&&others.length&&others.every(h=>best.bounds[0]>h.bounds[1])?best:null;
  const favorable=[...days.values()].filter(c=>c.favorable==='yes'),notFavorable=[...days.values()].filter(c=>c.favorable==='no');
  return {boss,total:blocks.size,found:[...blocks.values()].filter(c=>c.result==='encontrado').length,days:days.size,favorable:{total:favorable.length,found:favorable.filter(c=>c.result==='encontrado').length},notFavorable:{total:notFavorable.length,found:notFavorable.filter(c=>c.result==='encontrado').length},hours,recommended,lastSeen:checks.filter(c=>c.result==='encontrado').sort((a,b)=>b.at-a.at)[0]||null};
 }).sort((a,b)=>Number(!!b.recommended)-Number(!!a.recommended)||b.total-a.total||a.boss.localeCompare(b.boss));
}

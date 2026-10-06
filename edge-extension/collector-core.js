(()=>{
 const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f\u200e\u200f\u202a-\u202e]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
 const compact=s=>norm(s).replace(/\s+/g,'');
 const words=s=>norm(s).split(' ').filter(Boolean);
 const levenshtein=(a,b)=>{a=compact(a);b=compact(b);if(a===b)return 0;if(!a.length)return b.length;if(!b.length)return a.length;let p=Array.from({length:b.length+1},(_,i)=>i),c=[];for(let i=1;i<=a.length;i++){c[0]=i;for(let j=1;j<=b.length;j++)c[j]=Math.min(c[j-1]+1,p[j]+1,p[j-1]+(a[i-1]===b[j-1]?0:1));[p,c]=[c,p];}return p[b.length];};
 const similarity=(a,b)=>{const aa=compact(a),bb=compact(b),m=Math.max(aa.length,bb.length);return m?1-levenshtein(aa,bb)/m:0;};
 const containsPhrase=(text,phrase)=>{const t=' '+norm(text)+' ',p=' '+norm(phrase)+' ';return !!norm(phrase)&&t.includes(p);};
 const trigrams=s=>{const x=' '+compact(s)+' ',out=new Set();for(let i=0;i<x.length-2;i++)out.add(x.slice(i,i+3));return out;};
 function compileDictionary(dictionary={version:'',entries:[]}){
  const exact=[],index=new Map(),shapeIndex=new Map();
  const addShape=(key,item)=>{if(!key)return;if(!shapeIndex.has(key))shapeIndex.set(key,[]);shapeIndex.get(key).push(item);};
  for(const entry of dictionary.entries||[]){for(const raw of [entry.name,...(entry.aliases||[])]){const value=norm(raw);if(!value)continue;const item={boss_id:entry.boss_id,name:entry.name,value,alias:raw!==entry.name};exact.push(item);for(const g of trigrams(value)){if(!index.has(g))index.set(g,[]);index.get(g).push(item);}const c=compact(value);for(let d=-3;d<=3;d++){const len=c.length+d;if(len<3)continue;addShape('f:'+c[0]+'|'+len,item);if(c[1])addShape('s:'+c[1]+'|'+len,item);}}}
  return {version:dictionary.version||'',entries:dictionary.entries||[],exact,index,shapeIndex};
 }
 function fuzzy(text,compiled){
  const ws=words(text),scored=new Map(),seenPhrases=new Set();
  for(let i=0;i<ws.length;i++)for(let n=1;n<=Math.min(4,ws.length-i);n++){
   const phrase=ws.slice(i,i+n).join(' '),a=compact(phrase);if(a.length<4||seenPhrases.has(a))continue;seenPhrases.add(a);
   let candidates=compiled.shapeIndex?.get('f:'+a[0]+'|'+a.length)||[];
   if(!candidates.length&&a[1])candidates=compiled.shapeIndex?.get('s:'+a[1]+'|'+a.length)||[];
   if(!candidates.length)continue;
   const unique=new Set();
   for(const item of candidates){const key=item.name+'|'+item.value;if(unique.has(key))continue;unique.add(key);const b=compact(item.value);if(Math.abs(a.length-b.length)>3)continue;const score=similarity(phrase,item.value),threshold=b.length<=5?.88:b.length<=8?.82:.76;if(score<threshold)continue;const old=scored.get(item.name);if(!old||score>old.similarity)scored.set(item.name,{boss_id:item.boss_id,name:item.name,matchType:'FUZZY',similarity:Math.round(score*1000)/1000,matched:phrase});}
  }
  return [...scored.values()].sort((a,b)=>b.similarity-a.similarity).slice(0,5);
 }
 function match(text,compiled){
  const normalized=norm(text),padded=' '+normalized+' ',out=new Map();
  for(const item of compiled.exact){if(padded.includes(' '+item.value+' ')){const type=item.alias?'ALIAS':'EXACT',old=out.get(item.name);if(!old||old.matchType==='FUZZY')out.set(item.name,{boss_id:item.boss_id,name:item.name,matchType:type,similarity:1,matched:item.value});}}
  if(out.size)return [...out.values()];
  const wordCount=normalized?normalized.split(' ').length:0,context=classify(text);
  if(context==='UNKNOWN'&&wordCount>4)return [];
  return fuzzy(normalized,compiled);
 }
 function classify(text){
  const raw=String(text||''),s=norm(raw);
  if(raw.includes('?')||/\b(?:quem viu|alguem viu|sera que|saiu ou nao|cade|onde)\b/.test(s))return 'QUESTION';
  if(/\b(?:nao saiu|nao apareceu|nao tem|nao vi|nada de|fake|falso|nao e)\b/.test(s))return 'NEGATION';
  if(/\b(?:corrigindo|correcao|horario correto|foi as|na verdade|era)\b/.test(s))return 'CORRECTION';
  if(/\b(?:acho|talvez|provavelmente|pode sair|deve sair|chance|se aparecer|mais tarde|hoje ainda)\b/.test(s))return 'SPECULATION';
  if(/\b(?:confirmado|confirmo|eu vi|ta la|esta la|vi agora)\b/.test(s))return 'CONFIRMATION';
  if(/\b(?:saiu|spawn|nasceu|apareceu|agora|achei|encontrei|foi|ta aqui|esta aqui)\b/.test(s))return 'POSSIBLE_REPORT';
  return 'UNKNOWN';
 }
 const fingerprintMaterial=({groupKey='',authorHash='',messageTimestamp='',normalizedText='',messageKey=''})=>[groupKey,authorHash,messageTimestamp,messageKey,norm(normalizedText)].join('|');
 function pruneProcessed(entries=[],now=Date.now(),ttlMs=24*3600000,max=10000){
  const map=new Map();for(const row of entries||[]){const key=String(row?.key||''),at=Number(row?.at)||0;if(!key||now-at>ttlMs)continue;const old=map.get(key);if(!old||at>old.at)map.set(key,{key,at});}
  return [...map.values()].sort((a,b)=>b.at-a.at).slice(0,max);
 }
 globalThis.BossCollectorCore={norm,compact,similarity,compileDictionary,match,classify,fingerprintMaterial,pruneProcessed};
})();
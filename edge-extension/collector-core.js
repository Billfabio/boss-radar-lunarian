(()=>{
 const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f\u200e\u200f\u202a-\u202e]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
 const compact=s=>norm(s).replace(/\s+/g,'');
 const words=s=>norm(s).split(' ').filter(Boolean);
 const levenshtein=(a,b)=>{a=compact(a);b=compact(b);if(a===b)return 0;if(!a.length)return b.length;if(!b.length)return a.length;let p=Array.from({length:b.length+1},(_,i)=>i),c=[];for(let i=1;i<=a.length;i++){c[0]=i;for(let j=1;j<=b.length;j++)c[j]=Math.min(c[j-1]+1,p[j]+1,p[j-1]+(a[i-1]===b[j-1]?0:1));[p,c]=[c,p];}return p[b.length];};
 const similarity=(a,b)=>{const aa=compact(a),bb=compact(b),m=Math.max(aa.length,bb.length);return m?1-levenshtein(aa,bb)/m:0;};
 const containsPhrase=(text,phrase)=>{const t=' '+norm(text)+' ',p=' '+norm(phrase)+' ';return !!norm(phrase)&&t.includes(p);};
 const trigrams=s=>{const x=' '+compact(s)+' ',out=new Set();for(let i=0;i<x.length-2;i++)out.add(x.slice(i,i+3));return out;};
 function compileDictionary(dictionary={version:'',entries:[]}){
  const exact=[],index=new Map();
  for(const entry of dictionary.entries||[]){for(const raw of [entry.name,...(entry.aliases||[])]){const value=norm(raw);if(!value)continue;const item={boss_id:entry.boss_id,name:entry.name,value,alias:raw!==entry.name};exact.push(item);for(const g of trigrams(value)){if(!index.has(g))index.set(g,[]);index.get(g).push(item);}}}
  return {version:dictionary.version||'',entries:dictionary.entries||[],exact,index};
 }
 function fuzzy(text,compiled){
  const ws=words(text),phrases=[];for(let i=0;i<ws.length;i++)for(let n=1;n<=Math.min(4,ws.length-i);n++){const p=ws.slice(i,i+n).join(' ');if(compact(p).length>=4)phrases.push(p);}
  const scored=new Map();
  for(const phrase of phrases){const grams=trigrams(phrase),counts=new Map();for(const g of grams)for(const item of compiled.index.get(g)||[])counts.set(item,(counts.get(item)||0)+1);
   for(const [item,count] of [...counts].sort((a,b)=>b[1]-a[1]).slice(0,24)){const a=compact(phrase),b=compact(item.value);if(Math.abs(a.length-b.length)>3)continue;const overlap=count/Math.max(1,trigrams(item.value).size);if(overlap<.3)continue;const score=similarity(phrase,item.value),threshold=b.length<=5?.88:b.length<=8?.82:.76;if(score<threshold)continue;const old=scored.get(item.name);if(!old||score>old.similarity)scored.set(item.name,{boss_id:item.boss_id,name:item.name,matchType:'FUZZY',similarity:Math.round(score*1000)/1000,matched:phrase});}}
  return [...scored.values()].sort((a,b)=>b.similarity-a.similarity).slice(0,5);
 }
 function match(text,compiled){
  const out=new Map();for(const item of compiled.exact){if(containsPhrase(text,item.value)){const type=item.alias?'ALIAS':'EXACT',old=out.get(item.name);if(!old||old.matchType==='FUZZY')out.set(item.name,{boss_id:item.boss_id,name:item.name,matchType:type,similarity:1,matched:item.value});}}
  return out.size?[...out.values()]:fuzzy(text,compiled);
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
 const fingerprintMaterial=({groupKey='',authorHash='',messageTimestamp='',normalizedText=''})=>[groupKey,authorHash,messageTimestamp,norm(normalizedText)].join('|');
 globalThis.BossCollectorCore={norm,compact,similarity,compileDictionary,match,classify,fingerprintMaterial};
})();
export const CHARACTER_NAME='Kena Rain';
import {characterRankings} from './highscores-source.mjs';
export function normalizeCharacter(raw,now=Date.now(),name=CHARACTER_NAME){
 if(!raw?.player || raw.player.name?.toLowerCase()!==name.toLowerCase())throw new Error('Personagem não encontrado na fonte oficial');
 const player={};
 for(const field of ['name','level','vocation','world','sex','residence','lastlogin','created','comment','account_created','loyalty_points','isHidden','recentlyTraded','guild','house','partner','formerNames','title','auction','looktype','lookhead','lookbody','looklegs','lookfeet','lookaddons','vip_time','achievementPoints'])if(field in raw.player)player[field]=raw.player[field];
 return {player,deaths:Array.isArray(raw.deaths)?raw.deaths:[],otherCharacters:Array.isArray(raw.otherCharacters)?raw.otherCharacters:[],accountBadges:Array.isArray(raw.accountBadges)?raw.accountBadges:[],displayedAchievements:Array.isArray(raw.displayedAchievements)?raw.displayedAchievements:[],banInfo:raw.banInfo||null,banHistory:Array.isArray(raw.banHistory)?raw.banHistory:[],fetchedAt:now,source:`https://rubinot.com.br/characters?name=${encodeURIComponent(name)}`,bosstiaryAvailable:false};
}
export function validateCharacterName(value){
 if(typeof value!=='string' || value.trim().length<2 || value.trim().length>60 || /[\x00-\x1f]/.test(value))throw new Error('Informe um nome de personagem entre 2 e 60 caracteres');
 return value.trim();
}
export async function fetchCharacter(input=CHARACTER_NAME){
 const name=validateCharacterName(input);
 const response=await fetch(`https://rubinot.com.br/api/characters/search?name=${encodeURIComponent(name)}`,{signal:AbortSignal.timeout(15000),headers:{Accept:'application/json'}});
 if(!response.ok)throw new Error(`Consulta do personagem indisponível (HTTP ${response.status})`);
 const result=normalizeCharacter(await response.json(),Date.now(),name);
 if(result.player.world){
  const source=`https://rubinotxp.com/character/${encodeURIComponent(result.player.world)}/${encodeURIComponent(result.player.name)}`;
  try {
   const page=await fetch(source,{signal:AbortSignal.timeout(10000)});
   if(!page.ok)throw new Error(`HTTP ${page.status}`);
   const text=(await page.text()).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ');
   const metrics={};
   for(const [field,label] of Object.entries({experience:'Experiência total',gain24h:'Ganho 24h',gain7d:'Ganho 7 dias',gain30d:'Ganho 30 dias'})){
    const match=text.match(new RegExp(label+'\\s+([+−-]?[\\d.]+)'));
    if(match){const value=Number(match[1].replace(/\./g,'').replace('−','-'));if(Number.isSafeInteger(value))metrics[field]=value;}
   }
   result.experience={...metrics,source,fetchedAt:Date.now(),note:'Dados do RubinotXP, coletados por terceiros. Podem diferir da atualização do jogo.'};
  }catch(e){result.experienceError=`RubinotXP indisponível: ${e.message}`;}
 }
 try{result.rankings=await characterRankings(result.player.world,result.player.name);}catch(e){result.rankingsError=e.message;}
 result.sources=[{label:'RubinOT · perfil público',url:result.source,fetchedAt:result.fetchedAt},{label:'RubinOT · rankings públicos',url:'https://rubinot.com.br/highscores',fetchedAt:Date.now()},...(result.experience?[{label:'RubinotXP · experiência',url:result.experience.source,fetchedAt:result.experience.fetchedAt}]:[])];
 return result;
}

export const WORLD_IDS={Elysian:1,Lunarian:9,Auroria:11,Solarian:12,Belaria:15,Vesperia:16,Mystian:18,Tenebrium:21,Bellum:30,Eldrian:31,Obsidian:32,Drakaria:33,Malveria:34,'Infernum I':35,'Infernum II':36,'Infernum III':37};
export const officialURL=world=>`https://rubinot.com.br/api/killstats?world=${WORLD_IDS[world]}`;
const key=s=>s.toLowerCase().replace(/[^a-z0-9]/g,'');
export function mergeOfficial(data,raw,previous={},now=Date.now()){
  if(!Array.isArray(raw?.entries))throw new Error('Formato das estatísticas oficiais desconhecido');
  const map=new Map(raw.entries.filter(x=>typeof x.race_name==='string').map(x=>[key(x.race_name),x]));
  const snapshot={at:now,counts:{}};
  let addedCoverage=0,coverage=0;
  for(const b of data.bosses){
    const row=map.get(key(b.name));
    if(!row)continue;
    const day=row.creatures_killed_24h,week=row.creatures_killed_7d;
    if(!Number.isInteger(day)||day<0||!Number.isInteger(week)||week<0)continue;
    coverage++;if(!data.pending.some(p=>p.boss_name===b.name))addedCoverage++;
    snapshot.counts[b.name]={day,week};
    const old=previous.counts?.[b.name];
    const increase=old && previous.at<now && now-previous.at<=3600000 && (day>old.day||week>old.week);
    b.official={day,week,fetchedAt:now,source:'https://rubinot.com.br/killstats',increase:!!increase,observedSince:increase?previous.at:null};
  }
  data.officialCoverage=coverage;data.additionalCoverage=addedCoverage;
  return snapshot;
}

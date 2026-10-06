export const PUBLIC_SOURCE = 'https://otbosstracker.com/data/bosses.json';
const canonical = name => name.toLowerCase().replace(/[^a-z0-9]/g, '');
export function normalizePublic(raw, world, catalogue, now = Date.now()) {
  const source = raw?.worlds?.[world.toLowerCase()];
  if (!source || !Array.isArray(source.bosses) || !Array.isArray(source.demonLords)) throw new Error('Histórico público indisponível para este mundo');
  const stamp = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(raw.updated || '');
  const today = new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(now));
  const parts = Object.fromEntries(today.map(p=>[p.type,p.value]));
  const age = stamp ? (Date.UTC(+parts.year,+parts.month-1,+parts.day)-Date.UTC(+stamp[3],+stamp[2]-1,+stamp[1]))/86400000 : Infinity;
  if (age < -1 || age > 2) throw new Error('Histórico público desatualizado. Alertas suspensos.');
  const names = new Map(catalogue.map(b=>[canonical(b.name), b.name]));
  const records = [...source.bosses, ...source.demonLords].filter(b=>typeof b?.boss==='string');
  const pending = records.map(b=>({world,boss_name:names.get(canonical(b.boss))||b.boss,resolution:'day',sourceStatus:b.status_key,lastDate:b.txt_date||b.last_date||'',windowText:b.window_txt||`${b.window_min}-${b.window_max}`,recurrences:Array.isArray(b.recorrencias)?b.recorrencias:[],methodology:'Classificação diária do OT Boss Tracker; datas aproximadas de mortes, sem previsão de hora.'}));
  const bosses = catalogue.map(b=>({...b,history:[]}));
  for (const [i,b] of records.entries()) {
    const name=pending[i].boss_name;
    let entry=bosses.find(x=>x.name===name);
    if(!entry) {entry={name,history:[]};bosses.push(entry);}
    entry.history=[...new Map((b.last_kills||[]).filter(x=>typeof x.date==='string').map(x=>[x.date,{world,date:x.date,approximate:!!x.approx}])).values()];
    entry.rawRecords=(b.last_kills||[]).length;
  }
  return {world,pending,bosses,fetchedAt:now,source:PUBLIC_SOURCE,providerUpdated:raw.updated,resolution:'day'};
}

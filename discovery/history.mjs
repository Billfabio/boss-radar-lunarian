import {digest} from '../mlops/feature-store.mjs';
export function recordConfiguration(d,world,settings,at=Date.now()){
 d.configurationVersions||=[];const fields={enabled:!!settings.enabled,leadMinutes:settings.leadMinutes,favoritesOnly:!!settings.favoritesOnly,checkTime:settings.checkTime||'',progress:Object.fromEntries(Object.entries(settings.progress||{}).map(([boss,p])=>[boss,{favorite:!!p.favorite,muted:!!p.muted}])),liveAlerts:!!settings.liveAlerts};const hash=digest({world,fields}),previous=d.configurationVersions.filter(x=>x.world===world).at(-1);if(previous?.hash===hash)return previous;const row={id:'CFG-'+hash.slice(0,20)+'-'+at,world,at,hash,settings:structuredClone(fields)};d.configurationVersions.push(row);return row;
}
export function recordHistoricalAlert(d,input,at=Date.now()){
 d.alertHistory||=[];const row={id:'ALERT-'+digest({world:input.world,key:input.key,boss:input.boss,at}).slice(0,24),world:input.world,boss:input.boss,key:input.key,kind:input.kind,status:input.status||'planned',message:input.message||null,at,configurationId:d.configurationVersions.filter(c=>c.world===input.world&&c.at<=at).at(-1)?.id??null};if(!d.alertHistory.some(a=>a.id===row.id))d.alertHistory.push(row);return row;
}
export function replaySettings(d,world,asOf){return d.configurationVersions?.filter(c=>c.world===world&&c.at<=asOf).at(-1)||null;}
export function replayAlerts(d,world,previousAt,asOf){return (d.alertHistory||[]).filter(a=>a.world===world&&a.at>previousAt&&a.at<=asOf).map(a=>({...a,delivery:'historical_virtual_only'}));}

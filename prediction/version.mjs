import {createHash} from 'node:crypto';
export const PREDICTION_ENGINE_VERSION='4.4.0';
export const MODEL_FAMILY_VERSION='adaptive-ensemble-v4.4';
export function datasetVersion(events,boss,world){
 const rows=events.filter(e=>e.boss===boss&&e.world===world&&/^confirmed_/.test(e.status)&&e.eventType!=='absence').sort((a,b)=>a.estimatedAt-b.estimatedAt||String(a.id).localeCompare(String(b.id)));
 const hash=createHash('sha256');for(const e of rows)hash.update(String(e.id)+'|'+String(e.estimatedAt)+'|'+String(e.updatedAt||0)+'|'+String(e.qualityStatus||'')+';');
 return `${world}|${String(boss).toLowerCase()}|${rows.length}|${hash.digest('hex').slice(0,16)}`;
}

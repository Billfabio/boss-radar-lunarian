export const PREDICTION_ENGINE_VERSION='4.0.0';
export const MODEL_FAMILY_VERSION='adaptive-ensemble-v4';
export function datasetVersion(events,boss,world){
 const rows=events.filter(e=>e.boss===boss&&e.world===world&&/^confirmed_/.test(e.status)&&e.eventType!=='absence').sort((a,b)=>a.estimatedAt-b.estimatedAt);
 const last=rows.at(-1);return `${world}|${String(boss).toLowerCase()}|${rows.length}|${last?.id||'none'}|${last?.updatedAt||last?.estimatedAt||0}`;
}

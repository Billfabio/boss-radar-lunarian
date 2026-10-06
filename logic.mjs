export const WORLDS = ['Auroria','Belaria','Bellum','Drakaria','Eldrian','Elysian','Infernum I','Infernum II','Infernum III','Lunarian','Malveria','Mystian','Obsidian','Solarian','Tenebrium','Vesperia'];

// Prediction dates with an explicit zone are accepted. Ambiguous datetimes are
// retained for display but never drive an unattended alert.
export function instant(value) {
  if (typeof value !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/i.test(value)) return null;
  const result = Date.parse(value);
  return Number.isFinite(result) ? result : null;
}
export function status(prediction, now = Date.now()) {
  if(prediction?.resolution==='day') return ({quente:'high',media:'medium',inicial:'low',fora:'late'})[prediction.sourceStatus] || 'unknown';
  const start = instant(prediction?.predicted_window_start);
  const end = instant(prediction?.predicted_window_end);
  if (start === null || end === null || end < start) return 'unknown';
  if (now > end) return 'late';
  if (now >= start) return 'high';
  return start - now <= 3 * 86400000 ? 'medium' : 'low';
}
export function uniqueHistory(history = []) {
  return [...new Map(history.filter(x => x && typeof x.date === 'string').map(x => [`${x.world || ''}|${x.date}`, x])).values()];
}
export function alertKey(prediction, kind) {
  return JSON.stringify([prediction.world, prediction.boss_name, prediction.predicted_window_start, prediction.predicted_window_end, kind]);
}
export function dueAlert(prediction, settings, now = Date.now()) {
  const progress = settings.progress?.[prediction.boss_name] || {};
  if (progress.completed || progress.muted || !settings.enabled) return null;
  if (settings.favoritesOnly && !progress.favorite) return null;
  if(prediction.resolution==='day') {
    if(status(prediction,now)!=='high')return null;
    if(!settings.checkTime)return {kind:'daily',key:JSON.stringify([prediction.world,prediction.boss_name,prediction.lastDate,'daily'])};
    const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(now));
    const p=Object.fromEntries(day.map(x=>[x.type,x.value]));
    const planned=Date.parse(`${p.year}-${p.month}-${p.day}T${settings.checkTime}:00-03:00`);
    const lead=(Number(settings.leadMinutes)||30)*60000;
    if(now<planned-lead || now>planned)return null;
    return {kind:'round',key:JSON.stringify([prediction.world,prediction.boss_name,prediction.lastDate,p.year,p.month,p.day,'round']),start:planned};
  }
  const start = instant(prediction.predicted_window_start), end = instant(prediction.predicted_window_end);
  if (start === null || end === null || end < start || now > end) return null;
  const lead = Math.min(120, Math.max(5, Number(settings.leadMinutes) || 30)) * 60000;
  if (now >= start) return { kind: 'open', key: alertKey(prediction, 'window'), start, end };
  if (now >= start - lead) return { kind: 'soon', key: alertKey(prediction, 'window'), start, end };
  return null;
}

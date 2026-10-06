const ZONE='America/Sao_Paulo';
export const canonical=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
export function localDate(at=Date.now()){const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(at)).map(x=>[x.type,x.value]));return `${p.year}-${p.month}-${p.day}`;}
export function parseDateOnly(value){
  const s=String(value||'').trim();let m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);if(m)return Date.parse(`${m[1]}-${m[2]}-${m[3]}T12:00:00-03:00`);
  m=s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);if(m)return Date.parse(`${m[3]}-${m[2]}-${m[1]}T12:00:00-03:00`);
  return null;
}
export function makeObservation(input){
  const eventType=['appearance','kill','absence'].includes(input.eventType)?input.eventType:'appearance';
  const precision=['minute','hour','range','day'].includes(input.precision)?input.precision:'day';
  let startAt=Number(input.startAt),endAt=Number(input.endAt),estimatedAt=Number(input.estimatedAt);
  if(!Number.isFinite(estimatedAt)&&Number.isFinite(startAt)&&Number.isFinite(endAt))estimatedAt=Math.round((startAt+endAt)/2);
  if(!Number.isFinite(startAt)&&Number.isFinite(estimatedAt))startAt=precision==='day'?Date.parse(localDate(estimatedAt)+'T00:00:00-03:00'):estimatedAt;
  if(!Number.isFinite(endAt)&&Number.isFinite(estimatedAt))endAt=precision==='day'?Date.parse(localDate(estimatedAt)+'T23:59:59-03:00'):estimatedAt;
  if(!Number.isFinite(startAt)||!Number.isFinite(endAt)||endAt<startAt)throw new Error('Observação sem intervalo temporal válido');
  const processedAt=Number(input.processedAt)||Date.now(),reportedAt=Number(input.reportedAt)||processedAt,sourceObservedAt=Number(input.sourceObservedAt)||Number.isFinite(estimatedAt)?Number(input.sourceObservedAt)||estimatedAt:reportedAt,collectedAt=Number(input.collectedAt)||reportedAt;
  return {evidenceId:String(input.evidenceId),boss:String(input.boss),world:String(input.world),sourceId:String(input.sourceId),sourceRef:String(input.sourceRef||input.detail?.sourceRef||''),collectionMethod:String(input.collectionMethod||input.detail?.collectionMethod||'unknown'),confirmedBy:input.confirmedBy?String(input.confirmedBy).slice(0,120):null,eventType,precision,startAt,endAt,estimatedAt:Number.isFinite(estimatedAt)?estimatedAt:Math.round((startAt+endAt)/2),sourceObservedAt,collectedAt,reportedAt,processedAt,manual:!!input.manual,confidence:Math.max(.05,Math.min(1,Number(input.confidence)||.5)),detail:input.detail||null};
}
export function publicHistoryObservation(world,boss,row,index){
  const at=parseDateOnly(row.date);if(!Number.isFinite(at))return null;const date=localDate(at),start=Date.parse(date+'T00:00:00-03:00'),end=Date.parse(date+'T23:59:59-03:00');
  return makeObservation({evidenceId:`otb|${world}|${canonical(boss)}|${date}|${index}`,boss,world,sourceId:'otbosstracker',sourceRef:'https://otbosstracker.com/data/bosses.json',collectionMethod:'public_json',eventType:'kill',precision:'day',startAt:start,endAt:end,sourceObservedAt:at,confidence:row.approximate?.55:.72,detail:{rawDate:row.date,approximate:!!row.approximate}});
}
export function checkObservation(check){
  if(!check||!['encontrado','morto','vazio'].includes(check.result))return null;
  const at=Number(check.at)||Date.parse(check.date+'T'+(check.time||'12:00')+':00-03:00');if(!Number.isFinite(at))return null;
  const precision=check.precision==='day'||!check.time&&check.origin!=='manual'?'day':'minute';
  const sourceId=check.origin==='whatsapp'?'whatsapp-group':check.origin==='group'?'group-import':'manual-panel';
  const eventType=check.result==='vazio'?'absence':check.result==='morto'?'kill':'appearance';
  return makeObservation({evidenceId:`check|${check.id||checkKey(check)}`,boss:check.boss,world:check.world,sourceId,sourceRef:check.origin==='whatsapp'?'whatsapp://authorized-group':'boss-radar://panel',collectionMethod:check.origin==='whatsapp'?'browser_extension':check.origin==='group'?'group_batch':'manual_panel',confirmedBy:check.actor||null,eventType,precision,estimatedAt:at,sourceObservedAt:at,collectedAt:Number(check.recordedAt)||Number(check.at)||Date.now(),manual:sourceId!=='whatsapp-group',confidence:eventType==='absence'?.72:sourceId==='manual-panel'?.96:.82,detail:{result:check.result,batchId:check.batchId||null}});
}
function checkKey(c){return [c.world,canonical(c.boss),c.date||localDate(c.at),c.time||'',c.result].join('|');}

import {randomBytes,createHash} from 'node:crypto';
import {decodeGroupImage} from './group-images.mjs';
import {parseGroupText,validateGroupRows,checkKey,brasiliaDate} from './group-checks.mjs';
const digest=s=>createHash('sha256').update(s).digest('hex');
const norm=s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
export function extractObservations(message,names){
 const text=String(message.text||'').slice(0,6000);
 // Only explicit reports are accepted. Plans, questions and conditional reports need review.
 const mentioned=names.filter(n=>norm(text).includes(norm(n)));
 if(/[?]|\b(?:vou|vamos|sera|talvez|se aparecer|amanha|ontem|anteontem)\b/.test(norm(text)))return {rows:[],pending:true,mentioned};
 const rows=parseGroupText(text,names,{date:message.date,time:message.time,result:''});
 const recognized=rows.filter(r=>r.boss&&r.result);
 return {rows:recognized,pending:rows.some(r=>!r.boss||!r.result)||(!recognized.length&&mentioned.length>0),mentioned};
}
export function createWhatsAppSync({state,persist,broadcast,names,worlds,readBody,favorable=()=> 'unknown',saveImage=async()=>{throw new Error('Armazenamento de imagens indisponível');},onRecords=async()=>{}}){
 state.whatsapp ||= {connection:null,pending:[],seen:[],checkpoint:null,status:'Não conectado'};
 state.whatsapp.identified ||= [];
 state.whatsapp.images ||= [];
 const knownIds=new Set(state.whatsapp.identified.map(r=>r.id));for(const p of state.whatsapp.pending)if(!knownIds.has(p.id)&&p.bosses?.length)state.whatsapp.identified.push({id:p.id,bosses:p.bosses,at:Date.parse(p.date+'T'+(p.time||'12:00')+':00-03:00')||0});
 const badGroup=s=>/^(dados do perfil|profile details|dados do contato|contact info|group info|dados do grupo)$/i.test(String(s).trim());
 const identified=()=>{const byBoss=new Map();for(const row of state.groupChecks.filter(c=>c.origin==='whatsapp')){if(!byBoss.has(row.boss))byBoss.set(row.boss,{boss:row.boss,found:0,empty:0,pending:0,lastAt:0});const p=byBoss.get(row.boss);p[row.result==='encontrado'?'found':'empty']++;p.lastAt=Math.max(p.lastAt,row.at||0);}
  for(const r of state.whatsapp.identified)for(const boss of r.bosses){if(!byBoss.has(boss))byBoss.set(boss,{boss,found:0,empty:0,pending:0,lastAt:0});const p=byBoss.get(boss);if(state.whatsapp.pending.some(x=>x.id===r.id))p.pending++;p.lastAt=Math.max(p.lastAt,r.at||0);}return [...byBoss.values()].sort((a,b)=>a.boss.localeCompare(b.boss));};
 let pairing=null,attempts=0;
 const publicState=()=>({connected:!!state.whatsapp.connection,group:state.whatsapp.connection?.group||'',world:state.whatsapp.connection?.world||'',status:badGroup(state.whatsapp.connection?.group)?'Nome do grupo capturado incorretamente. Atualize a extensão e conecte o grupo correto.':state.whatsapp.status,checkpoint:state.whatsapp.checkpoint,pending:state.whatsapp.pending,identified:identified(),images:state.whatsapp.images,diagnostics:state.whatsapp.diagnostics||null,lastSync:state.whatsapp.lastSync||null});
 async function control(path,input){
  if(path==='/api/whatsapp/pair-code'){pairing={code:randomBytes(12).toString('hex'),expires:Date.now()+600000};attempts=0;return {code:pairing.code,expires:pairing.expires};}
  if(path==='/api/whatsapp/disconnect'){state.whatsapp.connection=null;pairing=null;state.whatsapp.status='Desconectado';await persist();return {ok:true};}
  if(path==='/api/whatsapp/dismiss'){state.whatsapp.pending=state.whatsapp.pending.filter(p=>p.id!==input.id);await persist();return {ok:true};}
  return null;
 }
 async function handle(req,res,url){
  if(!url.pathname.startsWith('/extension/'))return false;
  const origin=req.headers.origin||'',match=origin.match(/^chrome-extension:\/\/([a-p]{32})$/)||(!origin?String(req.headers['x-radar-extension']||'').match(/^([a-p]{32})$/):null);
  const reply=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store',...(match&&origin?{'Access-Control-Allow-Origin':origin,'Vary':'Origin'}:{})});res.end(JSON.stringify(data));};
  if(!match){reply(403,{error:'Origem da extensão inválida'});return true;}
  if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, X-Radar-Key, X-Radar-Extension','Access-Control-Max-Age':'600','Access-Control-Allow-Private-Network':'true','Vary':'Origin'});res.end();return true;}
  if(req.method!=='POST'){reply(405,{error:'Método inválido'});return true;}
  try{
   const input=await readBody(req);
   if(url.pathname==='/extension/pair'){
    if(++attempts>10||!pairing||pairing.expires<Date.now()||input.code!==pairing.code)throw new Error('Código inválido ou expirado. Gere outro no painel.');
    if(typeof input.group!=='string'||!input.group.trim()||input.group.length>150||badGroup(input.group)||!worlds.includes(input.world))throw new Error('Informe o nome verdadeiro do grupo; Dados do perfil é um botão do WhatsApp.');
    const key=randomBytes(32).toString('hex');state.whatsapp={connection:{extensionId:match[1],keyHash:digest(key),group:input.group.trim(),world:input.world},seen:[],pending:state.whatsapp.pending,identified:state.whatsapp.identified,images:state.whatsapp.images,checkpoint:null,status:'Aguardando primeira leitura'};pairing=null;await persist();broadcast('update',{});reply(200,{key,group:state.whatsapp.connection.group,world:input.world,names:names()});return true;
   }
   const c=state.whatsapp.connection;
   if(!c||c.extensionId!==match[1]||digest(String(req.headers['x-radar-key']||''))!==c.keyHash)throw new Error('Extensão desconectada. Conecte novamente no painel.');
   if(input.group!==c.group)throw new Error('Este grupo não está autorizado.');
   if(badGroup(c.group))throw new Error('Atualize a extensão e conecte o nome verdadeiro do grupo. Dados do perfil não é uma conversa.');
   if(url.pathname==='/extension/image'){
    if(!/^[a-f0-9]{64}$/.test(input.messageId||'')||!state.whatsapp.seen.includes(input.messageId))throw new Error('Importe a mensagem do grupo antes da imagem.');
    const image=decodeGroupImage(input.data),id=digest(input.messageId+'|'+image.hash);if(state.whatsapp.images.some(i=>i.id===id)){reply(200,{ok:true,id});return true;}
    if(state.whatsapp.images.length>=2000)throw new Error('Limite de 2 mil imagens atingido. Exporte antes de continuar.');
    await saveImage(id,image);const row=state.whatsapp.identified.find(x=>x.id===input.messageId),p=state.whatsapp.pending.find(x=>x.id===input.messageId);
    state.whatsapp.images.unshift({id,messageId:input.messageId,bosses:row?.bosses||p?.bosses||[],at:row?.at||Date.parse(p?.date+'T'+(p?.time||'12:00')+':00-03:00')||0,world:c.world,group:c.group,type:image.type,url:'/api/group-image?id='+id});await persist();broadcast('update',{});reply(200,{ok:true,id});return true;
   }
   if(url.pathname==='/extension/config'){reply(200,{names:names(),checkpoint:state.whatsapp.checkpoint,world:c.world});return true;}
   if(url.pathname==='/extension/status'){state.whatsapp.status=String(input.status||'').slice(0,250);state.whatsapp.diagnostics=cleanDiagnostics(input.diagnostics);await persist();broadcast('update',{});reply(200,{ok:true});return true;}
   if(url.pathname!=='/extension/sync')throw new Error('Rota inválida');
   if(!Array.isArray(input.messages)||input.messages.length>100)throw new Error('Envie até 100 mensagens por lote.');
   if(input.checkpoint){const cp=input.checkpoint;if(!/^[a-f0-9]{64}$/.test(cp.id||'')||!Number.isFinite(cp.at)||cp.at>Date.now()+60000||cp.at<Date.parse('2020-01-01'))throw new Error('Marcador inválido');}
   const seen=new Set(state.whatsapp.seen),existing=new Set(state.groupChecks.map(checkKey));let added=0,pending=0;
   const next=[],reviews=[],ids=[],recognized=[];
   for(const m of input.messages){
    if(!/^[a-f0-9]{64}$/.test(m.id||'')||typeof m.text!=='string'||m.text.length>6000)throw new Error('Mensagem inválida');
    if(seen.has(m.id))continue;
    const parsed=extractObservations(m,names());
    if(parsed.mentioned?.length||parsed.rows.length)recognized.push({id:m.id,bosses:[...new Set([...(parsed.mentioned||[]),...parsed.rows.map(r=>r.boss)])],at:Date.parse(m.date+'T'+(m.time||'12:00')+':00-03:00')||0});
    let rows=[];try{if(parsed.rows.length)rows=validateGroupRows({world:c.world,rows:parsed.rows},names(),worlds);}catch{parsed.pending=true;}
    for(const row of rows){const key=checkKey(row);if(existing.has(key))continue;existing.add(key);next.push({...row,favorable:favorable(row),id:'wa-'+m.id+'-'+added,batchId:'wa-'+m.id,recordedAt:Date.now(),origin:'whatsapp',timeBasis:'message'});added++;}
    if(parsed.pending){reviews.push({id:m.id,bosses:(parsed.mentioned||[]).slice(0,20),date:typeof m.date==='string'?m.date.slice(0,10):'',time:typeof m.time==='string'?m.time.slice(0,5):'',reason:m.media&&!parsed.mentioned?.length?'Foto sem nome identificado. Confira a imagem no grupo e informe o boss e o resultado.':'Confira o resultado ou a data: a mensagem não permitiu registrar tudo com segurança.'});pending++;}
    ids.push(m.id);seen.add(m.id);
   }
   if(state.groupChecks.length+next.length>50000||state.whatsapp.pending.length+reviews.length>2000)throw new Error('Histórico ou pendências cheio. Exporte e revise antes de continuar.');
   state.groupChecks.unshift(...next);if(next.length)await onRecords(next);state.whatsapp.pending.unshift(...reviews);const oldIdentified=new Map(state.whatsapp.identified.map(x=>[x.id,x]));for(const r of recognized)oldIdentified.set(r.id,r);state.whatsapp.identified=[...oldIdentified.values()].slice(-20000);state.whatsapp.seen=[...seen].slice(-20000);state.whatsapp.diagnostics=cleanDiagnostics(input.diagnostics);
   if(input.checkpoint&&input.coverage!=='gap'){const cp=input.checkpoint;if(!state.whatsapp.checkpoint||cp.at>=state.whatsapp.checkpoint.at)state.whatsapp.checkpoint={id:cp.id,at:cp.at};}
   state.whatsapp.lastSync=Date.now();state.whatsapp.status=input.coverage==='gap'?'Recuperação incompleta: abra o grupo e carregue mensagens mais antigas.':input.coverage==='baseline'?'Primeira leitura concluída; acompanhamento das próximas mensagens ativo.':'Leitura atualizada';await persist();broadcast('update',{});reply(200,{added,pending,checkpoint:state.whatsapp.checkpoint});
  }catch(e){reply(400,{error:e.message});}
  return true;
 }
 return {handle,control,publicState};
}
function cleanDiagnostics(d){if(!d)return null;return {detected:String(d.detected||'').slice(0,150),visible:Math.max(0,Math.min(100000,Number(d.visible)||0)),relevant:Math.max(0,Math.min(100000,Number(d.relevant)||0)),withoutDate:Math.max(0,Math.min(100000,Number(d.withoutDate)||0))};}

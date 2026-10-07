import {showBossMap} from './boss-map-ui.mjs';
import {entryFor,resolvedProgress,parseTotals,STAGES} from './bosstiary.mjs';
import {initGroupUI,renderGroupUI,groupNote} from './group-ui.mjs';
import {initWhatsAppUI,renderWhatsAppUI} from './whatsapp-ui.mjs';
import {renderCharacter} from './character-ui.mjs';
import { status, instant } from './logic.mjs';
import {activateNotifications} from './notification-flow.mjs';
import {renderIntelligence,initIntelligenceUI} from './intelligence-ui.mjs';
import {renderSystemHealth,initSystemHealthUI} from './system-health-ui.mjs';
import {initAILabUI,loadAILab} from './ai-lab-ui.mjs';
import {initKnowledgeGraphUI,loadKnowledgeGraph} from './knowledge-graph-ui.mjs';
const $ = id => document.getElementById(id);
const safe = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function portrait(b){try{const u=new URL(b.image_url);if(['https://cdn.rubinottools.com','https://www.tibiawiki.com.br'].includes(u.origin))return `<img src="${safe(u.href)}" alt="" loading="lazy">`;}catch{}return safe(b.name.charAt(0));}
let model=null, currentView='radar', activeCheck=null, saving=Promise.resolve();
const labels={high:'DIA FAVORÁVEL',medium:'FASE INTERMEDIÁRIA',low:'FASE INICIAL',late:'FORA DA JANELA',unknown:'SEM PREVISÃO CONFIRMADA'};
const format = value => {
  const n=typeof value==='number'?value:instant(value);
  if(n===null || !Number.isFinite(n)) return 'Fuso não confirmado';
  return new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(n));
};
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').hidden=true,6000);}
async function api(path,input){const res=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json','X-Boss-Token':model.token},body:JSON.stringify(input)});const data=await res.json();if(!res.ok)throw new Error(data.error||'Não foi possível salvar');return data;}
function progress(name){return resolvedProgress(name,model.settings.progress[name],model.bosstiary||[]);}
function progressLabel(p){return !p.known?'Não informado':p.category||p.targetConfirmed?`${p.kills} / ${p.target}`:`${p.kills} kills · meta a definir`;}
function bosses(includeAll=false){
  const data=model.data || {bosses:[],pending:[]};
  const map=new Map(data.bosses.map(b=>[b.name,b]));
  if(includeAll)for(const b of model.bosstiary||[])if(![...map.keys()].some(n=>entryFor(n,[b])))map.set(b.name,{...b,history:[]});
  for(const p of data.pending) if(!map.has(p.boss_name)) map.set(p.boss_name,{name:p.boss_name,history:[]});
  for(const name of Object.keys(model.settings.progress)) if(!map.has(name)) map.set(name,{name,history:[],manual:true});
  return [...map.values()].map(b=>({...b,image_url:b.image_url||entryFor(b.name,model.bosstiary||[])?.image_url,prediction:data.pending.find(p=>p.boss_name===b.name),progress:progress(b.name)}));
}
let loadInFlight=null,loadAgain=false;
async function load(){
  if(loadInFlight){loadAgain=true;return loadInFlight;}
  loadInFlight=(async()=>{
    try {const res=await fetch('/api/state',{cache:'no-store'});if(!res.ok)throw new Error('Monitor indisponível');model=await res.json();render();}
    catch(e){$('source-warning').hidden=false;$('source-warning').textContent='Monitor indisponível. Inicie o servidor do Boss Radar. '+e.message;}
  })();
  try{return await loadInFlight;}finally{loadInFlight=null;if(loadAgain){loadAgain=false;void load();}}
}
function render(){
  const all=bosses(); const now=Date.now();
  $('world').innerHTML=model.worlds.map(w=>`<option ${w===model.settings.world?'selected':''}>${safe(w)}</option>`).join('');
  $('sync').textContent=model.data?(model.data.stale?`Dados preservados de ${format(model.data.staleFrom||model.data.fetchedAt)}`:`${model.data.catalogOnly?'Catálogo carregado':'Atualizado'} ${format(model.data.fetchedAt)}`):'Fonte ainda não carregada';
  const sourceIssue=model.error||model.data?.catalogFallback||model.data?.publicError||model.data?.officialError||'';
  $('source-warning').hidden=!sourceIssue;
  $('source-warning').textContent=model.error?'Não foi possível atualizar as previsões. Os dados anteriores podem estar desatualizados; os novos alertas estão suspensos até a atualização voltar a funcionar.':sourceIssue;
  $('high-count').textContent=model.error?'—':all.filter(b=>status(b.prediction,now)==='high').length;
  $('boss-count').textContent=all.length;
  $('completed-count').textContent=all.filter(b=>b.progress.completed).length;
  $('lead-stat').textContent=model.settings.leadMinutes;
  $('coverage').textContent=`Bosses para acompanhar`;
  $('check-time').value=model.settings.checkTime||'';
  $('lead').value=String(model.settings.leadMinutes);$('favorites-only').checked=model.settings.favoritesOnly;$('monitor-enabled').checked=model.settings.enabled;
  $('push-title').textContent=model.settings.enabled&&model.subscriptions?(model.error?'Navegador inscrito · previsões indisponíveis':'Monitor habilitado'):'Ative os avisos no navegador';
  $('push-desc').textContent=model.settings.enabled&&model.subscriptions?`${model.subscriptions} navegador(es) inscrito(s). Última consulta: ${model.lastPoll?format(model.lastPoll):'aguardando'}.`:'Avisos em dias favoráveis; configure sua rodada para receber um lembrete antecipado.';
  renderGrid();renderProgress();renderLogs();renderGroupUI();renderWhatsAppUI();renderIntelligence(model);renderSystemHealth(model);
}
function renderGrid(){
  const query=$('search').value.toLocaleLowerCase('pt-BR'),filter=$('filter').value,hide=$('hide-completed').checked;
  const rank={high:0,medium:1,low:2,unknown:3,late:4};
  const list=bosses().filter(b=>{
    const s=status(b.prediction); if(!b.name.toLocaleLowerCase('pt-BR').includes(query)||hide&&b.progress.completed)return false;
    return filter==='all'||filter==='high'&&s==='high'||filter==='soon'&&['low','medium'].includes(s)||filter==='favorites'&&b.progress.favorite||filter==='missing'&&!b.progress.completed||filter==='unknown'&&s==='unknown';
  }).sort((a,b)=>rank[status(a.prediction)]-rank[status(b.prediction)]||Number(b.progress.favorite)-Number(a.progress.favorite)||a.name.localeCompare(b.name));
  $('boss-grid').innerHTML=list.length?list.map(b=>{
    const s=status(b.prediction),p=b.progress,n=encodeURIComponent(b.name),pct=p.category||p.targetConfirmed?Math.min(100,p.kills/p.target*100):0;
    return `<article class="boss-card ${s}"><button class="star ${p.favorite?'selected':''}" data-action="favorite" data-boss="${n}" aria-label="${p.favorite?'Remover':'Adicionar'} ${safe(b.name)} dos favoritos">${p.favorite?'★':'☆'}</button><div class="boss-top"><span class="avatar">${portrait(b)}</span><div><h3>${safe(b.name)}</h3><small>${safe(model.settings.world)} ${b.manual?'· adicionado por você':''}</small></div></div><span class="badge ${s}">${labels[s]}</span><div class="window-box"><small>HISTÓRICO DIÁRIO · SEM HORA DE SPAWN</small><b>${b.prediction?`Última morte: ${safe(b.prediction.lastDate)} · intervalo ${safe(b.prediction.windowText)} dias`:'Sem histórico recente'}</b><p>${s==='unknown'?'Sem alerta por hora; mantenha suas checagens.':s==='late'?'Fora da janela diária.':s==='high'?'Dia favorável; horário desconhecido.':'Classificação aproximada, sem probabilidade calibrada.'}</p></div>${b.official?`<p class="muted"> ${b.official.day} mortes em 24h · ${b.official.week} em 7 dias. Não confirma boss vivo.</p>`:!b.prediction?`<p class="muted">Sem linha nas estatísticas recentes. Ausência de registro não comprova ausência do boss.</p>`:""}<div><div class="card-progress"><span>${p.completed?'✓ Concluído':p.muted?'Alertas silenciados':(p.category==='Bestiary'?'Bestiary':p.category?'Bosstiary':'Kills registradas')}</span><span>${progressLabel(p)}</span></div><progress class="track" max="100" value="${pct}" aria-label="Progresso de ${safe(b.name)}"></progress></div>${groupNote(model.groupPatterns?.find(x=>x.boss===b.name))}<div class="card-actions"><button class="secondary" data-action="detail" data-boss="${n}">Ver detalhes ↗</button></div><div class="quick-check"><button data-action="empty" data-boss="${n}">Não achei</button><button data-action="found" data-boss="${n}">Encontrei</button><button class="primary" data-action="kill" data-boss="${n}">Matei +1</button></div></article>`;
  }).join(''):`<div class="empty">${!model.data?'Aguardando dados. Você já pode adicionar bosses e registrar seu progresso.':'Nenhum boss corresponde ao filtro.'}</div>`;
}
function renderProgress(){
 const query=$('progress-search').value.toLowerCase(),filter=$('progress-filter').value;
 const all=bosses(true),list=all.filter(b=>b.name.toLowerCase().includes(query)&&(filter==='all'||filter==='missing'&&!b.progress.completed||filter==='started'&&b.progress.kills>0&&!b.progress.completed||filter==='complete'&&b.progress.completed||filter==='unfilled'&&!b.progress.known||filter===b.progress.category));
 $('progress-summary').textContent=all.filter(b=>b.progress.completed).length+' concluídos · '+all.filter(b=>b.progress.known).length+' com quantidade informada · '+all.length+' no catálogo';
 $('progress-list').innerHTML=list.sort((a,b)=>a.name.localeCompare(b.name)).map(b=>{
 const p=b.progress,n=encodeURIComponent(b.name),stages=STAGES[p.category];
 return `<div class="progress-row"><div class="progress-boss"><span class="avatar">${portrait(b)}</span><div><b>${safe(b.name)}</b><p class="muted">${p.category? p.category+' · etapas '+stages.join(' / '):'Categoria não confirmada · ajuste a meta no jogo'}</p><small>${p.completed?'✓ Concluído':p.known?(p.category||p.targetConfirmed?'Faltam '+Math.max(0,p.target-p.kills)+' kills':'Defina a meta no jogo'):'Quantidade ainda não informada'}</small></div></div><div class="kill-counter"><button class="secondary" data-progress-action="minus" data-boss="${n}" aria-label="Diminuir kills de ${safe(b.name)}">−</button><label>Já matei<input type="number" min="0" max="100000" placeholder="Informar" value="${p.known?p.kills:''}" data-field="kills" data-boss="${n}"></label><button class="primary" data-progress-action="plus" data-boss="${n}" aria-label="Adicionar kill de ${safe(b.name)}">+1</button></div><div>${p.category?'<b>Meta: '+p.target+'</b>':`<label>Meta<input type="number" min="1" max="100000" value="${p.target}" data-field="target" data-boss="${n}"></label>`}<button class="secondary" data-progress-action="map" data-boss="${n}">Ver mapa ↗</button><button class="secondary" data-progress-action="complete" data-boss="${n}">Marcar completo</button><label class="checkbox"><input type="checkbox" data-field="muted" data-boss="${n}" ${p.muted?'checked':''}> Silenciar</label></div></div>`;
 }).join('')||'<div class="empty">Nenhum boss neste filtro.</div>';
}
function renderLogs(){
  const results={vazio:'Não encontrado',encontrado:'Encontrado',morto:'Morto'};
  $('checks-list').innerHTML=model.checks.map(c=>`<div class="log-row"><b>${safe(c.boss)}</b><span>${safe(results[c.result] || c.result)} · ${safe(c.world)}</span><small>${format(c.at)}</small>${c.id?`<button class="secondary" data-undo="${safe(c.id)}">Desfazer${c.countKill?' e retirar +1':''}</button>`:''}</div>`).join('')||'<div class="empty">Nenhuma checagem registrada ainda.</div>';
  $('alerts-list').innerHTML=model.log.map(c=>`<div class="log-row"><b>${safe(c.boss)}</b><span>${safe(c.result)}</span><small>${format(c.at)}</small></div>`).join('')||'<div class="empty">Nenhum envio registrado. Ative os avisos e envie uma notificação de teste.</div>';
}
function saveSettings(update){
  saving=saving.catch(()=>{}).then(async()=>{model.settings=await api('/api/settings',update);render();});
  saving.catch(e=>toast(e.message));return saving;
}
function updateProgress(name,patch){
  const updated={...model.settings.progress,[name]:resolvedProgress(name,{...progress(name),...patch},model.bosstiary||[])};
  model.settings.progress=updated;return saveSettings({progress:updated});
}
function showView(view){
  currentView=view;
  for(const element of document.querySelectorAll('.stats,.alertbar,#notification-hint'))element.hidden=['character','progress','checks','knowledge','ailab','system'].includes(view);
  const titles={knowledge:['Entender relações,<br>sem inventar causalidade.','Explore sequências, estados do servidor, relações entre bosses e fontes com baseline, lift, amostra e validação temporal.'],ailab:['Experimentar,<br>medir e provar.','Novos modelos só avançam quando superam o Champion fora da amostra e em eventos futuros.'],system:['Sistema saudável,<br>ou claramente degradado.','Monitore heartbeats, filas, incidentes, backups, integridade e recuperação automática.'],intelligence:['Previsões que aprendem,<br>sem inventar certeza.','Entenda as evidências, a confiança e a evolução do algoritmo.'],character:['Seu personagem,<br>em um só lugar.','Personagens, aparência animada, skills e experiência.'],radar:['Cada boss, um passo<br>mais perto do completo.','Acompanhe janelas favoráveis e organize seu Bosstiary em um só lugar.'],progress:['Seu progresso,<br>boss por boss.','Registre suas kills e acompanhe as metas do jogo.'],checks:['Toda checagem<br>conta uma história.','Construa seu próprio histórico de encontros em Lunarian.'],alerts:['Prepare a próxima<br>rodada de checagens.','Ajuste quando e quais avisos você quer receber.']};
  $('view-title').innerHTML=titles[view][0];$('view-desc').textContent=titles[view][1];
  for(const name of Object.keys(titles)) $(name+'-view').hidden=name!==view;
  document.querySelectorAll('.nav').forEach(b=>b.classList.toggle('active',b.dataset.view===view));if(view==='knowledge')void loadKnowledgeGraph().catch(e=>toast(e.message));if(view==='ailab')void loadAILab().catch(e=>toast(e.message));
}
function detail(name){
  const b=bosses(true).find(b=>b.name===name);if(!b)return;
  const p=b.prediction; const rows=(b.history||[]).slice().sort((a,c)=>String(c.date).localeCompare(String(a.date))).slice(0,30);
  $('detail-content').innerHTML=`<div class="eyebrow">${safe(model.settings.world)}</div><h2>${safe(name)}</h2><span class="avatar">${portrait(b)}</span><span class="badge ${status(p)}">${labels[status(p)]}</span><div class="notice">${p?'A classificação diária é aproximada e não representa uma porcentagem de chance calibrada nem um horário de spawn.':'Este boss não tem previsão disponível. Pode depender de acesso, mecânica, raid ou cooldown; confira as regras no jogo.'}</div>${p?`<p>Última morte: <b>${safe(p.lastDate)}</b><br>Intervalo indicado: <b>${safe(p.windowText)} dias</b></p>`:''}${b.official?`<h3>Estatísticas oficiais de ${safe(model.settings.world)}</h3><p>${b.official.day} mortes em 24 horas · ${b.official.week} em 7 dias.</p><p class="muted">Consulta: ${format(b.official.fetchedAt)}. Contagens agregadas, sem hora exata de morte ou spawn.</p>`:""}<h3>Histórico de mortes</h3><p class="muted">${b.history?.length||0} registros após deduplicação de ${b.rawRecords||0} linhas. Datas sem fuso são mostradas como recebidas e não comprovam o horário de spawn.</p>${rows.map(r=>`<div class="history-entry"><span>${safe(r.world||model.settings.world)}</span><span>${safe(instant(r.date)===null?r.date:format(r.date))}</span></div>`).join('')||'<p class="muted">Sem registros disponíveis.</p>'}`;
  $('detail').showModal();void showBossMap($('detail-content'),name);
}
function bytes(text){const base64=(text+'='.repeat((4-text.length%4)%4)).replace(/-/g,'+').replace(/_/g,'/');return Uint8Array.from(atob(base64),c=>c.charCodeAt(0));}
async function subscription(){const reg=await navigator.serviceWorker.ready;return reg.pushManager.getSubscription();}
async function enablePush(){
  $('notification-status').hidden=false;
  await activateNotifications(window,bytes(model.publicKey),sub=>api('/api/subscribe',sub),stage=>{$('notification-status').textContent=stage;$('enable-push').textContent=stage;});
  await load();$('notification-status').textContent='Navegador inscrito. Envie um teste na aba Alertas.';toast('Navegador inscrito. Envie um teste na aba Alertas.');
}
async function action(button,fn){const label=button.textContent;button.disabled=true;try{await fn();}catch(e){toast(e.message);if(button.id==='enable-push'){$('notification-status').hidden=false;$('notification-status').textContent=e.message;}}finally{button.disabled=false;button.textContent=label;}}
document.querySelectorAll('.nav').forEach(b=>b.addEventListener('click',()=>showView(b.dataset.view)));
for(const id of ['search','filter','hide-completed']) $(id).addEventListener(id==='search'?'input':'change',()=>model&&renderGrid());
$('world').addEventListener('change',async()=>{await saveSettings({world:$('world').value});await load();});
$('check-time').addEventListener('change',()=>saveSettings({checkTime:$('check-time').value}));
$('lead').addEventListener('change',()=>saveSettings({leadMinutes:Number($('lead').value)}));
$('favorites-only').addEventListener('change',()=>saveSettings({favoritesOnly:$('favorites-only').checked}));
$('monitor-enabled').addEventListener('change',()=>saveSettings({enabled:$('monitor-enabled').checked}));
$('enable-push').addEventListener('click',()=>action($('enable-push'),enablePush));
$('refresh').addEventListener('click',()=>action($('refresh'),async()=>{await api('/api/refresh',{});await load();toast('Dados atualizados.');}));
$('test-push').addEventListener('click',()=>action($('test-push'),async()=>{if(!('serviceWorker'in navigator))throw new Error('Este navegador não oferece suporte a notificações push.');const reg=await navigator.serviceWorker.getRegistration();if(!reg)throw new Error('Ative as notificações primeiro.');const sub=await reg.pushManager.getSubscription();if(!sub)throw new Error('Ative as notificações primeiro.');await api('/api/test',{endpoint:sub.endpoint});toast('Teste enviado ao serviço de push. Confira o aviso no sistema.');}));
$('disable-push').addEventListener('click',()=>action($('disable-push'),async()=>{if('serviceWorker'in navigator){const reg=await navigator.serviceWorker.getRegistration();const sub=await reg?.pushManager.getSubscription();if(sub){await api('/api/unsubscribe',{endpoint:sub.endpoint});await sub.unsubscribe();}}await load();toast('Avisos desativados neste navegador.');}));
$('boss-grid').addEventListener('click',e=>{const b=e.target.closest('button[data-action]');if(!b)return;const name=decodeURIComponent(b.dataset.boss),kind=b.dataset.action;if(kind==='favorite')updateProgress(name,{favorite:!progress(name).favorite});else if(kind==='detail')detail(name);else void action(b,async()=>{await saving.catch(()=>{});await api('/api/check',{id:crypto.randomUUID(),boss:name,result:{empty:'vazio',found:'encontrado',kill:'morto'}[kind],countKill:kind==='kill'});await load();toast(kind==='kill'?'Kill adicionada e checagem salva.':'Checagem salva.');});});
$('progress-list').addEventListener('change',e=>{const field=e.target.dataset.field;if(!field)return;const value=e.target.type==='checkbox'?e.target.checked:Number(e.target.value);if(field==='kills'&&e.target.value==='')return;updateProgress(decodeURIComponent(e.target.dataset.boss),{[field]:value,...(field==='kills'?{known:true}:field==='target'?{targetConfirmed:true}:{})});});
$('progress-list').addEventListener('click',e=>{const b=e.target.closest('[data-progress-action]');if(!b)return;const name=decodeURIComponent(b.dataset.boss);if(b.dataset.progressAction==='map'){detail(name);return;}void action(b,async()=>{await saving.catch(()=>{});const p=progress(name),kind=b.dataset.progressAction;if(kind==='complete'&&!p.category&&!p.targetConfirmed)throw new Error('Informe a meta do jogo antes de marcar como completo.');await updateProgress(name,{known:true,kills:kind==='complete'?Math.max(p.kills,p.target):Math.max(0,p.kills+(kind==='plus'?1:-1))});toast('Progresso salvo.');});});
for(const id of ['progress-search','progress-filter'])$(id).addEventListener(id==='progress-search'?'input':'change',renderProgress);
$('checks-list').addEventListener('click',e=>{const b=e.target.closest('[data-undo]');if(b)void action(b,async()=>{await saving.catch(()=>{});await api('/api/check/undo',{id:b.dataset.undo});await load();toast('Registro desfeito.');});});
let bulkRows=[];
$('preview-totals').addEventListener('click',()=>{try{bulkRows=parseTotals($('bulk-totals').value,bosses(true).map(b=>b.name));$('bulk-preview').innerHTML=bulkRows.map(r=>'<div class="log-row"><b>'+safe(r.name)+'</b><span>'+progress(r.name).kills+' → '+r.kills+' kills</span></div>').join('');$('save-totals').hidden=false;}catch(e){bulkRows=[];$('save-totals').hidden=true;toast(e.message);}});
$('bulk-totals').addEventListener('input',()=>{bulkRows=[];$('save-totals').hidden=true;$('bulk-preview').textContent='';});
$('save-totals').addEventListener('click',()=>action($('save-totals'),async()=>{if(!bulkRows.length)return;await saving.catch(()=>{});const updated={...model.settings.progress};for(const r of bulkRows)updated[r.name]=resolvedProgress(r.name,{...progress(r.name),kills:r.kills,known:true},model.bosstiary);await saveSettings({progress:updated});bulkRows=[];$('bulk-totals').value='';$('bulk-preview').textContent='';$('save-totals').hidden=true;toast('Quantidades atualizadas.');}));
$('check-form').addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/check',{id:crypto.randomUUID(),boss:activeCheck,result:$('check-result').value});$('check-dialog').close();await load();toast('Checagem registrada.');}catch(error){toast(error.message);}});
$('cancel-check').addEventListener('click',()=>$('check-dialog').close());
$('add-boss').addEventListener('submit',async e=>{e.preventDefault();const name=$('custom-name').value.trim();if(!name)return;try{await updateProgress(name,{target:Number($('custom-target').value),targetConfirmed:true});$('custom-name').value='';toast('Boss adicionado. Sem histórico, ele permanece sem previsão automática.');}catch{}});
$('export').addEventListener('click',()=>{const blob=new Blob([JSON.stringify({version:1,exportedAt:new Date().toISOString(),settings:model.settings,checks:model.checks},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='boss-radar-progresso.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
$('import').addEventListener('change',async()=>{try{const f=$('import').files[0];if(!f)return;if(f.size>200000)throw new Error('Backup grande demais');const data=JSON.parse(await f.text());if(data.version!==1||!data.settings?.progress)throw new Error('Backup inválido');await saveSettings({progress:{...model.settings.progress,...data.settings.progress}});toast('Progresso restaurado. As checagens existentes foram mantidas.');}catch(e){toast(e.message);}finally{$('import').value='';}});
let characterModel=null,selectedCharacter='Kena Rain',characterRequest=0;
async function loadCharacter(){
  const request=++characterRequest,name=selectedCharacter;
  characterModel=null;
  $('character-content').textContent='Consultando perfil, experiência e 20 categorias de rankings…';
  try{const response=await fetch('/api/character?name='+encodeURIComponent(name),{signal:AbortSignal.timeout(90000)});if(!response.ok)throw new Error('Não foi possível consultar o personagem');const result=await response.json();if(request!==characterRequest)return;characterModel=result;$('character-content').innerHTML=renderCharacter(result);animateOutfits();}
  catch(e){if(request===characterRequest)$('character-content').textContent=e.message;}
}
async function loadCharacterNames(){const r=await fetch('/api/characters');if(!r.ok)throw new Error('Lista de personagens indisponível');const data=await r.json();$('character-select').innerHTML=data.names.map(name=>`<option ${name===selectedCharacter?'selected':''}>${safe(name)}</option>`).join('');}
$('character-select').addEventListener('change',()=>{selectedCharacter=$('character-select').value;void loadCharacter();});
$('add-character').addEventListener('submit',e=>{e.preventDefault();void action($('add-character-button'),async()=>{const result=await api('/api/characters/add',{name:$('character-name').value});selectedCharacter=result.name;await loadCharacterNames();await loadCharacter();$('character-name').value='';toast('Personagem adicionado.');});});
$('refresh-character').addEventListener('click',()=>action($('refresh-character'),async()=>{await api('/api/character/refresh',{name:selectedCharacter});await loadCharacter();toast('Informações públicas atualizadas.');}));
$('export-character').addEventListener('click',()=>{if(!characterModel?.character){toast('Aguarde a consulta do personagem.');return;}const blob=new Blob([JSON.stringify(characterModel.character,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=selectedCharacter.replace(/[^a-z0-9-]/gi,'-')+'-informacoes-publicas.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
initGroupUI({getModel:()=>model,getBosses:()=>bosses(true),post:api,reload:load,notify:toast});
initWhatsAppUI({getModel:()=>model,post:api,reload:load,notify:toast});
initIntelligenceUI({getModel:()=>model,post:api,reload:load,notify:toast});
initSystemHealthUI({getModel:()=>model,post:api,reload:load,notify:toast});
initAILabUI({getModel:()=>model,post:api,reload:load,notify:toast});
initKnowledgeGraphUI({getModel:()=>model,post:api,reload:load,notify:toast});
$('intelligence-refresh').addEventListener('click',()=>action($('intelligence-refresh'),async()=>{await api('/api/refresh',{});await load();toast('Fontes consultadas e previsões recalculadas.');}));
await load();
void loadCharacterNames().then(()=>loadCharacter()).catch(e=>{$('character-content').textContent=e.message;});
const events=new EventSource('/api/events');events.addEventListener('update',()=>void load());events.addEventListener('alert',()=>void load());events.addEventListener('source-error',()=>void load());
setInterval(()=>void load(),60000);

function animateOutfits(){for(const img of document.querySelectorAll('.outfit-sprite img')){const animate=()=>{const frames=Math.max(1,Math.round(img.naturalWidth/img.naturalHeight));img.style.width=(frames*96)+'px';img.style.setProperty('--sprite-end','-'+frames*96+'px');img.style.animation='outfitWalk '+(frames*80)+'ms steps('+frames+') infinite';};img.addEventListener('load',animate,{once:true});img.addEventListener('error',()=>{img.parentElement.textContent='Aparência indisponível';},{once:true});if(img.complete&&img.naturalWidth)animate();}}






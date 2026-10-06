const BASE='http://127.0.0.1:4317';
function serviceURL(value){const u=new URL(value||BASE);if(u.username||u.password)throw new Error('Não use usuário ou senha na URL.');if(u.origin===BASE||u.protocol==='https:')return u.origin;throw new Error('Use o endereço local ou uma origem HTTPS segura.');}
let busy=false;
async function request(path,data,key,base){const stored=await chrome.storage.local.get('config');const url=serviceURL(base||stored.config?.serviceURL);const r=await fetch(url+path,{method:'POST',headers:{'Content-Type':'application/json','X-Radar-Extension':chrome.runtime.id,...(key?{'X-Radar-Key':key}:{})},body:JSON.stringify(data),signal:AbortSignal.timeout(20000)});const result=await r.json();if(!r.ok)throw new Error(result.error||'Falha na conexão');return result;}
async function tellStatus(status){await chrome.storage.local.set({status});}
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
 const local=!sender.tab&&sender.url?.startsWith(chrome.runtime.getURL(''));
 const web=sender.tab?.url?.startsWith('https://web.whatsapp.com/');
 if(!local&&!web)return;
 (async()=>{
  const {config,paused}=await chrome.storage.local.get(['config','paused']);
  if(message.type==='pair'&&local){const base=serviceURL(message.serviceURL);const r=await request('/extension/pair',{code:message.code,group:message.group,world:message.world},null,base);await chrome.storage.local.set({config:{key:r.key,group:r.group,world:r.world,names:r.names,serviceURL:base},paused:false,status:'Conectado. Aguardando leitura do grupo.'});return {ok:true};}
  if(message.type==='image'&&web){if(!config||paused||message.group!==config.group)throw new Error('Grupo não autorizado.');const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(config.key+message.messageId+message.data))),b=>b.toString(16).padStart(2,'0')).join('');const {uploadedImages=[]}=await chrome.storage.local.get('uploadedImages');if(uploadedImages.includes(hash))return {ok:true,duplicate:true};const result=await request('/extension/image',{group:config.group,messageId:message.messageId,data:message.data},config.key);await chrome.storage.local.set({uploadedImages:[...uploadedImages,hash].slice(-2048)});return result;}
  if(message.type==='config'&&web){if(!config||paused)return {paused:true};try{const r=await request('/extension/config',{group:config.group},config.key);await chrome.storage.local.set({config:{...config,names:r.names},serverCheckpoint:r.checkpoint});return {...r,group:config.group};}catch(e){await tellStatus('Painel indisponível: '+e.message);return {paused:true,error:e.message};}}
  if(message.type==='status'&&web){await tellStatus(String(message.status).slice(0,250));if(config&&!paused)await request('/extension/status',{group:config.group,status:message.status,diagnostics:message.diagnostics},config.key).catch(()=>{});return {ok:true};}
  if(message.type==='read-now'&&local){const tabs=await chrome.tabs.query({active:true,currentWindow:true});if(!tabs[0]?.url?.startsWith('https://web.whatsapp.com/'))throw new Error('Abra a extensão na aba do WhatsApp Web.');await chrome.tabs.sendMessage(tabs[0].id,{type:'tick'});return {ok:true};}
  if(message.type==='sync'&&web){if(!config||paused||message.group!==config.group)throw new Error('Grupo não autorizado ou leitura pausada.');if(busy)throw new Error('Outra aba está sincronizando. Tente na próxima rodada.');busy=true;try{const r=await request('/extension/sync',{group:config.group,messages:message.messages,checkpoint:message.checkpoint,coverage:message.coverage},config.key);await chrome.storage.local.set({serverCheckpoint:r.checkpoint,status:message.coverage==='gap'?'Histórico incompleto. Abra o grupo e carregue mensagens anteriores.':`Atualizado: ${r.added} checagens novas, ${r.pending} para revisar.`,lastSync:Date.now()});return r;}finally{busy=false;}}
  throw new Error('Ação não permitida');
 })().then(reply).catch(async e=>{await tellStatus(e.message);reply({error:e.message});});
 return true;
});
chrome.alarms.create('check-group',{periodInMinutes:1});
chrome.alarms.onAlarm.addListener(async()=>{const tabs=await chrome.tabs.query({url:'https://web.whatsapp.com/*'});for(const tab of tabs)chrome.tabs.sendMessage(tab.id,{type:'tick'}).catch(()=>{});});

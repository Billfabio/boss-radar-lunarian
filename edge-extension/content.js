(()=>{
 const GROUP='Lunarian',adapter=globalThis.BossWhatsAppAdapter,core=globalThis.BossCollectorCore,VERSION=chrome.runtime.getManifest().version;
 let running=false,observer=null,observedRoot=null,debounceTimer=null,heartbeatTimer=null,compiled=null,compiledVersion='',currentStatus='DISCONNECTED',lastDiagnostics=null;
 let delta={messagesSeen:0,messagesFiltered:0,bossMatches:0,exactMatches:0,fuzzyMatches:0,duplicates:0,errors:0,observerEvents:0};
 const send=data=>chrome.runtime.sendMessage(data),hash=async text=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(String(text))))].map(x=>x.toString(16).padStart(2,'0')).join('');
 const add=(key,n=1)=>{delta[key]=(delta[key]||0)+n;};
 async function emitHeartbeat(status=currentStatus,diagnostics=lastDiagnostics){const d=delta;delta={messagesSeen:0,messagesFiltered:0,bossMatches:0,exactMatches:0,fuzzyMatches:0,duplicates:0,errors:0,observerEvents:0};try{await send({type:'heartbeat',status,diagnostics,metricsDelta:d});}catch{}}
 function scheduleHeartbeat(){clearTimeout(heartbeatTimer);heartbeatTimer=setTimeout(async()=>{await emitHeartbeat();scheduleHeartbeat();},15000);}
 function hasMessageNode(node){return node?.nodeType===1&&(node.matches?.('[data-pre-plain-text],[data-id]')||node.querySelector?.('[data-pre-plain-text]'));}
 function attachObserver(){const root=document.querySelector('#main');if(root===observedRoot&&observer)return;if(observer)observer.disconnect();observer=null;observedRoot=root;if(!root)return;observer=new MutationObserver(ms=>{if(!ms.some(m=>[...m.addedNodes].some(hasMessageNode)))return;add('observerEvents');clearTimeout(debounceTimer);debounceTimer=setTimeout(()=>void scan(false),220);});observer.observe(root,{childList:true,subtree:true});}
 function status(code,message,diagnostics){currentStatus=code;lastDiagnostics=diagnostics;return send({type:'status',statusCode:code,status:message,diagnostics}).catch(()=>{});}
 async function reporter(author,salt){return author?hash(salt+'|author|'+author):'';}
 async function groupKey(identity,salt){return hash(salt+'|group|'+identity);}
 async function rawKey(m){return hash([m.nativeId,m.at||'',m.date,m.time,m.text].join('|'));}
 async function imageData(el){const out=[];for(const img of [...el.querySelectorAll('img')].filter(i=>i.naturalWidth>80&&i.naturalHeight>60).slice(0,3)){try{const canvas=document.createElement('canvas'),scale=Math.min(1,1000/img.naturalWidth,1000/img.naturalHeight);canvas.width=Math.round(img.naturalWidth*scale);canvas.height=Math.round(img.naturalHeight*scale);canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);const data=canvas.toDataURL('image/jpeg',.7);if(data.length<=290000)out.push(data);}catch{}}return out;}
 async function analyze(m,cfg,gKey){
  const matches=core.match(m.text,compiled);if(!matches.length){add('messagesFiltered');return null;}add('bossMatches');for(const x of matches)add(x.matchType==='FUZZY'?'fuzzyMatches':'exactMatches');
  const capturedTimestamp=Date.now(),authorHash=await reporter(m.author,cfg.reporterSalt),fingerprint=await hash(core.fingerprintMaterial({groupKey:gKey,authorHash,messageTimestamp:m.at||'',normalizedText:m.text}));
  return {messageFingerprint:fingerprint,bossCandidates:matches,messageTimestamp:Number.isFinite(m.at)?m.at:null,capturedTimestamp,authorHash:authorHash||null,contextClassification:core.classify(m.text),text:String(m.text||'').slice(0,1000),normalizedText:core.norm(m.text).slice(0,1000),extensionVersion:VERSION};
 }
 async function baseline(nodes,cfg){
  const rows=[];for(const el of nodes){const m=adapter.extractNode(el);if(!m.text&&!m.media)continue;rows.push({...m,_key:await rawKey(m)});}rows.sort((a,b)=>(a.at||0)-(b.at||0));const last=rows.at(-1);if(last)await chrome.storage.local.set({localCheckpoint:{key:last._key,at:last.at||Date.now(),setAt:Date.now()}});return rows.length;
 }
 async function scan(manual=false){if(running)return;running=true;
  try{
   const cfg=await send({type:'config'});if(cfg.paused){await status('PAUSED','Collector pausado.',null);return;}if(!cfg.dictionary?.entries?.length){await status('DEGRADED','Dicionário de bosses indisponível; coleta aguardando sincronização.',null);return;}
   if(compiledVersion!==cfg.dictionary.version){compiled=core.compileDictionary(cfg.dictionary);compiledVersion=cfg.dictionary.version;}
   const health=adapter.health(document);attachObserver();if(!health.app){await status('WHATSAPP_NOT_FOUND','WhatsApp Web não foi localizado.',{domOk:false,visible:0,relevant:0});return;}if(!health.ok){await status('WHATSAPP_WEB_STRUCTURE_CHANGED','Estrutura esperada do WhatsApp Web não foi encontrada.',{domOk:false,visible:health.messages,relevant:0});return;}
   const detected=adapter.title(document,GROUP);if(core.norm(detected)!==core.norm(GROUP)){await status('LUNARIAN_NOT_FOUND','Abra o grupo Lunarian para ativar o Collector.',{configured:GROUP,detected,domOk:true,visible:health.messages,relevant:0});return;}
   const identity=adapter.groupIdentity(document,GROUP),gKey=await groupKey(identity,cfg.reporterSalt||'local'),nodes=adapter.messageNodes(document),{localCheckpoint}=await chrome.storage.local.get('localCheckpoint');
   if(!localCheckpoint){const visible=await baseline(nodes,cfg);await status('CONNECTED','Baseline criado. Somente mensagens novas serão tratadas como evidência.',{configured:GROUP,detected,domOk:true,visible,relevant:0});return;}
   const extracted=[];for(const el of nodes){const m=adapter.extractNode(el);if(!m.text&&!m.media)continue;const key=await rawKey(m);extracted.push({...m,_key:key,_el:el});}extracted.sort((a,b)=>(a.at||0)-(b.at||0));
   const cpIndex=extracted.findIndex(x=>x._key===localCheckpoint.key),oldest=extracted.find(x=>Number.isFinite(x.at)),gap=cpIndex<0&&oldest&&Number.isFinite(localCheckpoint.at)&&oldest.at>localCheckpoint.at+120000;
   const newer=extracted.filter((m,i)=>cpIndex>=0?i>cpIndex:!Number.isFinite(m.at)||m.at>Number(localCheckpoint.at||0));const evidence=[];
   for(const m of newer){add('messagesSeen');const row=await analyze(m,cfg,gKey);if(row)evidence.push(row);}
   if(evidence.length){const r=await send({type:'evidence-batch',group:GROUP,evidence});if(r?.error)throw new Error(r.error);}
   const last=extracted.at(-1);if(last)await chrome.storage.local.set({localCheckpoint:{key:last._key,at:last.at||Date.now(),setAt:Date.now()}});
   const diagnostics={configured:GROUP,detected,domOk:true,visible:extracted.length,relevant:evidence.length,gapDetected:!!gap,manual:!!manual};
   await status(gap?'DEGRADED':'CONNECTED',gap?'Lacuna de coleta detectada; mensagens atuais continuam sendo capturadas.':'Lunarian Collector ativo.',diagnostics);
  }catch(e){add('errors');await status('ERROR',String(e.message||e).slice(0,240),lastDiagnostics);}finally{running=false;}
 }
 chrome.runtime.onMessage.addListener((m,sender,reply)=>{if(m.type==='selected-group'){reply({group:adapter.title(document),visible:adapter.messageNodes(document).length});return;}if(m.type==='tick'){void scan(!!m.manual);reply({ok:true});}});
 attachObserver();void scan(false);scheduleHeartbeat();window.addEventListener('pagehide',()=>{observer?.disconnect();clearTimeout(debounceTimer);clearTimeout(heartbeatTimer);});
})();
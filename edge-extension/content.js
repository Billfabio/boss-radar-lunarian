(()=>{
 let running=false,firstOpen=true,currentGroup='';
 const adapter=globalThis.BossWhatsAppAdapter;
 const send=data=>chrome.runtime.sendMessage(data);
 const wait=ms=>new Promise(r=>setTimeout(r,ms));
 const normalize=s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 const title=()=>adapter.title(document,currentGroup);
 const hash=async text=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(x=>x.toString(16).padStart(2,'0')).join('');
 async function messages(){
  const result=[];
  for(const el of adapter.messageNodes(document)){
   const {text,media,date,time,at,nativeId}=adapter.extractNode(el);if(!text&&!media)continue;
   const imageData=[];if(media)for(const img of [...el.querySelectorAll('img')].filter(i=>i.naturalWidth>80&&i.naturalHeight>60).slice(0,3)){try{const canvas=document.createElement('canvas'),scale=Math.min(1,1000/img.naturalWidth,1000/img.naturalHeight);canvas.width=Math.round(img.naturalWidth*scale);canvas.height=Math.round(img.naturalHeight*scale);canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);const data=canvas.toDataURL('image/jpeg',0.7);if(data.length<=290000)imageData.push(data);}catch{/* The picture may not be loaded or canvas-readable yet; retry next round. */}}
   result.push({id:await hash(nativeId+'|'+date+'|'+time+'|'+text),text,date,time,at,media,imageData});
  }
  return result;
 }
 function scroller(){let el=document.querySelector('#main [data-pre-plain-text]');while(el&&el.id!=='main'){if(el.scrollHeight>el.clientHeight+100&&getComputedStyle(el).overflowY!=='visible')return el;el=el.parentElement;}return null;}
 async function openGroup(group){
  const matches=[...document.querySelectorAll('#pane-side [title]')].filter(e=>e.getAttribute('title')===group);
  if(matches.length>1)throw new Error('Há conversas com o mesmo nome. Renomeie o grupo para um nome exclusivo.');
  if(matches.length===1){matches[0].click();await wait(1200);return;}
  const search=document.querySelector('#side [contenteditable="true"][role="textbox"]');
  if(search){search.focus();search.textContent=group;search.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:group}));await wait(1500);const hits=[...document.querySelectorAll('#side [title]')].filter(e=>e.getAttribute('title')===group);if(hits.length===1){hits[0].click();await wait(1200);}else throw new Error('Abra o grupo escolhido; a busca não encontrou uma conversa única.');}
 }
 async function tick(){if(running)return;running=true;let scroll=null;
  try{
   const config=await send({type:'config'});if(config.paused)return;currentGroup=config.group;
   if(!title()){if(firstOpen){await openGroup(config.group);firstOpen=false;}if(!title()){await send({type:'status',status:'Grupo aberto não corresponde ao configurado. Abra o grupo escolhido e confira o nome na extensão.',diagnostics:{configured:config.group,detected:adapter.title(document),visible:adapter.messageNodes(document).length}});return;}}
   firstOpen=false;
   const cp=config.checkpoint,all=new Map();let reached=!cp,coverage=cp?'complete':'baseline';
   const collect=async()=>{if(!title())throw new Error('Conversa alterada. Leitura interrompida.');for(const m of await messages())all.set(m.id,m);if(cp&&all.has(cp.id))reached=true;};
   await collect();
   if(cp&&!reached){scroll=scroller();let unchanged=0,previous='';for(let i=0;i<120&&!reached;i++){
    if(!scroll||!title())break;
    scroll.scrollTop=0;scroll.dispatchEvent(new Event('scroll',{bubbles:true}));await wait(700);await collect();
    const current=[...all.keys()].join('|');unchanged=current===previous?unchanged+1:0;previous=current;if(unchanged>=6)break;
   }if(!reached)coverage='gap';}
   // Never advance across an unverified gap. Retry after more history is loaded.
   const ordered=[...all.values()].filter(m=>Number.isFinite(m.at)).sort((a,b)=>a.at-b.at);
   const relevant=[...all.values()].filter(m=>m.media||(!cp||!Number.isFinite(m.at)||m.at>=cp.at)&&config.names.some(n=>normalize(m.text).includes(normalize(n))));
   const latest=ordered.at(-1);const checkpoint=coverage==='gap'?null:latest?{id:latest.id,at:latest.at}:null;
   if(relevant.length>1000)throw new Error('Mais de mil mensagens de bosses: importe o intervalo em partes. Marcador preservado.');
   for(let i=0;i<Math.max(1,relevant.length);i+=100){if(!title())throw new Error('Conversa alterada. Marcador preservado.');const final=i+100>=relevant.length,batch=relevant.slice(i,i+100);const r=await send({type:'sync',group:config.group,messages:batch.map(({at,imageData,...m})=>m),checkpoint:final?checkpoint:null,coverage,diagnostics:{configured:config.group,detected:title(),visible:all.size,relevant:relevant.length,withoutDate:relevant.filter(m=>!m.date).length}});if(r.error)throw new Error(r.error);for(const m of batch)for(const data of m.imageData){const upload=await send({type:'image',group:config.group,messageId:m.id,data});if(upload.error)throw new Error(upload.error);}}
  }catch(e){await send({type:'status',status:e.message}).catch(()=>{});}finally{if(scroll&&title()){scroll.scrollTop=scroll.scrollHeight;}running=false;}
 }
 chrome.runtime.onMessage.addListener((m,sender,reply)=>{if(m.type==='selected-group'){reply({group:adapter.title(document),error:'Nome não localizado. Informe o nome exato manualmente.',visible:adapter.messageNodes(document).length});return;}if(m.type==='tick'){void tick();reply({ok:true});}});
 setInterval(tick,20000);void tick();
})();

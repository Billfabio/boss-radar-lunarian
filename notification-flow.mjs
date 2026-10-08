export async function bounded(operation, message, milliseconds=15000) {
  let timer;
  try { return await Promise.race([operation,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(message)),milliseconds);})]); }
  finally {clearTimeout(timer);}
}
export async function activateNotifications(env,key,save,onStage=()=>{}) {
  if(!env.isSecureContext || !env.Notification || !env.navigator?.serviceWorker || !env.PushManager)throw new Error('Abra este painel em uma origem segura (HTTPS ou localhost) no Chrome, Edge ou Firefox. Este navegador não oferece notificações completas.');
  if(env.Notification.permission==='denied')throw new Error('Notificações bloqueadas. Permita notificações nas configurações deste site no navegador e tente novamente.');
  onStage('Aguardando permissão do navegador…');
  const permission=env.Notification.permission==='granted'?'granted':await bounded(env.Notification.requestPermission(),'O navegador não respondeu ao pedido de permissão. Abra o painel no Chrome, Edge ou Firefox e tente novamente.');
  if(permission!=='granted')throw new Error('Permissão não concedida. Aceite o pedido do navegador para ativar os avisos.');
  onStage('Preparando notificações…');
  await bounded(env.navigator.serviceWorker.register('/sw.js'),'Não foi possível preparar as notificações. Atualize a página e tente novamente.');
  const reg=await bounded(env.navigator.serviceWorker.ready,'O serviço de notificações não iniciou. Abra o painel em um navegador externo.');
  onStage('Conectando ao serviço de avisos…');
  let sub=await bounded(reg.pushManager.getSubscription(),'O serviço de avisos não respondeu.');
  if(sub){const existing=sub.options.applicationServerKey;if(existing && [...new Uint8Array(existing)].join(',')!==[...key].join(',')){await bounded(sub.unsubscribe(),'Não foi possível atualizar a inscrição.');sub=null;}}
  if(!sub) {
    try {sub=await bounded(reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key}),'O serviço de avisos não respondeu. Confira a conexão e abra o painel no Chrome, Edge ou Firefox.',20000);}
    catch(error){if(/push service|registration failed/i.test(error.message))throw new Error('O navegador não conseguiu registrar o serviço de notificações. Abra o painel em HTTPS ou localhost no Chrome, Edge ou Firefox, permita os avisos e tente novamente.');throw error;}
  }
  onStage('Salvando inscrição…');
  await bounded(save(sub.toJSON()),'Não foi possível salvar a inscrição. Confira se o monitor está rodando.');
  return sub;
}

export function buildHealth({lastPoll,lastCollectionAt,lastPredictionAt,queue,sources,whatsapp,clients,storageMode='legacy-file',storage={},errors24h=0}){
 const now=Date.now(),src=(sources||[]),online=src.filter(s=>s.active&&s.lastSuccess&&now-s.lastSuccess<15*60000&&!s.lastError).length,offline=src.filter(s=>s.active&&s.lastError).length;
 const storageStatus=storage.lastError?'ERRO':storage.lastSuccessAt?'ONLINE':'AGUARDANDO';
 return {at:now,services:{
  api:{status:'ONLINE'},
  storage:{status:storageStatus,mode:storageMode,lastSuccessAt:storage.lastSuccessAt||null,lastError:storage.lastError||'',recoveryCount:storage.recoveryCount||0},
  realtime:{status:'ONLINE',transport:'SSE',clients:clients||0},
  prediction:{status:lastPredictionAt?'ONLINE':'AGUARDANDO',lastPredictionAt:lastPredictionAt||null},
  collection:{status:lastCollectionAt&&now-lastCollectionAt<15*60000?'ONLINE':lastCollectionAt?'ATRASADA':'AGUARDANDO',lastCollectionAt:lastCollectionAt||null,lastPoll:lastPoll||null},
  whatsapp:{status:whatsapp?.connected?'ONLINE':whatsapp?.paired?'AGUARDANDO':'NÃO CONECTADO'},
  queue:{status:queue?.failed&&queue.lastError?'ATENÇÃO':'ONLINE',...(queue||{})}
 },sources:{online,offline,total:src.filter(s=>s.active).length},errors24h};
}

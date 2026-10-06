self.addEventListener('push',event=>{
  let message; try {message=event.data.json();} catch {message={title:'Boss Radar',body:'Nova janela favorável disponível.'};}
  event.waitUntil(self.registration.showNotification(message.title || 'Boss Radar',{body:message.body || '',tag:message.tag || 'boss-radar',data:{url:'/'},requireInteraction:true}));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil((async()=>{const tabs=await clients.matchAll({type:'window',includeUncontrolled:true}); for(const tab of tabs) if(new URL(tab.url).origin===self.location.origin) return tab.focus(); return clients.openWindow('/');})());
});

const CACHE='moneymatters-pos-v1';
self.addEventListener('install',(event)=>{event.waitUntil(caches.open(CACHE).then(()=>self.skipWaiting()));});
self.addEventListener('activate',(event)=>{event.waitUntil(self.clients.claim());});
self.addEventListener('online',async()=>{const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});for(const client of clients)client.postMessage({type:'POS_SYNC_REQUESTED'});});
self.addEventListener('fetch',(event)=>{const url=new URL(event.request.url);if(event.request.method==='GET'&&url.origin===self.location.origin){event.respondWith(fetch(event.request).catch(()=>caches.match(event.request).then((r)=>r||Response.error())));}});
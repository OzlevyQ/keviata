const CACHE='keviata-v9';
const SHELL=['app.js','offline.html','manifest.webmanifest','favicon.svg','icons/icon-192.svg','icons/icon-512.svg','icons/icon-192.png','icons/icon-512.png','icons/maskable-512.png','icons/apple-touch-icon.png'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;const u=new URL(e.request.url);if(u.origin!==location.origin)return;e.respondWith(fetch(e.request,{cache:'no-cache'}).then(r=>{if(r.ok){const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy))}return r}).catch(async()=>await caches.match(e.request)||await caches.match('offline.html')))})
self.addEventListener('push',e=>{let d={};try{d=e.data?e.data.json():{}}catch{}
  e.waitUntil(self.registration.showNotification(d.title||'קביעותא',{body:d.body||'הדף היומי מחכה לך',icon:'icons/icon-192.png',badge:'icons/icon-192.png',dir:'rtl',lang:'he',data:{url:d.url||'./'}}))})
self.addEventListener('notificationclick',e=>{e.notification.close();const u=(e.notification.data&&e.notification.data.url)||'./'
  e.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(cs=>{const c=cs.find(c=>c.url.includes('/keviata/'));if(c)return c.focus();return clients.openWindow(u)}))})

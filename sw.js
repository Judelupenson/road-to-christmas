const CACHE_NAME = 'road-to-christmas-shell-v2';
const SHELL = [
  './', './index.html', './styles.css', './config.js', './scoring.js', './app.js',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'
];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(fetch(req).then(response => {
    if (response && response.ok) {
      const clone = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(req, clone));
    }
    return response;
  }).catch(async () => {
    const cached = await caches.match(req);
    return cached || caches.match('./index.html');
  }));
});

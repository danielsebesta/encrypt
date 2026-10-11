// Retire older caches so security updates cannot be held by cache-first scripts.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith('encrypt-')).map(key => caches.delete(key))
  )).then(() => self.clients.claim()));
});
// Requests use the network and HTTP cache policy. No API or secret URLs are cached.

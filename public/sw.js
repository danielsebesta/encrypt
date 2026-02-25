const CACHE_VERSION = 'v1';
const STATIC_CACHE = `encrypt-static-${CACHE_VERSION}`;
const PAGE_CACHE = `encrypt-pages-${CACHE_VERSION}`;

const PRECACHE_URLS = [
  '/',
  '/favicon.svg',
  '/encryptclick.svg',
  '/encryptclick_icon.svg',
];

const STATIC_EXTENSIONS = [
  '.js', '.css', '.woff2', '.woff', '.ttf',
  '.svg', '.png', '.jpg', '.webp', '.ico',
  '.webmanifest', '.json',
];

function isStaticAsset(url) {
  const path = new URL(url).pathname;
  return STATIC_EXTENSIONS.some(ext => path.endsWith(ext));
}

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== STATIC_CACHE && key !== PAGE_CACHE)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  if (isStaticAsset(request.url)) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(cache =>
        cache.match(request).then(cached => {
          if (cached) return cached;
          return fetch(request).then(response => {
            if (response.ok) cache.put(request, response.clone());
            return response;
          });
        })
      )
    );
    return;
  }

  if (request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(PAGE_CACHE).then(cache => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }
});

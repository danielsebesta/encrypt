const SHELL_CACHE = 'encrypt-shell-v2';
const SHELL_MAX_ENTRIES = 160;
const SHARE_INBOX = 'share-target-inbox';
const MAX_SHARED_FILES = 100;
const NETWORK_WAIT_MS = 4000;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.add('/app').catch(() => undefined)),
  );
  self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith('encrypt-') && key !== SHELL_CACHE).map(key => caches.delete(key))
  )).then(() => self.clients.claim()));
});

self.addEventListener('push', event => {
  event.waitUntil(showPush());
});

// A push carries no content. The text was left here by the page, in the language the user chose.
async function showPush() {
  let text = { title: 'encrypt.click', body: 'New message' };
  try {
    const hit = await (await caches.open('push-text')).match('/push-text');
    if (hit) text = await hit.json();
  } catch {}
  await self.registration.showNotification(String(text.title), {
    body: String(text.body),
    tag: 'encrypt-click-push',
    icon: '/web-app-manifest-192x192.png',
  });
}

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const open = list.find(client => new URL(client.url).pathname.startsWith('/app'));
    return open ? open.focus() : self.clients.openWindow('/app');
  }));
});

// What the device share sheet hands over stays on the device until the share form takes it out of the inbox.
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.method === 'POST') {
    if (url.pathname === '/share-target') event.respondWith(receiveShare(request));
    return;
  }
  if (request.method !== 'GET' || request.cache === 'no-store' || request.headers.has('range')) return;
  if (request.mode === 'navigate') {
    // Online: only /app is network-first with shell cache. Offline: any
    // same-origin navigation falls back to the cached start_url so audits
    // that hit `/` still get a 200 and the installable app opens.
    if (url.pathname === '/app' || url.pathname === '/app/') {
      event.respondWith(appShell(request));
    } else {
      event.respondWith(navigateWithAppFallback(request));
    }
  } else if (!url.search && (url.pathname.startsWith('/_astro/') || url.pathname.startsWith('/fonts/'))) {
    event.respondWith(immutableAsset(request));
  }
});

async function trim(cache) {
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - SHELL_MAX_ENTRIES)).map(key => cache.delete(key)));
}

async function immutableAsset(request) {
  const cache = await caches.open(SHELL_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok && response.type === 'basic') {
    await cache.put(request, response.clone());
    await trim(cache);
  }
  return response;
}

async function cachedAppShell() {
  const cache = await caches.open(SHELL_CACHE);
  return cache.match(new URL('/app', self.location.origin).href);
}

async function appShell(request) {
  const cache = await caches.open(SHELL_CACHE);
  const key = new URL('/app', self.location.origin).href;
  const cached = await cache.match(key);
  const controller = new AbortController();
  const timer = cached ? setTimeout(() => controller.abort(), NETWORK_WAIT_MS) : 0;
  try {
    const response = await fetch(request, { signal: controller.signal });
    clearTimeout(timer);
    if (response.ok && !response.redirected && response.type === 'basic') await cache.put(key, response.clone());
    return response;
  } catch (error) {
    clearTimeout(timer);
    if (cached) return cached;
    throw error;
  }
}

async function navigateWithAppFallback(request) {
  try {
    return await fetch(request);
  } catch (error) {
    const cached = await cachedAppShell();
    if (cached) return cached;
    throw error;
  }
}

async function receiveShare(request) {
  await caches.delete(SHARE_INBOX);
  try {
    const form = await request.formData();
    const field = name => {
      const value = form.get(name);
      return typeof value === 'string' ? value : '';
    };
    const files = form.getAll('files').filter(file => typeof file !== 'string').slice(0, MAX_SHARED_FILES);
    const inbox = await caches.open(SHARE_INBOX);
    await Promise.all(files.map((file, index) => inbox.put(`/share-target/file/${index}`, new Response(file))));
    const meta = { at: Date.now(), title: field('title'), text: field('text'), url: field('url'), files: files.map(file => ({ name: file.name, type: file.type })) };
    await inbox.put('/share-target/meta', new Response(JSON.stringify(meta), { headers: { 'Content-Type': 'application/json' } }));
  } catch {
    await caches.delete(SHARE_INBOX);
  }
  return Response.redirect(new URL('/app?tab=files', self.location.origin).href, 303);
}
// Only the /app shell and hashed build assets are cached, so the app opens offline. API, upload and room traffic always uses the network.

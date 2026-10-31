// Retire older caches so security updates cannot be held by cache-first scripts.
const SHARE_INBOX = 'share-target-inbox';
const MAX_SHARED_FILES = 100;

self.addEventListener('install', event => {
  self.skipWaiting();
  // Where the browser supports it, everything except the share POST skips the worker entirely.
  const bypass = event.addRoutes?.({ condition: { not: { requestMethod: 'POST' } }, source: 'network' });
  if (bypass) event.waitUntil(bypass.catch(() => {}));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith('encrypt-')).map(key => caches.delete(key))
  )).then(() => self.clients.claim()));
});

// What the device share sheet hands over stays on the device until the share form takes it out of the inbox.
self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'POST') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname !== '/share-target') return;
  event.respondWith(receiveShare(request));
});

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
  return Response.redirect(new URL('/share', self.location.origin).href, 303);
}
// Every other request uses the network and HTTP cache policy. No API or secret URLs are cached.

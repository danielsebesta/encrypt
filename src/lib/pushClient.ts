const TEXT_CACHE = 'push-text';
const TEXT_URL = '/push-text';
export const PUSH_ROOMS_CACHE = 'encrypt-push-rooms';
const ROOM_URL = '/push-room/';
const TAG_PREFIX = 'encrypt.click:chat-push-tag:';
const TAG_RE = /^[A-Za-z0-9_-]{22}$/;

export type PushSubscriptionInfo = { endpoint: string; keys: { p256dh: string; auth: string } | null };

export function pushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function keyBytes(key: string): Uint8Array<ArrayBuffer> {
  const padded = key.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(key.length / 4) * 4, '=');
  return Uint8Array.from(atob(padded), char => char.charCodeAt(0));
}

/** The service worker shows this text for an empty push, so it stays in the language the user picked. */
async function storeText(title: string, body: string) {
  const cache = await caches.open(TEXT_CACHE);
  await cache.put(TEXT_URL, new Response(JSON.stringify({ title, body }), { headers: { 'Content-Type': 'application/json' } }));
}

/** Subscribes this device with the relay's key and returns what the room needs to wake it, or null when push is unavailable. */
export async function subscribeForPush(publicKey: string, title: string, body: string): Promise<PushSubscriptionInfo | null> {
  if (!pushSupported() || Notification.permission !== 'granted') return null;
  try {
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    const current = subscription?.options.applicationServerKey;
    if (subscription && current && !sameKey(new Uint8Array(current), keyBytes(publicKey))) {
      await subscription.unsubscribe();
      subscription = null;
    }
    subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
    await storeText(title, body).catch(() => {});
    const keys = subscription.toJSON().keys;
    return {
      endpoint: subscription.endpoint,
      keys: typeof keys?.p256dh === 'string' && typeof keys.auth === 'string' ? { p256dh: keys.p256dh, auth: keys.auth } : null,
    };
  } catch {
    return null;
  }
}

function sameKey(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** A random tag per room and device. The relay only ever sees this tag; the device alone knows which room it stands for. */
export function pushTagFor(roomId: string, storage: Storage = localStorage): string {
  const key = `${TAG_PREFIX}${roomId}`;
  try {
    const existing = storage.getItem(key);
    if (existing && TAG_RE.test(existing)) return existing;
  } catch {}
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const tag = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  try { storage.setItem(key, tag); } catch {}
  return tag;
}

/** Lets the service worker name the room and open it when a push with this tag arrives. */
export async function rememberPushRoom(tag: string, room: { roomId: string; label: string; kind: 'chat' }): Promise<void> {
  if (typeof caches === 'undefined') return;
  const cache = await caches.open(PUSH_ROOMS_CACHE);
  await cache.put(`${ROOM_URL}${tag}`, new Response(JSON.stringify(room), { headers: { 'Content-Type': 'application/json' } }));
}

export async function forgetPushRooms(): Promise<void> {
  if (typeof caches === 'undefined') return;
  await caches.delete(PUSH_ROOMS_CACHE);
}

export async function forgetPushRoom(tag: string): Promise<void> {
  if (typeof caches === 'undefined') return;
  const cache = await caches.open(PUSH_ROOMS_CACHE);
  await cache.delete(`${ROOM_URL}${tag}`);
}

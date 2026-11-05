const TEXT_CACHE = 'push-text';
const TEXT_URL = '/push-text';

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

/** Subscribes this device with the relay's key and returns the endpoint the room should wake, or null when push is unavailable. */
export async function subscribeForPush(publicKey: string, title: string, body: string): Promise<string | null> {
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
    return subscription.endpoint;
  } catch {
    return null;
  }
}

function sameKey(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

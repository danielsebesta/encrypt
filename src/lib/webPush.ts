export type VapidKeys = { publicKey: string; privateKey: string; subject: string };
export type PushResult = 'sent' | 'gone' | 'failed';

const HOSTS = [/^fcm\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/];
const ENDPOINT_MAX = 1024;
const JWT_LIFETIME_S = 12 * 60 * 60;
const SEND_TIMEOUT_MS = 8000;

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

/** Only the push services browsers ship with are contacted, so a stored endpoint can never aim the server at another host. */
export function isPushEndpoint(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > ENDPOINT_MAX) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && HOSTS.some(re => re.test(url.hostname));
  } catch {
    return false;
  }
}

export function readVapidKeys(env: Record<string, unknown>): VapidKeys | null {
  const { VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey, VAPID_SUBJECT: subject } = env;
  if (typeof publicKey !== 'string' || typeof privateKey !== 'string') return null;
  if (!/^[A-Za-z0-9_-]{87}$/.test(publicKey) || !/^[A-Za-z0-9_-]{43}$/.test(privateKey)) return null;
  return {
    publicKey,
    privateKey,
    subject: typeof subject === 'string' && /^(mailto:|https:\/\/)/.test(subject) ? subject : 'mailto:admin@localhost.invalid',
  };
}

const importedKeys = new Map<string, Promise<CryptoKey>>();

function signingKey(keys: VapidKeys): Promise<CryptoKey> {
  let key = importedKeys.get(keys.privateKey);
  if (!key) {
    const raw = fromBase64Url(keys.publicKey);
    key = crypto.subtle.importKey('jwk', {
      kty: 'EC', crv: 'P-256', d: keys.privateKey,
      x: toBase64Url(raw.slice(1, 33)), y: toBase64Url(raw.slice(33, 65)),
    }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    importedKeys.set(keys.privateKey, key);
  }
  return key;
}

export async function vapidAuthorization(endpoint: string, keys: VapidKeys, now = Date.now()): Promise<string> {
  const header = toBase64Url(encoder.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = toBase64Url(encoder.encode(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(now / 1000) + JWT_LIFETIME_S,
    sub: keys.subject,
  })));
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await signingKey(keys), encoder.encode(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${toBase64Url(new Uint8Array(signature))}, k=${keys.publicKey}`;
}

/** Wakes the device with an empty push. The notification text is local to the device; the relay never sends a message or a room. */
export async function sendPush(endpoint: string, keys: VapidKeys): Promise<PushResult> {
  if (!isPushEndpoint(endpoint)) return 'gone';
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: await vapidAuthorization(endpoint, keys), TTL: '86400', Urgency: 'high' },
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    if (response.ok) return 'sent';
    return response.status === 404 || response.status === 410 ? 'gone' : 'failed';
  } catch {
    return 'failed';
  }
}

export async function generateVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const publicKey = new Uint8Array(65);
  publicKey[0] = 4;
  publicKey.set(fromBase64Url(jwk.x!), 1);
  publicKey.set(fromBase64Url(jwk.y!), 33);
  return { publicKey: toBase64Url(publicKey), privateKey: jwk.d! };
}

const enc = new TextEncoder();
const hex = (b: Uint8Array) => Array.from(b, v => v.toString(16).padStart(2, '0')).join('');
async function key(secret: string) { return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']); }
export async function issueTurnGrant(secret: string, room: string) {
  const payload = `${room}.${Math.floor(Date.now() / 1000) + 60}.${crypto.randomUUID()}`;
  return `${payload}.${hex(new Uint8Array(await crypto.subtle.sign('HMAC', await key(secret), enc.encode(payload))))}`;
}
export async function verifyTurnGrant(secret: string, token: string): Promise<string | null> {
  if (secret.length < 32 || token.length > 256) return null;
  const parts = token.split('.');
  if (parts.length !== 4 || !/^[a-f0-9]{64}$/.test(parts[0]) || !/^[a-f0-9]{64}$/.test(parts[3])) return null;
  const expiry = Number(parts[1]);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(expiry) || expiry <= now || expiry > now + 60) return null;
  const signature = Uint8Array.from(parts[3].match(/../g)!, v => parseInt(v, 16));
  return await crypto.subtle.verify('HMAC', await key(secret), signature, enc.encode(parts.slice(0, 3).join('.'))) ? parts[0] : null;
}

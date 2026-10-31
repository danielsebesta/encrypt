import type { TimeLock } from './timelock';

const B64URL_RE = /^[A-Za-z0-9_-]+$/;
const MAX_UNIX = 32503680000;
const MAX_LOCK_BYTES = 4096;

/**
 * What a receive link carries in its fragment. `payload` is the base64url password envelope; the rest is readable
 * before the password is entered: when the upload expires (Unix seconds), whether it is deleted after one download,
 * and the drand time lock whose secret is mixed into the payload's key.
 */
export type ShareLink = {
  payload: string;
  expires?: number;
  burn?: boolean;
  lock?: TimeLock;
};

const unixOk = (value: number) => Number.isSafeInteger(value) && value > 0 && value < MAX_UNIX;

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array | null {
  if (!B64URL_RE.test(text) || text.length % 4 === 1) return null;
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(text.length / 4) * 4, '='));
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

/**
 * Version 1 is the bare payload. Version 2 is `v=2`, the optional `x` (expiry), `b=1` (one-time download), `r` and
 * `l` (drand round and the tlock ciphertext of the time secret), then `p` (payload) last; it is used only when there
 * is something to say besides the payload.
 */
export function formatShareFragment(link: ShareLink): string {
  if (!B64URL_RE.test(link.payload)) throw new Error('Invalid payload');
  const fields: string[] = [];
  if (link.expires !== undefined) {
    if (!unixOk(link.expires)) throw new Error('Invalid expiry');
    fields.push(`x=${link.expires}`);
  }
  if (link.burn) fields.push('b=1');
  if (link.lock) {
    if (!Number.isSafeInteger(link.lock.round) || link.lock.round < 1 || !link.lock.ciphertext.length || link.lock.ciphertext.length > MAX_LOCK_BYTES) throw new Error('Invalid time lock');
    fields.push(`r=${link.lock.round}`, `l=${toBase64Url(link.lock.ciphertext)}`);
  }
  if (!fields.length) return link.payload;
  return ['v=2', ...fields, `p=${link.payload}`].join('&');
}

/** The link in a fragment (without `#`, already percent-decoded), or null when it is not a share link. */
export function parseShareFragment(fragment: string): ShareLink | null {
  if (B64URL_RE.test(fragment)) return { payload: fragment };
  if (!fragment.startsWith('v=2&')) return null;
  const fields = new Map<string, string>();
  for (const part of fragment.split('&')) {
    const at = part.indexOf('=');
    if (at < 1) return null;
    const name = part.slice(0, at);
    if (fields.has(name)) return null;
    fields.set(name, part.slice(at + 1));
  }
  const payload = fields.get('p') ?? '';
  if (!B64URL_RE.test(payload)) return null;
  const link: ShareLink = { payload };
  for (const [name, value] of fields) {
    if (name === 'v' || name === 'p') continue;
    if (name === 'x') {
      if (!/^\d{1,11}$/.test(value) || !unixOk(Number(value))) return null;
      link.expires = Number(value);
    } else if (name === 'b') {
      if (value !== '1') return null;
      link.burn = true;
    }
  }
  if (fields.has('r') || fields.has('l')) {
    const round = fields.get('r') ?? '';
    const ciphertext = fromBase64Url(fields.get('l') ?? '');
    if (!/^[1-9]\d{0,14}$/.test(round) || !ciphertext || ciphertext.length > MAX_LOCK_BYTES) return null;
    link.lock = { round: Number(round), ciphertext };
  }
  return link;
}


import type { TimeLock } from './timelock';

const B64URL_RE = /^[A-Za-z0-9_-]+$/;
const MAX_UNIX = 32503680000;
const MAX_LOCK_BYTES = 4096;
const MAX_KEY_CHARS = 1024;

export type ShareLink = {
  payload: string;
  expires?: number;
  burn?: boolean;
  lock?: TimeLock;
  key?: string;
  recipients?: boolean;
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

export function encodeShareKey(password: string): string {
  return toBase64Url(new TextEncoder().encode(password));
}

export function decodeShareKey(key: string): string | null {
  const bytes = fromBase64Url(key);
  if (!bytes) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

export function formatShareFragment(link: ShareLink): string {
  if (!B64URL_RE.test(link.payload)) throw new Error('Invalid payload');
  if (link.recipients) {
    if (link.burn || link.key !== undefined || link.lock) throw new Error('Unsupported recipient link options');
    const fields = ['v=3', 'm=r'];
    if (link.expires !== undefined) {
      if (!unixOk(link.expires)) throw new Error('Invalid expiry');
      fields.push(`x=${link.expires}`);
    }
    return [...fields, `p=${link.payload}`].join('&');
  }
  const fields: string[] = [];
  if (link.expires !== undefined) {
    if (!unixOk(link.expires)) throw new Error('Invalid expiry');
    fields.push(`x=${link.expires}`);
  }
  if (link.burn) fields.push('b=1');
  if (link.key !== undefined) {
    if (!link.key || link.key.length > MAX_KEY_CHARS || !B64URL_RE.test(link.key)) throw new Error('Invalid key');
    fields.push(`k=${link.key}`);
  }
  if (link.lock) {
    if (!Number.isSafeInteger(link.lock.round) || link.lock.round < 1 || !link.lock.ciphertext.length || link.lock.ciphertext.length > MAX_LOCK_BYTES) throw new Error('Invalid time lock');
    fields.push(`r=${link.lock.round}`, `l=${toBase64Url(link.lock.ciphertext)}`);
  }
  if (!fields.length) return link.payload;
  return ['v=2', ...fields, `p=${link.payload}`].join('&');
}

function splitFields(fragment: string): Map<string, string> | null {
  const fields = new Map<string, string>();
  for (const part of fragment.split('&')) {
    const at = part.indexOf('=');
    if (at < 1) return null;
    const name = part.slice(0, at);
    if (fields.has(name)) return null;
    fields.set(name, part.slice(at + 1));
  }
  return fields;
}

function parseRecipientFragment(fragment: string): ShareLink | null {
  const fields = splitFields(fragment);
  if (!fields || fields.get('m') !== 'r') return null;
  const payload = fields.get('p') ?? '';
  if (!B64URL_RE.test(payload)) return null;
  const link: ShareLink = { payload, recipients: true };
  for (const [name, value] of fields) {
    if (name === 'v' || name === 'm' || name === 'p') continue;
    if (name !== 'x' || !/^\d{1,11}$/.test(value) || !unixOk(Number(value))) return null;
    link.expires = Number(value);
  }
  return link;
}

export function parseShareFragment(fragment: string): ShareLink | null {
  if (B64URL_RE.test(fragment)) return { payload: fragment };
  if (fragment.startsWith('v=3&')) return parseRecipientFragment(fragment);
  if (!fragment.startsWith('v=2&')) return null;
  const fields = splitFields(fragment);
  if (!fields) return null;
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
    } else if (name === 'k') {
      if (!value || value.length > MAX_KEY_CHARS || !decodeShareKey(value)) return null;
      link.key = value;
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

export function isCapsuleFragment(fragment: string): boolean {
  return /^c=[A-Za-z0-9_-]+$/.test(fragment);
}

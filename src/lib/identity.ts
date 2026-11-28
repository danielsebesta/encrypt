import { ml_kem768_x25519 } from '@noble/post-quantum/hybrid.js';
import { arrayToB64url, b64urlToArray } from './chatCrypto';
import { equalBytes, hkdfBytes, hkdfKey } from './kdf';

const ED25519 = { name: 'Ed25519' };
const PKCS8_ED25519 = new Uint8Array([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20]);

export const SEED_BYTES = 32;
export const SIGN_PUBLIC_BYTES = 32;
export const KEM_PUBLIC_BYTES = 1216;
export const KEM_SECRET_BYTES = 32;
export const KEM_CIPHERTEXT_BYTES = 1120;
export const SIGNATURE_BYTES = 64;
export const NAME_MAX_BYTES = 32;
const CARD_VERSION = 1;
const CARD_FIXED = 1 + SIGN_PUBLIC_BYTES + KEM_PUBLIC_BYTES + 1;
export const CARD_MAX_BYTES = CARD_FIXED + NAME_MAX_BYTES + SIGNATURE_BYTES;
const CARD_CONTEXT = 'encrypt.click/identity/v1/card';
const FINGERPRINT_CONTEXT = 'encrypt.click/identity/v1/fingerprint';

export type Card = {
  signPub: Uint8Array;
  kemPub: Uint8Array;
  name: string;
  bytes: Uint8Array;
};

export type Identity = {
  card: Card;
  kemSecret: Uint8Array;
  signKey: CryptoKey;
};

const encoder = new TextEncoder();

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

export async function sha256(...parts: Uint8Array[]): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', concat(...parts) as BufferSource));
}

/** Trims, collapses whitespace, drops control characters and cuts on a code point so the UTF-8 form fits the card. */
export function cleanName(value: string): string {
  const flat = value.normalize('NFC').replace(/[\p{Cc}\p{Zl}\p{Zp}\u200B\u200E\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/gu, ' ').replace(/\s+/g, ' ').trim();
  let out = '';
  for (const char of flat) {
    if (encoder.encode(out + char).length > NAME_MAX_BYTES) break;
    out += char;
  }
  return out.trim();
}

async function signingKey(sigSeed: Uint8Array): Promise<{ key: CryptoKey; publicKey: Uint8Array }> {
  const pkcs8 = concat(PKCS8_ED25519, sigSeed);
  try {
    const exportable = await crypto.subtle.importKey('pkcs8', pkcs8 as BufferSource, ED25519, true, ['sign']);
    const jwk = await crypto.subtle.exportKey('jwk', exportable);
    const publicKey = b64urlToArray(jwk.x ?? '');
    if (publicKey.length !== SIGN_PUBLIC_BYTES) throw new Error('Invalid signing key');
    const key = await crypto.subtle.importKey('pkcs8', pkcs8 as BufferSource, ED25519, false, ['sign']);
    return { key, publicKey };
  } finally {
    pkcs8.fill(0);
  }
}

function cardBody(signPub: Uint8Array, kemPub: Uint8Array, name: string): Uint8Array {
  const nameBytes = encoder.encode(name);
  if (nameBytes.length > NAME_MAX_BYTES) throw new Error('Name too long');
  const body = new Uint8Array(CARD_FIXED + nameBytes.length);
  body[0] = CARD_VERSION;
  body.set(signPub, 1);
  body.set(kemPub, 1 + SIGN_PUBLIC_BYTES);
  body[CARD_FIXED - 1] = nameBytes.length;
  body.set(nameBytes, CARD_FIXED);
  return body;
}

/** The whole identity comes from one seed: X-Wing for receiving, Ed25519 for signing, and a card signed by the latter. */
export async function deriveIdentity(seed: Uint8Array, name: string): Promise<Identity> {
  if (seed.length !== SEED_BYTES) throw new Error('Invalid seed');
  const base = await hkdfKey(seed);
  const kemSeed = await hkdfBytes(base, 'encrypt.click/identity/v1/kem', ml_kem768_x25519.lengths.seed);
  const sigSeed = await hkdfBytes(base, 'encrypt.click/identity/v1/sign');
  try {
    const { publicKey: kemPub, secretKey: kemSecret } = ml_kem768_x25519.keygen(kemSeed);
    const { key: signKey, publicKey: signPub } = await signingKey(sigSeed);
    const body = cardBody(signPub, kemPub, cleanName(name));
    const signature = new Uint8Array(await crypto.subtle.sign(ED25519, signKey, concat(encoder.encode(CARD_CONTEXT), body) as BufferSource));
    const bytes = concat(body, signature);
    return { card: { signPub, kemPub, name: cleanName(name), bytes }, kemSecret, signKey };
  } finally {
    kemSeed.fill(0);
    sigSeed.fill(0);
  }
}

export async function renameIdentity(identity: Identity, name: string): Promise<Identity> {
  const body = cardBody(identity.card.signPub, identity.card.kemPub, cleanName(name));
  const signature = new Uint8Array(await crypto.subtle.sign(ED25519, identity.signKey, concat(encoder.encode(CARD_CONTEXT), body) as BufferSource));
  return { ...identity, card: { ...identity.card, name: cleanName(name), bytes: concat(body, signature) } };
}

export function forgetIdentityKeys(identity: Identity | null | undefined): void {
  identity?.kemSecret.fill(0);
}

const verifyKeys = new Map<string, Promise<CryptoKey>>();

export function verifyKeyFor(signPub: Uint8Array): Promise<CryptoKey> {
  const id = arrayToB64url(signPub);
  let key = verifyKeys.get(id);
  if (!key) {
    key = crypto.subtle.importKey('raw', signPub as BufferSource, ED25519, false, ['verify']);
    key.catch(() => verifyKeys.delete(id));
    verifyKeys.set(id, key);
  }
  return key;
}

export async function verifySignature(signPub: Uint8Array, signature: Uint8Array, message: Uint8Array): Promise<boolean> {
  if (signPub.length !== SIGN_PUBLIC_BYTES || signature.length !== SIGNATURE_BYTES) return false;
  try {
    return await crypto.subtle.verify(ED25519, await verifyKeyFor(signPub), signature as BufferSource, message as BufferSource);
  } catch {
    return false;
  }
}

export async function signMessage(identity: Identity, message: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.sign(ED25519, identity.signKey, message as BufferSource));
}

function kemKeyUsable(kemPub: Uint8Array): boolean {
  try {
    const { sharedSecret } = ml_kem768_x25519.encapsulate(kemPub);
    sharedSecret.fill(0);
    return true;
  } catch {
    return false;
  }
}

/** Accepts only a card whose self-signature holds and whose receiving key is a usable X-Wing key. */
export async function parseCard(bytes: Uint8Array): Promise<Card | null> {
  if (bytes.length < CARD_FIXED + SIGNATURE_BYTES || bytes.length > CARD_MAX_BYTES || bytes[0] !== CARD_VERSION) return null;
  const nameLength = bytes[CARD_FIXED - 1];
  if (nameLength > NAME_MAX_BYTES || bytes.length !== CARD_FIXED + nameLength + SIGNATURE_BYTES) return null;
  let name: string;
  try {
    name = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(CARD_FIXED, CARD_FIXED + nameLength));
  } catch {
    return null;
  }
  if (cleanName(name) !== name) return null;
  const signPub = bytes.slice(1, 1 + SIGN_PUBLIC_BYTES);
  const kemPub = bytes.slice(1 + SIGN_PUBLIC_BYTES, CARD_FIXED - 1);
  const body = bytes.subarray(0, CARD_FIXED + nameLength);
  const signature = bytes.subarray(CARD_FIXED + nameLength);
  if (!(await verifySignature(signPub, signature, concat(encoder.encode(CARD_CONTEXT), body)))) return null;
  if (!kemKeyUsable(kemPub)) return null;
  return { signPub, kemPub, name, bytes: bytes.slice() };
}

export async function fingerprintBytes(card: Pick<Card, 'signPub' | 'kemPub'>): Promise<Uint8Array> {
  return sha256(encoder.encode(FINGERPRINT_CONTEXT), card.signPub, card.kemPub);
}

/** 25 digits in five groups: each group is five hash bytes taken modulo 100000, as in Signal's safety numbers. */
export async function fingerprint(card: Pick<Card, 'signPub' | 'kemPub'>): Promise<string> {
  const hash = await fingerprintBytes(card);
  const groups: string[] = [];
  for (let i = 0; i < 5; i++) {
    let value = 0;
    for (let j = 0; j < 5; j++) value = value * 256 + hash[i * 5 + j];
    groups.push(String(value % 100000).padStart(5, '0'));
  }
  return groups.join(' ');
}

export async function contactId(card: Pick<Card, 'signPub' | 'kemPub'>): Promise<string> {
  return arrayToB64url((await fingerprintBytes(card)).subarray(0, 16));
}

export function sameKeys(a: Pick<Card, 'signPub' | 'kemPub'>, b: Pick<Card, 'signPub' | 'kemPub'>): boolean {
  return equalBytes(a.signPub, b.signPub) && equalBytes(a.kemPub, b.kemPub);
}

export function cardToText(card: Card): string {
  return arrayToB64url(card.bytes);
}

export async function cardFromText(text: string): Promise<Card | null> {
  const value = text.trim();
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length > Math.ceil((CARD_MAX_BYTES * 4) / 3)) return null;
  try {
    return await parseCard(b64urlToArray(value));
  } catch {
    return null;
  }
}

export function cardLink(card: Card, origin: string, path = '/keys'): string {
  return `${origin}${path}#${cardToText(card)}`;
}

/** Takes a pasted card link or a bare card and returns the card, whatever host or language prefix the link uses. */
export async function cardFromInput(input: string): Promise<Card | null> {
  const value = input.trim();
  const hash = value.indexOf('#');
  return cardFromText(hash >= 0 ? value.slice(hash + 1) : value);
}

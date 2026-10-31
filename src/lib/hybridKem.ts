import { ml_kem768 } from '@noble/post-quantum/ml-kem.js';
import { arrayToB64url, b64urlToArray } from './chatCrypto';

// ML-KEM-768 (FIPS 203), always used together with ECDH: a recording only opens if both are broken. Every sealed key gets
// its own encapsulation, so one recovered secret opens nothing else.
const PUBLIC_KEY_RE = /^[A-Za-z0-9_-]{1579}$/;
const CIPHERTEXT_RE = /^[A-Za-z0-9_-]{1451}$/;

export type KemKeyPair = { publicKey: string; secretKey: Uint8Array };
export type KemSeal = { ciphertext: string; secret: Uint8Array };

export function validKemKey(value: unknown): value is string {
  return typeof value === 'string' && PUBLIC_KEY_RE.test(value);
}

export function validKemCiphertext(value: unknown): value is string {
  return typeof value === 'string' && CIPHERTEXT_RE.test(value);
}

export function createKemKeyPair(): KemKeyPair {
  const { publicKey, secretKey } = ml_kem768.keygen();
  return { publicKey: arrayToB64url(publicKey), secretKey };
}

export function kemSeal(peerKey: string): KemSeal {
  if (!validKemKey(peerKey)) throw new Error('Invalid KEM key');
  const { cipherText, sharedSecret } = ml_kem768.encapsulate(b64urlToArray(peerKey));
  return { ciphertext: arrayToB64url(cipherText), secret: sharedSecret };
}

/** A tampered ciphertext gives an unrelated secret instead of an error, so the key sealed under it fails to open. */
export function kemOpen(secretKey: Uint8Array, ciphertext: string): Uint8Array {
  if (!validKemCiphertext(ciphertext)) throw new Error('Invalid KEM ciphertext');
  return ml_kem768.decapsulate(b64urlToArray(ciphertext), secretKey);
}

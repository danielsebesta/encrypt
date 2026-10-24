import { ml_dsa44 } from '@noble/post-quantum/ml-dsa.js';
import { arrayToB64url, b64urlToArray, type PqSigner, type PqVerifier } from './chatCrypto';

// ML-DSA-44 (FIPS 204) for saved rooms, loaded only there. The context string keeps these signatures from being valid
// for anything else signed with the same key.
const CONTEXT = new TextEncoder().encode('encrypt.click/chat/v1');
const PUBLIC_KEY_BYTES = 1312;
const SIGNATURE_BYTES = 2420;
const SEED_BYTES = 32;
const MAX_KEYS = 256;
export const PQ_PUBLIC_KEY_RE = /^[A-Za-z0-9_-]{1750}$/;

export type PqIdentity = PqSigner & { publicKey: string };

export async function pqKeyHash(publicKey: Uint8Array): Promise<string> {
  return arrayToB64url(new Uint8Array(await crypto.subtle.digest('SHA-256', publicKey as BufferSource)));
}

/** The key pair is regenerated from a 32-byte seed, so only the seed needs to be stored. */
export async function pqIdentity(seed: Uint8Array): Promise<PqIdentity> {
  if (seed.length !== SEED_BYTES) throw new Error('Invalid seed');
  const { publicKey, secretKey } = ml_dsa44.keygen(seed);
  return {
    publicKey: arrayToB64url(publicKey),
    keyHash: await pqKeyHash(publicKey),
    sign: (message) => ml_dsa44.sign(message, secretKey, { context: CONTEXT }),
  };
}

/** Public keys by hash. A key is only ever filed under the hash of its own bytes, whoever handed it over. */
export class PqKeyring {
  private keys = new Map<string, Uint8Array>();

  async add(publicKey: unknown, expectedHash?: string): Promise<string | null> {
    if (typeof publicKey !== 'string' || !PQ_PUBLIC_KEY_RE.test(publicKey)) return null;
    const bytes = b64urlToArray(publicKey);
    if (bytes.length !== PUBLIC_KEY_BYTES) return null;
    const hash = await pqKeyHash(bytes);
    if (expectedHash !== undefined && hash !== expectedHash) return null;
    if (!this.keys.has(hash)) {
      if (this.keys.size >= MAX_KEYS) this.keys.delete(this.keys.keys().next().value as string);
      this.keys.set(hash, bytes);
    }
    return hash;
  }

  has(hash: string): boolean {
    return this.keys.has(hash);
  }

  readonly verify: PqVerifier = (hash, message, signature) => {
    const key = this.keys.get(hash);
    if (!key) return null;
    if (signature.length !== SIGNATURE_BYTES) return false;
    try {
      return ml_dsa44.verify(signature, message, key, { context: CONTEXT });
    } catch {
      return false;
    }
  };
}

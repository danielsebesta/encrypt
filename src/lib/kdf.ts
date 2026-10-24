import { argon2id as argon2idWasm } from 'hash-wasm';

export type Argon2Params = { memory: number; iterations: number; parallelism: number };

/** Argon2id settings of format version 3. Rooms derive with exactly these; envelopes store theirs in the header. */
export const ARGON2_V3: Readonly<Argon2Params> = Object.freeze({ memory: 65536, iterations: 3, parallelism: 1 });

// Bounds for settings read from a header, so a crafted file can neither weaken nor stall the browser opening it.
const LIMITS = { memory: [8192, 262144], iterations: [1, 10], parallelism: [1, 4] } as const;

export function argon2ParamsOk(params: Argon2Params): boolean {
  return (Object.keys(LIMITS) as (keyof Argon2Params)[]).every((name) => {
    const value = params[name];
    return Number.isInteger(value) && value >= LIMITS[name][0] && value <= LIMITS[name][1];
  });
}

export async function argon2id(password: string, salt: Uint8Array, params: Argon2Params = ARGON2_V3): Promise<Uint8Array> {
  if (!argon2ParamsOk(params) || salt.length < 16) throw new Error('Unsupported key derivation settings');
  return argon2idWasm({
    password: new TextEncoder().encode(password),
    salt,
    memorySize: params.memory,
    iterations: params.iterations,
    parallelism: params.parallelism,
    hashLength: 32,
    outputType: 'binary',
  });
}

const EMPTY = new Uint8Array(0);

const hkdfParams = (info: string, salt: Uint8Array): HkdfParams => ({
  name: 'HKDF',
  hash: 'SHA-256',
  salt: salt as BufferSource,
  info: new TextEncoder().encode(info) as BufferSource,
});

export function hkdfKey(ikm: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, ['deriveBits', 'deriveKey']);
}

export async function hkdfBytes(base: CryptoKey, info: string, length = 32, salt: Uint8Array = EMPTY): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.deriveBits(hkdfParams(info, salt), base, length * 8));
}

export function hkdfAesKey(base: CryptoKey, info: string, salt: Uint8Array = EMPTY, usages: KeyUsage[] = ['encrypt', 'decrypt']): Promise<CryptoKey> {
  return crypto.subtle.deriveKey(hkdfParams(info, salt), base, { name: 'AES-GCM', length: 256 }, false, usages);
}

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** First 16 bytes of SHA-256 over a label: a fixed, domain-separated salt for secrets that have no random one. */
export async function labelSalt(label: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(label))).slice(0, 16);
}

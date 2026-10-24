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

class WorkerUnavailable extends Error {}

type Job = { resolve: (hash: Uint8Array) => void; reject: (error: Error) => void };
type Reply = { id: number; hash?: Uint8Array; error?: string };

const jobs = new Map<number, Job>();
let worker: Worker | null = null;
let workerBroken = false;
let nextJob = 0;

function retireWorker() {
  workerBroken = true;
  worker?.terminate();
  worker = null;
  for (const job of jobs.values()) job.reject(new WorkerUnavailable());
  jobs.clear();
}

function startWorker(): Worker | null {
  if (worker) return worker;
  if (workerBroken || typeof window === 'undefined' || typeof Worker === 'undefined') return null;
  try {
    worker = new Worker(new URL('./argon2Worker.ts', import.meta.url), { type: 'module', name: 'argon2' });
  } catch {
    workerBroken = true;
    return null;
  }
  worker.onmessage = (event: MessageEvent<Reply>) => {
    const { id, hash, error } = event.data;
    const job = jobs.get(id);
    if (!job) return;
    jobs.delete(id);
    if (hash instanceof Uint8Array) job.resolve(hash);
    else job.reject(new Error(error ?? 'Key derivation failed'));
  };
  worker.onerror = retireWorker;
  worker.onmessageerror = retireWorker;
  return worker;
}

function deriveInWorker(target: Worker, password: string, salt: Uint8Array, params: Argon2Params): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const id = nextJob++;
    const secret = new TextEncoder().encode(password);
    const own = salt.slice();
    jobs.set(id, { resolve, reject });
    try {
      target.postMessage({ id, password: secret, salt: own, ...params }, [secret.buffer as ArrayBuffer, own.buffer as ArrayBuffer]);
    } catch {
      jobs.delete(id);
      secret.fill(0);
      reject(new WorkerUnavailable());
    }
  });
}

async function deriveHere(password: string, salt: Uint8Array, params: Argon2Params): Promise<Uint8Array> {
  const { argon2Raw } = await import('./argon2Core');
  const secret = new TextEncoder().encode(password);
  try {
    return await argon2Raw(secret, salt, params);
  } finally {
    secret.fill(0);
  }
}

/**
 * Argon2id runs in a dedicated worker in the browser so a 64 MiB derivation never freezes the page, and in the calling
 * thread everywhere else (Node, server rendering, tests) or when the worker cannot start.
 */
export async function argon2id(password: string, salt: Uint8Array, params: Argon2Params = ARGON2_V3): Promise<Uint8Array> {
  if (!argon2ParamsOk(params) || salt.length < 16) throw new Error('Unsupported key derivation settings');
  const target = startWorker();
  if (target) {
    try {
      return await deriveInWorker(target, password, salt, params);
    } catch (error) {
      if (!(error instanceof WorkerUnavailable)) throw error;
    }
  }
  return deriveHere(password, salt, params);
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

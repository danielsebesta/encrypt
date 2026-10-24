import { argon2id } from 'hash-wasm';
import type { Argon2Params } from './kdf';

/** The one place Argon2id runs, so the browser worker and the in-thread path cannot disagree. */
export function argon2Raw(password: Uint8Array, salt: Uint8Array, params: Argon2Params): Promise<Uint8Array> {
  return argon2id({
    password,
    salt,
    memorySize: params.memory,
    iterations: params.iterations,
    parallelism: params.parallelism,
    hashLength: 32,
    outputType: 'binary',
  });
}

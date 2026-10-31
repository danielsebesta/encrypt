// drand quicknet through this site's /api/drand proxy. The browser verifies every beacon against the chain's public
// key, so the proxy cannot fake one.
export const DRAND_CHAIN = {
  period: 3,
  genesis: 1692803367,
  publicKey: '83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a',
  chainHash: '52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971',
} as const;

const PROXY_CHAIN_URL = `/api/drand/${DRAND_CHAIN.chainHash}`;
export const TIME_SECRET_BYTES = 32;

/** The last round published at or before a moment, so a lock opens at most one period before the chosen time. */
export function roundAt(timeMs: number): number {
  return Math.floor((timeMs - DRAND_CHAIN.genesis * 1000) / (DRAND_CHAIN.period * 1000)) + 1;
}

/** When a round is published, in milliseconds. */
export function roundTime(round: number): number {
  return (DRAND_CHAIN.genesis + (round - 1) * DRAND_CHAIN.period) * 1000;
}

type TlockApi = {
  timelockEncrypt: typeof import('tlock-js').timelockEncrypt;
  timelockDecrypt: typeof import('tlock-js').timelockDecrypt;
  Buffer: typeof import('tlock-js').Buffer;
  client: import('tlock-js').HttpChainClient;
};

let tlockApi: Promise<TlockApi> | null = null;

export function tlock(): Promise<TlockApi> {
  tlockApi ??= Promise.all([import('tlock-js'), import('drand-client')]).then(([{ timelockEncrypt, timelockDecrypt, HttpCachingChain, HttpChainClient, Buffer }, { defaultChainOptions }]) => {
    const options = { ...defaultChainOptions, chainVerificationParams: { chainHash: DRAND_CHAIN.chainHash, publicKey: DRAND_CHAIN.publicKey } };
    return { timelockEncrypt, timelockDecrypt, Buffer, client: new HttpChainClient(new HttpCachingChain(PROXY_CHAIN_URL, options), options) };
  }).catch(error => { tlockApi = null; throw error; });
  return tlockApi;
}

export type TimeLock = { round: number; ciphertext: Uint8Array };

/**
 * A fresh random secret, sealed with tlock to the round of `unlockMs`. The binary age file is kept without its
 * armor, which only adds base64 and header lines.
 */
export async function lockTimeSecret(unlockMs: number): Promise<{ secret: Uint8Array; lock: TimeLock }> {
  const round = roundAt(unlockMs);
  if (round < 1) throw new Error('Unlock time before drand genesis');
  const { timelockEncrypt, Buffer, client } = await tlock();
  const secret = crypto.getRandomValues(new Uint8Array(TIME_SECRET_BYTES));
  const armored = await timelockEncrypt(round, Buffer.from(secret), client);
  const body = armored.replace(/-----(BEGIN|END) AGE ENCRYPTED FILE-----/g, '').replace(/\s+/g, '');
  return { secret, lock: { round, ciphertext: Uint8Array.from(atob(body), c => c.charCodeAt(0)) } };
}

/** Fetches the beacon for the lock's round and opens the secret; fails before the round is published. */
export async function unlockTimeSecret(lock: TimeLock): Promise<Uint8Array> {
  const { timelockDecrypt, client } = await tlock();
  let binary = '';
  for (const byte of lock.ciphertext) binary += String.fromCharCode(byte);
  const secret = new Uint8Array(await timelockDecrypt(binary, client));
  if (secret.length !== TIME_SECRET_BYTES) throw new Error('Invalid time lock');
  return secret;
}

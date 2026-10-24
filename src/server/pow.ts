// Proof-of-work challenges in the ALTCHA format: the browser finds the number that, appended to the salt, hashes to
// the challenge. Nothing leaves our servers, and every extra challenge a visitor needs within an hour doubles the work.

export interface PowChallenge {
  algorithm: 'SHA-256';
  challenge: string;
  maxnumber: number;
  salt: string;
  signature: string;
}

export interface PowSolution {
  algorithm: string;
  challenge: string;
  number: number;
  salt: string;
  signature: string;
}

export const POW_TTL_MS = 10 * 60 * 1000;
const BASE_MAXNUMBER = 250_000;
const MAX_MAXNUMBER = 64_000_000;
const enc = new TextEncoder();
const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');

export function powDifficulty(challengesThisHour: number): number {
  return Math.min(MAX_MAXNUMBER, BASE_MAXNUMBER * 2 ** Math.max(0, challengesThisHour - 1));
}

async function hmac(secret: string, text: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(`pow:${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(text)));
}

async function sha256(text: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}

function randomBelow(limit: number): number {
  const range = Math.floor(0x100000000 / limit) * limit;
  const value = new Uint32Array(1);
  do { crypto.getRandomValues(value); } while (value[0] >= range);
  return value[0] % limit;
}

export async function createChallenge(secret: string, maxnumber: number, now = Date.now()): Promise<PowChallenge> {
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, '0')).join('');
  const salt = `${nonce}?expires=${Math.floor((now + POW_TTL_MS) / 1000)}`;
  const challenge = await sha256(`${salt}${randomBelow(maxnumber + 1)}`);
  return { algorithm: 'SHA-256', challenge, maxnumber, salt, signature: await hmac(secret, challenge) };
}

export function parseSolution(value: unknown): PowSolution | null {
  if (!value || typeof value !== 'object') return null;
  const s = value as Record<string, unknown>;
  if (s.algorithm !== 'SHA-256' || typeof s.challenge !== 'string' || !/^[0-9a-f]{64}$/.test(s.challenge)) return null;
  if (typeof s.signature !== 'string' || !/^[0-9a-f]{64}$/.test(s.signature)) return null;
  if (typeof s.salt !== 'string' || !/^[0-9a-f]{24}\?expires=\d{10}$/.test(s.salt)) return null;
  if (!Number.isSafeInteger(s.number) || (s.number as number) < 0 || (s.number as number) > MAX_MAXNUMBER) return null;
  return s as unknown as PowSolution;
}

/** Returns the challenge expiry when the solution is genuine and unexpired; the caller still has to refuse reuse. */
export async function verifySolution(secret: string, solution: PowSolution, now = Date.now()): Promise<number | null> {
  const expires = Number(solution.salt.split('?expires=')[1]) * 1000;
  if (!(expires > now) || expires > now + POW_TTL_MS + 60_000) return null;
  const signature = await hmac(secret, solution.challenge);
  let diff = 0;
  for (let i = 0; i < signature.length; i++) diff |= signature.charCodeAt(i) ^ solution.signature.charCodeAt(i);
  if (diff !== 0) return null;
  return (await sha256(`${solution.salt}${solution.number}`)) === solution.challenge ? expires : null;
}

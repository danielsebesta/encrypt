import { createSHA256 } from 'hash-wasm';
import type { PowChallenge, PowSolution } from '../server/pow';

export async function solvePow(challenge: PowChallenge, onProgress: (share: number) => void, signal: AbortSignal): Promise<PowSolution | null> {
  const hasher = await createSHA256();
  for (let number = 0; number <= challenge.maxnumber; number++) {
    hasher.init();
    hasher.update(`${challenge.salt}${number}`);
    if (hasher.digest('hex') === challenge.challenge) {
      onProgress(1);
      return { algorithm: challenge.algorithm, challenge: challenge.challenge, number, salt: challenge.salt, signature: challenge.signature };
    }
    if (number % 20_000 === 0) {
      onProgress(number / challenge.maxnumber);
      await new Promise((resolve) => setTimeout(resolve));
      if (signal.aborted) return null;
    }
  }
  return null;
}

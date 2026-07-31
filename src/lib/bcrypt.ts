import { bcrypt as bcryptWasm, bcryptVerify as bcryptVerifyWasm } from 'hash-wasm';

export async function bcryptHash(text: string, rounds: number = 10): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return bcryptWasm({
    password: text,
    salt,
    costFactor: rounds,
    outputType: 'encoded',
  }) as Promise<string>;
}

export async function bcryptVerify(text: string, hash: string): Promise<boolean> {
  return bcryptVerifyWasm({ password: text, hash });
}

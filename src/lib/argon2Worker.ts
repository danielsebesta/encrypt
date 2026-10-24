import { argon2Raw } from './argon2Core';

type Scope = {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage(message: unknown): void;
};

type Request = { id: number; password: Uint8Array; salt: Uint8Array; memory: number; iterations: number; parallelism: number };

const scope = self as unknown as Scope;
let queue: Promise<void> = Promise.resolve();

function parse(value: unknown): Request | null {
  const request = value as Partial<Request> | null;
  if (!request || typeof request.id !== 'number') return null;
  if (!(request.password instanceof Uint8Array) || !(request.salt instanceof Uint8Array)) return null;
  if (!Number.isInteger(request.memory) || !Number.isInteger(request.iterations) || !Number.isInteger(request.parallelism)) return null;
  return request as Request;
}

async function run({ id, password, salt, memory, iterations, parallelism }: Request) {
  try {
    const hash = await argon2Raw(password, salt, { memory, iterations, parallelism });
    scope.postMessage({ id, hash });
    hash.fill(0);
  } catch (error) {
    scope.postMessage({ id, error: error instanceof Error ? error.message : 'Key derivation failed' });
  } finally {
    password.fill(0);
    salt.fill(0);
  }
}

scope.onmessage = (event: MessageEvent) => {
  const request = parse(event.data);
  if (request) {
    queue = queue.then(() => run(request));
    return;
  }
  const id = (event.data as { id?: unknown } | null)?.id;
  if (typeof id === 'number') scope.postMessage({ id, error: 'Invalid request' });
};

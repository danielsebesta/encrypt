export const MAX_TRANSFER_BYTES = 50 * 1024 * 1024;
export const MAX_UPLOAD_BYTES = 90 * 1024 * 1024;
// First-party ciphertext: the largest upload plus encryption and ZIP overhead, still under the 100 MB request limit.
export const MAX_FIRST_PARTY_BYTES = MAX_UPLOAD_BYTES + 1024 * 1024;
export const SLOW_TRANSFER_TIMEOUT_MS = 120_000;

export async function readLimited(source: Request | Response, limit: number, timeoutMs = 30_000): Promise<Uint8Array> {
  const declared = Number(source.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) {
    await source.body?.cancel();
    throw new Error('Body too large');
  }
  if (!source.body) return new Uint8Array();
  const reader = source.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let expired = false;
  const timer = setTimeout(() => { expired = true; void reader.cancel(); }, timeoutMs);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (expired) throw new Error('Body timeout');
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error('Body too large');
      chunks.push(value);
    }
    const result = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
    return result;
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { clearTimeout(timer); reader.releaseLock(); }
}

export async function readJsonLimited(request: Request, limit = 16384): Promise<any> {
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readLimited(request, limit, 10_000)));
}

export async function mapConcurrent<T, R>(items: T[], count: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(count, items.length) }, async () => {
    while (next < items.length) { const i = next++; results[i] = await fn(items[i]); }
  }));
  return results;
}

export async function fetchNoRedirect(input: string | URL, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(input, { ...init, redirect: 'manual' });
  if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
    await res.body?.cancel().catch(() => {});
    throw new TypeError('Unexpected redirect');
  }
  return res;
}

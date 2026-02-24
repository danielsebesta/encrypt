const WINDOW_MS = 60 * 1000;
const SALT = 'encrypt.click-rate-limit-v1';

const store = new Map<string, { count: number; resetAt: number }>();

function prune() {
  const now = Date.now();
  for (const [key, v] of store.entries()) {
    if (v.resetAt <= now) store.delete(key);
  }
}

async function hashedKey(route: string, request: Request): Promise<string> {
  const raw =
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    '';
  const input = new TextEncoder().encode(SALT + raw);
  const hash = await crypto.subtle.digest('SHA-256', input);
  const hex = Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
  return `${route}:${hex}`;
}

export async function checkRateLimit(
  route: string,
  request: Request,
  limit: number
): Promise<{ ok: boolean; remaining: number; resetIn: number }> {
  const key = await hashedKey(route, request);
  const now = Date.now();

  if (store.size > 10000) prune();

  let entry = store.get(key);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + WINDOW_MS };
    store.set(key, entry);
  }

  entry.count += 1;
  const remaining = Math.max(0, limit - entry.count);
  const ok = entry.count <= limit;
  return { ok, remaining, resetIn: Math.ceil((entry.resetAt - now) / 1000) };
}

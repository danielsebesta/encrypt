import { test } from 'node:test';
import assert from 'node:assert/strict';
import shortener, { SLUG_RE, MAX_TTL_SECONDS, generateSlug, isReceiveLink, type ShortenerEnv } from '../workers/shortener/src/index';
import { shortLinkTtl } from '../src/server/shortLink';
import { formatShareFragment } from '../src/lib/shareLink';
import { roundAt } from '../src/lib/timelock';

const ORIGIN = 'https://encrypt.click';
const LINK = `${ORIGIN}/u/?p=v%3D2%26x%3D1999999999%26p%3DAbc_-1`;

function fakeEnv(overrides: Partial<ShortenerEnv> = {}) {
  const store = new Map<string, { value: string; ttl?: number }>();
  let lookups = 0;
  const env: ShortenerEnv = {
    TARGET_ORIGIN: ORIGIN,
    SHORTENER_TOKEN: 'secret-token',
    URLS: {
      get: (async (key: string) => store.get(key)?.value ?? null) as never,
      put: (async (key: string, value: string, options?: { expirationTtl?: number }) => {
        store.set(key, { value, ttl: options?.expirationTtl });
      }) as never,
    },
    LOOKUPS: { limit: async () => ({ success: ++lookups <= 3 }) },
    ...overrides,
  };
  return { env, store };
}

const create = (env: ShortenerEnv, body: unknown, token = 'secret-token') =>
  shortener.fetch(new Request('https://l.encrypt.click/api/shorten', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  }), env);

test('slugs are eight pronounceable letters and stay uniform', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 2000; i++) {
    const slug = generateSlug();
    assert.match(slug, SLUG_RE);
    seen.add(slug);
  }
  assert.ok(seen.size > 1990);
});

test('only receive links on the target origin are accepted', () => {
  assert.equal(isReceiveLink(LINK, ORIGIN), true);
  assert.equal(isReceiveLink(`${ORIGIN}/u?p=abc`, ORIGIN), true);
  for (const bad of [
    'https://evil.test/u?p=abc', `${ORIGIN}/u?p=abc#key`, `${ORIGIN}/u?p=abc&next=x`, `${ORIGIN}/share?p=abc`,
    `${ORIGIN}/u?p=`, 'https://user:pw@encrypt.click/u?p=abc', 'https://sub.encrypt.click/u?p=abc', 'not a url',
  ]) assert.equal(isReceiveLink(bad, ORIGIN), false, bad);
});

test('creating a short link needs the token and stores it with the clamped ttl', async () => {
  const { env, store } = fakeEnv();
  assert.equal((await create(env, { url: LINK, ttl: 3600 }, 'wrong')).status, 401);
  assert.equal((await create(fakeEnv({ SHORTENER_TOKEN: undefined }).env, { url: LINK, ttl: 3600 }, '')).status, 401);
  assert.equal((await create(env, { url: 'https://evil.test/u?p=x', ttl: 3600 })).status, 400);
  assert.equal((await create(env, { url: LINK })).status, 400);

  const res = await create(env, { url: LINK, ttl: 5 });
  assert.equal(res.status, 201);
  const { short_url } = await res.json() as { short_url: string };
  const slug = new URL(short_url).pathname.slice(1);
  assert.match(slug, SLUG_RE);
  assert.deepEqual(store.get(`s:${slug}`), { value: LINK, ttl: 60 });

  await create(env, { url: LINK, ttl: 10 ** 12 });
  assert.ok([...store.values()].some((entry) => entry.ttl === MAX_TTL_SECONDS));
});

test('opening a short link redirects without caching and is rate limited', async () => {
  const { env, store } = fakeEnv();
  store.set('s:badokemu', { value: LINK });
  const open = (path: string) => shortener.fetch(new Request(`https://l.encrypt.click${path}`, { headers: { 'CF-Connecting-IP': '203.0.113.9' } }), env);

  const hit = await open('/badokemu');
  assert.equal(hit.status, 302);
  assert.equal(hit.headers.get('Location'), LINK);
  assert.equal(hit.headers.get('Cache-Control'), 'no-store');
  assert.equal(hit.headers.get('Referrer-Policy'), 'no-referrer');
  assert.equal(hit.headers.get('Access-Control-Allow-Origin'), null);
  assert.equal((await open('/fumevita')).status, 404);
  assert.equal((await open('/fumevi')).status, 404);
  assert.equal((await open('/api/resolve/badokemu')).status, 404);
  assert.equal((await open('/badokemu')).status, 302);
  assert.equal((await open('/badokemu')).status, 429);
});

test('short links live as long as the share they point to', () => {
  const now = Date.UTC(2026, 10, 20);
  const nowSeconds = now / 1000;
  const fragment = (link: Parameters<typeof formatShareFragment>[0]) => formatShareFragment(link);
  assert.equal(shortLinkTtl(fragment({ payload: 'abc', expires: nowSeconds + 3600 }), now), 3600);
  assert.equal(shortLinkTtl(fragment({ payload: 'abc', expires: nowSeconds - 1 }), now), null);
  assert.equal(shortLinkTtl('abc', now), 7 * 86400);
  const round = roundAt(now + 3 * 86400 * 1000);
  const ttl = shortLinkTtl(fragment({ payload: 'abc', lock: { round, ciphertext: new Uint8Array([1]) } }), now)!;
  assert.ok(Math.abs(ttl - 10 * 86400) <= 3, String(ttl));
  assert.equal(shortLinkTtl('c=capsule', now), null);
});

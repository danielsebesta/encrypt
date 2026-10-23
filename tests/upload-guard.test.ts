import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { ClientLedger, PASS_ALLOWANCE, PASS_TTL_MS, SUSPICION, browserFetch, issuePass, suspicious, verifyPass, type SqlLike } from '../src/lib/uploadPass';
import { handleRequest, type Env, type Reservation } from '../workers/upload/src/handler';

const SECRET = 'test-secret';
const GB = 1000 ** 3;

function sqlite(): SqlLike {
  const db = new DatabaseSync(':memory:');
  return {
    exec(query: string, ...bindings: any[]) {
      const statement = db.prepare(query);
      const rows = /^\s*SELECT/i.test(query) ? statement.all(...bindings) : (statement.run(...bindings), []);
      return { toArray: () => rows };
    },
  };
}

test('a pass verifies only for its client, secret and lifetime', async () => {
  const now = Date.now();
  const { pass, expires } = await issuePass(SECRET, '2001:db8:0:1::/64', now);
  assert.equal(expires, now + PASS_TTL_MS);
  assert.ok(!pass.includes('2001'));
  assert.ok(await verifyPass(pass, SECRET, '2001:db8:0:1::/64', now + 1000));
  assert.equal(await verifyPass(pass, SECRET, '2001:db8:0:2::/64', now), null);
  assert.equal(await verifyPass(pass, 'other-secret', '2001:db8:0:1::/64', now), null);
  assert.equal(await verifyPass(pass, undefined, '2001:db8:0:1::/64', now), null);
  assert.equal(await verifyPass(pass, SECRET, '2001:db8:0:1::/64', expires), null);
  const [v, exp, nonce, mac] = pass.split('.');
  assert.equal(await verifyPass([v, String(Number(exp) + 1000), nonce, mac].join('.'), SECRET, '2001:db8:0:1::/64', now), null);
  assert.equal(await verifyPass(`${pass}x`, SECRET, '2001:db8:0:1::/64', now), null);
  assert.equal(await verifyPass(null, SECRET, '2001:db8:0:1::/64', now), null);
  const future = await issuePass(SECRET, '203.0.113.7', now + 10 * PASS_TTL_MS);
  assert.equal(await verifyPass(future.pass, SECRET, '203.0.113.7', now), null);
});

test('fetch metadata tells our page apart from bare scripts', () => {
  const headers = (init: Record<string, string>) => new Headers(init);
  assert.equal(browserFetch(headers({ 'Sec-Fetch-Site': 'same-site', 'Sec-Fetch-Mode': 'cors' }), ['same-site', 'same-origin']), true);
  assert.equal(browserFetch(headers({ 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'cors' }), ['same-site', 'same-origin']), false);
  assert.equal(browserFetch(headers({ 'Sec-Fetch-Site': 'same-site' }), ['same-site']), false);
  assert.equal(browserFetch(headers({}), ['same-site']), false);
  assert.equal(browserFetch(headers({ 'Sec-Fetch-Site': 'same-site', 'Sec-Fetch-Mode': 'cors' }), ['same-origin']), false);
});

test('suspicion stays out of the way of normal use', () => {
  const calm = { browser: true, hourUploads: 5, dayBytes: 100e6, globalDayBytes: 10 * GB, globalDayCap: 100 * GB };
  assert.equal(suspicious(calm, 90e6), false);
  assert.equal(suspicious({ ...calm, browser: false }, 1), true);
  assert.equal(suspicious({ ...calm, hourUploads: SUSPICION.hourlyUploads }, 1), true);
  assert.equal(suspicious({ ...calm, dayBytes: SUSPICION.clientDayBytes }, 1), true);
  assert.equal(suspicious({ ...calm, globalDayBytes: 50 * GB }, 1), true);
  assert.equal(suspicious({ browser: true, hourUploads: 0, dayBytes: 0, globalDayBytes: 99 * GB }, 1), false);
});

test('the ledger challenges bursts, honours passes within their allowance and keeps the hard cap', () => {
  const ledger = new ClientLedger(sqlite(), 'clients', 5 * GB);
  const now = Date.UTC(2026, 9, 23, 12, 0, 0);
  const base = { client: 'a', bytes: 1000, browser: true, pass: null, now };
  for (let i = 0; i < SUSPICION.hourlyUploads; i++) assert.equal(ledger.charge({ ...base, now: now + i }), 'ok');
  assert.equal(ledger.charge(base), 'challenge');
  assert.equal(ledger.charge({ ...base, client: 'b' }), 'ok');
  assert.equal(ledger.charge({ ...base, pass: 'nonce-1' }), 'ok');
  assert.equal(ledger.charge({ ...base, now: now + 3 * 3600_000 }), 'ok');

  assert.equal(ledger.charge({ ...base, client: 'c', browser: false }), 'challenge');
  assert.equal(ledger.charge({ ...base, client: 'c', browser: false, pass: 'nonce-2' }), 'ok');

  for (let i = 1; i < PASS_ALLOWANCE.uploads; i++) ledger.add({ ...base, client: 'd', pass: 'nonce-3' });
  assert.equal(ledger.charge({ ...base, client: 'd', browser: false, pass: 'nonce-3' }), 'ok');
  assert.equal(ledger.charge({ ...base, client: 'd', browser: false, pass: 'nonce-3' }), 'challenge');

  assert.equal(ledger.charge({ ...base, client: 'e', bytes: 4 * GB, pass: 'nonce-4' }), 'challenge');
  ledger.add({ ...base, client: 'e', bytes: 4.5 * GB });
  assert.equal(ledger.charge({ ...base, client: 'e', bytes: GB, pass: 'nonce-5' }), 'client');
  ledger.release('e', 4 * GB, now);
  assert.equal(ledger.charge({ ...base, client: 'e', bytes: 100e6 }), 'ok');

  assert.equal(ledger.charge({ ...base, client: 'f', globalDayBytes: 60 * GB, globalDayCap: 100 * GB }), 'challenge');
  assert.equal(ledger.charge({ ...base, client: 'f', globalDayBytes: 60 * GB, globalDayCap: 100 * GB, pass: 'nonce-6' }), 'ok');
});

test('the hourly count slides instead of resetting on the hour', () => {
  const ledger = new ClientLedger(sqlite(), 'relay', 2 * GB);
  const hourStart = Date.UTC(2026, 9, 23, 12, 0, 0);
  for (let i = 0; i < 40; i++) ledger.add({ client: 'a', bytes: 1, browser: true, pass: null, now: hourStart + 3500_000 });
  const base = { client: 'a', bytes: 1, browser: true, pass: null };
  assert.equal(ledger.check({ ...base, now: hourStart + 3600_000 + 60_000 }), 'challenge');
  assert.equal(ledger.check({ ...base, now: hourStart + 3600_000 + 3000_000 }), 'ok');
});

function fakeEnv(reservation: Reservation, extra: Partial<Env> = {}) {
  const calls = { reserve: [] as any[], release: [] as any[], stored: [] as number[] };
  const budget = {
    reserve: async (...args: any[]) => { calls.reserve.push(args); return reservation; },
    release: async (...args: any[]) => { calls.release.push(args); },
    status: async () => ({ available: true }),
  };
  const env = {
    BUDGET: { idFromName: () => 'id', get: () => budget },
    BUCKET: {
      put: async (_key: string, stream: ReadableStream<Uint8Array>) => {
        let size = 0;
        for await (const chunk of stream) size += chunk.length;
        calls.stored.push(size);
      },
    },
    ...extra,
  } as unknown as Env;
  return { env, calls };
}

const configured = { UPLOAD_PASS_SECRET: SECRET, TURNSTILE_SITE_KEY: 'site-key', TURNSTILE_SECRET_KEY: 'turnstile-secret' };
const envelope = (size = 64) => {
  const body = new Uint8Array(size);
  body.set([69, 67, 76, 75, 69, 67, 80, 50, 0, 9, 39, 192]);
  return body;
};

function upload(body: Uint8Array, headers: Record<string, string> = {}) {
  return new Request('https://upload.encrypt.click/', {
    method: 'POST',
    body: body as BodyInit,
    headers: { Origin: 'https://encrypt.click', 'Content-Length': String(body.length), 'CF-Connecting-IP': '2001:db8:0:1::5', 'Sec-Fetch-Site': 'same-site', 'Sec-Fetch-Mode': 'cors', ...headers },
  });
}

(globalThis as any).FixedLengthStream ??= class extends TransformStream<Uint8Array, Uint8Array> {
  constructor(_length: number) { super(); }
};

test('preflight allows the pass header for the main site only', async () => {
  const res = await handleRequest(new Request('https://upload.encrypt.click/', { method: 'OPTIONS' }), fakeEnv('ok').env);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://encrypt.click');
  assert.match(res.headers.get('Access-Control-Allow-Headers') ?? '', /X-Upload-Pass/);
});

test('suspicious uploads get a Turnstile challenge when it is configured and a 429 otherwise', async () => {
  const challenged = await handleRequest(upload(envelope()), fakeEnv('challenge', configured).env);
  assert.equal(challenged.status, 428);
  assert.deepEqual(await challenged.json(), { challenge: 'turnstile' });
  assert.equal(challenged.headers.get('Access-Control-Allow-Origin'), 'https://encrypt.click');

  const limited = await handleRequest(upload(envelope()), fakeEnv('challenge').env);
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('Retry-After'), '3600');
  assert.equal(limited.headers.get('Access-Control-Allow-Origin'), 'https://encrypt.click');

  const capped = await handleRequest(upload(envelope()), fakeEnv('client', configured).env);
  assert.equal(capped.status, 429);
  assert.ok(Number(capped.headers.get('Retry-After')) > 0);
});

test('the worker passes browser signals and a verified pass to the budget', async () => {
  const { pass } = await issuePass(SECRET, '2001:db8:0:1::/64');
  const { env, calls } = fakeEnv('ok', configured);
  const res = await handleRequest(upload(envelope(), { 'X-Upload-Pass': pass, 'CF-Connecting-IP': '2001:db8:0:1:aaaa::9' }), env);
  assert.equal(res.status, 200);
  assert.deepEqual(calls.reserve[0][2], { browser: true, pass: pass.split('.')[2] });
  assert.deepEqual(calls.stored, [64]);

  const { env: scriptEnv, calls: scriptCalls } = fakeEnv('ok', configured);
  await handleRequest(upload(envelope(), { 'X-Upload-Pass': pass, 'CF-Connecting-IP': '2001:db8:0:2::1', 'Sec-Fetch-Site': '', 'Sec-Fetch-Mode': '' }), scriptEnv);
  assert.deepEqual(scriptCalls.reserve[0][2], { browser: false, pass: null });
});

test('only password envelopes and stego PNGs are stored', async () => {
  const png = new Uint8Array(64);
  png.set([69, 67, 76, 75, 137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal((await handleRequest(upload(png), fakeEnv('ok').env)).status, 200);

  const other = new Uint8Array(64);
  other.set([69, 67, 76, 75, 1, 2, 3, 4, 5, 6, 7, 8]);
  const { env, calls } = fakeEnv('ok');
  const res = await handleRequest(upload(other), env);
  assert.equal(res.status, 400);
  assert.equal(calls.release.length, 1);
  assert.equal(calls.stored.length, 0);
});

test('the challenge page exists only when configured and is locked to Turnstile and the main site', async () => {
  const missing = await handleRequest(new Request('https://upload.encrypt.click/challenge'), fakeEnv('ok').env);
  assert.equal(missing.status, 404);

  const page = await handleRequest(new Request('https://upload.encrypt.click/challenge?lang=cs&theme=dark&size=compact'), fakeEnv('ok', configured).env);
  assert.equal(page.status, 200);
  const csp = page.headers.get('Content-Security-Policy') ?? '';
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /script-src 'nonce-[0-9a-f]+' https:\/\/challenges\.cloudflare\.com;/);
  assert.match(csp, /frame-src https:\/\/challenges\.cloudflare\.com;/);
  assert.match(csp, /frame-ancestors https:\/\/encrypt\.click$/);
  const html = await page.text();
  assert.match(html, /"language":"cs"/);
  assert.match(html, /"size":"compact"/);
  assert.match(html, /postMessage\(message, origin\)/);
  assert.match(html, /const origin = "https:\/\/encrypt\.click"/);

  const injected = await handleRequest(new Request('https://upload.encrypt.click/challenge?lang=%3C/script%3E'), fakeEnv('ok', configured).env);
  assert.doesNotMatch(await injected.text(), /<\/script><\/script>/);
});

test('a solved challenge returns a pass bound to the solver\'s /64', async () => {
  const realFetch = globalThis.fetch;
  const sent: FormData[] = [];
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    sent.push(init.body as FormData);
    return Response.json({ success: true, action: 'upload', hostname: 'upload.encrypt.click' });
  }) as typeof fetch;
  try {
    const verify = (headers: Record<string, string>) => handleRequest(new Request('https://upload.encrypt.click/challenge/verify', {
      method: 'POST',
      body: JSON.stringify({ token: 'tok' }),
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '2001:db8:0:1::5', ...headers },
    }), fakeEnv('ok', configured).env);

    assert.equal((await verify({ Origin: 'https://evil.example' })).status, 403);
    const res = await verify({ Origin: 'https://upload.encrypt.click' });
    assert.equal(res.status, 200);
    assert.equal(sent[0].get('secret'), 'turnstile-secret');
    assert.equal(sent[0].get('remoteip'), '2001:db8:0:1::5');
    const { pass } = await res.json() as { pass: string };
    assert.ok(await verifyPass(pass, SECRET, '2001:db8:0:1::/64'));

    globalThis.fetch = (async () => Response.json({ success: true, action: 'upload', hostname: 'elsewhere.example' })) as unknown as typeof fetch;
    assert.equal((await verify({ Origin: 'https://upload.encrypt.click' })).status, 403);
  } finally {
    globalThis.fetch = realFetch;
  }
});

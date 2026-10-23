import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clientPrefix, routingPath } from '../src/lib/httpLimits';
import { sameOriginTarget } from '../src/lib/locale';
import { ReplayWindow } from '../src/lib/roomAccess';
import { DocPartAssembler, splitDocUpdate } from '../src/lib/whiteboardSync';
import { ghostFetch, isBareSendUrl, isSendUrl, SEND_AUTH_KEY_HEADER, validSendAuthKey } from '../src/lib/nologSend';
import { GET as fetchFile } from '../src/pages/api/ghost/fetch';

test('rate limit keys group an IPv6 /64 and leave IPv4 alone', () => {
  assert.equal(clientPrefix('203.0.113.7'), '203.0.113.7');
  assert.equal(clientPrefix('2001:db8:0:1::ff'), '2001:db8:0:1::/64');
  assert.equal(clientPrefix('2001:0db8:0000:0001:aaaa:bbbb:cccc:dddd'), '2001:db8:0:1::/64');
  assert.equal(clientPrefix('2001:db8:0:1:1:2:3:4'), clientPrefix('2001:db8:0:1:ffff::1'));
  assert.notEqual(clientPrefix('2001:db8:0:1::1'), clientPrefix('2001:db8:0:2::1'));
});

test('worker guards see the same decoded path Astro routes on', () => {
  assert.equal(routingPath('/%61pi/ghost/fetch'), '/api/ghost/fetch');
  assert.equal(routingPath('/%2561pi/shorten'), '/api/shorten');
  assert.equal(routingPath('//api//turn'), '/api/turn');
  assert.equal(routingPath('/chat/abc'), '/chat/abc');
  assert.equal(routingPath('/%E0%A4%A'), null);
});

test('language choice only continues to same-origin paths', () => {
  const origin = 'https://encrypt.click';
  assert.equal(sameOriginTarget('/cs/tools/hmac?x=1', origin), 'https://encrypt.click/cs/tools/hmac?x=1');
  for (const evil of ['/\t/evil.tld', '/\n/evil.tld', '//evil.tld', '/\\evil.tld', 'https://evil.tld', 'javascript:alert(1)', null]) {
    assert.equal(sameOriginTarget(evil, origin), 'https://encrypt.click/', String(evil));
  }
  assert.equal(sameOriginTarget('/u/#secret', origin), 'https://encrypt.click/u/');
});

test('replay window evicts the oldest entries instead of refusing everything', () => {
  const replay = new ReplayWindow(3);
  for (const v of ['a', 'b', 'c', 'd']) assert.equal(replay.accept(v), true);
  assert.equal(replay.accept('d'), false);
  assert.equal(replay.accept('a'), true);
});

test('one sender cannot stall large-board sync for everyone', () => {
  const asm = new DocPartAssembler();
  const parts = Array.from({ length: 10 }, () => splitDocUpdate(new Uint8Array(600), 300)!);
  for (const p of parts) assert.ok(asm.accept('attacker', p[0]));
  const honest = splitDocUpdate(new Uint8Array(600), 300)!;
  assert.ok(asm.accept('honest', honest[0]));
  assert.ok(asm.accept('honest', honest[1])?.update);
});

test('Send content keys stay in the browser on download', async () => {
  const url = 'https://upload.nolog.cz/download/0123456789abcdef/#c2VjcmV0c2VjcmV0c2VjcmV0';
  assert.equal(isSendUrl(url), true);
  assert.equal(isBareSendUrl(url), false);
  assert.equal(isBareSendUrl(url.slice(0, url.indexOf('#'))), true);

  const original = globalThis.fetch;
  const seen: { url: string; headers: Headers }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push({ url: String(input), headers: new Headers(init?.headers) });
    return new Response('x');
  }) as typeof fetch;
  try {
    await ghostFetch(url);
  } finally { globalThis.fetch = original; }
  assert.equal(seen.length, 1);
  assert.ok(!decodeURIComponent(seen[0].url).includes('#'));
  assert.ok(!seen[0].url.includes('c2VjcmV0'));
  const authKey = seen[0].headers.get(SEND_AUTH_KEY_HEADER);
  assert.equal(validSendAuthKey(authKey), true);
  assert.notEqual(authKey, 'c2VjcmV0c2VjcmV0c2VjcmV0');
});

test('download proxy signs Send requests with the forwarded auth key only', async () => {
  const bare = 'https://upload.nolog.cz/download/0123456789abcdef/';
  const authKey = 'A'.repeat(86);
  const original = globalThis.fetch;
  const upstream: Headers[] = [];
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    upstream.push(new Headers(init?.headers));
    return new Response(new Uint8Array([1, 2, 3]));
  }) as typeof fetch;
  try {
    const url = new URL(`https://encrypt.click/api/ghost/fetch?url=${encodeURIComponent(bare)}`);
    const response = await fetchFile({ url, request: new Request(url, { headers: { [SEND_AUTH_KEY_HEADER]: authKey } }) } as any);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('X-Send-Encrypted'), 'true');
  } finally { globalThis.fetch = original; }
  assert.match(upstream[0].get('Authorization') ?? '', /^send-v1 /);
});

test('a forwarded auth key signs Send challenges exactly like the full secret', async () => {
  const secretB64 = 'c2VjcmV0c2VjcmV0c2VjcmV0';
  const url = `https://upload.nolog.cz/download/0123456789abcdef/#${secretB64}`;
  const original = globalThis.fetch;
  let authKey = '';
  let upstreamAuth = '';
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    if (String(input).startsWith('/api/')) authKey = headers.get(SEND_AUTH_KEY_HEADER) ?? '';
    else upstreamAuth = headers.get('Authorization') ?? '';
    return new Response(new Uint8Array([1]));
  }) as typeof fetch;
  try {
    await ghostFetch(url);
    const proxyUrl = new URL(`https://encrypt.click/api/ghost/fetch?url=${encodeURIComponent(url.slice(0, url.indexOf('#')))}`);
    await fetchFile({ url: proxyUrl, request: new Request(proxyUrl, { headers: { [SEND_AUTH_KEY_HEADER]: authKey } }) } as any);
  } finally { globalThis.fetch = original; }

  const raw = Uint8Array.from(atob(secretB64), (c) => c.charCodeAt(0));
  const ikm = await crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey']);
  const hmac = await crypto.subtle.deriveKey({ name: 'HKDF', salt: new Uint8Array(), info: new TextEncoder().encode('authentication'), hash: 'SHA-256' },
    ikm, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const nonce = Uint8Array.from(atob('yRCdyQ1EMSA3mo4rqSkuNQ=='), (c) => c.charCodeAt(0));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', hmac, nonce));
  const expected = `send-v1 ${btoa(String.fromCharCode(...sig)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')}`;
  assert.equal(upstreamAuth, expected);
});

test('room keys are bound to the room mode so a server cannot switch it', async () => {
  const { deriveRoomKey, deriveKeyFromPassword, encryptMessage, decryptMessage } = await import('../src/lib/chatCrypto');
  const live = await deriveRoomKey('Kyber-Zebra-Moth-Lamp-Fern42', 'room', 'live');
  const burn = await deriveRoomKey('Kyber-Zebra-Moth-Lamp-Fern42', 'room', 'ttl-10');
  const legacy = await deriveKeyFromPassword('Kyber-Zebra-Moth-Lamp-Fern42', 'room');
  const sealed = await encryptMessage(burn, 'hello');
  assert.equal(await decryptMessage(await deriveRoomKey('Kyber-Zebra-Moth-Lamp-Fern42', 'room', 'ttl-10'), sealed), 'hello');
  await assert.rejects(decryptMessage(live, sealed));
  await assert.rejects(decryptMessage(legacy, sealed));
});

test('link shortening is off unless configured and only wraps receive links on this site', async () => {
  const { POST } = await import('../src/pages/api/shorten');
  const { setRuntimeEnv } = await import('../src/platform/env');
  const call = (url: string) => POST({ request: new Request('https://self.example/api/shorten', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) }) } as any);
  setRuntimeEnv({});
  assert.equal((await call('https://self.example/u/?p=abc')).status, 404);
  setRuntimeEnv({ SHORTENER_URL: 'https://short.example/api/shorten' });
  assert.equal((await call('https://other.example/u/?p=abc')).status, 400);
  assert.equal((await call('https://self.example/chat/x?p=abc')).status, 400);
  const original = globalThis.fetch;
  globalThis.fetch = (async () => Response.json({ short_url: 'https://short.example/xyz' })) as typeof fetch;
  try {
    const res = await call('https://self.example/u/?p=abc');
    assert.equal(res.status, 200);
    assert.equal((await res.json() as { shorturl: string }).shorturl, 'https://short.example/xyz');
  } finally {
    globalThis.fetch = original;
    setRuntimeEnv({});
  }
});

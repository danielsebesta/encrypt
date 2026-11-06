import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encryptPushPayload, generateVapidKeys, isPushEndpoint, normalizePushTarget, readVapidKeys, vapidAuthorization } from '../src/lib/webPush';

function b64url(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(Buffer.from(value, 'base64url'));
}

test('only the push services browsers ship with are accepted as endpoints', () => {
  assert.equal(isPushEndpoint('https://fcm.googleapis.com/fcm/send/abc'), true);
  assert.equal(isPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/abc'), true);
  assert.equal(isPushEndpoint('https://web.push.apple.com/abc'), true);
  assert.equal(isPushEndpoint('https://par02p.notify.windows.com/w/?token=abc'), true);
  assert.equal(isPushEndpoint('http://fcm.googleapis.com/fcm/send/abc'), false);
  assert.equal(isPushEndpoint('https://evil.example/fcm.googleapis.com'), false);
  assert.equal(isPushEndpoint('https://fcm.googleapis.com.evil.example/x'), false);
  assert.equal(isPushEndpoint('https://user:pw@fcm.googleapis.com/x'), false);
  assert.equal(isPushEndpoint('https://fcm.googleapis.com:8443/x'), false);
  assert.equal(isPushEndpoint('https://127.0.0.1/x'), false);
  assert.equal(isPushEndpoint(`https://fcm.googleapis.com/${'a'.repeat(1100)}`), false);
  assert.equal(isPushEndpoint(42), false);
});

test('push stays off unless both VAPID keys are valid', async () => {
  const keys = await generateVapidKeys();
  assert.equal(readVapidKeys({}), null);
  assert.equal(readVapidKeys({ VAPID_PUBLIC_KEY: keys.publicKey }), null);
  assert.equal(readVapidKeys({ VAPID_PUBLIC_KEY: 'short', VAPID_PRIVATE_KEY: keys.privateKey }), null);
  const read = readVapidKeys({ VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey, VAPID_SUBJECT: 'https://encrypt.click' });
  assert.equal(read?.subject, 'https://encrypt.click');
});

test('the VAPID header carries a signature the public key verifies', async () => {
  const keys = await generateVapidKeys();
  const vapid = readVapidKeys({ VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey })!;
  const endpoint = 'https://fcm.googleapis.com/fcm/send/abc';
  const header = await vapidAuthorization(endpoint, vapid, 1_700_000_000_000);
  const match = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(header);
  assert.ok(match);
  assert.equal(match[4], keys.publicKey);
  const claims = JSON.parse(Buffer.from(match[2], 'base64url').toString());
  assert.equal(claims.aud, 'https://fcm.googleapis.com');
  assert.equal(claims.exp, 1_700_000_000 + 12 * 60 * 60);
  const raw = b64url(keys.publicKey);
  const publicKey = await crypto.subtle.importKey('raw', raw, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, b64url(match[3]), new TextEncoder().encode(`${match[1]}.${match[2]}`));
  assert.equal(valid, true);
  assert.equal(raw.length, 65);
});

const b64u = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');

async function uaOpen(body: Uint8Array<ArrayBuffer>, uaKeys: CryptoKeyPair, uaPublic: Uint8Array<ArrayBuffer>, auth: Uint8Array<ArrayBuffer>): Promise<string> {
  const salt = body.slice(0, 16);
  const rs = new DataView(body.buffer, body.byteOffset).getUint32(16);
  const idlen = body[20];
  const asPublic = body.slice(21, 21 + idlen);
  const sealed = body.slice(21 + idlen);
  assert.equal(rs, 4096);
  const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, uaKeys.privateKey, 256));
  const hk = async (s: Uint8Array<ArrayBuffer>, ikm: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, n: number) => new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: s, info }, await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']), n * 8));
  const enc = new TextEncoder();
  const ikm = await hk(auth, shared, new Uint8Array([...enc.encode('WebPush: info\0'), ...uaPublic, ...asPublic]), 32);
  const cek = await hk(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hk(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']), sealed));
  assert.equal(plain.at(-1), 2);
  return new TextDecoder().decode(plain.slice(0, -1));
}

test('push payloads are RFC 8291 encrypted to the device keys only', async () => {
  const ua = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  const uaPublic = new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const body = await encryptPushPayload(new TextEncoder().encode('{"t":"abcdefghijklmnopqrstuv"}'), b64u(uaPublic), b64u(auth));
  assert.ok(!Buffer.from(body).toString('latin1').includes('abcdefghij'));
  assert.equal(await uaOpen(body, ua, uaPublic, auth), '{"t":"abcdefghijklmnopqrstuv"}');
  const other = crypto.getRandomValues(new Uint8Array(16));
  await assert.rejects(uaOpen(body, ua, uaPublic, other));
  await assert.rejects(encryptPushPayload(new Uint8Array(4), 'x'.repeat(87), b64u(auth)));
});

test('stored push targets keep keys only when the whole set is valid', () => {
  const endpoint = 'https://fcm.googleapis.com/fcm/send/abc';
  assert.deepEqual(normalizePushTarget(endpoint), { endpoint });
  assert.equal(normalizePushTarget('https://evil.example/x'), null);
  assert.equal(normalizePushTarget({ endpoint: 'https://evil.example/x', tag: 'a'.repeat(22) }), null);
  const full = { endpoint, tag: 'A'.repeat(22), p256dh: 'B'.repeat(87), auth: 'C'.repeat(22) };
  assert.deepEqual(normalizePushTarget({ ...full, extra: 1 }), full);
  assert.deepEqual(normalizePushTarget({ ...full, tag: 'short' }), { endpoint });
  assert.deepEqual(normalizePushTarget({ ...full, auth: 'C'.repeat(21) }), { endpoint });
});

test('push encryption matches the RFC 8291 appendix A vector', async () => {
  const asPublic = Buffer.from('BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8', 'base64url');
  const jwk = { kty: 'EC', crv: 'P-256', d: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw', x: b64u(asPublic.subarray(1, 33)), y: b64u(asPublic.subarray(33, 65)) };
  const privateKey = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const publicKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, true, []);
  const body = await encryptPushPayload(
    new TextEncoder().encode('When I grow up, I want to be a watermelon'),
    'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
    'BTBZMqHH6r4Tts7J_aSIgg',
    { local: { privateKey, publicKey }, salt: new Uint8Array(Buffer.from('DGv6ra1nlYgDCS1FRnbzlw', 'base64url')) },
  );
  assert.equal(b64u(body), 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN');
});

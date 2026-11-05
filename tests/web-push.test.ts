import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateVapidKeys, isPushEndpoint, readVapidKeys, vapidAuthorization } from '../src/lib/webPush';

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

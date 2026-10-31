import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTransientUploadStatus, sendWithUploadPass } from '../src/lib/firstPartyUpload';

test('transient upload statuses cover rate limits and gateway blips', () => {
  assert.equal(isTransientUploadStatus(429), true);
  assert.equal(isTransientUploadStatus(502), true);
  assert.equal(isTransientUploadStatus(503), true);
  assert.equal(isTransientUploadStatus(504), true);
  assert.equal(isTransientUploadStatus(428), false);
  assert.equal(isTransientUploadStatus(500), false);
  assert.equal(isTransientUploadStatus(200), false);
});

test('sendWithUploadPass retries 503 then succeeds', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    if (calls < 3) return new Response('Service Unavailable', { status: 503, headers: { 'Retry-After': '0' } });
    return Response.json({ success: true });
  }) as typeof fetch;
  try {
    const res = await sendWithUploadPass('/upload', { method: 'POST', body: '{}' }, {});
    assert.equal(res.status, 200);
    assert.equal(calls, 3);
    assert.deepEqual(await res.json(), { success: true });
  } finally {
    globalThis.fetch = original;
  }
});

test('sendWithUploadPass gives up after repeated 503s', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return new Response('Service Unavailable', { status: 503, headers: { 'Retry-After': '0' } });
  }) as typeof fetch;
  try {
    const res = await sendWithUploadPass('/upload/x/1', { method: 'PUT', body: 'x' }, {});
    assert.equal(res.status, 503);
    assert.equal(calls, 7);
  } finally {
    globalThis.fetch = original;
  }
});

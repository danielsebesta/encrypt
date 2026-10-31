import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import type { SqlLike } from '../src/lib/uploadPass';
import { createApp } from '../src/server/app';
import { runBudgetCommand } from '../src/server/budget';
import { turnProviders } from '../src/server/status';
import type { BlobStore, Platform } from '../src/platform/types';

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

const blobs: BlobStore = {
  async put(_id, body) { await new Response(body).arrayBuffer(); },
  async get() { return null; },
  async delete() {},
  async beginMultipart() {},
  async putPart(_id, _index, body) { await new Response(body).arrayBuffer(); },
  async completeMultipart() {},
};

function app(env: Record<string, string> = {}, extra: Partial<Platform> = {}) {
  const scopes = new Map<string, SqlLike>();
  return createApp({
    env: { UPLOAD_PASS_SECRET: 'secret', ...env },
    clientIp: () => '203.0.113.9',
    budget: async <T>(scope: string, command: any) => {
      if (!scopes.has(scope)) scopes.set(scope, sqlite());
      return runBudgetCommand(scopes.get(scope)!, command) as T;
    },
    blobs,
    realtime: async () => new Response('', { status: 426 }),
    waitUntil: () => {},
    ...extra,
  });
}

const render = async () => new Response('page');
const browser = { 'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Mode': 'cors' };
const status = (headers: Record<string, string> = {}, method = 'GET') => new Request('https://example.test/status', { method, headers });

test('status reports upload usage against the quotas and nothing about clients', async () => {
  const site = app({ UPLOAD_DAILY_GB: '2' }, { build: 'abc123', startedAt: Date.now() - 90_000 });
  const body = new Uint8Array(500);
  body.set([69, 67, 76, 75, 69, 67, 80, 51, 1]);
  const upload = await site.fetch(new Request('https://example.test/upload', {
    method: 'POST', body, headers: { ...browser, 'Content-Length': '500', 'X-Upload-Retention': '7d' },
  }), render);
  assert.equal(upload.status, 200);

  const res = await site.fetch(status(), render);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  const json = await res.json() as any;
  assert.deepEqual(Object.keys(json).sort(), ['build', 'status', 'turn', 'uploads', 'uptimeSeconds']);
  assert.equal(json.status, 'ok');
  assert.equal(json.build, 'abc123');
  assert.ok(json.uptimeSeconds >= 90 && json.uptimeSeconds < 100);
  assert.deepEqual(json.turn, { configured: false, providers: [] });
  assert.deepEqual(json.uploads.today, { bytes: 3500, uploads: 1 });
  assert.deepEqual(json.uploads.month, { bytes: 3500, uploads: 1 });
  assert.equal(json.uploads.limits.dailyBytes, 2e9);
  assert.equal(json.uploads.available, true);
  assert.doesNotMatch(JSON.stringify(json), /203\.0\.113|client"/);

  const pub = await (await site.fetch(new Request('https://example.test/upload/status', { headers: browser }), render)).json();
  assert.deepEqual(Object.keys(pub as object).sort(), ['available', 'maxFileSize']);
  assert.equal((await site.fetch(status({}, 'POST'), render)).status, 405);
});

test('a status token is required when one is set', async () => {
  const site = app({ STATUS_TOKEN: 'operator-token' });
  assert.equal((await site.fetch(status(), render)).status, 401);
  assert.equal((await site.fetch(status({ Authorization: 'Bearer wrong' }), render)).status, 401);
  assert.equal((await site.fetch(status({ Authorization: 'operator-token' }), render)).status, 401);
  const ok = await site.fetch(status({ Authorization: 'Bearer operator-token' }), render);
  assert.equal(ok.status, 200);
  assert.equal(((await ok.json()) as any).build, null);
});

test('status goes through the cross-site and rate-limit guards', async () => {
  const site = app();
  assert.equal((await site.fetch(status({ 'Sec-Fetch-Site': 'cross-site' }), render)).status, 403);
  let last = 0;
  for (let i = 0; i < 31; i++) last = (await site.fetch(status(), render)).status;
  assert.equal(last, 429);
  assert.equal((await site.fetch(new Request('https://example.test/STATUS'), render)).status, 404);
});

test('TURN counts as configured by the same settings /api/turn reads', () => {
  assert.deepEqual(turnProviders({}), []);
  assert.deepEqual(turnProviders({ TURN_PROVIDER: 'cloudflare', CLOUDFLARE_TURN_TOKEN_ID: 'id', CLOUDFLARE_TURN_API_TOKEN: 'token' }), ['cloudflare']);
  assert.deepEqual(turnProviders({ TURN_PROVIDER: 'cloudflare', TURN_AUTH_SECRET: 's', TURN_HOST: 'turn.example' }), []);
  assert.deepEqual(turnProviders({ TURN_AUTH_SECRET: 's', TURN_URLS: 'turn:turn.example:3478' }), ['coturn']);
  assert.deepEqual(turnProviders({ TURN_AUTH_SECRET: 's', TURN_URLS: 'https://nope' }), []);
});

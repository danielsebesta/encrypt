import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { FileBlobStore } from '../src/adapters/node/blobs';
import { BLOB_ID_RE, RETENTION_MS, blobId, retentionDays, retentionForUnlock, retentionOfId, uuidOfId, latestUploadUnlock, UNLOCK_MARGIN_MS } from '../src/lib/retention';
import { formatShareFragment, parseShareFragment } from '../src/lib/shareLink';
import type { SqlLike } from '../src/lib/uploadPass';
import { createApp } from '../src/server/app';
import { runBudgetCommand } from '../src/server/budget';
import { uploadOptions } from '../src/server/upload';
import type { BlobMeta, BlobStore, Platform } from '../src/platform/types';

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const dirs: string[] = [];
after(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });

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

function memoryBlobs(clock: () => number) {
  const stored = new Map<string, { bytes: Uint8Array; meta: BlobMeta }>();
  const blobs: BlobStore = {
    async put(id, body, size, meta) {
      const bytes = new Uint8Array(await new Response(body).arrayBuffer());
      if (bytes.length !== size) throw new Error('size mismatch');
      stored.set(id, { bytes, meta });
    },
    async get(id) {
      const entry = stored.get(id);
      return entry ? { body: new Blob([entry.bytes as BlobPart]).stream(), size: entry.bytes.length, uploaded: clock(), ...entry.meta } : null;
    },
    async delete(id) { stored.delete(id); },
  };
  return { blobs, stored };
}

function setup() {
  const scopes = new Map<string, SqlLike>();
  const background: Promise<unknown>[] = [];
  const { blobs, stored } = memoryBlobs(Date.now);
  const platform: Platform = {
    env: { UPLOAD_PASS_SECRET: 'secret' },
    clientIp: () => '2001:db8:0:1::5',
    budget: async <T>(scope: string, command: any) => {
      if (!scopes.has(scope)) scopes.set(scope, sqlite());
      return runBudgetCommand(scopes.get(scope)!, command) as T;
    },
    blobs,
    realtime: async () => new Response('', { status: 426 }),
    waitUntil: work => { background.push(work); },
  };
  return { app: createApp(platform), platform, stored, background, scopes };
}

const render = async () => new Response('page');
const browser = { 'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Mode': 'cors' };
const envelope = (size = 64) => {
  const body = new Uint8Array(size);
  body.set([69, 67, 76, 75, 69, 67, 80, 51, 1]);
  return body;
};
const upload = (body: Uint8Array, headers: Record<string, string> = {}) =>
  new Request('https://example.test/upload', { method: 'POST', body: body as BodyInit, headers: { ...browser, 'Content-Length': String(body.length), ...headers } });
const download = (id: string, method = 'GET') => new Request(`https://example.test/dl/${id}`, { method, headers: browser });

test('retention classes map to ids, weights and unlock windows', () => {
  const uuid = crypto.randomUUID();
  assert.equal(blobId('1d', uuid), uuid);
  assert.equal(blobId('7d', uuid), `t7d-${uuid}`);
  for (const retention of ['1h', '1d', '7d'] as const) {
    const id = blobId(retention, uuid);
    assert.ok(BLOB_ID_RE.test(id));
    assert.equal(retentionOfId(id), retention);
    assert.equal(uuidOfId(id), uuid);
  }
  assert.equal(BLOB_ID_RE.test(`t1d-${uuid}`), false);
  assert.equal(BLOB_ID_RE.test(`t7d/${uuid}`), false);
  assert.deepEqual([retentionDays('1h'), retentionDays('1d'), retentionDays('7d')], [1, 1, 7]);

  const now = Date.UTC(2026, 9, 31, 12);
  assert.equal(retentionForUnlock('1h', null, now), '1h');
  assert.equal(retentionForUnlock('1h', now + 10 * 60_000, now), '1d');
  assert.equal(retentionForUnlock('1d', now + 2 * DAY, now), '7d');
  assert.equal(retentionForUnlock('7d', now + HOUR, now), '7d');
  assert.equal(retentionForUnlock('1d', latestUploadUnlock(now), now), '7d');
  assert.equal(retentionForUnlock('1d', latestUploadUnlock(now) + 1, now), null);
  assert.equal(latestUploadUnlock(now), now + RETENTION_MS['7d'] - UNLOCK_MARGIN_MS);
});

test('upload options default to one day and many downloads and reject anything else', () => {
  assert.deepEqual(uploadOptions(new Headers()), { retention: '1d', burn: false });
  assert.deepEqual(uploadOptions(new Headers({ 'X-Upload-Retention': '7d', 'X-Upload-Burn': '1' })), { retention: '7d', burn: true });
  assert.equal(uploadOptions(new Headers({ 'X-Upload-Retention': '30d' })), null);
  assert.equal(uploadOptions(new Headers({ 'X-Upload-Burn': 'yes' })), null);
});

test('share links keep version 1 and carry expiry and one-time flags in version 2', () => {
  assert.equal(formatShareFragment({ payload: 'abc_-' }), 'abc_-');
  assert.deepEqual(parseShareFragment('abc_-'), { payload: 'abc_-' });
  const fragment = formatShareFragment({ payload: 'abc', expires: 1_800_000_000, burn: true });
  assert.equal(fragment, 'v=2&x=1800000000&b=1&p=abc');
  assert.deepEqual(parseShareFragment(fragment), { payload: 'abc', expires: 1_800_000_000, burn: true });
  assert.deepEqual(parseShareFragment('v=2&x=1800000000&p=abc'), { payload: 'abc', expires: 1_800_000_000 });
  for (const bad of ['', 'v=3&p=abc', 'v=2&x=1', 'v=2&p=a+b', 'v=2&x=abc&p=abc', 'v=2&b=2&p=abc', 'v=2&p=abc&p=abd', 'v=2&x=99999999999999&p=abc', 'v=2&=1&p=abc']) {
    assert.equal(parseShareFragment(bad), null, bad);
  }
  assert.throws(() => formatShareFragment({ payload: 'a b' }));
});

test('an upload is kept for its class, charged per day kept, and gone after its expiry', async () => {
  const { app, stored, scopes } = setup();
  const res = await app.fetch(upload(envelope(1000), { 'X-Upload-Retention': '7d' }), render);
  assert.equal(res.status, 200);
  const { id, expires, burn } = await res.json() as { id: string; expires: number; burn: boolean };
  assert.match(id, /^t7d-/);
  assert.equal(burn, false);
  assert.ok(Math.abs(expires - (Date.now() + 7 * DAY)) < 60_000);
  assert.equal(stored.get(id)!.meta.expires, expires);

  const usage = () => scopes.get('uploads')!.exec("SELECT bytes, uploads FROM usage WHERE period LIKE 'd:%'").toArray()[0];
  assert.deepEqual({ ...usage() }, { bytes: 7000, uploads: 1 });
  const plain = await app.fetch(upload(envelope(1000)), render);
  const legacy = await plain.json() as { id: string; expires: number };
  assert.ok(BLOB_ID_RE.test(legacy.id) && !legacy.id.startsWith('t'));
  assert.deepEqual({ ...usage() }, { bytes: 8000, uploads: 2 });
  assert.equal((await app.fetch(upload(envelope(), { 'X-Upload-Retention': '2d' }), render)).status, 400);

  assert.equal((await app.fetch(download(id), render)).status, 200);
  assert.equal((await app.fetch(download(id), render)).status, 200);
  stored.get(id)!.meta.expires = Date.now() - 1;
  assert.equal((await app.fetch(download(id), render)).status, 404);
  assert.equal((await app.fetch(download(`t1d-${crypto.randomUUID()}`), render)).status, 404);
});

test('a one-time upload is served once, refused after, and deleted once read out', async () => {
  const { app, stored, background } = setup();
  const body = envelope(200);
  const res = await app.fetch(upload(body, { 'X-Upload-Retention': '1h', 'X-Upload-Burn': '1' }), render);
  const { id, burn } = await res.json() as { id: string; burn: boolean };
  assert.equal(burn, true);
  assert.match(id, /^t1h-/);

  assert.equal((await app.fetch(download(id, 'HEAD'), render)).status, 200);
  const first = await app.fetch(download(id), render);
  const second = await app.fetch(download(id), render);
  assert.equal(first.status, 200);
  assert.equal(second.status, 404);
  assert.ok(stored.has(id));
  assert.deepEqual(new Uint8Array(await first.arrayBuffer()), body.slice(4));
  await Promise.all(background);
  assert.equal(stored.has(id), false);
  assert.equal((await app.fetch(download(id), render)).status, 404);
});

test('a one-time download cut short still burns the upload', async () => {
  const { app, stored, background } = setup();
  const res = await app.fetch(upload(envelope(500), { 'X-Upload-Burn': '1' }), render);
  const { id } = await res.json() as { id: string };
  const first = await app.fetch(download(id), render);
  await first.body!.cancel();
  await Promise.all(background);
  assert.equal(stored.has(id), false);
  assert.equal((await app.fetch(download(id), render)).status, 404);
});

test('the Node blob store keeps expiry and the one-time flag in SQLite and sweeps by them', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ec-blobs-'));
  dirs.push(dir);
  let now = Date.now();
  const meta = new DatabaseSync(':memory:');
  const store = new FileBlobStore(dir, () => now, meta);
  await store.init();
  const stream = (bytes: Uint8Array) => new Blob([bytes as BlobPart]).stream();
  const short = `t1h-${crypto.randomUUID()}`;
  const long = `t7d-${crypto.randomUUID()}`;
  await store.put(short, stream(new Uint8Array(5)), 5, { expires: now + HOUR, burn: true });
  await store.put(long, stream(new Uint8Array(5)), 5, { expires: now + 7 * DAY, burn: false });

  const blob = (await store.get(short))!;
  assert.equal(blob.burn, true);
  assert.equal(blob.expires, now + HOUR);
  await blob.body.cancel();

  now += 2 * HOUR;
  assert.equal(await store.get(short), null);
  assert.equal(existsSync(path.join(dir, short)), false);

  now += 2 * DAY;
  assert.equal(await store.sweep(), 0);
  const kept = (await store.get(long))!;
  assert.equal(kept.burn, false);
  await kept.body.cancel();

  now += 5 * DAY;
  assert.equal(await store.sweep(), 1);
  assert.equal(existsSync(path.join(dir, long)), false);
  assert.equal(meta.prepare('SELECT COUNT(*) AS n FROM blobs').get()!.n, 0);
});

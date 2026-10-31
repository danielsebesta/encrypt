import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { FileBlobStore } from '../src/adapters/node/blobs';
import { openChunkedFile, sealChunkedFile } from '../src/lib/chunkedFile';
import { decryptData, encryptData, prependEclkMagic } from '../src/lib/ghost/crypto';
import { createApp } from '../src/server/app';
import { runBudgetCommand } from '../src/server/budget';
import type { SqlLike } from '../src/lib/uploadPass';
import type { Platform } from '../src/platform/types';

const SECRET = 'chunk-secret';
const browser = { 'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Mode': 'cors' };
const render = async () => new Response('page');

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

test('chunked seal and open round-trip with tiny synthetic chunks', async () => {
  const plain = new TextEncoder().encode('hello chunked world '.repeat(20));
  const sealed = await sealChunkedFile(plain, 'correct horse', 'note.txt', { chunkSize: 32 });
  assert.ok(sealed.parts.length > 1);
  const wire = new Uint8Array(sealed.envelope.length + sealed.parts.reduce((n, p) => n + p.length, 0));
  wire.set(sealed.envelope);
  let offset = sealed.envelope.length;
  for (const part of sealed.parts) { wire.set(part, offset); offset += part.length; }
  assert.deepEqual(await openChunkedFile(wire, 'correct horse'), { data: plain, name: 'note.txt' });
  await assert.rejects(openChunkedFile(wire, 'wrong'), /./);
  assert.deepEqual(await decryptData(wire, 'correct horse'), { data: plain, name: 'note.txt' });
});

test('classic encryptData still opens through decryptData', async () => {
  const data = new Uint8Array([1, 2, 3, 4, 5]);
  const sealed = await encryptData(data, 'pw', 'a.bin');
  assert.deepEqual(await decryptData(sealed, 'pw'), { data, name: 'a.bin' });
});

test('chunked upload HTTP routes are gone', async () => {
  const platform: Platform = {
    env: { UPLOAD_PASS_SECRET: SECRET },
    clientIp: () => '2001:db8:0:1::5',
    budget: async <T>(_scope: string, command: any) => runBudgetCommand(sqlite(), command) as T,
    blobs: {
      put: async () => {},
      beginMultipart: async () => {},
      putPart: async () => {},
      completeMultipart: async () => {},
      get: async () => null,
      delete: async () => {},
    },
    realtime: async () => new Response('', { status: 426 }),
    waitUntil: () => {},
  };
  const app = createApp(platform);
  assert.equal((await app.fetch(new Request('https://example.test/upload/init', {
    method: 'POST',
    headers: { ...browser, 'Content-Type': 'application/json' },
    body: JSON.stringify({ bytes: 200, parts: 2 }),
  }), render)).status, 404);
  assert.equal((await app.fetch(new Request('https://example.test/upload/x/0', {
    method: 'PUT', headers: { ...browser, 'Content-Length': '1' }, body: 'x',
  }), render)).status, 404);
});

test('legacy completed multipart still downloads and burns once via Node store', async () => {
  const plain = new TextEncoder().encode('burn-me-once');
  const sealed = await sealChunkedFile(plain, 'secret', 'b.txt', { chunkSize: 8 });
  const part0 = prependEclkMagic(sealed.envelope);
  const total = part0.length + sealed.parts.reduce((n, p) => n + p.length, 0);

  const dir = mkdtempSync(path.join(tmpdir(), 'chunk-blobs-'));
  try {
    const store = new FileBlobStore(dir);
    await store.init();
    const id = crypto.randomUUID();
    const meta = { expires: Date.now() + 60_000, burn: true };
    await store.beginMultipart(id, 1 + sealed.parts.length, meta);
    await store.putPart(id, 0, new Blob([part0 as BlobPart]).stream(), part0.length);
    for (let i = 0; i < sealed.parts.length; i++) {
      await store.putPart(id, i + 1, new Blob([sealed.parts[i] as BlobPart]).stream(), sealed.parts[i].length);
    }
    assert.equal(await store.get(id), null);
    await store.completeMultipart(id);

    const scopes = new Map<string, SqlLike>();
    const background: Promise<unknown>[] = [];
    const platform: Platform = {
      env: { UPLOAD_PASS_SECRET: SECRET },
      clientIp: () => '2001:db8:0:1::5',
      budget: async <T>(scope: string, command: any) => {
        if (!scopes.has(scope)) scopes.set(scope, sqlite());
        return runBudgetCommand(scopes.get(scope)!, command) as T;
      },
      blobs: store,
      realtime: async () => new Response('', { status: 426 }),
      waitUntil: work => { background.push(work); },
    };
    const app = createApp(platform);
    const first = await app.fetch(new Request(`https://example.test/dl/${id}`, { headers: browser }), render);
    assert.equal(first.status, 200);
    assert.equal(first.headers.get('Content-Length'), String(total - 4));
    const downloaded = new Uint8Array(await first.arrayBuffer());
    assert.deepEqual(await decryptData(downloaded, 'secret'), { data: plain, name: 'b.txt' });
    await Promise.all(background);
    assert.equal((await app.fetch(new Request(`https://example.test/dl/${id}`, { headers: browser }), render)).status, 404);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

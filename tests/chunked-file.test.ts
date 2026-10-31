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
import type { BlobMeta, BlobStore, Platform } from '../src/platform/types';

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

function memoryBlobs(): BlobStore & { stored: Map<string, Uint8Array> } {
  const stored = new Map<string, Uint8Array>();
  const meta = new Map<string, BlobMeta>();
  const multipart = new Map<string, { parts: number; complete: boolean; chunks: Map<number, Uint8Array> }>();
  return {
    stored,
    async put(id, body, size, info) {
      const bytes = new Uint8Array(await new Response(body).arrayBuffer());
      if (bytes.length !== size) throw new Error('size mismatch');
      stored.set(id, bytes);
      meta.set(id, info);
    },
    async beginMultipart(id, parts, info) {
      multipart.set(id, { parts, complete: false, chunks: new Map() });
      meta.set(id, info);
    },
    async putPart(id, index, body, size) {
      const session = multipart.get(id);
      if (!session || session.complete || index < 0 || index >= session.parts) throw new Error('Invalid part');
      const bytes = new Uint8Array(await new Response(body).arrayBuffer());
      if (bytes.length !== size) throw new Error('size mismatch');
      session.chunks.set(index, bytes);
    },
    async completeMultipart(id) {
      const session = multipart.get(id);
      if (!session || session.complete || session.chunks.size !== session.parts) throw new Error('Incomplete');
      const total = Array.from({ length: session.parts }, (_, i) => session.chunks.get(i)!).reduce((n, c) => n + c.length, 0);
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (let i = 0; i < session.parts; i++) {
        const part = session.chunks.get(i)!;
        bytes.set(part, offset);
        offset += part.length;
      }
      stored.set(id, bytes);
      session.complete = true;
    },
    async get(id) {
      const session = multipart.get(id);
      if (session && !session.complete) return null;
      const bytes = stored.get(id);
      return bytes ? { body: new Blob([bytes as BlobPart]).stream(), size: bytes.length, uploaded: Date.now(), ...meta.get(id)! } : null;
    },
    async delete(id) { stored.delete(id); meta.delete(id); multipart.delete(id); },
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

test('incomplete multipart uploads are refused on download', async () => {
  const { stored, ...blobs } = memoryBlobs();
  const scopes = new Map<string, SqlLike>();
  const platform: Platform = {
    env: { UPLOAD_PASS_SECRET: SECRET },
    clientIp: () => '2001:db8:0:1::5',
    budget: async <T>(scope: string, command: any) => {
      if (!scopes.has(scope)) scopes.set(scope, sqlite());
      return runBudgetCommand(scopes.get(scope)!, command) as T;
    },
    blobs,
    realtime: async () => new Response('', { status: 426 }),
    waitUntil: () => {},
  };
  const app = createApp(platform);
  const init = await app.fetch(new Request('https://example.test/upload/init', {
    method: 'POST',
    headers: { ...browser, 'Content-Type': 'application/json' },
    body: JSON.stringify({ bytes: 200, parts: 2 }),
  }), render);
  assert.equal(init.status, 200);
  const { id } = await init.json() as { id: string };
  const part0 = prependEclkMagic(await (await import('../src/lib/passwordEnvelope')).sealPassword(new Uint8Array(8), 'x'));
  assert.equal((await app.fetch(new Request(`https://example.test/upload/${id}/0`, {
    method: 'PUT', headers: { ...browser, 'Content-Length': String(part0.length) }, body: part0 as BodyInit,
  }), render)).status, 200);
  assert.equal((await app.fetch(new Request(`https://example.test/dl/${id}`, { headers: browser }), render)).status, 404);
  assert.equal(stored.has(id), false);
  assert.equal((await app.fetch(new Request(`https://example.test/upload/${id}/complete`, { method: 'POST', headers: browser }), render)).status, 409);
});

test('completed chunked upload downloads, burns once, and Node store round-trips', async () => {
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
    const got = await store.get(id);
    assert.ok(got);
    assert.equal(got.size, total);
    const bytes = new Uint8Array(await new Response(got.body).arrayBuffer());
    assert.deepEqual(await openChunkedFile(bytes.subarray(4), 'secret'), { data: plain, name: 'b.txt' });
    await store.delete(id);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  const blobs = memoryBlobs();
  const scopes = new Map<string, SqlLike>();
  const background: Promise<unknown>[] = [];
  const platform: Platform = {
    env: { UPLOAD_PASS_SECRET: SECRET },
    clientIp: () => '2001:db8:0:1::5',
    budget: async <T>(scope: string, command: any) => {
      if (!scopes.has(scope)) scopes.set(scope, sqlite());
      return runBudgetCommand(scopes.get(scope)!, command) as T;
    },
    blobs,
    realtime: async () => new Response('', { status: 426 }),
    waitUntil: work => { background.push(work); },
  };
  const app = createApp(platform);
  const init = await app.fetch(new Request('https://example.test/upload/init', {
    method: 'POST',
    headers: { ...browser, 'Content-Type': 'application/json', 'X-Upload-Burn': '1' },
    body: JSON.stringify({ bytes: total, parts: 1 + sealed.parts.length }),
  }), render);
  assert.equal(init.status, 200);
  const { id } = await init.json() as { id: string };
  assert.equal((await app.fetch(new Request(`https://example.test/upload/${id}/0`, {
    method: 'PUT', headers: { ...browser, 'Content-Length': String(part0.length) }, body: part0 as BodyInit,
  }), render)).status, 200);
  for (let i = 0; i < sealed.parts.length; i++) {
    const part = sealed.parts[i];
    assert.equal((await app.fetch(new Request(`https://example.test/upload/${id}/${i + 1}`, {
      method: 'PUT', headers: { ...browser, 'Content-Length': String(part.length) }, body: part as BodyInit,
    }), render)).status, 200);
  }
  assert.equal((await app.fetch(new Request(`https://example.test/upload/${id}/complete`, { method: 'POST', headers: browser }), render)).status, 200);
  const first = await app.fetch(new Request(`https://example.test/dl/${id}`, { headers: browser }), render);
  assert.equal(first.status, 200);
  const downloaded = new Uint8Array(await first.arrayBuffer());
  assert.deepEqual(await decryptData(downloaded, 'secret'), { data: plain, name: 'b.txt' });
  await Promise.all(background);
  assert.equal((await app.fetch(new Request(`https://example.test/dl/${id}`, { headers: browser }), render)).status, 404);
});

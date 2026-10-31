import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SHARE_INBOX, SHARE_MAX_AGE_MS, SHARE_MAX_FILES, composeSharedText, parseSharedMeta, safeFileName } from '../src/lib/shareTarget';
import { createApp } from '../src/server/app';
import type { Platform } from '../src/platform/types';

const NOW = 1_800_000_000_000;

test('the manifest posts shared files and text to the path the service worker handles', () => {
  const manifest = JSON.parse(readFileSync(new URL('../public/site.webmanifest', import.meta.url), 'utf8'));
  assert.equal(manifest.share_target.action, '/share-target');
  assert.equal(manifest.share_target.method, 'POST');
  assert.equal(manifest.share_target.enctype, 'multipart/form-data');
  assert.deepEqual(manifest.share_target.params.files, [{ name: 'files', accept: ['*/*'] }]);
  const worker = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
  assert.ok(worker.includes(`'${SHARE_INBOX}'`));
  assert.ok(worker.includes("'/share-target'"));
  assert.ok(!SHARE_INBOX.startsWith('encrypt-'));
});

test('shared metadata is accepted only while fresh and well formed', () => {
  const meta = { at: NOW - 1000, title: 'T', text: 'x', url: 'https://example.test/', files: [{ name: 'a.pdf', type: 'application/pdf' }] };
  assert.deepEqual(parseSharedMeta(meta, NOW), meta);
  assert.equal(parseSharedMeta({ ...meta, at: NOW - SHARE_MAX_AGE_MS - 1 }, NOW), null);
  assert.equal(parseSharedMeta({ ...meta, at: NOW + 120_000 }, NOW), null);
  assert.equal(parseSharedMeta({ ...meta, at: 'soon' }, NOW), null);
  assert.equal(parseSharedMeta(null, NOW), null);
  assert.equal(parseSharedMeta('{}', NOW), null);
  assert.deepEqual(parseSharedMeta({ at: NOW, title: 5, files: 'no' }, NOW), { at: NOW, title: '', text: '', url: '', files: [] });
});

test('shared file names lose paths and control characters and the list is capped', () => {
  assert.equal(safeFileName('C:\\Users\\me\\report.pdf', 0), 'report.pdf');
  assert.equal(safeFileName('../../etc/passwd', 0), 'passwd');
  assert.equal(safeFileName('a\u0000b\nc.txt', 0), 'abc.txt');
  assert.equal(safeFileName('..', 2), 'shared-3');
  assert.equal(safeFileName('', 0), 'shared-1');
  assert.equal(safeFileName('x'.repeat(400), 0).length, 255);
  const many = parseSharedMeta({ at: NOW, files: Array.from({ length: SHARE_MAX_FILES + 5 }, () => ({ name: 'f', type: 3 })) }, NOW);
  assert.equal(many?.files.length, SHARE_MAX_FILES);
  assert.deepEqual(many?.files[0], { name: 'f', type: '' });
});

test('title, text and link become one message without repeating each other', () => {
  assert.equal(composeSharedText({ title: 'Page', text: '', url: 'https://example.test/a' }), 'Page\nhttps://example.test/a');
  assert.equal(composeSharedText({ title: '', text: 'Look https://example.test/a', url: 'https://example.test/a' }), 'Look https://example.test/a');
  assert.equal(composeSharedText({ title: 'Note', text: 'Note', url: '' }), 'Note');
  assert.equal(composeSharedText({ title: '  ', text: ' hello ', url: '' }), 'hello');
  assert.equal(composeSharedText({ title: '', text: '', url: '' }), '');
});

test('without the service worker the server drops the shared body and sends the visitor to the share page', async () => {
  let rendered = false;
  let budgeted = false;
  const platform: Platform = {
    env: {},
    clientIp: () => '2001:db8::1',
    budget: async () => { budgeted = true; return true as never; },
    blobs: { put: async () => {}, get: async () => null, delete: async () => {} },
    realtime: async () => new Response(null, { status: 426 }),
    waitUntil: () => {},
  };
  const app = createApp(platform);
  let pulled = false;
  for (const path of ['/share-target', '/share-target/', '/Share-Target']) {
    const body = new ReadableStream<Uint8Array>({ pull(controller) { pulled = true; controller.enqueue(new TextEncoder().encode('secret')); controller.close(); } }, { highWaterMark: 0 });
    const res = await app.fetch(new Request(`https://example.test${path}`, { method: 'POST', body, duplex: 'half', headers: { 'Content-Type': 'multipart/form-data; boundary=x' } } as RequestInit), async () => { rendered = true; return new Response('page'); });
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('Location'), 'https://example.test/share');
    assert.equal(res.headers.get('Cache-Control'), 'no-store');
  }
  assert.equal(pulled, false);
  assert.equal(rendered, false);
  assert.equal(budgeted, false);
});

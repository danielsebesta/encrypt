import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { DatabaseSync } from 'node:sqlite';
import { accessChannel } from '../src/lib/roomAccess';
import { RoomDatabase, sqlLike } from '../src/adapters/node/sqlite';
import { RealtimeRooms } from '../src/adapters/node/realtime';
import { BLOB_TTL_MS, FileBlobStore } from '../src/adapters/node/blobs';
import { StaticSite, matchHeaders, matchRedirect, parseHeaders, parseRedirects, resolveAsset } from '../src/adapters/node/static';

const token = 'c'.repeat(64);
const PAYLOAD = 'A'.repeat(64);

const dirs: string[] = [];
after(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });

function tempDir() {
  const dir = mkdtempSync(path.join(tmpdir(), 'ec-node-'));
  dirs.push(dir);
  return dir;
}

async function until(condition: () => boolean | Promise<boolean>, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

function fakeSocket() {
  return {
    sent: [] as any[],
    closed: null as number | null,
    send(data: string) { this.sent.push(JSON.parse(data)); },
    close(code?: number) { this.closed = code ?? 1000; },
  };
}

function stream(...chunks: Uint8Array[]) {
  return new ReadableStream<Uint8Array>({ start(controller) { for (const chunk of chunks) controller.enqueue(chunk); controller.close(); } });
}

test('room storage lists keys in UTF-8 byte order with prefix, limit and startAfter', async t => {
  const db = new RoomDatabase(path.join(tempDir(), 'rooms.sqlite'));
  t.after(() => db.close());
  const storage = db.storage('main:a');
  const other = db.storage('main:b');
  await storage.put({ 'h:2': 2, 'h:10': 10, 'h:1': { n: 1 }, b: 'b', '￿': 'bmp', '\u{1F600}': 'astral', B: 'upper' });
  await other.put('h:1', 'other room');
  assert.deepEqual([...(await storage.list()).keys()], ['B', 'b', 'h:1', 'h:10', 'h:2', '￿', '\u{1F600}']);
  assert.deepEqual([...(await storage.list({ prefix: 'h:' })).entries()], [['h:1', { n: 1 }], ['h:10', 10], ['h:2', 2]]);
  assert.deepEqual([...(await storage.list({ prefix: 'h:', limit: 2 })).keys()], ['h:1', 'h:10']);
  assert.deepEqual([...(await storage.list({ prefix: 'h:', startAfter: 'h:10' })).keys()], ['h:2']);
  assert.equal(await storage.get('missing'), undefined);
  assert.equal(await storage.delete('b'), true);
  assert.equal(await storage.delete('b'), false);
  assert.equal(await storage.delete(['h:1', 'h:2', 'nope']), 2);
  await storage.deleteAll();
  assert.equal((await storage.list()).size, 0);
  assert.equal(await other.get('h:1'), 'other room');
});

test('room alarms survive reopening the database and are cleared when taken', async t => {
  const file = path.join(tempDir(), 'rooms.sqlite');
  let db = new RoomDatabase(file);
  await db.storage('main:a').setAlarm(5000);
  await db.storage('persistent:b').setAlarm(1000);
  await db.storage('main:c').setAlarm(9000);
  await db.storage('main:c').deleteAlarm();
  db.close();
  db = new RoomDatabase(file);
  t.after(() => db.close());
  assert.equal(db.nextAlarm(), 1000);
  assert.deepEqual(db.takeDueAlarms(6000), ['persistent:b', 'main:a']);
  assert.equal(db.nextAlarm(), null);
});

test('the SQL adapter runs statement batches and binds values like Durable Object SQL', t => {
  const db = new DatabaseSync(path.join(tempDir(), 'budget.sqlite'));
  t.after(() => db.close());
  const sql = sqlLike(db);
  sql.exec('CREATE TABLE a (k TEXT PRIMARY KEY, v INTEGER); CREATE TABLE b (x INTEGER)');
  sql.exec('INSERT INTO a (k, v) VALUES (?, ?)', 'one', 1);
  sql.exec('INSERT INTO a (k, v) VALUES (?, ?)', 'yes', true);
  assert.deepEqual(sql.exec('SELECT k, v FROM a ORDER BY k').toArray().map(row => ({ ...row })), [{ k: 'one', v: 1 }, { k: 'yes', v: 1 }]);
  assert.deepEqual(sql.exec('SELECT x FROM b').toArray(), []);
});

test('chat rooms join, relay between connections and keep saved history across instance eviction', async t => {
  const db = new RoomDatabase(path.join(tempDir(), 'rooms.sqlite'));
  t.after(() => db.close());
  const rooms = new RealtimeRooms(db, {}, 0);
  const name = await accessChannel(token);

  const join = async () => {
    const socket = fakeSocket();
    const peer = rooms.connect('persistent', name, socket);
    peer.message(JSON.stringify({ type: 'join', token }));
    await until(() => socket.sent.some(m => m.type === 'history'));
    return { socket, peer };
  };

  const a = await join();
  const b = await join();
  assert.equal(a.socket.sent[0].type, 'init');
  assert.notEqual(a.peer.id, b.peer.id);
  a.peer.message(JSON.stringify({ type: 'message', id: 'm1', payload: PAYLOAD, persist: true }));
  await until(() => b.socket.sent.some(m => m.type === 'message'));
  assert.equal(b.socket.sent.find(m => m.type === 'message').serverSeq, 1);
  assert.equal(rooms.size, 1);

  a.peer.closed();
  b.peer.closed();
  await until(() => rooms.size === 0);
  assert.ok(db.nextAlarm()! > Date.now());

  const late = await join();
  const history = late.socket.sent.find(m => m.type === 'history');
  assert.deepEqual(history.messages.map((m: any) => m.id), ['m1']);
  late.peer.closed();
});

test('a room alarm left by an earlier process fires on start and clears an empty live room', async t => {
  const file = path.join(tempDir(), 'rooms.sqlite');
  const name = await accessChannel(token);
  let db = new RoomDatabase(file);
  await db.storage(`main:${name}`).put('room-config', { mode: 'live', authMode: 'fragment', createdAt: 1 });
  await db.storage(`main:${name}`).setAlarm(Date.now() - 1000);
  db.close();
  db = new RoomDatabase(file);
  t.after(() => db.close());
  const rooms = new RealtimeRooms(db, {}, 0);
  await until(async () => (await db.storage(`main:${name}`).list()).size === 0);
  assert.equal(db.nextAlarm(), null);
  await until(() => rooms.size === 0);
});

test('WebSocket upgrades pass the guard and the route check before reaching a room', async t => {
  const db = new RoomDatabase(path.join(tempDir(), 'rooms.sqlite'));
  const rooms = new RealtimeRooms(db, {}, 0);
  const server = createServer((_req, res) => res.end());
  const wss = rooms.listen(server, req => new Request(`http://local${req.url}`, { headers: req.headers as Record<string, string> }),
    async request => request.headers.get('origin') === 'https://evil.example' ? new Response(null, { status: 403 }) : null);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await rooms.shutdown(100);
    wss.close();
    await new Promise(resolve => server.close(resolve));
    db.close();
  });
  const base = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const open = (pathname: string, origin?: string) => new Promise<number | string>(resolve => {
    const ws = new WebSocket(base + pathname, origin ? { headers: { Origin: origin } } : {});
    ws.once('message', data => { resolve(JSON.parse(String(data)).type); ws.close(); });
    ws.once('unexpected-response', (req, res) => { req.destroy(); resolve(res.statusCode ?? 0); });
    ws.once('error', () => resolve('error'));
  });
  const name = await accessChannel(token);
  assert.equal(await open(`/parties/main/${name}`), 'init');
  assert.equal(await open(`/parties/main/${name}`, 'https://evil.example'), 403);
  assert.equal(await open('/parties/other/abc'), 404);
});

test('_headers blocks all apply, repeated headers join with a comma and ! removes one', () => {
  const rules = parseHeaders(`# comment
/*
  X-Frame-Options: DENY
  Cache-Control: no-cache
  Link: </a.css>; rel=preload

/_astro/*
  ! Cache-Control
  Cache-Control: public, max-age=31536000, immutable
/:lang/page
  Link: </:lang.css>; rel=preload
/files/*
  X-Path: :splat
https://example.com/*
  X-Host: ignored
`);
  const astro = matchHeaders(rules, '/_astro/app.js');
  assert.equal(astro.get('x-frame-options'), 'DENY');
  assert.equal(astro.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.equal(matchHeaders(rules, '/cs/page').get('link'), '</a.css>; rel=preload, </cs.css>; rel=preload');
  assert.equal(matchHeaders(rules, '/files/a/b.txt').get('x-path'), 'a/b.txt');
  assert.equal(matchHeaders(rules, '/cs/page/deeper').get('link'), '</a.css>; rel=preload');
  assert.equal(matchHeaders(rules, '/x').get('x-host'), null);
});

test('_redirects match exactly or by splat, default to 302 and keep the query', () => {
  const rules = parseRedirects(`/privacy /security 301
/old/* /new/:splat
/team/:name /people/:name 308
/bad /nowhere 200
`);
  const at = (pathname: string) => matchRedirect(rules, new URL(pathname, 'https://site.test'));
  assert.deepEqual(at('/privacy?x=1'), { location: '/security?x=1', status: 301 });
  assert.equal(at('/privacy/'), null);
  assert.deepEqual(at('/old/a/b'), { location: '/new/a/b', status: 302 });
  assert.deepEqual(at('/team/ana'), { location: '/people/ana', status: 308 });
  assert.equal(at('/bad'), null);
});

test('HTML lookup follows Cloudflare auto-trailing-slash handling', () => {
  const files = new Set(['/index.html', '/page.html', '/dir/index.html', '/404.html', '/a.txt']);
  const resolve = (pathname: string) => resolveAsset(file => files.has(file), pathname);
  assert.deepEqual(resolve('/'), { file: '/index.html' });
  assert.deepEqual(resolve('/index.html'), { redirect: '/' });
  assert.deepEqual(resolve('/page'), { file: '/page.html' });
  assert.deepEqual(resolve('/page.html'), { redirect: '/page' });
  assert.deepEqual(resolve('/page/'), { redirect: '/page' });
  assert.deepEqual(resolve('/dir'), { redirect: '/dir/' });
  assert.deepEqual(resolve('/dir/'), { file: '/dir/index.html' });
  assert.deepEqual(resolve('/dir/index.html'), { redirect: '/dir/' });
  assert.deepEqual(resolve('/dir.html'), { redirect: '/dir/' });
  assert.deepEqual(resolve('/a.txt'), { file: '/a.txt' });
  assert.equal(resolve('/missing'), null);
});

test('static files serve with headers, ETags, ranges and HEAD, and nothing outside the client directory', async () => {
  const root = tempDir();
  const client = path.join(root, 'client');
  mkdirSync(path.join(client, 'dir'), { recursive: true });
  writeFileSync(path.join(root, 'secret.txt'), 'secret');
  writeFileSync(path.join(client, 'index.html'), '<h1>home</h1>');
  writeFileSync(path.join(client, 'dir', 'index.html'), '<h1>dir</h1>');
  writeFileSync(path.join(client, 'a.txt'), '0123456789');
  writeFileSync(path.join(client, '_headers'), '/*\n  X-Frame-Options: DENY\n/a.txt\n  Cache-Control: no-cache\n');
  writeFileSync(path.join(client, '_redirects'), '/old /a.txt 301\n');
  const site = await StaticSite.load(client);
  const get = (pathname: string, init: RequestInit = {}) => site.serve(new Request(`https://site.test${pathname}`, init));

  const home = get('/')!;
  assert.equal(home.status, 200);
  assert.equal(home.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(home.headers.get('x-frame-options'), 'DENY');
  assert.equal(home.headers.get('cache-control'), 'public, max-age=0, must-revalidate');
  assert.equal(await home.text(), '<h1>home</h1>');

  const file = get('/a.txt')!;
  assert.equal(file.headers.get('cache-control'), 'no-cache');
  const etag = file.headers.get('etag')!;
  await file.body?.cancel();
  assert.equal(get('/a.txt', { headers: { 'If-None-Match': etag } })!.status, 304);
  const range = get('/a.txt', { headers: { Range: 'bytes=2-4' } })!;
  assert.equal(range.status, 206);
  assert.equal(range.headers.get('content-range'), 'bytes 2-4/10');
  assert.equal(await range.text(), '234');
  assert.equal(get('/a.txt', { headers: { Range: 'bytes=20-' } })!.status, 416);
  const head = get('/a.txt', { method: 'HEAD' })!;
  assert.equal(head.body, null);
  assert.equal(head.headers.get('content-length'), '10');

  assert.equal(get('/dir')!.headers.get('location'), '/dir/');
  assert.equal(get('/old?q=1')!.headers.get('location'), '/a.txt?q=1');
  assert.equal(get('/a.txt', { method: 'POST', body: 'x' }), null);
  for (const pathname of ['/../secret.txt', '/%2e%2e/secret.txt', '/..%2fsecret.txt', '/dir/..%2f..%2fsecret.txt', '/_headers', '/_redirects', '/%E0%A4%A']) {
    assert.equal(get(pathname), null, pathname);
  }
  const page = site.read('/dir/index.html')!;
  assert.equal(page.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(await page.text(), '<h1>dir</h1>');
  assert.equal(site.read('/missing.html'), null);
});

test('blob store keeps exactly the declared size and forgets uploads after a day', async () => {
  const dir = path.join(tempDir(), 'uploads');
  const store = new FileBlobStore(dir);
  await store.init();
  const id = '2f1c7a52-4b1e-4d4b-9a7e-1f0c2b3d4e5f';
  const bytes = new Uint8Array([1, 2, 3, 4, 5]);

  await assert.rejects(store.put(id, stream(bytes), 4));
  await assert.rejects(store.put(id, stream(bytes), 6));
  await assert.rejects(store.put('../escape', stream(bytes), 5));
  assert.equal(await store.get(id), null);
  assert.deepEqual(readdirSync(path.join(dir, '.tmp')), []);

  await store.put(id, stream(bytes.subarray(0, 2), bytes.subarray(2)), 5);
  const blob = (await store.get(id))!;
  assert.equal(blob.size, 5);
  assert.ok(Math.abs(blob.uploaded - Date.now()) < 60_000);
  assert.deepEqual(new Uint8Array(await new Response(blob.body).arrayBuffer()), bytes);
  assert.equal(await store.get('not-a-uuid'), null);

  const later = new FileBlobStore(dir, () => Date.now() + BLOB_TTL_MS + 60_000);
  assert.equal(await later.sweep(), 1);
  assert.equal(existsSync(path.join(dir, id)), false);

  await store.put(id, stream(bytes), 5);
  assert.equal(await later.get(id), null);
  assert.equal(existsSync(path.join(dir, id)), false);
  await store.delete(id);
});

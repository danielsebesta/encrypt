import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { ClientLedger, PASS_ALLOWANCE, PASS_TTL_MS, SUSPICION, browserFetch, issuePass, suspicious, verifyPass, type SqlLike } from '../src/lib/uploadPass';
import { createApp } from '../src/server/app';
import { runBudgetCommand } from '../src/server/budget';
import { createChallenge, verifySolution, powDifficulty, type PowChallenge } from '../src/server/pow';
import type { BlobStore, Platform } from '../src/platform/types';

const SECRET = 'test-secret';
const GB = 1000 ** 3;

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

test('a pass verifies only for its client, secret and lifetime', async () => {
  const now = Date.now();
  const { pass, expires } = await issuePass(SECRET, '2001:db8:0:1::/64', now);
  assert.equal(expires, now + PASS_TTL_MS);
  assert.ok(!pass.includes('2001'));
  assert.ok(await verifyPass(pass, SECRET, '2001:db8:0:1::/64', now + 1000));
  assert.equal(await verifyPass(pass, SECRET, '2001:db8:0:2::/64', now), null);
  assert.equal(await verifyPass(pass, 'other-secret', '2001:db8:0:1::/64', now), null);
  assert.equal(await verifyPass(pass, undefined, '2001:db8:0:1::/64', now), null);
  assert.equal(await verifyPass(pass, SECRET, '2001:db8:0:1::/64', expires), null);
  const [v, exp, nonce, mac] = pass.split('.');
  assert.equal(await verifyPass([v, String(Number(exp) + 1000), nonce, mac].join('.'), SECRET, '2001:db8:0:1::/64', now), null);
  assert.equal(await verifyPass(`${pass}x`, SECRET, '2001:db8:0:1::/64', now), null);
  assert.equal(await verifyPass(null, SECRET, '2001:db8:0:1::/64', now), null);
  const future = await issuePass(SECRET, '203.0.113.7', now + 10 * PASS_TTL_MS);
  assert.equal(await verifyPass(future.pass, SECRET, '203.0.113.7', now), null);
});

test('fetch metadata tells our page apart from bare scripts', () => {
  const headers = (init: Record<string, string>) => new Headers(init);
  assert.equal(browserFetch(headers({ 'Sec-Fetch-Site': 'same-site', 'Sec-Fetch-Mode': 'cors' }), ['same-site', 'same-origin']), true);
  assert.equal(browserFetch(headers({ 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'cors' }), ['same-site', 'same-origin']), false);
  assert.equal(browserFetch(headers({ 'Sec-Fetch-Site': 'same-site' }), ['same-site']), false);
  assert.equal(browserFetch(headers({}), ['same-site']), false);
  assert.equal(browserFetch(headers({ 'Sec-Fetch-Site': 'same-site', 'Sec-Fetch-Mode': 'cors' }), ['same-origin']), false);
});

test('suspicion stays out of the way of normal use', () => {
  const calm = { browser: true, hourUploads: 5, dayBytes: 100e6, globalDayBytes: 10 * GB, globalDayCap: 100 * GB };
  assert.equal(suspicious(calm, 90e6), false);
  assert.equal(suspicious({ ...calm, browser: false }, 1), true);
  assert.equal(suspicious({ ...calm, hourUploads: SUSPICION.hourlyUploads }, 1), true);
  assert.equal(suspicious({ ...calm, dayBytes: SUSPICION.clientDayBytes }, 1), true);
  assert.equal(suspicious({ ...calm, globalDayBytes: 50 * GB }, 1), true);
  assert.equal(suspicious({ browser: true, hourUploads: 0, dayBytes: 0, globalDayBytes: 99 * GB }, 1), false);
});

test('the ledger challenges bursts, honours passes within their allowance and keeps the hard cap', () => {
  const ledger = new ClientLedger(sqlite(), 'clients', 5 * GB);
  const now = Date.UTC(2026, 9, 23, 12, 0, 0);
  const base = { client: 'a', bytes: 1000, browser: true, pass: null, now };
  for (let i = 0; i < SUSPICION.hourlyUploads; i++) assert.equal(ledger.charge({ ...base, now: now + i }), 'ok');
  assert.equal(ledger.charge(base), 'challenge');
  assert.equal(ledger.charge({ ...base, client: 'b' }), 'ok');
  assert.equal(ledger.charge({ ...base, pass: 'nonce-1' }), 'ok');
  assert.equal(ledger.charge({ ...base, now: now + 3 * 3600_000 }), 'ok');

  assert.equal(ledger.charge({ ...base, client: 'c', browser: false }), 'challenge');
  assert.equal(ledger.charge({ ...base, client: 'c', browser: false, pass: 'nonce-2' }), 'ok');

  for (let i = 1; i < PASS_ALLOWANCE.uploads; i++) ledger.add({ ...base, client: 'd', pass: 'nonce-3' });
  assert.equal(ledger.charge({ ...base, client: 'd', browser: false, pass: 'nonce-3' }), 'ok');
  assert.equal(ledger.charge({ ...base, client: 'd', browser: false, pass: 'nonce-3' }), 'challenge');

  assert.equal(ledger.charge({ ...base, client: 'e', bytes: 4 * GB, pass: 'nonce-4' }), 'challenge');
  ledger.add({ ...base, client: 'e', bytes: 4.5 * GB });
  assert.equal(ledger.charge({ ...base, client: 'e', bytes: GB, pass: 'nonce-5' }), 'client');
  ledger.release('e', 4 * GB, now);
  assert.equal(ledger.charge({ ...base, client: 'e', bytes: 100e6 }), 'ok');

  assert.equal(ledger.charge({ ...base, client: 'f', globalDayBytes: 60 * GB, globalDayCap: 100 * GB }), 'challenge');
  assert.equal(ledger.charge({ ...base, client: 'f', globalDayBytes: 60 * GB, globalDayCap: 100 * GB, pass: 'nonce-6' }), 'ok');
});

test('the hourly count slides instead of resetting on the hour', () => {
  const ledger = new ClientLedger(sqlite(), 'relay', 2 * GB);
  const hourStart = Date.UTC(2026, 9, 23, 12, 0, 0);
  for (let i = 0; i < 40; i++) ledger.add({ client: 'a', bytes: 1, browser: true, pass: null, now: hourStart + 3500_000 });
  const base = { client: 'a', bytes: 1, browser: true, pass: null };
  assert.equal(ledger.check({ ...base, now: hourStart + 3600_000 + 60_000 }), 'challenge');
  assert.equal(ledger.check({ ...base, now: hourStart + 3600_000 + 3000_000 }), 'ok');
});

function memoryBlobs(): BlobStore & { stored: Map<string, Uint8Array> } {
  const stored = new Map<string, Uint8Array>();
  return {
    stored,
    async put(id, body, size) {
      const bytes = new Uint8Array(await new Response(body).arrayBuffer());
      if (bytes.length !== size) throw new Error('size mismatch');
      stored.set(id, bytes);
    },
    async get(id) {
      const bytes = stored.get(id);
      return bytes ? { body: new Blob([bytes as BlobPart]).stream(), size: bytes.length, uploaded: Date.now() } : null;
    },
    async delete(id) { stored.delete(id); },
  };
}

function platform(env: Record<string, string> = { UPLOAD_PASS_SECRET: SECRET }) {
  const scopes = new Map<string, SqlLike>();
  const blobs = memoryBlobs();
  const value: Platform = {
    env,
    clientIp: (request) => request.headers.get('X-Test-IP') ?? '2001:db8:0:1::5',
    budget: async <T>(scope: string, command: any) => {
      if (!scopes.has(scope)) scopes.set(scope, sqlite());
      return runBudgetCommand(scopes.get(scope)!, command) as T;
    },
    blobs,
    realtime: async () => new Response('Expected WebSocket', { status: 426 }),
  };
  return { value, blobs, app: createApp(value) };
}

const render = async () => new Response('page');
const browser = { 'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Mode': 'cors' };
const envelope = (size = 64) => {
  const body = new Uint8Array(size);
  body.set([69, 67, 76, 75, 69, 67, 80, 50, 0, 9, 39, 192]);
  return body;
};

function upload(body: Uint8Array, headers: Record<string, string> = browser) {
  return new Request('https://example.test/upload', { method: 'POST', body: body as BodyInit, headers: { 'Content-Length': String(body.length), ...headers } });
}

async function solve(challenge: PowChallenge) {
  for (let number = 0; number <= challenge.maxnumber; number++) {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${challenge.salt}${number}`)));
    if (Array.from(digest, b => b.toString(16).padStart(2, '0')).join('') === challenge.challenge) {
      return { algorithm: challenge.algorithm, challenge: challenge.challenge, number, salt: challenge.salt, signature: challenge.signature };
    }
  }
  throw new Error('unsolved');
}

test('a same-origin upload is stored and downloads as the bare ciphertext', async () => {
  const { app, blobs } = platform();
  const body = envelope(80);
  const res = await app.fetch(upload(body), render);
  assert.equal(res.status, 200);
  const { id } = await res.json() as { id: string };
  assert.equal(blobs.stored.get(id)?.length, 80);
  const dl = await app.fetch(new Request(`https://example.test/dl/${id}`, { headers: browser }), render);
  assert.equal(dl.status, 200);
  assert.match(dl.headers.get('Content-Disposition')!, /attachment/);
  assert.match(dl.headers.get('Content-Security-Policy')!, /sandbox/);
  assert.deepEqual(new Uint8Array(await dl.arrayBuffer()), body.slice(4));
  assert.equal((await app.fetch(new Request('https://example.test/dl/not-an-id', { headers: browser }), render)).status, 404);
});

test('only password envelopes and stego PNGs are stored', async () => {
  const { app, blobs } = platform();
  const zip = new Uint8Array(64);
  zip.set([69, 67, 76, 75, 80, 75, 3, 4]);
  assert.equal((await app.fetch(upload(zip), render)).status, 400);
  assert.equal(blobs.stored.size, 0);
  const png = new Uint8Array(64);
  png.set([69, 67, 76, 75, 137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal((await app.fetch(upload(png), render)).status, 200);
});

test('scripted uploads must prove work, and without a secret they are refused', async () => {
  const res = await platform().app.fetch(upload(envelope(), {}), render);
  assert.equal(res.status, 428);
  assert.deepEqual(await res.json(), { challenge: 'pow' });
  const refused = await platform({}).app.fetch(upload(envelope(), {}), render);
  assert.equal(refused.status, 429);
  assert.equal(refused.headers.get('Retry-After'), '3600');
});

test("a solved challenge buys a pass for the solver's /64 and cannot be redeemed twice", async () => {
  const { app } = platform();
  const issued = await (await app.fetch(new Request('https://example.test/upload/challenge', { headers: browser }), render)).json() as PowChallenge;
  assert.equal(issued.maxnumber, powDifficulty(1));
  const solution = await solve(await createChallenge(SECRET, 500));
  const redeem = () => app.fetch(new Request('https://example.test/upload/pass', {
    method: 'POST', body: JSON.stringify({ solution }), headers: { 'Content-Type': 'application/json', ...browser },
  }), render);
  const first = await redeem();
  assert.equal(first.status, 200);
  const { pass } = await first.json() as { pass: string };
  assert.equal((await redeem()).status, 403);
  assert.equal((await app.fetch(upload(envelope(), { 'X-Upload-Pass': pass }), render)).status, 200);
  assert.equal((await app.fetch(upload(envelope(), { 'X-Upload-Pass': pass, 'X-Test-IP': '2001:db8:0:2::5' }), render)).status, 428);
});

test('proof-of-work solutions are bound to their signature and expiry, and difficulty doubles', async () => {
  const solution = await solve(await createChallenge(SECRET, 300));
  assert.ok(await verifySolution(SECRET, solution));
  assert.equal(await verifySolution('other', solution), null);
  assert.equal(await verifySolution(SECRET, { ...solution, number: solution.number + 1 }), null);
  assert.equal(await verifySolution(SECRET, solution, Date.now() + 11 * 60 * 1000), null);
  assert.equal(powDifficulty(3), powDifficulty(1) * 4);
});

test('cross-site requests and over-budget clients are turned away before any route runs', async () => {
  const { app } = platform();
  assert.equal((await app.fetch(new Request('https://example.test/upload', { method: 'POST', headers: { 'Sec-Fetch-Site': 'cross-site' } }), render)).status, 403);
  assert.equal((await app.fetch(new Request('https://example.test/%61pi/turn', { headers: { 'Sec-Fetch-Site': 'cross-site' } }), render)).status, 403);
  let last = 0;
  for (let i = 0; i < 31; i++) last = (await app.fetch(new Request('https://example.test/upload/status', { headers: browser }), render)).status;
  assert.equal(last, 429);
  assert.equal(await (await app.fetch(new Request('https://example.test/cs/'), render)).text(), 'page');
});

test('websocket upgrades are guarded like every other realtime request', async () => {
  const { app } = platform();
  const room = `https://example.test/parties/main/${'a'.repeat(64)}`;
  assert.equal(await app.guardRealtime(new Request(room, { headers: browser })), null);
  assert.equal((await app.guardRealtime(new Request(room, { headers: { 'Sec-Fetch-Site': 'cross-site' } })))?.status, 403);
  assert.equal((await app.guardRealtime(new Request('https://example.test/chat/x')))?.status, 404);
  assert.equal((await app.fetch(new Request(room, { headers: browser }), render)).status, 426);
});


test('the browser solver finds what the server checks', async () => {
  const { solvePow } = await import('../src/lib/pow');
  const challenge = await createChallenge(SECRET, 50_000);
  const seen: number[] = [];
  const solution = await solvePow(challenge, (share) => seen.push(share), new AbortController().signal);
  assert.ok(solution);
  assert.ok(await verifySolution(SECRET, solution));
  assert.equal(seen.at(-1), 1);
  const aborted = new AbortController();
  aborted.abort();
  assert.equal(await solvePow({ ...challenge, challenge: '0'.repeat(64) }, () => {}, aborted.signal), null);
});

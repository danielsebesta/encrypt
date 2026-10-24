import { createHash, createHmac, randomBytes } from 'node:crypto';
import { createSocket } from 'node:dgram';
import WebSocket from 'ws';

// Usage: node scripts/smoke-node.mjs [base URL] [TURN host:port]. Checks a running Node or Docker deployment end to end;
// with a TURN address it also allocates a relay there using the credentials /api/turn hands out.
const base = new URL(process.argv[2] || 'http://localhost:8080');
const turnAddress = process.argv[3];
const wsBase = base.href.replace(/^http/, 'ws');
const failures = [];

function check(label, ok, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures.push(label);
}

async function page(path, expected) {
  const res = await fetch(new URL(path, base), { redirect: 'manual', headers: { Accept: 'text/html' } });
  await res.arrayBuffer();
  check(`GET ${path}`, [expected].flat().includes(res.status), `${res.status}`);
  return res;
}

function stunMessage(type, attributes, key) {
  const parts = attributes.map(([attr, value]) => {
    const head = Buffer.alloc(4);
    head.writeUInt16BE(attr, 0);
    head.writeUInt16BE(value.length, 2);
    return Buffer.concat([head, value, Buffer.alloc((4 - (value.length % 4)) % 4)]);
  });
  const header = Buffer.alloc(20);
  header.writeUInt16BE(type, 0);
  header.writeUInt32BE(0x2112a442, 4);
  randomBytes(12).copy(header, 8);
  let body = Buffer.concat(parts);
  if (key) {
    header.writeUInt16BE(body.length + 24, 2);
    const integrity = createHmac('sha1', key).update(Buffer.concat([header, body])).digest();
    body = Buffer.concat([body, Buffer.from([0, 8, 0, 20]), integrity]);
  }
  header.writeUInt16BE(body.length, 2);
  return Buffer.concat([header, body]);
}

function stunAttributes(message) {
  const found = new Map();
  for (let offset = 20; offset + 4 <= message.length;) {
    const length = message.readUInt16BE(offset + 2);
    found.set(message.readUInt16BE(offset), message.subarray(offset + 4, offset + 4 + length));
    offset += 4 + length + ((4 - (length % 4)) % 4);
  }
  return found;
}

// RFC 5766 Allocate over UDP: the first attempt is refused with a realm and nonce, the second carries the credential.
async function turnAllocate(address, username, credential) {
  const [host, port] = [address.slice(0, address.lastIndexOf(':')), Number(address.slice(address.lastIndexOf(':') + 1))];
  const udp = createSocket(host.includes(':') ? 'udp6' : 'udp4');
  const exchange = message => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('TURN server did not answer')), 3000);
    udp.once('message', reply => { clearTimeout(timer); resolve(reply); });
    udp.send(message, port, host);
  });
  const transport = [0x0019, Buffer.from([17, 0, 0, 0])];
  try {
    const challenge = stunAttributes(await exchange(stunMessage(0x0003, [transport])));
    const realm = challenge.get(0x0014);
    const nonce = challenge.get(0x0015);
    if (!realm || !nonce) return 'no realm or nonce in the challenge';
    const key = createHash('md5').update(`${username}:${realm}:${credential}`).digest();
    const reply = await exchange(stunMessage(0x0003, [[0x0006, Buffer.from(username)], [0x0014, realm], [0x0015, nonce], transport], key));
    return reply.readUInt16BE(0) === 0x0103 ? 'allocated' : `refused with type 0x${reply.readUInt16BE(0).toString(16)}`;
  } finally {
    udp.close();
  }
}

function socket(path) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(new URL(path, wsBase), { headers: { Origin: base.origin } });
    const inbox = [];
    const waiters = [];
    ws.on('message', data => {
      const message = JSON.parse(String(data));
      const waiter = waiters.findIndex(w => w.type === message.type);
      if (waiter >= 0) waiters.splice(waiter, 1)[0].resolve(message);
      else inbox.push(message);
    });
    ws.once('open', () => resolve({
      ws,
      send: value => ws.send(JSON.stringify(value)),
      next: type => {
        const found = inbox.findIndex(m => m.type === type);
        if (found >= 0) return Promise.resolve(inbox.splice(found, 1)[0]);
        return new Promise((done, fail) => {
          waiters.push({ type, resolve: done });
          setTimeout(() => fail(new Error(`no ${type} message`)), 5000).unref();
        });
      },
    }));
    ws.once('unexpected-response', (req, res) => { req.destroy(); reject(new Error(`upgrade refused with ${res.statusCode}`)); });
    ws.once('error', reject);
  });
}

try {
  const health = await page('/healthz', 200);
  check('healthz content type', health.headers.get('content-type')?.includes('json'));
  const home = await page('/', 200);
  check('home has CSP', Boolean(home.headers.get('content-security-policy')));
  await page('/chat/', 200);
  // Cloudflare renders these through the Worker, the Node server redirects from its static rules; both end on the same page.
  await page('/chat', [200, 307]);
  await page('/privacy', [200, 301]);
  await page('/no-such-page', 404);

  const status = await fetch(new URL('/upload/status', base), { headers: { 'Sec-Fetch-Site': 'same-origin' } });
  check('upload status', status.status === 200 && (await status.json()).available === true, String(status.status));
  const upload = Buffer.concat([Buffer.from('ECLK'), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), randomBytes(4096)]);
  const stored = await fetch(new URL('/upload', base), {
    method: 'POST',
    body: upload,
    headers: { 'Content-Type': 'application/octet-stream', Origin: base.origin, 'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Mode': 'cors' },
  });
  const { id } = stored.ok ? await stored.json() : {};
  check('upload accepted', typeof id === 'string', String(stored.status));
  if (id) {
    const download = await fetch(new URL(`/dl/${id}`, base), { headers: { 'Sec-Fetch-Site': 'same-origin' } });
    const bytes = Buffer.from(await download.arrayBuffer());
    check('download returns the ciphertext', download.status === 200 && bytes.equals(upload.subarray(4)), String(download.status));
  }

  const token = randomBytes(32).toString('hex');
  const room = createHash('sha256').update(`room-access-v2:${token}`).digest('hex');
  const path = `/parties/main/${room}`;
  const a = await socket(path);
  const b = await socket(path);
  check('first socket gets init', (await a.next('init')).type === 'init');
  check('second socket gets init', (await b.next('init')).type === 'init');
  a.send({ type: 'join', token, config: { mode: 'live', authMode: 'password', v: 3 } });
  await a.next('room-config');
  b.send({ type: 'join', token });
  // The first join's room-config also reaches sockets that have not joined yet, so wait until the room counts both.
  for (let presence = await a.next('presence'); presence.count < 2; presence = await a.next('presence'));
  const payload = randomBytes(48).toString('base64url');
  a.send({ type: 'message', id: 'smoke-1', payload });
  const relayed = await b.next('message');
  check('message relayed between sockets', relayed.payload === payload);
  a.send({ type: 'turn-grant' });
  const grant = (await a.next('turn-grant').catch(() => null))?.token;
  if (!grant) check('TURN grant (needs ROOM_TURN_SECRET)', !turnAddress, 'skipped');
  const turn = grant ? await fetch(new URL('/api/turn', base), { headers: { Authorization: `Bearer ${grant}`, 'Sec-Fetch-Site': 'same-origin' } }) : null;
  const ice = turn?.ok ? await turn.json() : {};
  if (turn) check('TURN credentials endpoint', turn.status === 200, `${turn.status}, turnReady ${ice.turnReady}`);
  if (turnAddress) {
    const server = ice.iceServers?.find(entry => [entry.urls].flat().some(url => url.startsWith('turn:')));
    check('TURN relay allocated', server ? (await turnAllocate(turnAddress, server.username, server.credential)) === 'allocated' : false,
      server ? [server.urls].flat().join(' ') : 'no TURN server offered');
  }
  a.ws.close();
  b.ws.close();

  const crossSite = await new Promise(resolve => {
    const ws = new WebSocket(new URL(path, wsBase), { headers: { Origin: 'https://evil.example' } });
    ws.once('unexpected-response', (req, res) => { req.destroy(); resolve(res.statusCode); });
    ws.once('open', () => { ws.close(); resolve(101); });
    ws.once('error', () => resolve(0));
  });
  check('cross-site upgrade refused', crossSite === 403, String(crossSite));
} catch (error) {
  check('smoke test ran', false, error instanceof Error ? error.message : String(error));
}

if (failures.length) {
  console.error(`${failures.length} check(s) failed`);
  process.exit(1);
}

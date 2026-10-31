import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { TLSSocket } from 'node:tls';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { DatabaseSync } from 'node:sqlite';
import { createApp } from '../../server/app';
import { runBudgetCommand } from '../../server/budget';
import { setRuntimeEnv } from '../../platform/env';
import type { Platform, SqlLike } from '../../platform/types';
import { FileBlobStore } from './blobs';
import { RealtimeRooms, ROOM_ROUTE_RE } from './realtime';
import { openDatabase, RoomDatabase, sqlLike, transaction } from './sqlite';
import { StaticSite } from './static';

type AstroEntry = { render(request: Request, clientAddress: string, errorPage: (url: string) => Promise<Response>): Promise<Response> };

const SWEEP_MS = 60 * 60 * 1000;
const SHUTDOWN_GRACE_MS = 8000;
const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'proxy-connection']);

const env = process.env;
setRuntimeEnv(env);

const port = Number(env.PORT || 8080);
const host = env.HOST || undefined;
const dataDir = path.resolve(env.DATA_DIR || '/data');
const publicUrl = env.PUBLIC_URL ? new URL(env.PUBLIC_URL) : null;
const trustHops = /^\d+$/.test(env.TRUST_PROXY ?? '') ? Number(env.TRUST_PROXY) : /^(true|yes|on)$/i.test(env.TRUST_PROXY ?? '') ? 1 : 0;
const distDir = fileURLToPath(new URL('../', import.meta.url));

for (const dir of ['uploads', 'budget']) mkdirSync(path.join(dataDir, dir), { recursive: true, mode: 0o700 });

const budgets = new Map<string, { db: DatabaseSync; sql: SqlLike }>();
function budgetDatabase(scope: string) {
  let entry = budgets.get(scope);
  if (!entry) {
    const db = openDatabase(path.join(dataDir, 'budget', `${createHash('sha256').update(scope).digest('hex').slice(0, 32)}.sqlite`));
    entry = { db, sql: sqlLike(db) };
    budgets.set(scope, entry);
  }
  return entry;
}

// IPv4 peers on a dual-stack socket show up as ::ffff:a.b.c.d and must not be grouped as one IPv6 /64.
const plainIp = (ip: string) => ip.trim().replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, '');

function clientAddress(req: IncomingMessage): string {
  const socket = req.socket.remoteAddress ?? '';
  if (!trustHops) return plainIp(socket);
  const forwarded = String(req.headers['x-forwarded-for'] ?? '').split(',').map(part => part.trim()).filter(Boolean);
  return plainIp(forwarded[Math.max(0, forwarded.length - trustHops)] ?? socket);
}

function requestOrigin(req: IncomingMessage): string {
  if (publicUrl) return publicUrl.origin;
  const forwardedProto = trustHops ? String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim() : '';
  const protocol = forwardedProto === 'https' || forwardedProto === 'http' ? forwardedProto : (req.socket as TLSSocket).encrypted ? 'https' : 'http';
  const hostHeader = req.headers.host ?? '';
  return `${protocol}://${/^[A-Za-z0-9.-]+(:\d+)?$|^\[[0-9A-Fa-f:.]+\](:\d+)?$/.test(hostHeader) ? hostHeader : `localhost:${port}`}`;
}

/** The visitor's address travels as CF-Connecting-IP, the header the Workers runtime sets, after any client copy is dropped. */
function toRequest(req: IncomingMessage, signal?: AbortSignal): Request {
  const target = req.url ?? '/';
  if (!target.startsWith('/')) throw new Error('Unsupported request target');
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined || name.startsWith(':')) continue;
    for (const item of Array.isArray(value) ? value : [value]) headers.append(name, item);
  }
  headers.set('CF-Connecting-IP', clientAddress(req));
  const method = req.method ?? 'GET';
  const body = method === 'GET' || method === 'HEAD' ? undefined : Readable.toWeb(req) as ReadableStream<Uint8Array>;
  return new Request(`${requestOrigin(req)}${target}`, { method, headers, signal, body, ...(body ? { duplex: 'half' } : {}) } as RequestInit);
}

async function send(res: ServerResponse, response: Response, head: boolean) {
  const headers: Record<string, string | string[]> = {};
  response.headers.forEach((value, name) => {
    if (!HOP_BY_HOP.has(name) && name !== 'set-cookie') headers[name] = value;
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) headers['set-cookie'] = cookies;
  res.writeHead(response.status, response.statusText || undefined, headers);
  if (!response.body || head) {
    await response.body?.cancel().catch(() => {});
    res.end();
    return;
  }
  await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream<Uint8Array>), res);
}

const roomDatabase = new RoomDatabase(path.join(dataDir, 'rooms.sqlite'));
const rooms = new RealtimeRooms(roomDatabase, env);
const uploadsDatabase = openDatabase(path.join(dataDir, 'uploads.sqlite'));
const blobs = new FileBlobStore(path.join(dataDir, 'uploads'), () => Date.now(), uploadsDatabase);
await blobs.init();
const sweep = () => blobs.sweep().catch(error => console.error('Upload sweep failed:', error instanceof Error ? error.message : error));
void sweep();
setInterval(sweep, SWEEP_MS).unref();

const platform: Platform = {
  env,
  clientIp: request => request.headers.get('CF-Connecting-IP') ?? '',
  budget: async <T>(scope: string, command: Parameters<Platform['budget']>[1]) => {
    const { db, sql } = budgetDatabase(scope);
    return transaction(db, () => runBudgetCommand(sql, command)) as T;
  },
  blobs,
  realtime: async request => ROOM_ROUTE_RE.test(new URL(request.url).pathname)
    ? new Response('Expected WebSocket', { status: 426 })
    : new Response('Not found', { status: 404 }),
  waitUntil: work => { work.catch(error => console.error('Background task failed:', error instanceof Error ? error.message : error)); },
};

const site = await StaticSite.load(path.join(distDir, 'client'));
const astro = await import(pathToFileURL(path.join(distDir, 'server', 'entry.mjs')).href) as AstroEntry;
const app = createApp(platform);

const errorPage = async (url: string) => {
  const { pathname } = new URL(url);
  const page = site.read(pathname) ?? site.read('/404.html', pathname);
  if (!page) throw new Error('No prerendered error page');
  return page;
};
const render = async (request: Request) =>
  site.serve(request) ?? astro.render(request, request.headers.get('CF-Connecting-IP') ?? '', errorPage);

const server = createServer({ requestTimeout: 30 * 60 * 1000, headersTimeout: 60_000, keepAliveTimeout: 65_000 }, async (req, res) => {
  const head = req.method === 'HEAD';
  if (!req.url?.startsWith('/')) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end('Bad request');
    return;
  }
  const abort = new AbortController();
  res.on('close', () => { if (!res.writableFinished) abort.abort(); });
  try {
    const response = await app.fetch(toRequest(req, abort.signal), render);
    await send(res, response, head);
  } catch (error) {
    if (abort.signal.aborted) return;
    console.error('Request failed:', error instanceof Error ? error.stack ?? error.message : error);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end('Internal Server Error');
    } else {
      res.destroy();
    }
  }
});

const sockets = rooms.listen(server, req => toRequest(req), request => app.guardRealtime(request));

process.on('unhandledRejection', reason => console.error('Unhandled rejection:', reason instanceof Error ? reason.stack ?? reason.message : reason));

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  const closed = new Promise(resolve => server.close(resolve));
  server.closeIdleConnections();
  const force = setTimeout(() => {
    for (const socket of sockets.clients) socket.terminate();
    server.closeAllConnections();
  }, SHUTDOWN_GRACE_MS);
  force.unref();
  await rooms.shutdown(SHUTDOWN_GRACE_MS / 2);
  await closed;
  roomDatabase.close();
  uploadsDatabase.close();
  for (const { db } of budgets.values()) db.close();
  process.exit(0);
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);

server.listen(port, host, () => {
  const address = server.address();
  const shown = typeof address === 'object' && address ? `${address.address.includes(':') ? `[${address.address}]` : address.address}:${address.port}` : String(address);
  console.log(`encrypt.click listening on ${shown}${publicUrl ? ` as ${publicUrl.origin}` : ''}`);
});

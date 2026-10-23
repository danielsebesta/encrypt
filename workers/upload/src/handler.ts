import { MAX_FIRST_PARTY_BYTES, clientPrefix, readJsonLimited } from '../../../src/lib/httpLimits';
import { PASSWORD_ENVELOPE_MAGIC } from '../../../src/lib/passwordEnvelope';
import { PASS_HEADER, PASS_MESSAGE, SITE_ORIGIN, browserFetch, issuePass, verifyPass } from '../../../src/lib/uploadPass';
import type { UploadBudget } from './index';

export interface Env {
  BUCKET: R2Bucket;
  BUDGET: DurableObjectNamespace<UploadBudget>;
  UPLOAD_PASS_SECRET?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
}

export type Reservation = 'ok' | 'full' | 'client' | 'challenge';

const MAX_FILE_SIZE = MAX_FIRST_PARTY_BYTES;
const MAGIC_BYTES = new Uint8Array([69, 67, 76, 75]);
const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
// Everything our clients upload is a password envelope or, for small shares, a stego PNG that wraps one.
const FORMATS = [PASSWORD_ENVELOPE_MAGIC, PNG_SIGNATURE];
const HEAD_BYTES = MAGIC_BYTES.length + 8;
const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com';
const TURNSTILE_ACTION = 'upload';
const TURNSTILE_LANGUAGES = new Set(['en', 'cs', 'de', 'es', 'fr', 'sk', 'pl']);

export const corsHeaders = {
  'Access-Control-Allow-Origin': SITE_ORIGIN,
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': `Content-Type, Content-Length, ${PASS_HEADER}`,
  'Access-Control-Expose-Headers': 'Retry-After',
};

function respond(body: string, status: number, isJson = false, extra: Record<string, string> = {}) {
  return new Response(body, { status, headers: { ...corsHeaders, 'Content-Type': isJson ? 'application/json' : 'text/plain', ...extra } });
}

export function challengeReady(env: Env): boolean {
  return Boolean(env.UPLOAD_PASS_SECRET && env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY);
}

function secondsUntilTomorrow(): string {
  return String(Math.ceil((86_400_000 - (Date.now() % 86_400_000)) / 1000));
}

function knownFormat(head: Uint8Array): boolean {
  return head.length >= HEAD_BYTES
    && MAGIC_BYTES.every((b, i) => head[i] === b)
    && FORMATS.some(format => format.every((b, i) => head[MAGIC_BYTES.length + i] === b));
}

async function readHead(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<Uint8Array> {
  let head = new Uint8Array(0);
  while (head.length < HEAD_BYTES) {
    const { value, done } = await reader.read();
    if (done) break;
    const joined = new Uint8Array(head.length + value.length);
    joined.set(head);
    joined.set(value, head.length);
    head = joined;
  }
  return head;
}

function challengePage(env: Env, url: URL): Response {
  const nonce = crypto.randomUUID().replace(/-/g, '');
  const lang = url.searchParams.get('lang') ?? '';
  const config = {
    sitekey: env.TURNSTILE_SITE_KEY,
    action: TURNSTILE_ACTION,
    language: TURNSTILE_LANGUAGES.has(lang) ? lang : 'auto',
    theme: url.searchParams.get('theme') === 'dark' ? 'dark' : 'light',
    size: url.searchParams.get('size') === 'compact' ? 'compact' : 'normal',
  };
  const script = `const config = ${JSON.stringify(config).replace(/</g, '\\u003c')};
const origin = ${JSON.stringify(SITE_ORIGIN)};
const notify = message => parent.postMessage(message, origin);
window.onTurnstile = () => turnstile.render('#widget', { ...config, callback: async token => {
  try {
    const res = await fetch('/challenge/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
    const data = await res.json();
    if (!res.ok || typeof data.pass !== 'string') throw new Error();
    notify({ type: ${JSON.stringify(PASS_MESSAGE)}, pass: data.pass, expires: data.expires });
  } catch {
    notify({ type: ${JSON.stringify(`${PASS_MESSAGE}-error`)} });
    turnstile.reset('#widget');
  }
}, 'error-callback': () => notify({ type: ${JSON.stringify(`${PASS_MESSAGE}-error`)} }) });`;
  const html = `<!doctype html><html lang="${config.language === 'auto' ? 'en' : config.language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><style>html,body{margin:0;height:100%;background:transparent;color-scheme:${config.theme}}body{display:flex;align-items:center;justify-content:center;overflow:hidden}</style></head><body><div id="widget"></div><script nonce="${nonce}">${script}</script><script nonce="${nonce}" src="${TURNSTILE_ORIGIN}/turnstile/v0/api.js?onload=onTurnstile&amp;render=explicit" async></script></body></html>`;
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}' ${TURNSTILE_ORIGIN}; frame-src ${TURNSTILE_ORIGIN}; connect-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors ${SITE_ORIGIN}`,
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

async function verifyChallenge(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  if (request.headers.get('Origin') !== url.origin) return json({ error: 'Forbidden Origin' }, 403);
  let token: unknown;
  try { token = (await readJsonLimited(request, 4096))?.token; } catch { return json({ error: 'Invalid request' }, 400); }
  if (typeof token !== 'string' || !token || token.length > 2048) return json({ error: 'Invalid request' }, 400);

  const ip = request.headers.get('CF-Connecting-IP') ?? '';
  const form = new FormData();
  form.set('secret', env.TURNSTILE_SECRET_KEY!);
  form.set('response', token);
  if (ip) form.set('remoteip', ip);
  form.set('idempotency_key', crypto.randomUUID());
  let outcome: any = null;
  try {
    const res = await fetch(SITEVERIFY_URL, { method: 'POST', body: form, signal: AbortSignal.timeout(10_000) });
    outcome = await res.json();
  } catch { return json({ error: 'Verification unavailable' }, 503); }
  if (outcome?.success !== true || outcome.action !== TURNSTILE_ACTION || outcome.hostname !== url.hostname) return json({ error: 'Verification failed' }, 403);
  return json(await issuePass(env.UPLOAD_PASS_SECRET!, clientPrefix(ip)), 200);
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { headers: { ...corsHeaders, 'Access-Control-Max-Age': '86400' } });

  const url = new URL(request.url);
  if (url.pathname === '/challenge' || url.pathname === '/challenge/verify') {
    if (!challengeReady(env)) return new Response('Not found', { status: 404 });
    if (url.pathname === '/challenge' && request.method === 'GET') return challengePage(env, url);
    if (url.pathname === '/challenge/verify' && request.method === 'POST') return verifyChallenge(request, env);
    return new Response('Method Not Allowed', { status: 405 });
  }

  const budget = env.BUDGET.get(env.BUDGET.idFromName('budget'));
  if (request.method === 'GET' && url.pathname === '/status') {
    return respond(JSON.stringify(await budget.status()), 200, true);
  }
  if (request.method !== 'POST') return respond('Method Not Allowed', 405);
  if (request.headers.get('Origin') !== SITE_ORIGIN) return respond('Forbidden Origin', 403);

  const contentLength = Number(request.headers.get('Content-Length'));
  if (!request.headers.get('Content-Length') || !Number.isSafeInteger(contentLength) || contentLength <= MAGIC_BYTES.length) {
    return respond('Length Required', 411);
  }
  if (contentLength > MAX_FILE_SIZE) return respond('Payload Too Large', 413);
  if (!request.body) return respond('Empty body', 400);

  const ip = clientPrefix(request.headers.get('CF-Connecting-IP') ?? '');
  const pass = await verifyPass(request.headers.get(PASS_HEADER), env.UPLOAD_PASS_SECRET, ip);
  const browser = browserFetch(request.headers, ['same-site', 'same-origin']);
  const reservation: Reservation = await budget.reserve(contentLength, ip, { browser, pass });
  if (reservation === 'full') return respond('Upload storage is full. Try again later.', 503);
  if (reservation === 'client') return respond('Daily upload limit reached.', 429, false, { 'Retry-After': secondsUntilTomorrow() });
  if (reservation === 'challenge') {
    return challengeReady(env)
      ? respond(JSON.stringify({ challenge: 'turnstile' }), 428, true)
      : respond('Too many uploads. Try again later.', 429, false, { 'Retry-After': '3600' });
  }

  const reader = request.body.getReader();
  const head = await readHead(reader);
  if (!knownFormat(head) || head.length > contentLength) {
    await reader.cancel().catch(() => {});
    await budget.release(contentLength, ip);
    return respond('Invalid signature. Only encrypt.click client data allowed.', 400);
  }

  const fixedStream = new FixedLengthStream(contentLength);
  const writer = fixedStream.writable.getWriter();
  (async () => {
    try {
      let totalBytes = head.length;
      await writer.write(head);
      while (true) {
        const { value, done: finished } = await reader.read();
        if (finished) break;
        totalBytes += value.length;
        if (totalBytes > contentLength) {
          await writer.abort('Body longer than Content-Length');
          return;
        }
        await writer.write(value);
      }
      await writer.close();
    } catch (err) {
      await writer.abort(err).catch(() => {});
    }
  })();

  const fileId = crypto.randomUUID();
  try {
    await env.BUCKET.put(fileId, fixedStream.readable, { httpMetadata: { contentType: 'application/octet-stream', contentDisposition: 'attachment; filename="encrypted.bin"' } });
    return respond(JSON.stringify({ success: true, id: fileId }), 200, true);
  } catch {
    await budget.release(contentLength, ip);
    return respond('Storage error', 500);
  }
}

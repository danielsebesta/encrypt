import { MAX_FIRST_PARTY_BYTES, clientPrefix, readJsonLimited } from '../lib/httpLimits';
import { PASSWORD_ENVELOPE_MAGICS } from '../lib/passwordEnvelope';
import { PASS_HEADER, browserFetch, issuePass, verifyPass } from '../lib/uploadPass';
import type { Platform, UploadLimits } from '../platform/types';
import type { Reservation } from './budget';
import { createChallenge, parseSolution, powDifficulty, verifySolution } from './pow';

export const UPLOAD_SCOPE = 'uploads';
const GB = 1000 ** 3;
const MAGIC_BYTES = new Uint8Array([69, 67, 76, 75]);
const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
// Everything our clients upload is a password envelope or, for small shares, a stego PNG that wraps one.
const FORMATS = [...PASSWORD_ENVELOPE_MAGICS, PNG_SIGNATURE];
const HEAD_BYTES = MAGIC_BYTES.length + Math.max(...FORMATS.map(format => format.length));
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const enc = new TextEncoder();
const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');

const gigabytes = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return (Number.isFinite(n) && n > 0 ? n : fallback) * GB;
};

// Defaults keep Cloudflare R2 under about $1 a month; self-hosted instances size them to their disk.
export function uploadLimits(env: Platform['env']): UploadLimits {
  return {
    monthlyBytes: gigabytes(env.UPLOAD_MONTHLY_GB, 1000),
    monthlyUploads: Number(env.UPLOAD_MONTHLY_FILES) > 0 ? Number(env.UPLOAD_MONTHLY_FILES) : 500_000,
    dailyBytes: gigabytes(env.UPLOAD_DAILY_GB, 100),
    dailyBytesPerClient: gigabytes(env.UPLOAD_CLIENT_DAILY_GB, 5),
    maxFileBytes: MAX_FIRST_PARTY_BYTES,
  };
}

/** One secret signs passes and challenges; each use gets its own label so the keys never coincide. */
export function challengeSecret(env: Platform['env']): string {
  return env.UPLOAD_PASS_SECRET || env.RATE_LIMIT_SECRET || env.ROOM_TURN_SECRET || '';
}

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra } });
}

function secondsUntilTomorrow(): string {
  return String(Math.ceil((86_400_000 - (Date.now() % 86_400_000)) / 1000));
}

let saltCache: { day: string; salt: string } | null = null;

async function clientId(platform: Platform, prefix: string): Promise<string> {
  const day = new Date().toISOString().slice(0, 10);
  if (saltCache?.day !== day) saltCache = { day, salt: await platform.budget<string>(UPLOAD_SCOPE, { op: 'salt' }) };
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(`${saltCache.salt}:${prefix}`)));
}

/** What a client sees when it has to prove some work before the next upload, or a plain refusal without a secret. */
export function challengeResponse(env: Platform['env']): Response {
  return challengeSecret(env)
    ? json({ challenge: 'pow' }, 428)
    : json({ error: 'Too many uploads. Try again later.' }, 429, { 'Retry-After': '3600' });
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

// Re-emits the bytes already read for the format check, then the rest, and fails if the body runs past its declared length.
function exactly(head: Uint8Array, reader: ReadableStreamDefaultReader<Uint8Array>, length: number): ReadableStream<Uint8Array> {
  let sent = 0;
  let first = true;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const chunk = first ? { value: head, done: false } : await reader.read();
      first = false;
      if (chunk.done) return controller.close();
      sent += chunk.value.length;
      if (sent > length) {
        await reader.cancel().catch(() => {});
        return controller.error(new Error('Body longer than Content-Length'));
      }
      controller.enqueue(chunk.value);
    },
    cancel(reason) { return reader.cancel(reason); },
  });
}

async function upload(request: Request, platform: Platform): Promise<Response> {
  const limits = uploadLimits(platform.env);
  const length = Number(request.headers.get('Content-Length'));
  if (!request.headers.get('Content-Length') || !Number.isSafeInteger(length) || length <= HEAD_BYTES) return json({ error: 'Length required' }, 411);
  if (length > limits.maxFileBytes) return json({ error: 'Payload too large' }, 413);
  if (!request.body) return json({ error: 'Empty body' }, 400);

  const prefix = clientPrefix(platform.clientIp(request));
  const client = await clientId(platform, prefix);
  const pass = await verifyPass(request.headers.get(PASS_HEADER), challengeSecret(platform.env) || undefined, prefix);
  const browser = browserFetch(request.headers, ['same-origin']);
  const reservation = await platform.budget<Reservation>(UPLOAD_SCOPE, { op: 'reserve', client, bytes: length, browser, pass, limits });
  if (reservation === 'full') return json({ error: 'Upload storage is full. Try again later.' }, 503);
  if (reservation === 'client') return json({ error: 'Daily upload limit reached.' }, 429, { 'Retry-After': secondsUntilTomorrow() });
  if (reservation === 'challenge') return challengeResponse(platform.env);

  const release = () => platform.budget(UPLOAD_SCOPE, { op: 'release', client, bytes: length, limits });
  const reader = request.body.getReader();
  const head = await readHead(reader);
  if (!knownFormat(head) || head.length > length) {
    await reader.cancel().catch(() => {});
    await release();
    return json({ error: 'Only encrypt.click client data is accepted.' }, 400);
  }

  const id = crypto.randomUUID();
  try {
    await platform.blobs.put(id, exactly(head, reader, length), length);
    return json({ success: true, id });
  } catch {
    await release();
    return json({ error: 'Storage error' }, 500);
  }
}

// Stored objects keep the four-byte marker the uploader checked; downloads hand back the ciphertext alone.
async function download(id: string, platform: Platform): Promise<Response> {
  const blob = ID_RE.test(id) ? await platform.blobs.get(id) : null;
  if (!blob || blob.size <= MAGIC_BYTES.length) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  let skip = MAGIC_BYTES.length;
  const body = blob.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      if (skip >= chunk.length) { skip -= chunk.length; return; }
      controller.enqueue(skip ? chunk.subarray(skip) : chunk);
      skip = 0;
    },
  }));
  return new Response(body, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(blob.size - MAGIC_BYTES.length),
      'Content-Disposition': 'attachment; filename="encrypted.bin"',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
}

async function challenge(request: Request, platform: Platform): Promise<Response> {
  const secret = challengeSecret(platform.env);
  if (!secret) return json({ error: 'Not available' }, 404);
  const prefix = clientPrefix(platform.clientIp(request));
  const count = await platform.budget<number>(UPLOAD_SCOPE, { op: 'challenges', client: await clientId(platform, prefix) });
  return json(await createChallenge(secret, powDifficulty(count)));
}

async function redeem(request: Request, platform: Platform): Promise<Response> {
  const secret = challengeSecret(platform.env);
  if (!secret) return json({ error: 'Not available' }, 404);
  let solution;
  try { solution = parseSolution((await readJsonLimited(request, 4096))?.solution); } catch { return json({ error: 'Invalid request' }, 400); }
  if (!solution) return json({ error: 'Invalid request' }, 400);
  const expires = await verifySolution(secret, solution);
  if (expires === null) return json({ error: 'Verification failed' }, 403);
  if (!(await platform.budget<boolean>(UPLOAD_SCOPE, { op: 'spend', nonce: solution.challenge, expires }))) return json({ error: 'Already used' }, 403);
  return json(await issuePass(secret, clientPrefix(platform.clientIp(request))));
}

/** Same-origin upload routes; null when the path is not one of them. */
export async function handleUploadRoute(request: Request, path: string, platform: Platform): Promise<Response | null> {
  const method = request.method;
  if (path === '/upload') return method === 'POST' ? upload(request, platform) : json({ error: 'Method not allowed' }, 405, { Allow: 'POST' });
  if (path === '/upload/status') {
    if (method !== 'GET') return json({ error: 'Method not allowed' }, 405, { Allow: 'GET' });
    return json(await platform.budget(UPLOAD_SCOPE, { op: 'status', limits: uploadLimits(platform.env) }));
  }
  if (path === '/upload/challenge') return method === 'GET' ? challenge(request, platform) : json({ error: 'Method not allowed' }, 405, { Allow: 'GET' });
  if (path === '/upload/pass') return method === 'POST' ? redeem(request, platform) : json({ error: 'Method not allowed' }, 405, { Allow: 'POST' });
  if (path.startsWith('/dl/')) {
    if (method !== 'GET' && method !== 'HEAD') return json({ error: 'Method not allowed' }, 405, { Allow: 'GET, HEAD' });
    return download(path.slice(4), platform);
  }
  return null;
}

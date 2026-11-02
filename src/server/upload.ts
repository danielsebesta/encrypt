import {
  MAX_FIRST_PARTY_BYTES,
  clientPrefix,
  readJsonLimited,
} from '../lib/httpLimits';
import { PASSWORD_ENVELOPE_MAGIC } from '../lib/passwordEnvelope';
import {
  BLOB_ID_RE,
  BURN_HEADER,
  DEFAULT_RETENTION,
  RETENTION_HEADER,
  RETENTION_MS,
  blobId,
  isRetention,
  retentionDays,
  retentionOfId,
  uuidOfId,
  type Retention,
} from '../lib/retention';
import { PASS_HEADER, browserFetch, issuePass, verifyPass } from '../lib/uploadPass';
import type { Platform, UploadLimits } from '../platform/types';
import type { Reservation, UploadStatus } from './budget';
import { createChallenge, parseSolution, powDifficulty, verifySolution } from './pow';
import { signR2PutUrl } from './r2Presign';

export const UPLOAD_SCOPE = 'uploads';
export const DOWNLOAD_SCOPE = 'downloads';
const GB = 1000 ** 3;
const MAGIC_BYTES = new Uint8Array([69, 67, 76, 75]);
const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
// Everything our clients upload is a password envelope or, for small shares, a stego PNG that wraps one.
const FORMATS = [PASSWORD_ENVELOPE_MAGIC, PNG_SIGNATURE];
const HEAD_BYTES = MAGIC_BYTES.length + Math.max(...FORMATS.map(format => format.length));

const enc = new TextEncoder();
const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');

const gigabytes = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return (Number.isFinite(n) && n > 0 ? n : fallback) * GB;
};

// Defaults keep Cloudflare R2 under about $1 a month; self-hosted instances size them to their disk. Byte quotas count
// stored byte-days: an upload is charged its size once per day it is kept, so a 7-day upload costs seven times as much.
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

/** Retention and one-time download from the request; requests without them keep the default of one day, many downloads. */
export function uploadOptions(headers: Headers): { retention: Retention; burn: boolean } | null {
  const retention = headers.get(RETENTION_HEADER) ?? DEFAULT_RETENTION;
  const burn = headers.get(BURN_HEADER) ?? '0';
  if (!isRetention(retention) || (burn !== '0' && burn !== '1')) return null;
  return { retention, burn: burn === '1' };
}

async function reserveUpload(
  request: Request,
  platform: Platform,
  bytes: number,
  retention: Retention,
): Promise<{ ok: true; client: string; charged: number; limits: UploadLimits } | { ok: false; response: Response }> {
  const limits = uploadLimits(platform.env);
  const prefix = clientPrefix(platform.clientIp(request));
  const client = await clientId(platform, prefix);
  const pass = await verifyPass(request.headers.get(PASS_HEADER), challengeSecret(platform.env) || undefined, prefix);
  const browser = browserFetch(request.headers, ['same-origin']);
  const charged = bytes * retentionDays(retention);
  const reservation = await platform.budget<Reservation>(UPLOAD_SCOPE, { op: 'reserve', client, bytes: charged, browser, pass, limits });
  if (reservation === 'full') return { ok: false, response: json({ error: 'Upload storage is full. Try again later.' }, 503) };
  if (reservation === 'client') return { ok: false, response: json({ error: 'Daily upload limit reached.' }, 429, { 'Retry-After': secondsUntilTomorrow() }) };
  if (reservation === 'challenge') return { ok: false, response: challengeResponse(platform.env) };
  return { ok: true, client, charged, limits };
}

async function directUpload(request: Request, platform: Platform): Promise<Response> {
  const options = uploadOptions(request.headers);
  if (!options) return json({ error: 'Invalid upload options' }, 400);

  let body: any;
  try {
    body = await readJsonLimited(request, 1024);
  } catch {
    return json({ error: 'Invalid request body' }, 400);
  }
  const length = Number(body?.size);
  if (!Number.isSafeInteger(length) || length <= HEAD_BYTES) return json({ error: 'Invalid size' }, 400);
  if (length > MAX_FIRST_PARTY_BYTES) return json({ error: 'Payload too large' }, 413);

  const accountId = platform.env.R2_ACCOUNT_ID || platform.env.CLOUDFLARE_ACCOUNT_ID || platform.env.CF_ACCOUNT_ID || 'c76ce085303f62a966fac128aa2952ae';
  const accessKeyId = platform.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = platform.env.R2_SECRET_ACCESS_KEY;
  const bucketName = platform.env.R2_BUCKET_NAME || 'encrypt-r2';
  const jurisdiction = platform.env.R2_JURISDICTION || 'eu';

  if (!accountId || !accessKeyId || !secretAccessKey) {
    return json({ success: true, mode: 'relay' });
  }

  const reserved = await reserveUpload(request, platform, length, options.retention);
  if (!reserved.ok) return reserved.response;

  const id = blobId(options.retention, crypto.randomUUID());
  const expires = Date.now() + RETENTION_MS[options.retention];
  const objectKey = `t${retentionOfId(id)}/${uuidOfId(id)}`;
  const metaHeaders: Record<string, string> = {
    'content-type': 'application/octet-stream',
    'x-amz-meta-expires': String(expires),
    'x-amz-meta-burn': options.burn ? '1' : '0',
  };
  const signedHeaders: Record<string, string> = {
    ...metaHeaders,
    'content-length': String(length),
  };

  try {
    const uploadUrl = await signR2PutUrl({
      accountId,
      bucketName,
      jurisdiction,
      key: objectKey,
      accessKeyId,
      secretAccessKey,
      expiresInSeconds: 3600,
      headers: signedHeaders,
    });

    return json({
      success: true,
      mode: 'r2-direct',
      uploadUrl,
      headers: metaHeaders,
      id,
      expires,
      burn: options.burn,
    });
  } catch {
    await platform.budget(UPLOAD_SCOPE, { op: 'release', client: reserved.client, bytes: reserved.charged, limits: reserved.limits });
    return json({ error: 'Storage presign error' }, 500);
  }
}

async function upload(request: Request, platform: Platform): Promise<Response> {
  const options = uploadOptions(request.headers);
  if (!options) return json({ error: 'Invalid upload options' }, 400);
  const length = Number(request.headers.get('Content-Length'));
  if (!request.headers.get('Content-Length') || !Number.isSafeInteger(length) || length <= HEAD_BYTES) return json({ error: 'Length required' }, 411);
  if (length > MAX_FIRST_PARTY_BYTES) return json({ error: 'Payload too large' }, 413);
  if (!request.body) return json({ error: 'Empty body' }, 400);

  const reserved = await reserveUpload(request, platform, length, options.retention);
  if (!reserved.ok) return reserved.response;

  const release = () => platform.budget(UPLOAD_SCOPE, { op: 'release', client: reserved.client, bytes: reserved.charged, limits: reserved.limits });
  const reader = request.body.getReader();
  const head = await readHead(reader);
  if (!knownFormat(head) || head.length > length) {
    await reader.cancel().catch(() => {});
    await release();
    return json({ error: 'Only encrypt.click client data is accepted.' }, 400);
  }

  const id = blobId(options.retention, crypto.randomUUID());
  const expires = Date.now() + RETENTION_MS[options.retention];
  try {
    await platform.blobs.put(id, exactly(head, reader, length), length, { expires, burn: options.burn });
    return json({ success: true, id, expires, burn: options.burn });
  } catch {
    await release();
    return json({ error: 'Storage error' }, 500);
  }
}

const notFound = () => new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });

// Drops the four-byte magic marker and delivers the remaining ciphertext stream.
function servedCiphertext(
  headRest: Uint8Array,
  reader: ReadableStreamDefaultReader<Uint8Array>,
  done: () => void,
): ReadableStream<Uint8Array> {
  let first = true;
  let finished = false;
  const finish = () => { if (!finished) { finished = true; done(); } };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (first) {
          first = false;
          if (headRest.length > 0) {
            controller.enqueue(headRest);
            return;
          }
        }
        const { value, done: end } = await reader.read();
        if (end) {
          controller.close();
          finish();
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        controller.error(error);
        finish();
      }
    },
    async cancel(reason) {
      await reader.cancel(reason).catch(() => {});
      finish();
    },
  });
}

const DOWNLOAD_HEADERS = (size: number): HeadersInit => ({
  'Content-Type': 'application/octet-stream',
  'Content-Length': String(size),
  'Content-Disposition': 'attachment; filename="encrypted.bin"',
  'Content-Security-Policy': "default-src 'none'; sandbox",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cache-Control': 'private, no-store',
});

// Stored objects must be valid ECLK encrypted envelopes; downloads hand back the ciphertext alone.
// Even with direct R2 uploads, format validation occurs before any bytes or burn tokens are spent.
// An invalid or unencrypted file is rejected with 404 and purged immediately.
async function download(request: Request, id: string, platform: Platform): Promise<Response> {
  const blob = BLOB_ID_RE.test(id) ? await platform.blobs.get(id) : null;
  if (!blob) return notFound();
  const isHead = request.method === 'HEAD';
  if (blob.size <= HEAD_BYTES || Date.now() >= blob.expires) {
    await blob.body.cancel().catch(() => {});
    return notFound();
  }

  const reader = blob.body.getReader();
  const head = await readHead(reader);
  if (!knownFormat(head)) {
    await reader.cancel().catch(() => {});
    platform.waitUntil(platform.blobs.delete(id));
    return notFound();
  }

  if (isHead) {
    await reader.cancel().catch(() => {});
    return new Response(null, { headers: DOWNLOAD_HEADERS(blob.size - MAGIC_BYTES.length) });
  }

  if (blob.burn && !(await platform.budget<boolean>(DOWNLOAD_SCOPE, { op: 'spend', nonce: `burn:${id}`, expires: blob.expires }))) {
    await reader.cancel().catch(() => {});
    return notFound();
  }

  const headRest = head.subarray(MAGIC_BYTES.length);
  const body = servedCiphertext(headRest, reader, () => {
    if (blob.burn) platform.waitUntil(platform.blobs.delete(id));
  });

  return new Response(body, { headers: DOWNLOAD_HEADERS(blob.size - MAGIC_BYTES.length) });
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
  if (path === '/upload/direct') return method === 'POST' ? directUpload(request, platform) : json({ error: 'Method not allowed' }, 405, { Allow: 'POST' });
  if (path === '/upload/status') {
    if (method !== 'GET') return json({ error: 'Method not allowed' }, 405, { Allow: 'GET' });
    const { available, maxFileSize } = await platform.budget<UploadStatus>(UPLOAD_SCOPE, { op: 'status', limits: uploadLimits(platform.env) });
    return json({ available, maxFileSize });
  }
  if (path === '/upload/challenge') return method === 'GET' ? challenge(request, platform) : json({ error: 'Method not allowed' }, 405, { Allow: 'GET' });
  if (path === '/upload/pass') return method === 'POST' ? redeem(request, platform) : json({ error: 'Method not allowed' }, 405, { Allow: 'POST' });
  if (path.startsWith('/dl/')) {
    if (method !== 'GET' && method !== 'HEAD') return json({ error: 'Method not allowed' }, 405, { Allow: 'GET, HEAD' });
    return download(request, path.slice(4), platform);
  }
  if (path === '/upload' || path.startsWith('/upload/')) return json({ error: 'Not found' }, 404);
  return null;
}

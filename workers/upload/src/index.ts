import { DurableObject } from 'cloudflare:workers';
import { MAX_FIRST_PARTY_BYTES } from '../../../src/lib/httpLimits';

interface Env {
  BUCKET: R2Bucket;
  BUDGET: DurableObjectNamespace<UploadBudget>;
}

const ORIGIN = 'https://encrypt.click';
const MAX_FILE_SIZE = MAX_FIRST_PARTY_BYTES;
const MAGIC_BYTES = new Uint8Array([69, 67, 76, 75]);
const GB = 1000 ** 3;

// Keeps R2 under $1 a month. Storage is $0.015/GB-month with 10 GB-month free. Objects expire after 1 day and the
// lifecycle sweep can lag another day, so every byte is billed for at most 2 days: (1000 GB × 2 / 30 − 10) × $0.015 ≈ $0.85.
const MONTHLY_BYTES = 1000 * GB;
// One Class A operation per upload; 1M a month are free.
const MONTHLY_UPLOADS = 500_000;
// Neither a burst nor a single client can use up the whole month.
const DAILY_BYTES = 100 * GB;
const DAILY_BYTES_PER_CLIENT = 5 * GB;

type Reservation = 'ok' | 'full' | 'client';

export class UploadBudget extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS usage (period TEXT PRIMARY KEY, bytes INTEGER NOT NULL, uploads INTEGER NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS clients (day TEXT NOT NULL, client TEXT NOT NULL, bytes INTEGER NOT NULL, PRIMARY KEY (day, client))');
    this.sql.exec('CREATE TABLE IF NOT EXISTS salts (day TEXT PRIMARY KEY, salt TEXT NOT NULL)');
  }

  async reserve(bytes: number, ip: string): Promise<Reservation> {
    const { month, day } = periods();
    const client = await this.clientKey(day, ip);
    const used = this.usage(month, day);
    if (used.month.bytes + bytes > MONTHLY_BYTES || used.month.uploads >= MONTHLY_UPLOADS || used.day.bytes + bytes > DAILY_BYTES) return 'full';
    if (this.clientBytes(day, client) + bytes > DAILY_BYTES_PER_CLIENT) return 'client';
    this.add(month, day, client, bytes, 1);
    return 'ok';
  }

  async release(bytes: number, ip: string): Promise<void> {
    const { month, day } = periods();
    this.add(month, day, await this.clientKey(day, ip), -bytes, -1);
  }

  status() {
    const { month, day } = periods();
    const used = this.usage(month, day);
    const available = used.month.bytes + MAX_FILE_SIZE <= MONTHLY_BYTES && used.month.uploads < MONTHLY_UPLOADS && used.day.bytes + MAX_FILE_SIZE <= DAILY_BYTES;
    return { available, maxFileSize: MAX_FILE_SIZE, month: { period: month, ...used.month, capBytes: MONTHLY_BYTES } };
  }

  // Clients are told apart by their IP hashed with a salt that is deleted the next day.
  private async clientKey(day: string, ip: string): Promise<string> {
    this.sql.exec('DELETE FROM salts WHERE day <> ?', day);
    this.sql.exec('DELETE FROM clients WHERE day <> ?', day);
    let salt = this.sql.exec<{ salt: string }>('SELECT salt FROM salts WHERE day = ?', day).toArray()[0]?.salt;
    if (!salt) {
      salt = [...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, '0')).join('');
      this.sql.exec('INSERT INTO salts (day, salt) VALUES (?, ?)', day, salt);
    }
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${ip}`));
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  private period(key: string) {
    return this.sql.exec<{ bytes: number; uploads: number }>('SELECT bytes, uploads FROM usage WHERE period = ?', key).toArray()[0] ?? { bytes: 0, uploads: 0 };
  }

  private usage(month: string, day: string) {
    return { month: this.period(`m:${month}`), day: this.period(`d:${day}`) };
  }

  private clientBytes(day: string, client: string): number {
    return this.sql.exec<{ bytes: number }>('SELECT bytes FROM clients WHERE day = ? AND client = ?', day, client).toArray()[0]?.bytes ?? 0;
  }

  private add(month: string, day: string, client: string, bytes: number, uploads: number) {
    for (const key of [`m:${month}`, `d:${day}`]) {
      this.sql.exec(
        'INSERT INTO usage (period, bytes, uploads) VALUES (?, MAX(?, 0), MAX(?, 0)) ON CONFLICT(period) DO UPDATE SET bytes = MAX(bytes + ?, 0), uploads = MAX(uploads + ?, 0)',
        key, bytes, uploads, bytes, uploads,
      );
    }
    this.sql.exec('DELETE FROM usage WHERE period LIKE \'d:%\' AND period <> ?', `d:${day}`);
    this.sql.exec(
      'INSERT INTO clients (day, client, bytes) VALUES (?, ?, MAX(?, 0)) ON CONFLICT(day, client) DO UPDATE SET bytes = MAX(bytes + ?, 0)',
      day, client, bytes, bytes,
    );
  }
}

function periods() {
  const iso = new Date().toISOString();
  return { month: iso.slice(0, 7), day: iso.slice(0, 10) };
}

const corsHeaders = {
  'Access-Control-Allow-Origin': ORIGIN,
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Content-Length',
};

function respond(body: string, status: number, isJson = false) {
  return new Response(body, { status, headers: { ...corsHeaders, 'Content-Type': isJson ? 'application/json' : 'text/plain' } });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { headers: { ...corsHeaders, 'Access-Control-Max-Age': '86400' } });

    const budget = env.BUDGET.get(env.BUDGET.idFromName('budget'));
    if (request.method === 'GET' && new URL(request.url).pathname === '/status') {
      return respond(JSON.stringify(await budget.status()), 200, true);
    }
    if (request.method !== 'POST') return respond('Method Not Allowed', 405);
    if (request.headers.get('Origin') !== ORIGIN) return respond('Forbidden Origin', 403);

    const contentLength = Number(request.headers.get('Content-Length'));
    if (!request.headers.get('Content-Length') || !Number.isSafeInteger(contentLength) || contentLength <= MAGIC_BYTES.length) {
      return respond('Length Required', 411);
    }
    if (contentLength > MAX_FILE_SIZE) return respond('Payload Too Large', 413);
    if (!request.body) return respond('Empty body', 400);

    const ip = request.headers.get('CF-Connecting-IP') ?? '';
    const reservation = await budget.reserve(contentLength, ip);
    if (reservation === 'full') return respond('Upload storage is full. Try again later.', 503);
    if (reservation === 'client') return respond('Daily upload limit reached.', 429);

    const reader = request.body.getReader();
    const { value: firstChunk, done } = await reader.read();
    if (done || !firstChunk || firstChunk.length < MAGIC_BYTES.length || MAGIC_BYTES.some((b, i) => firstChunk[i] !== b)) {
      await budget.release(contentLength, ip);
      return respond('Invalid signature. Only encrypt.click client data allowed.', 400);
    }

    const fixedStream = new FixedLengthStream(contentLength);
    const writer = fixedStream.writable.getWriter();
    (async () => {
      try {
        let totalBytes = firstChunk.length;
        await writer.write(firstChunk);
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
      await env.BUCKET.put(fileId, fixedStream.readable, { httpMetadata: { contentType: 'application/octet-stream' } });
      return respond(JSON.stringify({ success: true, id: fileId }), 200, true);
    } catch {
      await budget.release(contentLength, ip);
      return respond('Storage error', 500);
    }
  },
} satisfies ExportedHandler<Env>;

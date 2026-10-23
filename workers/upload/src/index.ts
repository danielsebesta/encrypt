import { DurableObject } from 'cloudflare:workers';
import { MAX_FIRST_PARTY_BYTES } from '../../../src/lib/httpLimits';
import { ClientLedger } from '../../../src/lib/uploadPass';
import { handleRequest, type Env, type Reservation } from './handler';

const MAX_FILE_SIZE = MAX_FIRST_PARTY_BYTES;
const GB = 1000 ** 3;

// Keeps R2 under $1 a month. Storage is $0.015/GB-month with 10 GB-month free. Objects expire after 1 day and the
// lifecycle sweep can lag another day, so every byte is billed for at most 2 days: (1000 GB × 2 / 30 − 10) × $0.015 ≈ $0.85.
const MONTHLY_BYTES = 1000 * GB;
// One Class A operation per upload; 1M a month are free.
const MONTHLY_UPLOADS = 500_000;
// Neither a burst nor a single client can use up the whole month.
const DAILY_BYTES = 100 * GB;
const DAILY_BYTES_PER_CLIENT = 5 * GB;

export class UploadBudget extends DurableObject<Env> {
  private sql: SqlStorage;
  private ledger: ClientLedger;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS usage (period TEXT PRIMARY KEY, bytes INTEGER NOT NULL, uploads INTEGER NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS salts (day TEXT PRIMARY KEY, salt TEXT NOT NULL)');
    this.ledger = new ClientLedger(this.sql, 'clients', DAILY_BYTES_PER_CLIENT);
  }

  async reserve(bytes: number, ip: string, signals: { browser: boolean; pass: string | null }): Promise<Reservation> {
    const now = Date.now();
    const { month, day } = periods(now);
    const client = await this.clientKey(day, ip);
    const used = this.usage(month, day);
    if (used.month.bytes + bytes > MONTHLY_BYTES || used.month.uploads >= MONTHLY_UPLOADS || used.day.bytes + bytes > DAILY_BYTES) return 'full';
    const result = this.ledger.charge({ client, bytes, now, ...signals, globalDayBytes: used.day.bytes, globalDayCap: DAILY_BYTES });
    if (result === 'ok') this.add(month, day, bytes, 1);
    return result;
  }

  async release(bytes: number, ip: string): Promise<void> {
    const now = Date.now();
    const { month, day } = periods(now);
    this.add(month, day, -bytes, -1);
    this.ledger.release(await this.clientKey(day, ip), bytes, now);
  }

  status() {
    const { month, day } = periods(Date.now());
    const used = this.usage(month, day);
    const available = used.month.bytes + MAX_FILE_SIZE <= MONTHLY_BYTES && used.month.uploads < MONTHLY_UPLOADS && used.day.bytes + MAX_FILE_SIZE <= DAILY_BYTES;
    return { available, maxFileSize: MAX_FILE_SIZE, month: { period: month, ...used.month, capBytes: MONTHLY_BYTES } };
  }

  // Clients are told apart by their IP hashed with a salt that is deleted the next day.
  private async clientKey(day: string, ip: string): Promise<string> {
    this.sql.exec('DELETE FROM salts WHERE day <> ?', day);
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

  private add(month: string, day: string, bytes: number, uploads: number) {
    for (const key of [`m:${month}`, `d:${day}`]) {
      this.sql.exec(
        'INSERT INTO usage (period, bytes, uploads) VALUES (?, MAX(?, 0), MAX(?, 0)) ON CONFLICT(period) DO UPDATE SET bytes = MAX(bytes + ?, 0), uploads = MAX(uploads + ?, 0)',
        key, bytes, uploads, bytes, uploads,
      );
    }
    this.sql.exec('DELETE FROM usage WHERE period LIKE \'d:%\' AND period <> ?', `d:${day}`);
  }
}

function periods(now: number) {
  const iso = new Date(now).toISOString();
  return { month: iso.slice(0, 7), day: iso.slice(0, 10) };
}

export default {
  fetch: (request: Request, env: Env) => handleRequest(request, env),
} satisfies ExportedHandler<Env>;

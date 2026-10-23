export const SITE_ORIGIN = 'https://encrypt.click';
export const UPLOAD_ORIGIN = 'https://upload.encrypt.click';
export const PASS_HEADER = 'X-Upload-Pass';
export const PASS_MESSAGE = 'upload-pass';
export const PASS_TTL_MS = 60 * 60 * 1000;

const GB = 1000 ** 3;
const HOUR_MS = 60 * 60 * 1000;

// Far above what a person sharing by hand reaches, so only scripted volume or an unusually busy day meets a challenge.
export const SUSPICION = { hourlyUploads: 30, clientDayBytes: 1 * GB, globalDayShare: 0.5 };
// Each solved challenge covers a bounded amount, so a farm of solvers still pays per gigabyte.
export const PASS_ALLOWANCE = { uploads: 200, bytes: 2 * GB };
export const RELAY_DAILY_BYTES_PER_CLIENT = 2 * GB;

const enc = new TextEncoder();
let passKey: { secret: string; key: Promise<CryptoKey> } | null = null;

function keyFor(secret: string): Promise<CryptoKey> {
  if (passKey?.secret !== secret) {
    passKey = { secret, key: crypto.subtle.importKey('raw', enc.encode(`upload-pass:${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']) };
  }
  return passKey.key;
}

function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array | null {
  if (!/^[\w-]+$/.test(text)) return null;
  try {
    return Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  } catch { return null; }
}

// The client address only enters the MAC, so a pass works from the /64 it was solved on and reveals nothing about it.
const signed = (expires: number, nonce: string, client: string) => enc.encode(`v1:${expires}:${nonce}:${client}`);

export async function issuePass(secret: string, client: string, now = Date.now()): Promise<{ pass: string; expires: number }> {
  const expires = now + PASS_TTL_MS;
  const nonce = toBase64Url(crypto.getRandomValues(new Uint8Array(12)));
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', await keyFor(secret), signed(expires, nonce, client)));
  return { pass: `v1.${expires}.${nonce}.${toBase64Url(mac)}`, expires };
}

export async function verifyPass(pass: string | null, secret: string | undefined, client: string, now = Date.now()): Promise<string | null> {
  if (!pass || !secret || pass.length > 128) return null;
  const [version, exp, nonce, mac, ...rest] = pass.split('.');
  if (version !== 'v1' || rest.length || !/^\d{13}$/.test(exp) || !/^[\w-]{16}$/.test(nonce ?? '')) return null;
  const expires = Number(exp);
  if (expires <= now || expires > now + PASS_TTL_MS + 60_000) return null;
  const signature = fromBase64Url(mac ?? '');
  if (signature?.length !== 32) return null;
  const valid = await crypto.subtle.verify('HMAC', await keyFor(secret), signature as BufferSource, signed(expires, nonce, client));
  return valid ? nonce : null;
}

// Scripts can forge these headers, but a request without them did not come from a current browser running our page.
export function browserFetch(headers: Headers, sites: string[]): boolean {
  const site = headers.get('Sec-Fetch-Site');
  const mode = headers.get('Sec-Fetch-Mode');
  return site !== null && sites.includes(site) && (mode === 'cors' || mode === 'same-origin');
}

export interface Activity {
  browser: boolean;
  hourUploads: number;
  dayBytes: number;
  globalDayBytes?: number;
  globalDayCap?: number;
}

export function suspicious(activity: Activity, bytes: number): boolean {
  const { browser, hourUploads, dayBytes, globalDayBytes = 0, globalDayCap } = activity;
  return !browser
    || hourUploads >= SUSPICION.hourlyUploads
    || dayBytes + bytes > SUSPICION.clientDayBytes
    || (globalDayCap !== undefined && globalDayBytes + bytes > globalDayCap * SUSPICION.globalDayShare);
}

export type Charge = 'ok' | 'client' | 'challenge';

export interface ChargeRequest {
  client: string;
  bytes: number;
  browser: boolean;
  pass: string | null;
  now?: number;
  globalDayBytes?: number;
  globalDayCap?: number;
}

export interface SqlLike {
  exec(query: string, ...bindings: any[]): { toArray(): any[] };
}

const dayOf = (now: number) => new Date(now).toISOString().slice(0, 10);

// Per-client usage in a Durable Object's SQLite: bytes per day (the hard cap), uploads per hour and what each pass has covered.
export class ClientLedger {
  constructor(private sql: SqlLike, private table: string, private dailyCap: number) {
    sql.exec(`CREATE TABLE IF NOT EXISTS ${table} (day TEXT NOT NULL, client TEXT NOT NULL, bytes INTEGER NOT NULL, PRIMARY KEY (day, client))`);
    sql.exec(`CREATE TABLE IF NOT EXISTS ${table}_hours (hour INTEGER NOT NULL, client TEXT NOT NULL, uploads INTEGER NOT NULL, PRIMARY KEY (hour, client))`);
    sql.exec(`CREATE TABLE IF NOT EXISTS ${table}_passes (nonce TEXT PRIMARY KEY, expires INTEGER NOT NULL, uploads INTEGER NOT NULL, bytes INTEGER NOT NULL)`);
  }

  check(request: ChargeRequest): Charge {
    const { client, bytes, browser, pass, now = Date.now(), globalDayBytes, globalDayCap } = request;
    this.prune(now);
    const dayBytes = this.dayBytes(dayOf(now), client);
    if (dayBytes + bytes > this.dailyCap) return 'client';
    if (pass) {
      const used = this.sql.exec(`SELECT uploads, bytes FROM ${this.table}_passes WHERE nonce = ?`, pass).toArray()[0] ?? { uploads: 0, bytes: 0 };
      if (used.uploads < PASS_ALLOWANCE.uploads && used.bytes + bytes <= PASS_ALLOWANCE.bytes) return 'ok';
    }
    return suspicious({ browser, hourUploads: this.hourUploads(client, now), dayBytes, globalDayBytes, globalDayCap }, bytes) ? 'challenge' : 'ok';
  }

  charge(request: ChargeRequest): Charge {
    const result = this.check(request);
    if (result === 'ok') this.add(request);
    return result;
  }

  add({ client, bytes, pass, now = Date.now() }: ChargeRequest) {
    const hour = Math.floor(now / HOUR_MS);
    this.sql.exec(`INSERT INTO ${this.table} (day, client, bytes) VALUES (?, ?, ?) ON CONFLICT(day, client) DO UPDATE SET bytes = bytes + ?`, dayOf(now), client, bytes, bytes);
    this.sql.exec(`INSERT INTO ${this.table}_hours (hour, client, uploads) VALUES (?, ?, 1) ON CONFLICT(hour, client) DO UPDATE SET uploads = uploads + 1`, hour, client);
    if (pass) {
      this.sql.exec(
        `INSERT INTO ${this.table}_passes (nonce, expires, uploads, bytes) VALUES (?, ?, 1, ?) ON CONFLICT(nonce) DO UPDATE SET uploads = uploads + 1, bytes = bytes + ?`,
        pass, now + PASS_TTL_MS + 60_000, bytes, bytes,
      );
    }
  }

  release(client: string, bytes: number, now = Date.now()) {
    this.sql.exec(`UPDATE ${this.table} SET bytes = MAX(bytes - ?, 0) WHERE day = ? AND client = ?`, bytes, dayOf(now), client);
  }

  private dayBytes(day: string, client: string): number {
    return this.sql.exec(`SELECT bytes FROM ${this.table} WHERE day = ? AND client = ?`, day, client).toArray()[0]?.bytes ?? 0;
  }

  // Sliding estimate over the last 60 minutes: this hour plus the unexpired share of the previous one.
  private hourUploads(client: string, now: number): number {
    const hour = Math.floor(now / HOUR_MS);
    const rows = this.sql.exec(`SELECT hour, uploads FROM ${this.table}_hours WHERE client = ? AND hour >= ?`, client, hour - 1).toArray();
    const count = (h: number) => rows.find(row => row.hour === h)?.uploads ?? 0;
    return count(hour) + Math.floor(count(hour - 1) * (1 - (now % HOUR_MS) / HOUR_MS));
  }

  private prune(now: number) {
    this.sql.exec(`DELETE FROM ${this.table} WHERE day <> ?`, dayOf(now));
    this.sql.exec(`DELETE FROM ${this.table}_hours WHERE hour < ?`, Math.floor(now / HOUR_MS) - 1);
    this.sql.exec(`DELETE FROM ${this.table}_passes WHERE expires < ?`, now);
  }
}

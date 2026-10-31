import { ClientLedger, type Charge } from '../lib/uploadPass';
import type { BudgetCommand, SqlLike, UploadLimits } from '../platform/types';

export type Reservation = 'ok' | 'full' | Exclude<Charge, 'ok'>;

/** Upload usage of today (UTC) and this month; bytes are stored byte-days, as the quotas count them. */
export type UploadStatus = {
  available: boolean;
  maxFileSize: number;
  today: { bytes: number; uploads: number };
  month: { bytes: number; uploads: number };
};

const HOUR_MS = 60 * 60 * 1000;
const periods = (now: number) => {
  const iso = new Date(now).toISOString();
  return { minute: Math.floor(now / 60_000), month: iso.slice(0, 7), day: iso.slice(0, 10), hour: Math.floor(now / HOUR_MS) };
};

const prepared = new WeakSet<SqlLike>();

function prepare(sql: SqlLike) {
  if (prepared.has(sql)) return;
  sql.exec('CREATE TABLE IF NOT EXISTS rate (minute INTEGER NOT NULL, key TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY (minute, key))');
  sql.exec('CREATE TABLE IF NOT EXISTS usage (period TEXT PRIMARY KEY, bytes INTEGER NOT NULL, uploads INTEGER NOT NULL)');
  sql.exec('CREATE TABLE IF NOT EXISTS salts (day TEXT PRIMARY KEY, salt TEXT NOT NULL)');
  sql.exec('CREATE TABLE IF NOT EXISTS spent (nonce TEXT PRIMARY KEY, expires INTEGER NOT NULL)');
  sql.exec('CREATE TABLE IF NOT EXISTS challenges (hour INTEGER NOT NULL, client TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY (hour, client))');
  prepared.add(sql);
}

// Per-minute ceilings for one route: the visitor's own and everyone's together.
function rate(sql: SqlLike, key: string, limit: number, globalLimit: number, now: number): boolean {
  const { minute } = periods(now);
  sql.exec('DELETE FROM rate WHERE minute < ?', minute);
  const count = (k: string) => sql.exec('SELECT count FROM rate WHERE minute = ? AND key = ?', minute, k).toArray()[0]?.count ?? 0;
  if (count('*') + 1 > globalLimit || count(key) + 1 > limit) return false;
  for (const k of ['*', key]) sql.exec('INSERT INTO rate (minute, key, count) VALUES (?, ?, 1) ON CONFLICT(minute, key) DO UPDATE SET count = count + 1', minute, k);
  return true;
}

function usage(sql: SqlLike, now: number) {
  const { month, day } = periods(now);
  const period = (key: string) => sql.exec('SELECT bytes, uploads FROM usage WHERE period = ?', key).toArray()[0] ?? { bytes: 0, uploads: 0 };
  return { month: period(`m:${month}`), day: period(`d:${day}`) };
}

function addUsage(sql: SqlLike, now: number, bytes: number, uploads: number) {
  const { month, day } = periods(now);
  for (const key of [`m:${month}`, `d:${day}`]) {
    sql.exec(
      'INSERT INTO usage (period, bytes, uploads) VALUES (?, MAX(?, 0), MAX(?, 0)) ON CONFLICT(period) DO UPDATE SET bytes = MAX(bytes + ?, 0), uploads = MAX(uploads + ?, 0)',
      key, bytes, uploads, bytes, uploads,
    );
  }
  sql.exec("DELETE FROM usage WHERE period LIKE 'd:%' AND period <> ?", `d:${day}`);
}

function hasRoom(used: ReturnType<typeof usage>, bytes: number, limits: UploadLimits): boolean {
  return used.month.bytes + bytes <= limits.monthlyBytes && used.month.uploads < limits.monthlyUploads && used.day.bytes + bytes <= limits.dailyBytes;
}

// Clients are told apart by their /64 hashed with a salt that is deleted the next day, so yesterday's usage cannot be linked to today's.
function salt(sql: SqlLike, now: number): string {
  const { day } = periods(now);
  sql.exec('DELETE FROM salts WHERE day <> ?', day);
  const existing = sql.exec('SELECT salt FROM salts WHERE day = ?', day).toArray()[0]?.salt;
  if (existing) return existing;
  const fresh = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
  sql.exec('INSERT INTO salts (day, salt) VALUES (?, ?)', day, fresh);
  return fresh;
}

/** Runs synchronously so a single SQLite connection or Durable Object never sees two commands interleave. */
export function runBudgetCommand(sql: SqlLike, command: BudgetCommand, now = Date.now()): unknown {
  prepare(sql);
  switch (command.op) {
    case 'rate':
      return rate(sql, command.key, command.limit, command.globalLimit, now);
    case 'relay':
      return new ClientLedger(sql, 'relay', command.dailyCap).charge({ ...command, now });
    case 'salt':
      return salt(sql, now);
    case 'reserve': {
      const used = usage(sql, now);
      if (!hasRoom(used, command.bytes, command.limits)) return 'full' satisfies Reservation;
      const result = new ClientLedger(sql, 'clients', command.limits.dailyBytesPerClient)
        .charge({ ...command, now, globalDayBytes: used.day.bytes, globalDayCap: command.limits.dailyBytes });
      if (result === 'ok') addUsage(sql, now, command.bytes, 1);
      return result satisfies Reservation;
    }
    case 'release':
      addUsage(sql, now, -command.bytes, -1);
      new ClientLedger(sql, 'clients', command.limits.dailyBytesPerClient).release(command.client, command.bytes, now);
      return true;
    case 'status': {
      const used = usage(sql, now);
      return {
        available: hasRoom(used, command.limits.maxFileBytes, command.limits),
        maxFileSize: command.limits.maxFileBytes,
        today: { bytes: used.day.bytes, uploads: used.day.uploads },
        month: { bytes: used.month.bytes, uploads: used.month.uploads },
      } satisfies UploadStatus;
    }
    case 'spend': {
      sql.exec('DELETE FROM spent WHERE expires < ?', now);
      if (command.expires < now || sql.exec('SELECT 1 FROM spent WHERE nonce = ?', command.nonce).toArray().length) return false;
      sql.exec('INSERT INTO spent (nonce, expires) VALUES (?, ?)', command.nonce, command.expires);
      return true;
    }
    case 'challenges': {
      const { hour } = periods(now);
      sql.exec('DELETE FROM challenges WHERE hour < ?', hour - 1);
      sql.exec('INSERT INTO challenges (hour, client, count) VALUES (?, ?, 1) ON CONFLICT(hour, client) DO UPDATE SET count = count + 1', hour, command.client);
      return sql.exec('SELECT SUM(count) AS total FROM challenges WHERE client = ?', command.client).toArray()[0]?.total ?? 1;
    }
  }
}

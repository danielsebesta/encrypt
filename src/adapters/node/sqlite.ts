import { DatabaseSync, type StatementSync } from 'node:sqlite';
import type { SqlLike } from '../../platform/types';
import type { RoomStorage } from '../../../party/access';

export function openDatabase(file: string): DatabaseSync {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000');
  return db;
}

function statements(db: DatabaseSync) {
  const cache = new Map<string, StatementSync>();
  return (query: string) => {
    let statement = cache.get(query);
    if (!statement) {
      statement = db.prepare(query);
      cache.set(query, statement);
    }
    return statement;
  };
}

/** The Durable Object `sql.exec` shape over node:sqlite. Several statements without bindings run as one batch. */
export function sqlLike(db: DatabaseSync): SqlLike {
  const prepare = statements(db);
  return {
    exec(query, ...bindings) {
      const statement = prepare(query);
      if (!bindings.length && statement.sourceSQL.trim() !== query.trim()) {
        db.exec(query);
        return { toArray: () => [] };
      }
      const rows = statement.all(...bindings.map(value => value === undefined ? null : typeof value === 'boolean' ? Number(value) : value));
      return { toArray: () => rows };
    },
  };
}

export function transaction<T>(db: DatabaseSync, run: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = run();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

const decode = (value: unknown) => value === null || value === undefined ? undefined : JSON.parse(String(value));

/**
 * Room key-value storage and alarms in one SQLite file. Keys compare as UTF-8 bytes (SQLite's BINARY collation on
 * UTF-8 text), which is the order Durable Objects list them in.
 */
export class RoomDatabase {
  readonly db: DatabaseSync;
  private prepare: (query: string) => StatementSync;

  constructor(file: string, private onAlarmChange: () => void = () => {}) {
    this.db = openDatabase(file);
    this.db.exec(`CREATE TABLE IF NOT EXISTS room_kv (room TEXT NOT NULL, key TEXT NOT NULL, value TEXT, PRIMARY KEY (room, key)) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS room_alarms (room TEXT PRIMARY KEY, at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS room_alarms_at ON room_alarms (at)`);
    this.prepare = statements(this.db);
  }

  setAlarmListener(listener: () => void) {
    this.onAlarmChange = listener;
  }

  storage(room: string): RoomStorage {
    const run = (query: string, ...params: (string | number | null)[]) => this.prepare(query).run(...params);
    const rows = (query: string, ...params: (string | number | null)[]) => this.prepare(query).all(...params) as { key: string; value: string | null }[];
    const put = (key: string, value: unknown) => run('INSERT OR REPLACE INTO room_kv (room, key, value) VALUES (?, ?, ?)', room, key, JSON.stringify(value) ?? null);
    const remove = (key: string) => Number(run('DELETE FROM room_kv WHERE room = ? AND key = ?', room, key).changes) > 0;
    const storage = {
      get: async (key: string) => decode((this.prepare('SELECT value FROM room_kv WHERE room = ? AND key = ?').get(room, key) as { value: string | null } | undefined)?.value),
      put: async (key: string | Record<string, unknown>, value?: unknown) => {
        if (typeof key === 'string') put(key, value);
        else transaction(this.db, () => { for (const [name, entry] of Object.entries(key)) put(name, entry); });
      },
      delete: async (key: string | string[]) => Array.isArray(key) ? transaction(this.db, () => key.filter(remove).length) : remove(key),
      list: async (options: { prefix?: string; limit?: number; startAfter?: string } = {}) => {
        const prefix = options.prefix ?? '';
        const found = rows(
          'SELECT key, value FROM room_kv WHERE room = ? AND key >= ? AND substr(key, 1, ?) = ? AND key > ? ORDER BY key LIMIT ?',
          room, prefix, prefix.length, prefix, options.startAfter ?? '', options.limit ?? -1,
        );
        return new Map(found.map(row => [row.key, decode(row.value)]));
      },
      deleteAll: async () => {
        transaction(this.db, () => {
          run('DELETE FROM room_kv WHERE room = ?', room);
          run('DELETE FROM room_alarms WHERE room = ?', room);
        });
        this.onAlarmChange();
      },
      setAlarm: async (scheduledTime: number) => {
        run('INSERT OR REPLACE INTO room_alarms (room, at) VALUES (?, ?)', room, Math.round(scheduledTime));
        this.onAlarmChange();
      },
      deleteAlarm: async () => {
        run('DELETE FROM room_alarms WHERE room = ?', room);
        this.onAlarmChange();
      },
    };
    return storage as RoomStorage;
  }

  nextAlarm(): number | null {
    const row = this.prepare('SELECT at FROM room_alarms ORDER BY at LIMIT 1').get() as { at: number } | undefined;
    return row ? row.at : null;
  }

  /** Removes and returns the rooms whose alarm is due, as Durable Objects clear an alarm when it fires. */
  takeDueAlarms(now = Date.now()): string[] {
    return transaction(this.db, () => {
      const due = (this.prepare('SELECT room FROM room_alarms WHERE at <= ? ORDER BY at').all(now) as { room: string }[]).map(row => row.room);
      if (due.length) this.prepare('DELETE FROM room_alarms WHERE at <= ?').run(now);
      return due;
    });
  }

  close() {
    this.db.close();
  }
}

import { accessChannel } from '../src/lib/roomAccess';

export type RoomConnection = {
  id: string;
  state: unknown;
  setState(state: unknown): void;
  send(message: string): void;
  close(code?: number, reason?: string): void;
};

export type RoomStorage = {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  put(entries: Record<string, unknown>): Promise<void>;
  delete(key: string): Promise<boolean>;
  delete(keys: string[]): Promise<number>;
  list(options?: { prefix?: string; limit?: number; startAfter?: string }): Promise<Map<string, unknown>>;
  deleteAll(): Promise<void>;
  setAlarm(scheduledTime: number): Promise<void>;
  deleteAlarm(): Promise<void>;
};

export type RoomHost = {
  readonly name: string;
  readonly env: Record<string, unknown>;
  readonly storage: RoomStorage;
  getConnections(): Iterable<RoomConnection>;
};

/** The lifecycle every platform drives a room through. */
export type Room = {
  onStart?(): Promise<void> | void;
  onConnect(conn: RoomConnection): void;
  onMessage(message: string, conn: RoomConnection): Promise<void> | void;
  onClose(conn: RoomConnection): void;
  onAlarm?(): Promise<void> | void;
};

export const ROOM_ROUTE_RE = /^\/parties\/(main|persistent|whiteboard|whiteboard-saved)\/([0-9a-f]{64})$/;

// Connection IDs are assigned here so a client cannot pick one that collides with an existing socket.
export function connectionRequest(request: Request): Request {
  const url = new URL(request.url);
  url.searchParams.set('_pk', crypto.randomUUID());
  return new Request(url, request);
}

export class RoomAccess {
  private joined = new WeakSet<RoomConnection>();
  private windows = new WeakMap<RoomConnection, { start: number; count: number; bytes: number }>();
  private deadlines = new WeakMap<RoomConnection, ReturnType<typeof setTimeout>>();
  constructor(private room: RoomHost, private maxMessages = 150) {}
  open(conn: RoomConnection) {
    this.deadlines.set(conn, setTimeout(() => {
      if (!this.has(conn)) conn.close(4003, 'AUTH_TIMEOUT');
      this.deadlines.delete(conn);
    }, 5000));
  }
  has(conn: RoomConnection) { return this.joined.has(conn); }
  async join(conn: RoomConnection, token: unknown, locked: () => boolean) {
    if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token) || await accessChannel(token) !== this.room.name || locked() ||
      ![...this.room.getConnections()].some(c => c === conn)) return false;
    this.joined.add(conn);
    clearTimeout(this.deadlines.get(conn)); this.deadlines.delete(conn);
    return true;
  }
  allow(conn: RoomConnection, message: unknown) {
    if (typeof message !== 'string' || message.length > 768000) return false;
    const now = Date.now();
    let window = this.windows.get(conn);
    if (!window || now - window.start > 10000) { window = { start: now, count: 0, bytes: 0 }; this.windows.set(conn, window); }
    window.count++; window.bytes += message.length;
    if (window.count > this.maxMessages || window.bytes > 3 * 1024 * 1024) { conn.close(4008, 'RATE_LIMIT'); return false; }
    return true;
  }
  remove(conn: RoomConnection) {
    clearTimeout(this.deadlines.get(conn)); this.deadlines.delete(conn);
    this.joined.delete(conn); this.windows.delete(conn);
  }
}

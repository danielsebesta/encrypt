import { randomUUID } from 'node:crypto';
import { STATUS_CODES, type IncomingMessage, type Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import ChatRoom from '../../../party/chat';
import WhiteboardRoom from '../../../party/whiteboard';
import { ROOM_ROUTE_RE, type Room, type RoomConnection, type RoomHost, type RoomStorage } from '../../../party/access';
import type { RoomDatabase } from './sqlite';

export { ROOM_ROUTE_RE };

// The Workers runtime caps one WebSocket message at 1 MiB; RoomAccess drops anything over 768000 characters below that.
const MAX_PAYLOAD_BYTES = 1024 * 1024;
const HEARTBEAT_MS = 30_000;
const IDLE_EVICT_MS = 30_000;
const MAX_TIMER_MS = 2 ** 31 - 1;

export const PARTIES: Record<string, (host: RoomHost) => Room> = {
  main: host => new ChatRoom(host),
  persistent: host => new ChatRoom(host, { persistent: true }),
  whiteboard: host => new WhiteboardRoom(host),
  'whiteboard-saved': host => new WhiteboardRoom(host, { saved: true }),
};

export interface RoomSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface Peer {
  readonly id: string;
  message(data: string): void;
  closed(): void;
}

const failure = (error: unknown) => console.error('Realtime room error:', error instanceof Error ? error.message : error);

class Connection implements RoomConnection {
  state: unknown = null;
  open = true;
  connected = false;
  release = () => {};

  constructor(readonly id: string, private socket: RoomSocket) {}

  setState(state: unknown) {
    this.state = state;
  }

  send(message: string) {
    if (this.open) this.socket.send(message);
  }

  close(code?: number, reason?: string) {
    if (!this.open) return;
    this.open = false;
    this.socket.close(code, reason);
  }
}

class RoomInstance implements RoomHost {
  readonly connections = new Map<string, Connection>();
  readonly room: Room;
  readonly ready: Promise<boolean>;
  pending = 0;
  evictTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(readonly name: string, readonly env: Record<string, unknown>, readonly storage: RoomStorage, create: (host: RoomHost) => Room, private idle: (instance: RoomInstance) => void) {
    this.room = create(this);
    this.ready = Promise.resolve()
      .then(() => this.room.onStart?.())
      .then(() => true, error => {
        failure(error);
        for (const conn of this.connections.values()) conn.close(1011, 'ROOM_START_FAILED');
        this.connections.clear();
        return false;
      });
  }

  *getConnections(): Generator<RoomConnection> {
    for (const conn of this.connections.values()) if (conn.open) yield conn;
  }

  /** Room handlers run in arrival order, and only after onStart has finished. */
  run(task: () => unknown) {
    this.pending++;
    clearTimeout(this.evictTimer);
    this.ready
      .then(started => started ? task() : undefined)
      .catch(failure)
      .finally(() => {
        this.pending--;
        this.idle(this);
      });
  }

  get busy() {
    return this.pending > 0 || this.connections.size > 0;
  }
}

export class RealtimeRooms {
  private readonly instances = new Map<string, RoomInstance>();
  private alarmTimer: ReturnType<typeof setTimeout> | undefined;
  private closing = false;

  constructor(private readonly db: RoomDatabase, private readonly env: Record<string, unknown>, private readonly evictAfterMs = IDLE_EVICT_MS) {
    db.setAlarmListener(() => this.armAlarms());
    this.armAlarms();
  }

  get size() {
    return this.instances.size;
  }

  connect(party: string, name: string, socket: RoomSocket): Peer {
    const instance = this.closing ? null : this.instance(party, name);
    const conn = new Connection(randomUUID(), socket);
    if (!instance) {
      socket.close(1001, 'SERVER_RESTART');
      return { id: conn.id, message() {}, closed() {} };
    }
    instance.connections.set(conn.id, conn);
    instance.run(() => {
      if (!conn.open) return;
      conn.connected = true;
      instance.room.onConnect(conn);
    });
    let gone = false;
    conn.release = () => {
      if (gone) return;
      gone = true;
      conn.open = false;
      instance.run(() => {
        instance.connections.delete(conn.id);
        if (conn.connected) instance.room.onClose(conn);
      });
    };
    return {
      id: conn.id,
      message: (data: string) => {
        if (!gone) instance.run(() => conn.connected && instance.room.onMessage(data, conn));
      },
      closed: conn.release,
    };
  }

  /** Wires a `ws` socket to a room, with protocol pings so dead peers are noticed. */
  attach(party: string, name: string, ws: WebSocket) {
    const peer = this.connect(party, name, {
      send: data => ws.send(data),
      close: (code, reason) => {
        try { ws.close(code, reason); } catch { ws.terminate(); }
      },
    });
    let alive = true;
    const heartbeat = setInterval(() => {
      if (!alive) { ws.terminate(); return; }
      alive = false;
      ws.ping();
    }, HEARTBEAT_MS);
    ws.on('pong', () => { alive = true; });
    ws.on('message', (data, isBinary) => {
      alive = true;
      if (!isBinary) peer.message(String(data));
    });
    ws.on('error', () => ws.terminate());
    ws.on('close', () => {
      clearInterval(heartbeat);
      peer.closed();
    });
  }

  /** Answers WebSocket upgrades on `server` after the app's cross-site and rate-limit guard. */
  listen(server: Server, toRequest: (req: IncomingMessage) => Request, guard: (request: Request) => Promise<Response | null>) {
    const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });
    server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      socket.on('error', () => socket.destroy());
      void (async () => {
        let request: Request;
        try { request = toRequest(req); } catch { return refuse(socket, 400); }
        const refused = await guard(request).catch(() => new Response(null, { status: 503 }));
        if (refused) return refuse(socket, refused.status, refused.headers.get('Retry-After'));
        const match = ROOM_ROUTE_RE.exec(new URL(request.url).pathname);
        if (!match) return refuse(socket, 404);
        if (this.closing) return refuse(socket, 503);
        wss.handleUpgrade(req, socket, head, ws => this.attach(match[1], match[2], ws));
      })();
    });
    return wss;
  }

  /** Closes every socket so clients reconnect to the next process and rooms still see the departures, then lets handlers finish. */
  async shutdown(timeoutMs = 5000) {
    this.closing = true;
    clearTimeout(this.alarmTimer);
    for (const instance of this.instances.values()) {
      clearTimeout(instance.evictTimer);
      for (const conn of [...instance.connections.values()]) {
        conn.close(1001, 'SERVER_RESTART');
        conn.release();
      }
    }
    const deadline = Date.now() + timeoutMs;
    while ([...this.instances.values()].some(instance => instance.pending > 0) && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  private instance(party: string, name: string): RoomInstance | null {
    const create = PARTIES[party];
    if (!create) return null;
    const key = `${party}:${name}`;
    let instance = this.instances.get(key);
    if (!instance) {
      const created = new RoomInstance(name, this.env, this.db.storage(key), create, idle => this.idle(key, idle));
      this.instances.set(key, created);
      created.ready.then(started => { if (!started && this.instances.get(key) === created) this.instances.delete(key); });
      instance = created;
    }
    clearTimeout(instance.evictTimer);
    return instance;
  }

  // Alarms live in SQLite and wake a fresh instance, so an empty room can leave memory like an evicted Durable Object.
  private idle(key: string, instance: RoomInstance) {
    if (instance.busy || this.closing) return;
    clearTimeout(instance.evictTimer);
    instance.evictTimer = setTimeout(() => {
      if (!instance.busy && this.instances.get(key) === instance) this.instances.delete(key);
    }, this.evictAfterMs);
    instance.evictTimer.unref?.();
  }

  private armAlarms() {
    clearTimeout(this.alarmTimer);
    if (this.closing) return;
    const next = this.db.nextAlarm();
    if (next === null) return;
    this.alarmTimer = setTimeout(() => this.fireAlarms(), Math.min(Math.max(next - Date.now(), 0), MAX_TIMER_MS));
    this.alarmTimer.unref?.();
  }

  private fireAlarms() {
    for (const key of this.db.takeDueAlarms()) {
      const split = key.indexOf(':');
      const instance = this.instance(key.slice(0, split), key.slice(split + 1));
      instance?.run(() => instance.room.onAlarm?.());
    }
    this.armAlarms();
  }
}

function refuse(socket: Duplex, status: number, retryAfter?: string | null) {
  if (!socket.writable) { socket.destroy(); return; }
  const lines = [`HTTP/1.1 ${status} ${STATUS_CODES[status] ?? ''}`, 'Connection: close', 'Content-Length: 0', 'Cache-Control: no-store'];
  if (retryAfter && /^\d+$/.test(retryAfter)) lines.push(`Retry-After: ${retryAfter}`);
  socket.end(`${lines.join('\r\n')}\r\n\r\n`);
}

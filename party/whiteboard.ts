import {
  COMPACT_LOG_BYTES,
  COMPACT_LOG_COUNT,
  MAX_DOC_PARTS,
  SAVED_BOARD_BYTES,
  SAVED_BOARD_IDLE_DAYS,
  SAVED_PAYLOAD_CHARS,
} from '../src/lib/whiteboardSync';
import { RoomAccess, type RoomConnection, type RoomHost } from './access';

type RoomState = {
  locked: boolean;
  lockedBy: string | null;
};

export type WhiteboardOptions = {
  saved?: boolean;
  maxBytes?: number;
};

// `base` is the last log sequence the snapshot covers; `gen` names the snapshot's keys, so a new one is written beside the old.
type BoardMeta = {
  epoch: string;
  seq: number;
  base: number;
  gen: string | null;
  snapshotBytes: number;
  logCount: number;
  logBytes: number;
};

type EntryHead = { kind: string; id: string; from: string; chunks: number; seq?: number };
type Entry = EntryHead & { payload: string };
type Staging = { conn: string; gen: string; base: number; total: number; next: number; bytes: number; at: number };

const KINDS = ['doc', 'doc-part', 'chat', 'cursor', 'verify', 'verify-ack'];
const STORED_KINDS = ['doc', 'doc-part'];
const META_KEY = 'board-meta';
const LOG_PREFIX = 'log:';
const SNAP_PREFIX = 'snap:';
// Values stay far below the per-key limit of Durable Object storage; an envelope is spread over as many keys as it needs.
const CHUNK_CHARS = 100_000;
const PAGE = 32;
const HISTORY_BATCH_CHARS = 600_000;
const IDLE_MS = SAVED_BOARD_IDLE_DAYS * 24 * 60 * 60 * 1000;
const COMPACT_HINT_MS = 30_000;
const STAGING_IDLE_MS = 120_000;
const ID_RE = /^[A-Za-z0-9:_-]{1,128}$/;
const B64URL_RE = /^[A-Za-z0-9_-]+$/;

const logKey = (seq: number) => `${LOG_PREFIX}${String(seq).padStart(12, '0')}`;
const snapKey = (gen: string, index: number) => `${SNAP_PREFIX}${gen}:${String(index).padStart(4, '0')}`;
const chunkKey = (head: string, index: number) => `${head}:${String(index).padStart(3, '0')}`;
const entrySize = (payload: string, id: string) => payload.length + id.length + 64;

function validPayload(payload: unknown): payload is string {
  return typeof payload === 'string' && payload.length >= 16 && payload.length <= SAVED_PAYLOAD_CHARS && B64URL_RE.test(payload);
}

export default class WhiteboardRoom {
  access: RoomAccess;
  private queue = Promise.resolve();
  private readonly saved: boolean;
  private readonly maxBytes: number;
  private meta: BoardMeta | null | undefined;
  private staging: Staging | null = null;
  private lastCompactHint = 0;
  state: RoomState = { locked: false, lockedBy: null };

  constructor(private host: RoomHost, options: WhiteboardOptions = {}) {
    // Live drawing and cursors send about 20 small messages a second per person.
    this.access = new RoomAccess(host, 300);
    this.saved = options.saved === true;
    this.maxBytes = options.maxBytes ?? SAVED_BOARD_BYTES;
  }

  onConnect(conn: RoomConnection) {
    if ([...this.host.getConnections()].length > 32) { conn.close(4008, 'ROOM_FULL'); return; }
    if (this.state.locked) {
      conn.send(JSON.stringify({ type: "error", code: "ROOM_LOCKED" }));
      conn.close(4001, "ROOM_LOCKED");
      return;
    }
    if (this.saved) this.pushBackCleanup();
    this.access.open(conn);
  }

  onMessage(message: string, sender: RoomConnection) {
    if (!this.access.allow(sender, message)) return;
    this.queue = this.queue.then(() => this.handleMessage(message, sender)).catch(() => {});
    return this.queue;
  }

  private async handleMessage(message: string, sender: RoomConnection) {
    let parsed: any;
    try {
      parsed = JSON.parse(message);
    } catch {
      return;
    }

    if (!parsed || typeof parsed !== 'object') return;
    if (parsed.type === 'join') {
      if (!await this.access.join(sender, parsed.token, () => this.state.locked)) { sender.close(4003, 'FORBIDDEN'); return; }
      sender.send(JSON.stringify({ type: 'init', connId: sender.id, presence: this.getConnectionCount(), locked: this.state.locked }));
      this.broadcastPresence();
      if (this.saved) await this.sendHistory(sender, parsed.since, parsed.epoch);
      return;
    }
    if (!this.access.has(sender)) return;
    if (parsed.type === 'envelope' || parsed.type === 'envelope-to') {
      if (!KINDS.includes(parsed.kind) || typeof parsed.payload !== 'string' ||
        parsed.payload.length < 16 || parsed.payload.length > 720000 || !/^[A-Za-z0-9_-]+$/.test(parsed.payload) ||
        typeof parsed.id !== 'string' || !/^[A-Za-z0-9:_-]{1,128}$/.test(parsed.id)) return;
      // A saved board's document lives on the server, so its updates are stored in order and never handed from peer to peer.
      if (this.saved && STORED_KINDS.includes(parsed.kind)) {
        if (parsed.type === 'envelope') await this.storeUpdate(parsed.kind, parsed.payload, parsed.id, sender);
        return;
      }
      message = JSON.stringify({ type: 'envelope', kind: parsed.kind, payload: parsed.payload, id: parsed.id, from: sender.id });
    }
    switch (parsed.type) {
      case "envelope":
        this.broadcast(message, [sender.id]);
        break;
      case "envelope-to":
        if (typeof parsed.to === "string") {
          for (const conn of this.host.getConnections()) {
            if (conn.id === parsed.to && this.access.has(conn)) { conn.send(message); break; }
          }
        }
        break;
      case "lock":
        if (this.state.locked) return;
        this.state.locked = true;
        this.state.lockedBy = sender.id;
        this.broadcast(JSON.stringify({ type: "locked" }));
        break;
      case "unlock":
        if (this.state.lockedBy === sender.id) {
          this.state.locked = false;
          this.state.lockedBy = null;
          this.broadcast(JSON.stringify({ type: "unlocked" }));
        }
        break;
      case "snapshot":
        if (this.saved) await this.snapshotPart(parsed, sender);
        break;
      case "delete":
        if (this.saved) await this.deleteBoard();
        break;
    }
  }

  onClose(conn: RoomConnection) {
    this.access.remove(conn);
    if (this.state.lockedBy === conn.id) {
      this.state.locked = false;
      this.state.lockedBy = null;
      this.broadcast(JSON.stringify({ type: "unlocked" }));
    }
    if (this.staging?.conn === conn.id) {
      const staging = this.staging;
      this.staging = null;
      this.queue = this.queue.then(() => this.deletePrefix(`${SNAP_PREFIX}${staging.gen}:`)).catch(() => {});
    }
    this.broadcast(JSON.stringify({ type: "peer-leave", id: conn.id }));
    this.broadcastPresence();
    if (this.saved) this.pushBackCleanup();
  }

  // The alarm stays scheduled while people are connected, so a restart that never runs onClose still clears an idle board.
  private pushBackCleanup() {
    void this.host.storage.setAlarm(Date.now() + IDLE_MS).catch(() => {});
  }

  async onAlarm() {
    if (!this.saved) return;
    if ([...this.host.getConnections()].length > 0) {
      this.pushBackCleanup();
      return;
    }
    await this.host.storage.deleteAll();
    this.meta = null;
    this.staging = null;
  }

  private async boardMeta(): Promise<BoardMeta | null> {
    if (this.meta === undefined) this.meta = (await this.host.storage.get<BoardMeta>(META_KEY)) ?? null;
    return this.meta;
  }

  private async writeEntry(head: string, entry: Omit<Entry, 'chunks'>, extra: Record<string, unknown> = {}) {
    const chunks = Math.ceil(entry.payload.length / CHUNK_CHARS);
    const { payload, ...fields } = entry;
    const values: Record<string, unknown> = { ...extra, [head]: { ...fields, chunks } satisfies EntryHead };
    for (let i = 0; i < chunks; i++) values[chunkKey(head, i)] = payload.slice(i * CHUNK_CHARS, (i + 1) * CHUNK_CHARS);
    await this.host.storage.put(values);
  }

  private async *entries(prefix: string, startAfter?: string): AsyncGenerator<Entry> {
    let after = startAfter;
    let head: EntryHead | null = null;
    let parts: string[] = [];
    for (;;) {
      const page = await this.host.storage.list({ prefix, limit: PAGE, ...(after ? { startAfter: after } : {}) });
      if (!page.size) break;
      for (const [key, value] of page) {
        after = key;
        if (typeof value === 'string') {
          if (head) parts.push(value);
        } else {
          head = value as EntryHead;
          parts = [];
        }
        if (head && parts.length === head.chunks) {
          yield { ...head, payload: parts.join('') };
          head = null;
        }
      }
    }
  }

  private async deletePrefix(prefix: string, until?: string) {
    for (;;) {
      const page = await this.host.storage.list({ prefix, limit: PAGE * 4 });
      const keys = [...page.keys()].filter((key) => until === undefined || key <= until);
      if (keys.length) await this.host.storage.delete(keys);
      if (keys.length < page.size || page.size < PAGE * 4) break;
    }
  }

  // The server numbers stored updates itself and refuses anything past the cap, so a member cannot grow a board without bound.
  private async storeUpdate(kind: string, payload: string, id: string, sender: RoomConnection) {
    const meta = (await this.boardMeta()) ?? { epoch: crypto.randomUUID(), seq: 0, base: 0, gen: null, snapshotBytes: 0, logCount: 0, logBytes: 0 };
    const size = entrySize(payload, id);
    if (meta.snapshotBytes + meta.logBytes + size > this.maxBytes) {
      sender.send(JSON.stringify({ type: 'board-full', id }));
      return;
    }
    const next = { ...meta, seq: meta.seq + 1, logCount: meta.logCount + 1, logBytes: meta.logBytes + size };
    await this.writeEntry(logKey(next.seq), { kind, id, from: sender.id, seq: next.seq, payload }, { [META_KEY]: next });
    this.meta = next;
    this.broadcast(JSON.stringify({ type: 'envelope', kind, payload, id, from: sender.id, seq: next.seq }), [sender.id]);
    sender.send(JSON.stringify({ type: 'stored', id, seq: next.seq, epoch: next.epoch, ...(this.wantsSnapshot(next) ? { compact: true } : {}) }));
  }

  private wantsSnapshot(meta: BoardMeta): boolean {
    if (this.liveStaging() || Date.now() - this.lastCompactHint < COMPACT_HINT_MS || meta.logCount < 2) return false;
    const grown = meta.logBytes > Math.max(COMPACT_LOG_BYTES, meta.snapshotBytes / 2) || meta.logCount > COMPACT_LOG_COUNT;
    const crowded = meta.snapshotBytes + meta.logBytes > this.maxBytes * 0.75 && meta.logBytes > Math.min(COMPACT_LOG_BYTES, this.maxBytes) / 16;
    if (!grown && !crowded) return false;
    this.lastCompactHint = Date.now();
    return true;
  }

  private liveStaging(): boolean {
    return !!this.staging && Date.now() - this.staging.at < STAGING_IDLE_MS;
  }

  /**
   * A member that holds the whole board uploads it as a snapshot covering the log up to `base`. Parts arrive in order from
   * one connection, are written under a new generation and only replace the old snapshot and the covered log once complete,
   * so a half-finished or late snapshot never loses an update.
   */
  private async snapshotPart(parsed: any, sender: RoomConnection) {
    const meta = await this.boardMeta();
    const { base, index, total, kind, payload, id } = parsed;
    if (!meta || !Number.isInteger(index) || !Number.isInteger(total) || total < 1 || total > MAX_DOC_PARTS || index < 0 || index >= total ||
      !STORED_KINDS.includes(kind) || !validPayload(payload) || typeof id !== 'string' || !ID_RE.test(id)) return;
    if (index === 0) {
      if (this.liveStaging() && this.staging!.conn !== sender.id) { sender.send(JSON.stringify({ type: 'snapshot-busy' })); return; }
      if (this.staging) await this.deletePrefix(`${SNAP_PREFIX}${this.staging.gen}:`);
      this.staging = null;
      if (!Number.isInteger(base) || base <= meta.base || base > meta.seq) { sender.send(JSON.stringify({ type: 'snapshot-stale' })); return; }
      this.staging = { conn: sender.id, gen: crypto.randomUUID().replace(/-/g, '').slice(0, 16), base, total, next: 0, bytes: 0, at: Date.now() };
    }
    const staging = this.staging;
    if (!staging || staging.conn !== sender.id || staging.next !== index || staging.total !== total || staging.base !== base) return;
    staging.bytes += entrySize(payload, id);
    if (staging.bytes > this.maxBytes) {
      this.staging = null;
      await this.deletePrefix(`${SNAP_PREFIX}${staging.gen}:`);
      sender.send(JSON.stringify({ type: 'snapshot-stale' }));
      return;
    }
    await this.writeEntry(snapKey(staging.gen, index), { kind, id, from: 'snapshot', payload });
    staging.next++;
    staging.at = Date.now();
    if (staging.next < staging.total) return;

    this.staging = null;
    let logCount = 0;
    let logBytes = 0;
    for await (const entry of this.entries(LOG_PREFIX, chunkKey(logKey(staging.base), 999))) {
      logCount++;
      logBytes += entrySize(entry.payload, entry.id);
    }
    const next: BoardMeta = { ...meta, base: staging.base, gen: staging.gen, snapshotBytes: staging.bytes, logCount, logBytes };
    await this.host.storage.put(META_KEY, next);
    this.meta = next;
    if (meta.gen) await this.deletePrefix(`${SNAP_PREFIX}${meta.gen}:`);
    await this.deletePrefix(LOG_PREFIX, chunkKey(logKey(staging.base), 999));
    sender.send(JSON.stringify({ type: 'snapshot-saved', base: staging.base }));
  }

  // A member coming back from the same epoch only needs what was stored after its cursor; anyone else gets snapshot then log.
  private async sendHistory(conn: RoomConnection, since: unknown, epoch: unknown) {
    const meta = await this.boardMeta();
    if (!meta) {
      conn.send(JSON.stringify({ type: 'history', epoch: null, seq: 0, entries: [], more: false }));
      return;
    }
    const resume = typeof since === 'number' && Number.isInteger(since) && since >= meta.base && since <= meta.seq && epoch === meta.epoch;
    let batch: Record<string, unknown>[] = [];
    let chars = 0;
    const flush = (more: boolean) => {
      conn.send(JSON.stringify({ type: 'history', epoch: meta.epoch, seq: meta.seq, entries: batch, more }));
      batch = [];
      chars = 0;
    };
    const push = (entry: Entry, seq: number) => {
      if (batch.length && chars + entry.payload.length > HISTORY_BATCH_CHARS) flush(true);
      batch.push({ kind: entry.kind, payload: entry.payload, id: entry.id, from: entry.from, seq });
      chars += entry.payload.length;
    };
    if (!resume && meta.gen) {
      for await (const entry of this.entries(`${SNAP_PREFIX}${meta.gen}:`)) push(entry, meta.base);
    }
    const after = resume ? (since as number) : meta.base;
    for await (const entry of this.entries(LOG_PREFIX, chunkKey(logKey(after), 999))) push(entry, entry.seq ?? meta.base);
    flush(false);
  }

  private async deleteBoard() {
    await this.host.storage.deleteAll();
    this.meta = null;
    this.staging = null;
    this.state = { locked: false, lockedBy: null };
    const notice = JSON.stringify({ type: 'room-deleted' });
    for (const conn of this.host.getConnections()) {
      conn.send(notice);
      conn.close(4010, 'ROOM_DELETED');
    }
  }

  private getConnectionCount(): number {
    let count = 0;
    for (const conn of this.host.getConnections()) if (this.access.has(conn)) count++;
    return count;
  }

  private broadcastPresence() {
    this.broadcast(JSON.stringify({
      type: "presence",
      count: this.getConnectionCount(),
    }));
  }

  private broadcast(message: string, exclude?: string[]) {
    for (const conn of this.host.getConnections()) {
      if (!this.access.has(conn)) continue;
      if (exclude && exclude.includes(conn.id)) continue;
      conn.send(message);
    }
  }
}

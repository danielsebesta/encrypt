import { issueTurnGrant } from "../src/lib/turnGrant";
import {
  normalizeChatMode,
  PERSISTENT_HISTORY_BYTES,
  PERSISTENT_HISTORY_LIMIT,
  PERSISTENT_IDLE_DAYS,
  PERSISTENT_PAYLOAD_CHARS,
  type ChatMode,
} from "../src/lib/chatRoomSettings";
import { RoomAccess, type RoomConnection, type RoomHost } from "./access";

type AuthMode = "password" | "fragment";

type RoomConfig = {
  mode: ChatMode;
  authMode: AuthMode;
  createdAt: number;
  v?: 2 | 3;
};

type RoomState = {
  locked: boolean;
  lockedBy: string | null;
  config: RoomConfig | null;
};

type ChatConnectionState = {
  joined: boolean;
  keyed?: boolean;
};

type MemberKeyRecord = {
  key: string;
  at: number;
};

type ClientMessageEnvelope = {
  type: "message";
  id: string;
  payload: string;
  persist: boolean;
  createdAt?: number;
  serverSeq?: number;
};

type HistoryRecord = {
  id: string;
  payload: string;
  createdAt: number;
  seq: number;
};

// The epoch changes whenever history starts over, so a client's "since" cursor from a deleted room is never applied to a new one.
type HistoryMeta = {
  epoch: string;
  seq: number;
  count: number;
  bytes: number;
};

export type ChatRoomOptions = {
  persistent?: boolean;
};

const SERVER_INFO = {
  name: "encrypt-1",
  location: "AMS-NL",
  city: "Amsterdam",
  countryCode: "NL",
};

const CONFIG_KEY = "room-config";
const HISTORY_PREFIX = "history:";
const HISTORY_META_KEY = "history-meta";
const MEMBER_KEY_PREFIX = "member-key:";
const MAX_MEMBER_KEYS = 128;
// An ML-DSA-44 public key (1750 base64url characters) sealed by the client under the room key: 12 + 1750 + 16 bytes.
const MEMBER_KEY_RE = /^[A-Za-z0-9_-]{2371}$/;
const HISTORY_BATCH_CHARS = 600_000;
const MAX_ENCRYPTED_PAYLOAD_CHARS = 720_000;
const EMPTY_ROOM_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PERSISTENT_IDLE_MS = PERSISTENT_IDLE_DAYS * 24 * 60 * 60 * 1000;
const SAFE_ID_RE = /^[A-Za-z0-9:_-]{1,128}$/;
const B64URL_RE = /^[A-Za-z0-9_-]+$/;
const DEFAULT_CONFIG: RoomConfig = {
  mode: "live",
  authMode: "fragment",
  createdAt: 0,
};
const PERSISTENT_CONFIG: RoomConfig = {
  mode: "persistent",
  authMode: "fragment",
  createdAt: 0,
};

const historyKey = (seq: number) => `${HISTORY_PREFIX}${String(seq).padStart(12, "0")}`;
const recordBytes = (record: HistoryRecord) => record.payload.length + record.id.length + 32;

export default class ChatRoom {
  access: RoomAccess;
  private queue = Promise.resolve();
  private readonly persistent: boolean;
  private meta: HistoryMeta | null | undefined;
  state: RoomState = {
    locked: false,
    lockedBy: null,
    config: null,
  };

  constructor(private host: RoomHost, options: ChatRoomOptions = {}) {
    this.access = new RoomAccess(host);
    this.persistent = options.persistent === true;
  }

  async onStart() {
    const storedConfig = await this.host.storage.get<RoomConfig>(CONFIG_KEY);
    this.state.config = this.normalizeConfig(storedConfig);
    if (storedConfig && this.state.config && JSON.stringify(storedConfig) !== JSON.stringify(this.state.config)) {
      await this.host.storage.put(CONFIG_KEY, this.state.config);
    }
    if (this.persistent) return;

    // Live rooms store no messages; drop history left by older versions.
    const oldHistory = await this.host.storage.list({ prefix: HISTORY_PREFIX });
    if (oldHistory.size) {
      await Promise.all(Array.from(oldHistory.keys()).map((key) => this.host.storage.delete(key)));
    }
  }

  onConnect(conn: RoomConnection) {
    if (this.getConnectionCount() > 32) { conn.close(4008, "ROOM_FULL"); return; }
    if (this.state.locked) {
      conn.send(JSON.stringify({ type: "error", code: "ROOM_LOCKED" }));
      conn.close(4001, "ROOM_LOCKED");
      return;
    }

    this.pushBackCleanup();
    conn.setState({ joined: false });
    this.access.open(conn);

    conn.send(JSON.stringify({
      type: "init",
      presence: this.getJoinedConnectionCount(),
      rawPresence: this.getConnectionCount(),
      locked: this.state.locked,
      config: this.state.config,
      historyCount: 0,
      server: SERVER_INFO,
    }));
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

    if (!parsed || typeof parsed !== "object") return;
    switch (parsed.type) {
      case "join":
        if (!await this.access.join(sender, parsed.token, () => this.state.locked)) { sender.close(4003, "FORBIDDEN"); return; }
        const hadConfig = Boolean(this.state.config);
        if (!this.state.config) {
          await this.setRoomConfig(parsed.config);
        }
        const configMessage = JSON.stringify({ type: "room-config", config: this.state.config });
        if (!this.isJoined(sender)) {
          sender.setState({ joined: true });
          this.broadcastPresence();
        }
        sender.send(configMessage);
        if (!hadConfig) {
          this.broadcast(configMessage, [sender.id], true);
        }
        if (this.persistent) await this.sendMemberKeys(sender);
        await this.sendHistory(sender, parsed.since, parsed.epoch);
        break;

      case "member-key": {
        const state = sender.state as ChatConnectionState | null;
        if (!this.persistent || !this.isJoined(sender) || state?.keyed) return;
        if (typeof parsed.key !== "string" || !MEMBER_KEY_RE.test(parsed.key)) return;
        sender.setState({ joined: true, keyed: true });
        await this.storeMemberKey(parsed.key);
        break;
      }

      case "message": {
        if (!this.isJoined(sender)) return;
        const envelope = this.normalizeClientMessage(parsed);
        if (!envelope) return;
        if (envelope.persist) {
          const stored = await this.storeEnvelope(envelope);
          this.broadcast(JSON.stringify({ ...envelope, createdAt: stored.createdAt, serverSeq: stored.seq }), [sender.id]);
          sender.send(JSON.stringify({ type: "stored", id: envelope.id, serverSeq: stored.seq, createdAt: stored.createdAt, epoch: stored.epoch }));
        } else {
          this.broadcast(JSON.stringify(envelope), [sender.id]);
        }
        break;
      }

      case "typing":
        if (!this.isJoined(sender)) return;
        this.broadcast(JSON.stringify({ type: "typing" }), [sender.id]);
        break;

      case "lock":
        if (!this.isJoined(sender) || this.state.locked) return;
        this.state.locked = true;
        this.state.lockedBy = sender.id;
        this.broadcast(JSON.stringify({ type: "locked" }));
        break;

      case "unlock":
        if (!this.isJoined(sender)) return;
        if (this.state.lockedBy === sender.id) {
          this.state.locked = false;
          this.state.lockedBy = null;
          this.broadcast(JSON.stringify({ type: "unlocked" }));
        }
        break;

      case "delete":
        if (!this.persistent || !this.isJoined(sender)) return;
        await this.deleteRoom();
        break;

      case "turn-grant": {
        if (!this.isJoined(sender)) return;
        const secret = this.host.env.ROOM_TURN_SECRET;
        if (typeof secret !== 'string' || secret.length < 32) return;
        sender.send(JSON.stringify({ type: 'turn-grant', token: await issueTurnGrant(secret, this.host.name) }));
        break;
      }
      case "ping":
        sender.send(JSON.stringify({
          type: "pong",
          t: typeof parsed.t === "number" && Number.isFinite(parsed.t) ? parsed.t : Date.now(),
          server: SERVER_INFO,
        }));
        break;
    }
  }

  onClose(conn: RoomConnection) {
    const wasJoined = this.isJoined(conn);
    this.access.remove(conn);
    if (this.state.lockedBy === conn.id) {
      this.state.locked = false;
      this.state.lockedBy = null;
      this.broadcast(JSON.stringify({ type: "unlocked" }));
    }
    if (wasJoined) this.broadcastPresence();
    if (this.getConnectionCount([conn.id]) === 0) this.pushBackCleanup();
  }

  // The cleanup alarm stays scheduled even while people are connected, so a crash or a restart that never runs
  // onClose still deletes the room once it has been idle long enough.
  private pushBackCleanup() {
    const idle = this.persistent ? PERSISTENT_IDLE_MS : EMPTY_ROOM_TTL_MS;
    void this.host.storage.setAlarm(Date.now() + idle).catch(() => {});
  }

  async onAlarm() {
    if (this.getConnectionCount() > 0) {
      this.pushBackCleanup();
      return;
    }
    this.state = { locked: false, lockedBy: null, config: null };
    this.meta = null;
    await this.host.storage.deleteAll();
  }

  private async setRoomConfig(input: unknown) {
    const normalized = this.normalizeConfig(input) ?? {
      ...(this.persistent ? PERSISTENT_CONFIG : DEFAULT_CONFIG),
      createdAt: Date.now(),
    };
    this.state.config = normalized;
    await this.host.storage.put(CONFIG_KEY, normalized);
  }

  private normalizeConfig(input: unknown): RoomConfig | null {
    if (!input || typeof input !== "object") return null;
    const value = input as Partial<RoomConfig> & { mode?: unknown };
    const createdAt = typeof value.createdAt === "number" ? value.createdAt : Date.now();
    // A saved room never takes a typed password: ciphertext that stays on the server must not be guessable offline.
    if (this.persistent) return { ...PERSISTENT_CONFIG, createdAt };
    const authMode = value.authMode;
    if (!this.isAuthMode(authMode)) return null;
    return {
      mode: normalizeChatMode(value.mode),
      authMode,
      createdAt,
      ...(value.v === 2 || value.v === 3 ? { v: value.v } : {}),
    };
  }

  private isAuthMode(value: unknown): value is AuthMode {
    return value === "password" || value === "fragment";
  }

  private normalizeClientMessage(input: unknown): ClientMessageEnvelope | null {
    if (!input || typeof input !== "object") return null;
    const parsed = input as Partial<ClientMessageEnvelope>;
    if (parsed.type !== "message") return null;
    if (typeof parsed.id !== "string" || !SAFE_ID_RE.test(parsed.id)) return null;
    if (typeof parsed.payload !== "string") return null;
    if (parsed.payload.length < 16 || parsed.payload.length > MAX_ENCRYPTED_PAYLOAD_CHARS) return null;
    if (!B64URL_RE.test(parsed.payload)) return null;
    const persist = this.persistent && parsed.persist === true;
    if (persist && parsed.payload.length > PERSISTENT_PAYLOAD_CHARS) return null;
    const createdAt = this.safeTimestamp(parsed.createdAt);

    return {
      type: "message",
      id: parsed.id,
      payload: parsed.payload,
      persist,
      ...(createdAt ? { createdAt } : {}),
    };
  }

  private safeTimestamp(value: unknown): number | undefined {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
    return Math.round(value);
  }

  private async historyMeta(): Promise<HistoryMeta | null> {
    if (this.meta === undefined) this.meta = (await this.host.storage.get<HistoryMeta>(HISTORY_META_KEY)) ?? null;
    return this.meta;
  }

  // The server numbers and timestamps stored messages itself, so a client cannot push real history out of the window.
  private async storeEnvelope(envelope: ClientMessageEnvelope): Promise<{ seq: number; createdAt: number; epoch: string }> {
    const meta = (await this.historyMeta()) ?? { epoch: crypto.randomUUID(), seq: 0, count: 0, bytes: 0 };
    const record: HistoryRecord = { id: envelope.id, payload: envelope.payload, createdAt: Date.now(), seq: meta.seq + 1 };
    meta.seq = record.seq;
    meta.count += 1;
    meta.bytes += recordBytes(record);
    await this.host.storage.put({ [historyKey(record.seq)]: record, [HISTORY_META_KEY]: meta });
    this.meta = meta;
    await this.trimHistory(meta);
    return { seq: record.seq, createdAt: record.createdAt, epoch: meta.epoch };
  }

  private async trimHistory(meta: HistoryMeta) {
    const over = () => meta.count > PERSISTENT_HISTORY_LIMIT || meta.bytes > PERSISTENT_HISTORY_BYTES;
    if (!over()) return;
    while (over()) {
      const oldest = await this.host.storage.list({ prefix: HISTORY_PREFIX, limit: 16 });
      if (!oldest.size) { meta.count = 0; meta.bytes = 0; break; }
      const drop: string[] = [];
      for (const [key, value] of oldest) {
        if (!over()) break;
        drop.push(key);
        meta.count -= 1;
        meta.bytes -= recordBytes(value as HistoryRecord);
      }
      await this.host.storage.delete(drop);
    }
    meta.bytes = Math.max(0, meta.bytes);
    await this.host.storage.put(HISTORY_META_KEY, meta);
  }

  private async sendHistory(conn: RoomConnection, since: unknown, epoch: unknown) {
    const meta = this.persistent ? await this.historyMeta() : null;
    if (!meta) {
      conn.send(JSON.stringify({ type: "history", config: this.state.config, epoch: null, messages: [], more: false }));
      return;
    }
    const resume = typeof since === "number" && Number.isInteger(since) && since > 0 && epoch === meta.epoch;
    const stored = await this.host.storage.list({ prefix: HISTORY_PREFIX, ...(resume ? { startAfter: historyKey(since) } : {}) });
    let batch: ClientMessageEnvelope[] = [];
    let chars = 0;
    const flush = (more: boolean) => {
      conn.send(JSON.stringify({ type: "history", config: this.state.config, epoch: meta.epoch, messages: batch, more }));
      batch = [];
      chars = 0;
    };
    for (const value of stored.values()) {
      const record = value as HistoryRecord;
      if (batch.length && chars + record.payload.length > HISTORY_BATCH_CHARS) flush(true);
      batch.push({ type: "message", id: record.id, payload: record.payload, persist: true, createdAt: record.createdAt, serverSeq: record.seq });
      chars += record.payload.length;
    }
    flush(false);
  }

  // Saved-room messages name their ML-DSA key only by hash, so the room keeps the public keys of members who are offline,
  // sealed under the room key. Clients file each key under the hash of its own bytes, so an entry can only verify what that key signed.
  private async storeMemberKey(key: string) {
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)));
    const name = `${MEMBER_KEY_PREFIX}${Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("")}`;
    await this.host.storage.put(name, { key, at: Date.now() } satisfies MemberKeyRecord);
    const stored = await this.host.storage.list({ prefix: MEMBER_KEY_PREFIX });
    if (stored.size <= MAX_MEMBER_KEYS) return;
    const oldest = [...stored.entries()]
      .sort(([, a], [, b]) => (a as MemberKeyRecord).at - (b as MemberKeyRecord).at)
      .slice(0, stored.size - MAX_MEMBER_KEYS)
      .map(([id]) => id);
    await this.host.storage.delete(oldest);
  }

  private async sendMemberKeys(conn: RoomConnection) {
    const stored = await this.host.storage.list({ prefix: MEMBER_KEY_PREFIX });
    const keys = [...stored.values()].map((record) => (record as MemberKeyRecord).key).filter((key) => typeof key === "string" && MEMBER_KEY_RE.test(key));
    conn.send(JSON.stringify({ type: "member-keys", keys }));
  }

  private async deleteRoom() {
    await this.host.storage.deleteAll();
    this.meta = null;
    this.state = { locked: false, lockedBy: null, config: null };
    const notice = JSON.stringify({ type: "room-deleted" });
    for (const conn of this.host.getConnections()) {
      conn.send(notice);
      conn.close(4010, "ROOM_DELETED");
    }
  }

  private getConnectionCount(exclude: string[] = []): number {
    let count = 0;
    for (const conn of this.host.getConnections()) if (!exclude.includes(conn.id)) count++;
    return count;
  }

  private getJoinedConnectionCount(): number {
    let count = 0;
    for (const conn of this.host.getConnections()) {
      if (this.isJoined(conn)) count++;
    }
    return count;
  }

  private isJoined(conn: RoomConnection): boolean {
    return (conn.state as ChatConnectionState | null)?.joined === true && this.access.has(conn);
  }

  private broadcastPresence() {
    const msg = JSON.stringify({
      type: "presence",
      count: this.getJoinedConnectionCount(),
      rawCount: this.getConnectionCount(),
    });
    this.broadcast(msg, undefined, true);
  }

  private broadcast(message: string, exclude?: string[], includeWaiting = false) {
    for (const conn of this.host.getConnections()) {
      if (exclude && exclude.includes(conn.id)) continue;
      if (!includeWaiting && !this.isJoined(conn)) continue;
      conn.send(message);
    }
  }
}

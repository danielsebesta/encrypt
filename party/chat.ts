import { issueTurnGrant } from "../src/lib/turnGrant";
import {
  normalizeChatMode,
  type ChatMode,
} from "../src/lib/chatRoomSettings";
import { RoomAccess, type RoomConnection, type RoomHost } from "./access";

// Password rooms are format version 3; the room keeps only this small config, never a message.
type RoomConfig = { mode: ChatMode; authMode: "password"; createdAt: number; v: 3 };

type RoomState = {
  locked: boolean;
  lockedBy: string | null;
  config: RoomConfig | null;
};

// Every joined connection gets a random tag, stamped on what it sends and named when it
// closes, so members can tell which of them left. It links nothing across connections and the relay learns nothing new.
type ChatConnectionState = {
  joined: boolean;
  tag?: string;
};

type ClientMessageEnvelope = {
  type: "message";
  id: string;
  payload: string;
  createdAt?: number;
};

const CONFIG_KEY = "room-config";
const MAX_ENCRYPTED_PAYLOAD_CHARS = 720_000;
const EMPTY_ROOM_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SAFE_ID_RE = /^[A-Za-z0-9:_-]{1,128}$/;
const B64URL_RE = /^[A-Za-z0-9_-]+$/;
const DEFAULT_CONFIG: RoomConfig = {
  mode: "live",
  authMode: "password",
  createdAt: 0,
  v: 3,
};

export default class ChatRoom {
  access: RoomAccess;
  private queue = Promise.resolve();
  // Relayed client message ids, so a retry or reconnect retransmitting the same
  // envelope reaches members exactly once. Bounded FIFO; rooms are ephemeral.
  private seenIds = new Set<string>();
  state: RoomState = {
    locked: false,
    lockedBy: null,
    config: null,
  };

  constructor(private host: RoomHost) {
    this.access = new RoomAccess(host);
  }

  async onStart() {
    this.state.config = this.normalizeConfig(await this.host.storage.get<RoomConfig>(CONFIG_KEY));
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
      locked: this.state.locked,
      config: this.state.config,
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
          sender.setState({ joined: true, tag: crypto.randomUUID() });
          this.broadcastPresence();
        }
        sender.send(configMessage);
        if (!hadConfig) {
          this.broadcast(configMessage, [sender.id], true);
        }
        break;

      case "message": {
        if (!this.isJoined(sender)) return;
        const envelope = this.normalizeClientMessage(parsed);
        if (!envelope) return;
        if (this.seenIds.has(envelope.id)) return;
        this.seenIds.add(envelope.id);
        if (this.seenIds.size > 50_000) this.seenIds.delete(this.seenIds.values().next().value!);
        const tag = this.tagOf(sender);
        this.broadcast(JSON.stringify(tag ? { ...envelope, from: tag } : envelope), [sender.id]);
        break;
      }

      // A client from before the relay stopped storing may still ask for a stored ciphertext to be dropped;
      // there is nothing to drop, so the request is ignored.
      case "forget":
        break;

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
        }));
        break;
    }
  }

  onClose(conn: RoomConnection) {
    const wasJoined = this.isJoined(conn);
    const tag = this.tagOf(conn);
    this.access.remove(conn);
    if (this.state.lockedBy === conn.id) {
      this.state.locked = false;
      this.state.lockedBy = null;
      this.broadcast(JSON.stringify({ type: "unlocked" }));
    }
    if (wasJoined) this.broadcastPresence(tag, [conn.id]);
    if (this.getConnectionCount([conn.id]) === 0) this.pushBackCleanup();
  }

  // The cleanup alarm stays scheduled even while people are connected, so a crash or a restart that never runs
  // onClose still deletes the room once it has been idle long enough.
  private pushBackCleanup() {
    void this.host.storage.setAlarm(Date.now() + EMPTY_ROOM_TTL_MS).catch(() => {});
  }

  async onAlarm() {
    if (this.getConnectionCount() > 0) {
      this.pushBackCleanup();
      return;
    }
    this.state = { locked: false, lockedBy: null, config: null };
    await this.host.storage.deleteAll();
  }

  private async setRoomConfig(input: unknown) {
    const normalized = this.normalizeConfig(input) ?? {
      ...DEFAULT_CONFIG,
      createdAt: Date.now(),
    };
    this.state.config = normalized;
    await this.host.storage.put(CONFIG_KEY, normalized);
  }

  private normalizeConfig(input: unknown): RoomConfig | null {
    if (!input || typeof input !== "object") return null;
    const value = input as Record<string, unknown>;
    const createdAt = typeof value.createdAt === "number" ? value.createdAt : Date.now();
    if (value.authMode !== "password" || value.v !== 3) return null;
    return { mode: normalizeChatMode(value.mode), authMode: "password", createdAt, v: 3 };
  }

  private normalizeClientMessage(input: unknown): ClientMessageEnvelope | null {
    if (!input || typeof input !== "object") return null;
    const parsed = input as Partial<ClientMessageEnvelope>;
    if (parsed.type !== "message") return null;
    if (typeof parsed.id !== "string" || !SAFE_ID_RE.test(parsed.id)) return null;
    if (typeof parsed.payload !== "string") return null;
    if (parsed.payload.length < 16 || parsed.payload.length > MAX_ENCRYPTED_PAYLOAD_CHARS) return null;
    if (!B64URL_RE.test(parsed.payload)) return null;
    const createdAt = this.safeTimestamp(parsed.createdAt);

    return {
      type: "message",
      id: parsed.id,
      payload: parsed.payload,
      ...(createdAt ? { createdAt } : {}),
    };
  }

  private safeTimestamp(value: unknown): number | undefined {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
    return Math.round(value);
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

  private tagOf(conn: RoomConnection): string | undefined {
    const tag = (conn.state as ChatConnectionState | null)?.tag;
    return typeof tag === "string" ? tag : undefined;
  }

  private broadcastPresence(left?: string, exclude?: string[]) {
    const msg = JSON.stringify({
      type: "presence",
      count: this.getJoinedConnectionCount(),
      ...(left ? { left } : {}),
    });
    this.broadcast(msg, exclude, true);
  }

  private broadcast(message: string, exclude?: string[], includeWaiting = false) {
    for (const conn of this.host.getConnections()) {
      if (exclude && exclude.includes(conn.id)) continue;
      if (!includeWaiting && !this.isJoined(conn)) continue;
      conn.send(message);
    }
  }
}

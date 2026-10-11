import { issueTurnGrant } from "../src/lib/turnGrant";
import { RoomAccess, type RoomConnection, type RoomHost } from "./access";

type ChatMode = "live" | "ttl-10" | "ttl-5";
type AuthMode = "password" | "fragment";

type RoomConfig = {
  mode: ChatMode;
  authMode: AuthMode;
  createdAt: number;
};

type RoomState = {
  locked: boolean;
  lockedBy: string | null;
  config: RoomConfig | null;
};

type ChatConnectionState = {
  joined: boolean;
};

type ClientMessageEnvelope = {
  type: "message";
  id: string;
  payload: string;
  persist: false;
  createdAt?: number;
};

const SERVER_INFO = {
  name: "encrypt-1",
  location: "AMS-NL",
  city: "Amsterdam",
  countryCode: "NL",
};

const CONFIG_KEY = "room-config";
const HISTORY_PREFIX = "history:";
const MAX_ENCRYPTED_PAYLOAD_CHARS = 720_000;
const EMPTY_ROOM_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SAFE_ID_RE = /^[A-Za-z0-9:_-]{1,128}$/;
const B64URL_RE = /^[A-Za-z0-9_-]+$/;
const DEFAULT_CONFIG: RoomConfig = {
  mode: "live",
  authMode: "fragment",
  createdAt: 0,
};

export default class ChatRoom {
  access: RoomAccess;
  private queue = Promise.resolve();
  state: RoomState = {
    locked: false,
    lockedBy: null,
    config: null,
  };

  constructor(private host: RoomHost) {
    this.access = new RoomAccess(host);
  }

  async onStart() {
    const storedConfig = await this.host.storage.get<RoomConfig>(CONFIG_KEY);
    this.state.config = this.normalizeConfig(storedConfig);
    if (storedConfig && this.state.config && JSON.stringify(storedConfig) !== JSON.stringify(this.state.config)) {
      await this.host.storage.put(CONFIG_KEY, this.state.config);
    }

    // Chat messages are intentionally not stored on the server anymore.
    // Remove any old server-side chat history if this room still has it.
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

    void this.host.storage.deleteAlarm().catch(() => {});
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
        this.sendHistory(sender);
        break;

      case "message":
        if (!this.isJoined(sender)) return;
        const envelope = this.normalizeClientMessage(parsed);
        if (!envelope) return;
        this.broadcast(JSON.stringify(envelope), [sender.id]);
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
    if (this.getConnectionCount([conn.id]) === 0) {
      void this.host.storage.setAlarm(Date.now() + EMPTY_ROOM_TTL_MS).catch(() => {});
    }
  }

  async onAlarm() {
    if (this.getConnectionCount() > 0) return;
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
    const value = input as Partial<RoomConfig> & { mode?: unknown };
    const authMode = value.authMode;
    if (!this.isAuthMode(authMode)) return null;
    return {
      mode: this.normalizeChatMode(value.mode),
      authMode,
      createdAt: typeof value.createdAt === "number" ? value.createdAt : Date.now(),
    };
  }

  private normalizeChatMode(value: unknown): ChatMode {
    if (value === "ttl-10" || value === "ttl-5" || value === "live") return value;
    if (value === "burn") return "ttl-10";
    return "live";
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
    const createdAt = this.safeTimestamp(parsed.createdAt);

    return {
      type: "message",
      id: parsed.id,
      payload: parsed.payload,
      persist: false,
      ...(createdAt ? { createdAt } : {}),
    };
  }

  private safeTimestamp(value: unknown): number | undefined {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
    return Math.round(value);
  }

  private sendHistory(conn: RoomConnection) {
    conn.send(JSON.stringify({
      type: "history",
      config: this.state.config,
      messages: [],
    }));
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

import type * as Party from "partykit/server";

type ChatMode = "persistent" | "ttl-10" | "ttl-5" | "burn" | "live";
type AuthMode = "password" | "room-name";

type RoomConfig = {
  mode: ChatMode;
  authMode: AuthMode;
  createdAt: number;
};

type StoredMessage = {
  id: string;
  payload: string;
  createdAt: number;
  serverSeq: number;
  chainSeq?: number;
  prevHash?: string;
  hash?: string;
};

type RoomState = {
  locked: boolean;
  lockedBy: string | null;
  config: RoomConfig | null;
  history: StoredMessage[];
  nextServerSeq: number;
};

type ChatConnectionState = {
  joined: boolean;
};

const SERVER_INFO = {
  name: "encrypt-1",
  location: "AMS-NL",
  city: "Amsterdam",
  countryCode: "NL",
};

const CONFIG_KEY = "room-config";
const HISTORY_PREFIX = "history:";
const DEFAULT_CONFIG: RoomConfig = {
  mode: "persistent",
  authMode: "room-name",
  createdAt: 0,
};

export default class ChatRoom implements Party.Server {
  party: Party.Room;
  state: RoomState = {
    locked: false,
    lockedBy: null,
    config: null,
    history: [],
    nextServerSeq: 1,
  };

  constructor(party: Party.Room) {
    this.party = party;
  }

  async onStart() {
    const storedConfig = await this.party.storage.get<RoomConfig>(CONFIG_KEY);
    this.state.config = this.normalizeConfig(storedConfig);

    const storedHistory = await this.party.storage.list<StoredMessage>({ prefix: HISTORY_PREFIX });
    this.state.history = Array.from(storedHistory.values())
      .filter((msg) => Boolean(msg?.id && msg?.payload && msg?.serverSeq))
      .sort((a, b) => a.serverSeq - b.serverSeq);

    const last = this.state.history[this.state.history.length - 1];
    this.state.nextServerSeq = last ? last.serverSeq + 1 : 1;
  }

  onConnect(conn: Party.Connection<ChatConnectionState>) {
    if (this.state.locked) {
      conn.send(JSON.stringify({ type: "error", code: "ROOM_LOCKED" }));
      conn.close(4001, "ROOM_LOCKED");
      return;
    }

    conn.setState({ joined: false });

    conn.send(JSON.stringify({
      type: "init",
      presence: this.getJoinedConnectionCount(),
      rawPresence: this.getConnectionCount(),
      locked: this.state.locked,
      config: this.state.config,
      historyCount: this.state.history.length,
      server: SERVER_INFO,
    }));
  }

  async onMessage(message: string, sender: Party.Connection<ChatConnectionState>) {
    let parsed: any;
    try {
      parsed = JSON.parse(message);
    } catch {
      return;
    }

    switch (parsed.type) {
      case "join":
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
        if (parsed.persist === true && this.state.config?.mode === "persistent") {
          await this.persistMessage(parsed);
        }
        this.broadcast(message, [sender.id]);
        break;

      case "typing":
        if (!this.isJoined(sender)) return;
        this.broadcast(message, [sender.id]);
        break;

      case "lock":
        if (!this.isJoined(sender)) return;
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

      case "ping":
        sender.send(JSON.stringify({
          type: "pong",
          t: parsed.t,
          server: SERVER_INFO,
        }));
        break;
    }
  }

  onClose(conn: Party.Connection<ChatConnectionState>) {
    const wasJoined = this.isJoined(conn);
    if (this.state.lockedBy === conn.id) {
      this.state.locked = false;
      this.state.lockedBy = null;
      this.broadcast(JSON.stringify({ type: "unlocked" }));
    }
    if (wasJoined) this.broadcastPresence();
  }

  onRequest() {
    return new Response(JSON.stringify({
      room: this.party.id,
      presence: this.getJoinedConnectionCount(),
      rawPresence: this.getConnectionCount(),
      locked: this.state.locked,
      config: this.state.config,
      historyCount: this.state.history.length,
      server: SERVER_INFO,
    }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  private async setRoomConfig(input: unknown) {
    const normalized = this.normalizeConfig(input) ?? {
      ...DEFAULT_CONFIG,
      createdAt: Date.now(),
    };
    this.state.config = normalized;
    await this.party.storage.put(CONFIG_KEY, normalized);
  }

  private normalizeConfig(input: unknown): RoomConfig | null {
    if (!input || typeof input !== "object") return null;
    const value = input as Partial<RoomConfig>;
    const mode = value.mode;
    const authMode = value.authMode;
    if (!this.isChatMode(mode) || !this.isAuthMode(authMode)) return null;
    return {
      mode,
      authMode,
      createdAt: typeof value.createdAt === "number" ? value.createdAt : Date.now(),
    };
  }

  private isChatMode(value: unknown): value is ChatMode {
    return value === "persistent" || value === "ttl-10" || value === "ttl-5" || value === "burn" || value === "live";
  }

  private isAuthMode(value: unknown): value is AuthMode {
    return value === "password" || value === "room-name";
  }

  private async persistMessage(parsed: any) {
    if (typeof parsed.id !== "string" || typeof parsed.payload !== "string") return;
    if (this.state.history.some((msg) => msg.id === parsed.id)) return;

    const serverSeq = this.state.nextServerSeq++;
    const stored: StoredMessage = {
      id: parsed.id.slice(0, 128),
      payload: parsed.payload,
      createdAt: typeof parsed.createdAt === "number" ? parsed.createdAt : Date.now(),
      serverSeq,
      chainSeq: typeof parsed.seq === "number" ? parsed.seq : undefined,
      prevHash: typeof parsed.prevHash === "string" ? parsed.prevHash : undefined,
      hash: typeof parsed.hash === "string" ? parsed.hash : undefined,
    };

    this.state.history.push(stored);
    await this.party.storage.put(`${HISTORY_PREFIX}${serverSeq.toString().padStart(16, "0")}:${stored.id}`, stored);
  }

  private sendHistory(conn: Party.Connection<ChatConnectionState>) {
    if (this.state.config?.mode !== "persistent" || this.state.history.length === 0) {
      conn.send(JSON.stringify({
        type: "history",
        config: this.state.config,
        messages: [],
      }));
      return;
    }

    conn.send(JSON.stringify({
      type: "history",
      config: this.state.config,
      messages: this.state.history.map((msg) => ({
        type: "message",
        id: msg.id,
        payload: msg.payload,
        persist: true,
        seq: msg.chainSeq,
        prevHash: msg.prevHash,
        hash: msg.hash,
        createdAt: msg.createdAt,
        serverSeq: msg.serverSeq,
      })),
    }));
  }

  private getConnectionCount(): number {
    let count = 0;
    for (const _ of this.party.getConnections()) count++;
    return count;
  }

  private getJoinedConnectionCount(): number {
    let count = 0;
    for (const conn of this.party.getConnections<ChatConnectionState>()) {
      if (this.isJoined(conn)) count++;
    }
    return count;
  }

  private isJoined(conn: Party.Connection<ChatConnectionState>): boolean {
    return conn.state?.joined === true;
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
    for (const conn of this.party.getConnections<ChatConnectionState>()) {
      if (exclude && exclude.includes(conn.id)) continue;
      if (!includeWaiting && !this.isJoined(conn)) continue;
      conn.send(message);
    }
  }
}

import { RoomAccess, type RoomConnection, type RoomHost } from './access';

type RoomState = {
  locked: boolean;
  lockedBy: string | null;
};

export default class WhiteboardRoom {
  private access: RoomAccess;
  private queue = Promise.resolve();
  state: RoomState = { locked: false, lockedBy: null };

  constructor(private host: RoomHost) {
    this.access = new RoomAccess(host);
  }

  onConnect(conn: RoomConnection) {
    if ([...this.host.getConnections()].length > 32) { conn.close(4008, 'ROOM_FULL'); return; }
    if (this.state.locked) {
      conn.send(JSON.stringify({ type: "error", code: "ROOM_LOCKED" }));
      conn.close(4001, "ROOM_LOCKED");
      return;
    }
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
      return;
    }
    if (!this.access.has(sender)) return;
    if (parsed.type === 'envelope' || parsed.type === 'envelope-to') {
      if (!['doc', 'doc-part', 'chat', 'cursor', 'verify', 'verify-ack'].includes(parsed.kind) || typeof parsed.payload !== 'string' ||
        parsed.payload.length < 16 || parsed.payload.length > 720000 || !/^[A-Za-z0-9_-]+$/.test(parsed.payload) ||
        typeof parsed.id !== 'string' || !/^[A-Za-z0-9:_-]{1,128}$/.test(parsed.id)) return;
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
    }
  }

  onClose(conn: RoomConnection) {
    this.access.remove(conn);
    if (this.state.lockedBy === conn.id) {
      this.state.locked = false;
      this.state.lockedBy = null;
      this.broadcast(JSON.stringify({ type: "unlocked" }));
    }
    this.broadcast(JSON.stringify({ type: "peer-leave", id: conn.id }));
    this.broadcastPresence();
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

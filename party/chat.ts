import type * as Party from "partykit/server";

type RoomState = {
  locked: boolean;
  lockedBy: string | null;
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

export default class ChatRoom implements Party.Server {
  party: Party.Room;
  state: RoomState = { locked: false, lockedBy: null };

  constructor(party: Party.Room) {
    this.party = party;
  }

  onConnect(conn: Party.Connection<ChatConnectionState>) {
    if (this.state.locked) {
      conn.send(JSON.stringify({ type: "error", code: "ROOM_LOCKED" }));
      conn.close(4001, "ROOM_LOCKED");
      return;
    }

    conn.setState({ joined: false });

    // Tell the new connection how many people are actually inside the chat.
    conn.send(JSON.stringify({
      type: "init",
      presence: this.getJoinedConnectionCount(),
      rawPresence: this.getConnectionCount(),
      locked: this.state.locked,
      server: SERVER_INFO,
    }));
  }

  onMessage(message: string, sender: Party.Connection<ChatConnectionState>) {
    let parsed: any;
    try {
      parsed = JSON.parse(message);
    } catch {
      return;
    }

    switch (parsed.type) {
      case "join":
        if (!this.isJoined(sender)) {
          sender.setState({ joined: true });
          this.broadcastPresence();
        }
        break;

      case "message":
        if (!this.isJoined(sender)) return;
        // Relay encrypted message to all others
        this.broadcast(message, [sender.id]);
        break;

      case "typing":
        if (!this.isJoined(sender)) return;
        // Relay typing indicator to all others
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
    // If the person who locked the room leaves, unlock it
    if (this.state.lockedBy === conn.id) {
      this.state.locked = false;
      this.state.lockedBy = null;
      this.broadcast(JSON.stringify({ type: "unlocked" }));
    }
    if (wasJoined) this.broadcastPresence();
  }

  onRequest() {
    // Simple health check / room info
    return new Response(JSON.stringify({
      room: this.party.id,
      presence: this.getJoinedConnectionCount(),
      rawPresence: this.getConnectionCount(),
      locked: this.state.locked,
      server: SERVER_INFO,
    }), {
      headers: { "Content-Type": "application/json" },
    });
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

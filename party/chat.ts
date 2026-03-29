import type { Party, PartyConnection, PartyRequest } from "partykit/server";

type RoomState = {
  locked: boolean;
  lockedBy: string | null;
};

export default class ChatRoom {
  party: Party;
  state: RoomState = { locked: false, lockedBy: null };

  constructor(party: Party) {
    this.party = party;
  }

  onConnect(conn: PartyConnection) {
    if (this.state.locked) {
      conn.send(JSON.stringify({ type: "error", message: "Room is locked" }));
      conn.close(4001, "Room locked");
      return;
    }

    // Broadcast updated presence count
    this.broadcastPresence();

    // Tell the new connection the current state
    conn.send(JSON.stringify({
      type: "init",
      presence: this.getConnectionCount(),
      locked: this.state.locked,
    }));
  }

  onMessage(message: string, sender: PartyConnection) {
    let parsed: any;
    try {
      parsed = JSON.parse(message);
    } catch {
      return;
    }

    switch (parsed.type) {
      case "message":
        // Relay encrypted message to all others
        this.broadcast(message, [sender.id]);
        break;

      case "typing":
        // Relay typing indicator to all others
        this.broadcast(message, [sender.id]);
        break;

      case "lock":
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

  onClose(conn: PartyConnection) {
    // If the person who locked the room leaves, unlock it
    if (this.state.lockedBy === conn.id) {
      this.state.locked = false;
      this.state.lockedBy = null;
      this.broadcast(JSON.stringify({ type: "unlocked" }));
    }
    this.broadcastPresence();
  }

  onRequest(req: PartyRequest) {
    // Simple health check / room info
    return new Response(JSON.stringify({
      room: this.party.id,
      presence: this.getConnectionCount(),
      locked: this.state.locked,
    }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  private getConnectionCount(): number {
    let count = 0;
    for (const _ of this.party.getConnections()) count++;
    return count;
  }

  private broadcastPresence() {
    const msg = JSON.stringify({
      type: "presence",
      count: this.getConnectionCount(),
    });
    this.broadcast(msg);
  }

  private broadcast(message: string, exclude?: string[]) {
    for (const conn of this.party.getConnections()) {
      if (exclude && exclude.includes(conn.id)) continue;
      conn.send(message);
    }
  }
}

import type { Party, PartyConnection } from "partykit/server";

type RoomState = {
  locked: boolean;
  lockedBy: string | null;
};

export default class MemoRoom {
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

    this.broadcastPresence();

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
      case "envelope":
        this.broadcast(message, [sender.id]);
        break;
      case "envelope-to":
        if (typeof parsed.to === "string") {
          for (const conn of this.party.getConnections()) {
            if (conn.id === parsed.to) { conn.send(message); break; }
          }
        }
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
    for (const _ of this.party.getConnections()) count++;
    return count;
  }

  private broadcastPresence() {
    this.broadcast(JSON.stringify({
      type: "presence",
      count: this.getConnectionCount(),
    }));
  }

  private broadcast(message: string, exclude?: string[]) {
    for (const conn of this.party.getConnections()) {
      if (exclude && exclude.includes(conn.id)) continue;
      conn.send(message);
    }
  }
}

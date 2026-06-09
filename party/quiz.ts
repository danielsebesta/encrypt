import type * as Party from "partykit/server";

/**
 * Quiz relay: zero-knowledge dumb relay.
 *
 * Server sees only ciphertext envelopes, public keys exchanged in handshake,
 * and connection metadata (presence, timing). All game logic, scoring, and
 * state live in the host client. Server's only contribution to game logic
 * is `receivedAt` timestamps on relayed envelopes — this lets the host
 * compute fair speed bonuses without trusting client clocks.
 */
type RoomState = {
  locked: boolean;
  lockedBy: string | null;
};

export default class QuizRoom implements Party.Server {
  party: Party.Room;
  state: RoomState = { locked: false, lockedBy: null };

  constructor(party: Party.Room) {
    this.party = party;
  }

  onConnect(conn: Party.Connection) {
    if (this.state.locked) {
      conn.send(JSON.stringify({ type: "error", code: "ROOM_LOCKED", message: "Room is locked" }));
      conn.close(4001, "Room locked");
      return;
    }

    conn.send(JSON.stringify({
      type: "init",
      connId: conn.id,
      presence: this.getConnectionCount(),
      locked: this.state.locked,
    }));

    this.broadcast(JSON.stringify({ type: "peer-join", id: conn.id }), [conn.id]);
    this.broadcastPresence();
  }

  onMessage(message: string, sender: Party.Connection) {
    let parsed: any;
    try {
      parsed = JSON.parse(message);
    } catch {
      return;
    }
    if (!parsed || typeof parsed.type !== "string") return;

    switch (parsed.type) {
      case "envelope": {
        const out = JSON.stringify({
          type: "envelope",
          from: sender.id,
          to: typeof parsed.to === "string" ? parsed.to : undefined,
          payload: parsed.payload,
          receivedAt: Date.now(),
        });
        if (typeof parsed.to === "string") {
          for (const conn of this.party.getConnections()) {
            if (conn.id === parsed.to) {
              try { conn.send(out); } catch {}
              return;
            }
          }
        } else {
          for (const conn of this.party.getConnections()) {
            if (conn.id === sender.id) continue;
            try { conn.send(out); } catch {}
          }
        }
        return;
      }

      case "lock":
        this.state.locked = true;
        this.state.lockedBy = sender.id;
        this.broadcast(JSON.stringify({ type: "locked" }));
        return;

      case "unlock":
        if (this.state.lockedBy === sender.id) {
          this.state.locked = false;
          this.state.lockedBy = null;
          this.broadcast(JSON.stringify({ type: "unlocked" }));
        }
        return;

      case "ping":
        return;
    }
  }

  onClose(conn: Party.Connection) {
    if (this.state.lockedBy === conn.id) {
      this.state.locked = false;
      this.state.lockedBy = null;
      this.broadcast(JSON.stringify({ type: "unlocked" }));
    }
    this.broadcast(JSON.stringify({ type: "peer-leave", id: conn.id }));
    this.broadcastPresence();
  }

  onRequest() {
    return new Response(
      JSON.stringify({
        room: this.party.id,
        presence: this.getConnectionCount(),
        locked: this.state.locked,
      }),
      { headers: { "Content-Type": "application/json" } },
    );
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
      try { conn.send(message); } catch {}
    }
  }
}

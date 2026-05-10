import type { Party, PartyConnection, PartyRequest } from "partykit/server";

type Phase = "lobby" | "question" | "reveal" | "leaderboard" | "finished";

type Player = {
  token: string;
  nick: string;
  score: number;
  alive: boolean;
  connId: string | null;
};

type Question = {
  index: number;
  text: string;
  choices: [string, string, string, string];
  correctIndex: 0 | 1 | 2 | 3;
  duration: number;
  startedAt: number;
  endsAt: number;
  answers: Map<string, { choice: 0 | 1 | 2 | 3; receivedAt: number }>;
};

type State = {
  phase: Phase;
  hostToken: string | null;
  hostConnId: string | null;
  hostAlive: boolean;
  questionTotal: number;
  currentIndex: number;
  current: Question | null;
  lastReveal: {
    correctIndex: 0 | 1 | 2 | 3;
    perChoiceCounts: [number, number, number, number];
  } | null;
  players: Map<string, Player>;
};

const HOST_GRACE_MS = 60_000;
const NICK_MAX = 24;
const TEXT_MAX = 200;
const CHOICE_MAX = 80;
const MAX_QUESTIONS = 50;
const MIN_DURATION = 5_000;
const MAX_DURATION = 120_000;

function clean(s: unknown, max: number): string {
  if (typeof s !== "string") return "";
  return s.replace(/\s+/g, " ").trim().slice(0, max);
}

function score(correct: boolean, elapsed: number, duration: number): number {
  if (!correct) return 0;
  const ratio = Math.min(1, Math.max(0, elapsed / duration));
  return Math.max(500, Math.round(1000 - 500 * ratio));
}

export default class QuizRoom {
  party: Party;
  state: State = {
    phase: "lobby",
    hostToken: null,
    hostConnId: null,
    hostAlive: false,
    questionTotal: 0,
    currentIndex: -1,
    current: null,
    lastReveal: null,
    players: new Map(),
  };

  constructor(party: Party) {
    this.party = party;
  }

  onConnect(conn: PartyConnection) {
    conn.send(JSON.stringify({ type: "hello", connId: conn.id }));
    this.broadcastPresence();
  }

  onMessage(message: string, sender: PartyConnection) {
    let parsed: any;
    try {
      parsed = JSON.parse(message);
    } catch {
      return;
    }
    if (!parsed || typeof parsed.type !== "string") return;

    switch (parsed.type) {
      case "host-claim":
        return this.handleHostClaim(sender, parsed);
      case "player-join":
        return this.handlePlayerJoin(sender, parsed);
      case "host-relay-question":
        return this.handleRelayQuestion(sender, parsed);
      case "host-start-question":
        return this.handleStartQuestion(sender, parsed);
      case "player-answer":
        return this.handlePlayerAnswer(sender, parsed);
      case "host-reveal":
        return this.handleReveal(sender);
      case "host-next":
        return this.handleNext(sender);
      case "host-end":
        return this.handleEnd(sender);
      case "ping":
        return;
    }
  }

  onClose(conn: PartyConnection) {
    if (this.state.hostConnId === conn.id) {
      this.state.hostAlive = false;
      this.state.hostConnId = null;
      if (this.state.phase !== "lobby" && this.state.phase !== "finished") {
        this.broadcast({ type: "host-paused", graceMs: HOST_GRACE_MS });
      }
    }

    for (const [token, player] of this.state.players) {
      if (player.connId === conn.id) {
        player.alive = false;
        player.connId = null;
      }
    }

    this.broadcastPresence();
  }

  onRequest(_req: PartyRequest) {
    return new Response(
      JSON.stringify({
        room: this.party.id,
        phase: this.state.phase,
        playerCount: this.state.players.size,
        hostAlive: this.state.hostAlive,
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  }

  private handleHostClaim(conn: PartyConnection, msg: any) {
    const token = typeof msg.token === "string" ? msg.token : "";
    if (token.length < 8) {
      this.sendError(conn, "BAD_TOKEN", "Invalid host token");
      return;
    }

    if (this.state.hostToken && this.state.hostToken !== token) {
      this.sendError(conn, "ROOM_TAKEN", "Room already has a host");
      return;
    }

    if (!this.state.hostToken) {
      const total = Number(msg.total);
      if (!Number.isFinite(total) || total < 1 || total > MAX_QUESTIONS) {
        this.sendError(conn, "BAD_TOTAL", "Invalid question count");
        return;
      }
      this.state.hostToken = token;
      this.state.questionTotal = Math.floor(total);
    }

    this.state.hostConnId = conn.id;
    this.state.hostAlive = true;

    this.sendStateTo(conn, "host");
    this.broadcastPlayers();
    if (this.state.phase !== "lobby" && this.state.phase !== "finished") {
      this.broadcast({ type: "host-resumed" });
    }
  }

  private handlePlayerJoin(conn: PartyConnection, msg: any) {
    const nick = clean(msg.nick, NICK_MAX);
    if (!nick) {
      this.sendError(conn, "BAD_NICK", "Nickname required");
      return;
    }

    let token = typeof msg.token === "string" && msg.token.length >= 8
      ? msg.token
      : "";

    let player: Player | null = null;
    if (token && this.state.players.has(token)) {
      player = this.state.players.get(token)!;
      player.alive = true;
      player.connId = conn.id;
      player.nick = nick;
    } else {
      if (this.state.phase !== "lobby" && this.state.phase !== "question") {
        this.sendError(conn, "PHASE_LOCKED", "Cannot join now");
        return;
      }
      for (const p of this.state.players.values()) {
        if (p.alive && p.nick.toLowerCase() === nick.toLowerCase()) {
          this.sendError(conn, "NICK_TAKEN", "Nickname is taken");
          return;
        }
      }
      if (!token) {
        token = crypto.randomUUID().replace(/-/g, "");
      }
      player = {
        token,
        nick,
        score: 0,
        alive: true,
        connId: conn.id,
      };
      this.state.players.set(token, player);
    }

    conn.send(JSON.stringify({ type: "join-ok", token, nick: player.nick, score: player.score }));
    this.sendStateTo(conn, "player");
    this.broadcastPlayers();
  }

  private handleRelayQuestion(sender: PartyConnection, msg: any) {
    if (!this.isHost(sender)) return;
    const index = Number(msg.index);
    const text = clean(msg.text, TEXT_MAX);
    const choices = Array.isArray(msg.choices) ? msg.choices.slice(0, 4) : [];
    if (
      !Number.isFinite(index) ||
      index < 0 ||
      index >= this.state.questionTotal ||
      !text ||
      choices.length !== 4
    ) {
      this.sendError(sender, "BAD_QUESTION", "Invalid question payload");
      return;
    }
    const cleaned: [string, string, string, string] = [
      clean(choices[0], CHOICE_MAX),
      clean(choices[1], CHOICE_MAX),
      clean(choices[2], CHOICE_MAX),
      clean(choices[3], CHOICE_MAX),
    ];
    if (cleaned.some((c) => !c)) {
      this.sendError(sender, "BAD_CHOICES", "All 4 choices required");
      return;
    }

    this.broadcastPlayersOnly({
      type: "question-content",
      index,
      text,
      choices: cleaned,
    });
  }

  private handleStartQuestion(sender: PartyConnection, msg: any) {
    if (!this.isHost(sender)) return;

    const index = Number(msg.index);
    const duration = Math.max(MIN_DURATION, Math.min(MAX_DURATION, Number(msg.duration) || 20_000));
    const correctIndex = Number(msg.correctIndex);
    const text = clean(msg.text, TEXT_MAX);
    const choices = Array.isArray(msg.choices) ? msg.choices.slice(0, 4) : [];

    if (
      !Number.isFinite(index) ||
      index < 0 ||
      index >= this.state.questionTotal ||
      !text ||
      choices.length !== 4 ||
      ![0, 1, 2, 3].includes(correctIndex)
    ) {
      this.sendError(sender, "BAD_START", "Invalid start payload");
      return;
    }

    const cleaned: [string, string, string, string] = [
      clean(choices[0], CHOICE_MAX),
      clean(choices[1], CHOICE_MAX),
      clean(choices[2], CHOICE_MAX),
      clean(choices[3], CHOICE_MAX),
    ];
    if (cleaned.some((c) => !c)) {
      this.sendError(sender, "BAD_CHOICES", "All 4 choices required");
      return;
    }

    const now = Date.now();
    this.state.phase = "question";
    this.state.currentIndex = index;
    this.state.current = {
      index,
      text,
      choices: cleaned,
      correctIndex: correctIndex as 0 | 1 | 2 | 3,
      duration,
      startedAt: now,
      endsAt: now + duration,
      answers: new Map(),
    };
    this.state.lastReveal = null;

    this.broadcastPlayersOnly({
      type: "question-content",
      index,
      text,
      choices: cleaned,
    });

    this.broadcast({
      type: "question-start",
      index,
      startedAt: now,
      duration,
      total: this.state.questionTotal,
    });
  }

  private handlePlayerAnswer(sender: PartyConnection, msg: any) {
    const player = this.findPlayerByConn(sender);
    if (!player) {
      this.sendError(sender, "NOT_PLAYER", "Not a registered player");
      return;
    }

    if (this.state.phase !== "question" || !this.state.current) {
      this.sendError(sender, "NOT_ACCEPTING", "Not accepting answers right now");
      return;
    }

    const choice = Number(msg.choice);
    if (![0, 1, 2, 3].includes(choice)) {
      this.sendError(sender, "BAD_CHOICE", "Invalid choice");
      return;
    }

    const now = Date.now();
    if (now > this.state.current.endsAt) {
      this.sendError(sender, "TOO_LATE", "Time is up");
      return;
    }

    if (this.state.current.answers.has(player.token)) return;

    this.state.current.answers.set(player.token, {
      choice: choice as 0 | 1 | 2 | 3,
      receivedAt: now,
    });

    sender.send(JSON.stringify({ type: "answer-ack", choice }));

    const totalAlive = [...this.state.players.values()].filter((p) => p.alive).length;
    if (this.state.current.answers.size >= totalAlive && totalAlive > 0) {
      this.broadcast({ type: "all-answered" });
    }
  }

  private handleReveal(sender: PartyConnection) {
    if (!this.isHost(sender)) return;
    if (this.state.phase !== "question" || !this.state.current) return;

    const q = this.state.current;
    const counts: [number, number, number, number] = [0, 0, 0, 0];
    for (const a of q.answers.values()) counts[a.choice]++;

    for (const [token, a] of q.answers) {
      const player = this.state.players.get(token);
      if (!player) continue;
      const correct = a.choice === q.correctIndex;
      const elapsed = a.receivedAt - q.startedAt;
      player.score += score(correct, elapsed, q.duration);
    }

    this.state.phase = "reveal";
    this.state.lastReveal = { correctIndex: q.correctIndex, perChoiceCounts: counts };

    const leaderboard = this.computeLeaderboard();
    this.broadcast({
      type: "reveal",
      index: q.index,
      correctIndex: q.correctIndex,
      perChoiceCounts: counts,
      leaderboard,
    });

    for (const [token, a] of q.answers) {
      const player = this.state.players.get(token);
      if (!player) continue;
      const correct = a.choice === q.correctIndex;
      const gained = score(correct, a.receivedAt - q.startedAt, q.duration);
      this.sendToPlayerToken(token, {
        type: "my-result",
        correct,
        gained,
        score: player.score,
      });
    }
  }

  private handleNext(sender: PartyConnection) {
    if (!this.isHost(sender)) return;
    if (this.state.phase !== "reveal") return;

    if (this.state.currentIndex + 1 >= this.state.questionTotal) {
      this.finishGame();
      return;
    }

    this.state.phase = "leaderboard";
    this.broadcast({
      type: "leaderboard",
      leaderboard: this.computeLeaderboard(),
      next: this.state.currentIndex + 1,
      total: this.state.questionTotal,
    });
  }

  private handleEnd(sender: PartyConnection) {
    if (!this.isHost(sender)) return;
    this.finishGame();
  }

  private finishGame() {
    this.state.phase = "finished";
    this.state.current = null;
    const podium = this.computeLeaderboard().slice(0, 10);
    this.broadcast({ type: "final", podium });
  }

  private computeLeaderboard() {
    const arr = [...this.state.players.values()]
      .map((p) => ({ nick: p.nick, score: p.score, alive: p.alive }))
      .sort((a, b) => b.score - a.score);
    return arr.map((p, i) => ({ ...p, rank: i + 1 }));
  }

  private isHost(conn: PartyConnection): boolean {
    return this.state.hostAlive && this.state.hostConnId === conn.id;
  }

  private findPlayerByConn(conn: PartyConnection): Player | null {
    for (const p of this.state.players.values()) {
      if (p.connId === conn.id) return p;
    }
    return null;
  }

  private sendError(conn: PartyConnection, code: string, message: string) {
    try {
      conn.send(JSON.stringify({ type: "error", code, message }));
    } catch {}
  }

  private sendStateTo(conn: PartyConnection, role: "host" | "player") {
    const payload: any = {
      type: "state",
      phase: this.state.phase,
      hostAlive: this.state.hostAlive,
      currentIndex: this.state.currentIndex,
      questionTotal: this.state.questionTotal,
      role,
    };

    if (this.state.phase === "question" && this.state.current) {
      payload.question = {
        index: this.state.current.index,
        text: this.state.current.text,
        choices: this.state.current.choices,
        startedAt: this.state.current.startedAt,
        duration: this.state.current.duration,
      };
    }

    if (
      (this.state.phase === "reveal" || this.state.phase === "leaderboard") &&
      this.state.lastReveal &&
      this.state.current
    ) {
      payload.reveal = {
        index: this.state.current.index,
        correctIndex: this.state.lastReveal.correctIndex,
        perChoiceCounts: this.state.lastReveal.perChoiceCounts,
      };
      payload.leaderboard = this.computeLeaderboard();
    }

    if (this.state.phase === "finished") {
      payload.podium = this.computeLeaderboard().slice(0, 10);
    }

    payload.players = this.computeLeaderboard();

    try {
      conn.send(JSON.stringify(payload));
    } catch {}
  }

  private broadcast(msg: any) {
    const json = JSON.stringify(msg);
    for (const conn of this.party.getConnections()) {
      try {
        conn.send(json);
      } catch {}
    }
  }

  private broadcastPlayersOnly(msg: any) {
    const json = JSON.stringify(msg);
    for (const conn of this.party.getConnections()) {
      if (conn.id === this.state.hostConnId) continue;
      try {
        conn.send(json);
      } catch {}
    }
  }

  private broadcastPlayers() {
    this.broadcast({ type: "players", players: this.computeLeaderboard() });
  }

  private broadcastPresence() {
    let count = 0;
    for (const _ of this.party.getConnections()) count++;
    this.broadcast({ type: "presence", count });
  }

  private sendToPlayerToken(token: string, msg: any) {
    const player = this.state.players.get(token);
    if (!player || !player.connId) return;
    for (const conn of this.party.getConnections()) {
      if (conn.id === player.connId) {
        try {
          conn.send(JSON.stringify(msg));
        } catch {}
        return;
      }
    }
  }
}

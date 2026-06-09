<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import PartySocket from 'partysocket';
  import QRCode from 'qrcode';
  import {
    generateEphemeralKeypair, exportPublicKey, importPublicKey, deriveSharedKey,
    generateRoomKey, importRoomKey, encryptMessage, decryptMessage,
  } from '../../lib/quizCrypto';
  import { getTranslations, t } from '../../lib/i18n';

  export let locale = 'en';
  export let roomId = '';
  export let partyHost = 'encrypt-click.danielsebesta.partykit.dev';

  $: dict = getTranslations(locale);

  type Question = {
    text: string;
    choices: [string, string, string, string];
    correctIndex: 0 | 1 | 2 | 3;
    duration: number;
  };

  type HostQuiz = {
    token: string;
    title: string;
    questions: Question[];
  };

  type LeaderboardEntry = { nick: string; score: number; rank: number; alive: boolean };
  type ServerQuestion = { index: number; text: string; choices: [string, string, string, string]; startedAt: number; duration: number };
  type ServerReveal = { index: number; correctIndex: 0 | 1 | 2 | 3; perChoiceCounts: [number, number, number, number] };

  type Phase = 'lobby' | 'question' | 'reveal' | 'leaderboard' | 'finished';

  const PLAYER_TOKEN_KEY = `quiz-player-${roomId}`;
  const HOST_KEY = `quiz-host-${roomId}`;
  const ACTIVE_KEY = `quiz-active-${roomId}`;
  const COUNTDOWN_MS = 3000;
  const ACTIVE_TTL_MS = 60 * 60 * 1000;
  const NICK_MAX = 24;

  let role: 'pending' | 'host' | 'player' = 'pending';
  let phase: Phase = 'lobby';
  let connected = false;
  let connecting = false;
  let serverError = '';
  let hostPaused = false;
  let myConnId = '';

  // Host (creator) state
  let hostQuiz: HostQuiz | null = null;
  let hostKeypair: CryptoKeyPair | null = null;
  let hostPublicKeyB64 = '';
  let hostRoomKeyB64 = '';        // base64 of room passphrase (32 random bytes)
  let hostRoomKey: CryptoKey | null = null;

  type HostPlayer = {
    token: string;
    connId: string | null;
    nick: string;
    score: number;
  };
  let hostPlayers = new Map<string, HostPlayer>();             // keyed by token
  let hostConnToToken = new Map<string, string>();             // connId → token
  let hostConnSharedKey = new Map<string, CryptoKey>();        // connId → ECDH shared key

  let hostCurrent: {
    index: number; text: string; choices: [string, string, string, string]; correctIndex: 0|1|2|3;
    duration: number; startedAt: number; endsAt: number;
    answers: Map<string, { choice: 0|1|2|3; receivedAt: number }>;
  } | null = null;
  let hostQuestionTimeout: ReturnType<typeof setTimeout> | null = null;
  let persistTimeout: ReturnType<typeof setTimeout> | null = null;

  // Player state
  let needsNick = false;
  let nickInput = '';
  let nickError = '';
  let playerNick = '';
  let playerToken = '';
  let myScore = 0;
  let playerKeypair: CryptoKeyPair | null = null;
  let playerRoomKey: CryptoKey | null = null;
  let handshaking = false;

  // Game state mirrored on player (or computed by host)
  let currentQuestion: ServerQuestion | null = null;
  let questionTotal = 0;
  let currentIndex = -1;
  let timeLeft = 0;
  let timerInterval: ReturnType<typeof setInterval> | null = null;
  let lastReveal: ServerReveal | null = null;
  let leaderboard: LeaderboardEntry[] = [];
  let players: LeaderboardEntry[] = [];
  let podium: LeaderboardEntry[] = [];
  let myAnswer: 0 | 1 | 2 | 3 | null = null;
  let myLastResult: { correct: boolean; gained: number } | null = null;

  // Audio
  let audioCtx: AudioContext | null = null;
  let lastTickAt = 0;
  let lastCountdownAnnouncement = -1;

  // Countdown state
  let countdownNum = 0;

  // Share state
  let copiedLink = false;
  let serverPresence = 0;
  let qrSvg = '';

  let ws: PartySocket | null = null;

  const COLORS = [
    { bg: 'rgb(16,185,129)', dim: 'rgba(16,185,129,0.15)' },
    { bg: 'rgb(217,70,239)', dim: 'rgba(217,70,239,0.15)' },
    { bg: 'rgb(34,211,238)', dim: 'rgba(34,211,238,0.15)' },
    { bg: 'rgb(251,191,36)', dim: 'rgba(251,191,36,0.18)' },
  ];

  const ICONS = [
    // 0: lock
    '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    // 1: key-round
    '<path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/>',
    // 2: shield
    '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
    // 3: anonymous / Guy Fawkes-style mask (within 24x24 bounds)
    '<path d="M12 3.5c-3.5 0-6 2.5-6 6 0 2 .8 3.5 2 5l-1 5 5-1 5 1-1-5c1.2-1.5 2-3 2-5 0-3.5-2.5-6-6-6z"/><ellipse cx="9.5" cy="10.5" rx="1.1" ry="0.7"/><ellipse cx="14.5" cy="10.5" rx="1.1" ry="0.7"/><path d="M9.5 13.5c-1.5.5-2 1.5-1 2.5"/><path d="M14.5 13.5c1.5.5 2 1.5 1 2.5"/><path d="M11.5 16.5l.5 1.5.5-1.5"/>',
  ];

  function ensureAudio() {
    if (audioCtx || typeof window === 'undefined') return;
    try {
      audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    } catch {}
  }

  function playTick() {
    if (!audioCtx) return;
    const now = audioCtx.currentTime;
    if (now - lastTickAt < 0.4) return;
    lastTickAt = now;
    try {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.frequency.value = 880;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.12, now + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.15);
    } catch {}
  }

  function playCountdownBeep() {
    if (!audioCtx) return;
    const now = audioCtx.currentTime;
    try {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.frequency.value = 660;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.22, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.3);
    } catch {}
  }

  function playGo() {
    if (!audioCtx) return;
    const now = audioCtx.currentTime;
    try {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.frequency.value = 1100;
      osc.type = 'triangle';
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.28, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.65);
    } catch {}
  }

  function playFinalChord() {
    if (!audioCtx) return;
    const now = audioCtx.currentTime;
    try {
      [523.25, 659.25, 783.99].forEach((freq, i) => {
        const osc = audioCtx!.createOscillator();
        const gain = audioCtx!.createGain();
        osc.frequency.value = freq;
        osc.type = 'sine';
        const start = now + i * 0.08;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.15, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 1.2);
        osc.connect(gain);
        gain.connect(audioCtx!.destination);
        osc.start(start);
        osc.stop(start + 1.3);
      });
    } catch {}
  }

  function genPlayerToken(): string {
    const arr = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
  }

  function loadHostQuiz(): HostQuiz | null {
    if (typeof sessionStorage === 'undefined') return null;
    try {
      const raw = sessionStorage.getItem(HOST_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as HostQuiz;
      if (!parsed.token || !Array.isArray(parsed.questions) || parsed.questions.length === 0) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  function loadPlayerToken(): string {
    if (typeof sessionStorage === 'undefined') return genPlayerToken();
    let token = sessionStorage.getItem(PLAYER_TOKEN_KEY) || '';
    if (!token) {
      token = genPlayerToken();
      sessionStorage.setItem(PLAYER_TOKEN_KEY, token);
    }
    return token;
  }

  function loadPlayerNick(): string {
    if (typeof sessionStorage === 'undefined') return '';
    return sessionStorage.getItem(`${PLAYER_TOKEN_KEY}-nick`) || '';
  }

  function savePlayerNick(nick: string) {
    if (typeof sessionStorage === 'undefined') return;
    sessionStorage.setItem(`${PLAYER_TOKEN_KEY}-nick`, nick);
  }

  async function init() {
    if (typeof window === 'undefined') return;

    const active = loadActiveGame();
    const quiz = loadHostQuiz();

    if (quiz || active) {
      role = 'host';
      hostQuiz = quiz ?? (active ? { token: active.hostToken, title: active.title, questions: active.questions } : null);
      hostKeypair = await generateEphemeralKeypair();
      hostPublicKeyB64 = await exportPublicKey(hostKeypair.publicKey);

      if (active) {
        // Resume in-progress game
        hostRoomKeyB64 = active.roomKey;
        hostRoomKey = await importRoomKey(hostRoomKeyB64);
        for (const p of active.players) {
          hostPlayers.set(p.token, { token: p.token, connId: null, nick: p.nick, score: p.score });
        }
        phase = active.phase;
        currentIndex = active.currentIndex;
        questionTotal = hostQuiz ? hostQuiz.questions.length : 0;
        if (active.lastReveal) lastReveal = active.lastReveal;
        if (active.podium) podium = active.podium;
        recomputeLeaderboardFromHost();
      } else {
        hostRoomKeyB64 = await generateRoomKey();
        hostRoomKey = await importRoomKey(hostRoomKeyB64);
        questionTotal = hostQuiz ? hostQuiz.questions.length : 0;
      }
      connectWs();
      return;
    }

    role = 'player';
    playerToken = loadPlayerToken();
    const savedNick = loadPlayerNick();
    if (savedNick) {
      playerNick = savedNick;
      nickInput = savedNick;
      await beginPlayerHandshake();
    } else {
      needsNick = true;
    }
  }

  async function beginPlayerHandshake() {
    handshaking = true;
    playerKeypair = await generateEphemeralKeypair();
    connectWs();
  }

  function submitNick() {
    nickError = '';
    const trimmed = nickInput.trim().slice(0, NICK_MAX);
    if (!trimmed) {
      nickError = t(dict, 'quiz.errorNickRequired');
      return;
    }
    playerNick = trimmed;
    savePlayerNick(trimmed);
    needsNick = false;
    beginPlayerHandshake();
  }

  function connectWs() {
    if (ws) return;
    connecting = true;
    ws = new PartySocket({
      host: partyHost,
      room: roomId,
      party: 'quiz',
      minReconnectionDelay: 500,
      maxReconnectionDelay: 8000,
      reconnectionDelayGrowFactor: 1.4,
      connectionTimeout: 8000,
      maxRetries: Infinity,
    });
    ws.addEventListener('open', () => {
      connected = true;
      connecting = false;
      serverError = '';
    });
    ws.addEventListener('close', () => { connected = false; });
    ws.addEventListener('error', () => { connecting = false; });
    ws.addEventListener('message', handleServerMessage);
  }

  // ── Envelope helpers ────────────────────────────────────────────────────────

  function sendEnvelope(payload: any, to?: string) {
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ type: 'envelope', to, payload }));
  }

  async function sendEncrypted(roomKey: CryptoKey, payload: any, to?: string) {
    const ciphertext = await encryptMessage(roomKey, JSON.stringify(payload));
    sendEnvelope({ type: 'enc', ciphertext }, to);
  }

  // ── Server message handler ──────────────────────────────────────────────────

  async function handleServerMessage(event: MessageEvent) {
    let data: any;
    try { data = JSON.parse(event.data); } catch { return; }
    if (!data || typeof data.type !== 'string') return;

    switch (data.type) {
      case 'init':
        myConnId = data.connId || '';
        serverPresence = data.presence || 0;
        if (role === 'player' && handshaking) {
          await sendDhHello();
        } else if (role === 'host') {
          // Announce ourselves so any waiting players can (re-)handshake
          sendEnvelope({ type: 'host-online' });
          await hostBroadcastState();
        }
        return;

      case 'presence':
        serverPresence = data.count || 0;
        return;

      case 'peer-join':
        return;

      case 'peer-leave':
        if (role === 'host') {
          const token = hostConnToToken.get(data.id);
          hostConnToToken.delete(data.id);
          hostConnSharedKey.delete(data.id);
          if (token) {
            const p = hostPlayers.get(token);
            if (p && p.connId === data.id) {
              p.connId = null;
              hostPlayers = hostPlayers;
              recomputeLeaderboardFromHost();
              await hostBroadcastPlayers();
              persistGameState();
            }
          }
        } else if (role === 'player' && data.id && hostConnIdGuess && data.id === hostConnIdGuess) {
          // host disconnected
          hostPaused = true;
        }
        return;

      case 'envelope': {
        const from = data.from as string;
        const payload = data.payload;
        const receivedAt = data.receivedAt as number;
        if (!payload || typeof payload.type !== 'string') return;

        if (payload.type === 'host-online' && role === 'player') {
          hostConnIdGuess = from;
          if (!playerRoomKey) await sendDhHello();
          else hostPaused = false;
        } else if (payload.type === 'dh-hello' && role === 'host') {
          await hostHandleDhHello(from, payload);
        } else if (payload.type === 'dh-welcome' && role === 'player') {
          await playerHandleDhWelcome(from, payload);
        } else if (payload.type === 'enc') {
          if (role === 'host') {
            await hostHandleEncrypted(from, payload.ciphertext, receivedAt);
          } else if (role === 'player') {
            await playerHandleEncrypted(from, payload.ciphertext);
          }
        }
        return;
      }

      case 'error':
        serverError = data.message || 'Error';
        if (data.code === 'ROOM_LOCKED') {
          serverError = t(dict, 'quiz.errorRoomTaken');
        }
        return;
    }
  }

  // ── ECDH handshake ──────────────────────────────────────────────────────────

  let hostConnIdGuess = ''; // player-side: assumed host connId after dh-welcome

  async function sendDhHello() {
    if (!playerKeypair) return;
    const pubKey = await exportPublicKey(playerKeypair.publicKey);
    sendEnvelope({ type: 'dh-hello', pubKey });
  }

  async function hostHandleDhHello(fromConnId: string, msg: any) {
    if (!hostKeypair || !hostRoomKeyB64) return;
    try {
      const peerPub = await importPublicKey(msg.pubKey);
      const sharedKey = await deriveSharedKey(hostKeypair.privateKey, peerPub);
      hostConnSharedKey.set(fromConnId, sharedKey);

      // Encrypt room key with shared secret and send dh-welcome direct to peer
      const encryptedRoomKey = await encryptMessage(sharedKey, hostRoomKeyB64);
      sendEnvelope({
        type: 'dh-welcome',
        pubKey: hostPublicKeyB64,
        encryptedRoomKey,
      }, fromConnId);
    } catch {}
  }

  async function playerHandleDhWelcome(fromConnId: string, msg: any) {
    if (!playerKeypair || playerRoomKey) return; // ignore extra welcomes
    try {
      const hostPub = await importPublicKey(msg.pubKey);
      const sharedKey = await deriveSharedKey(playerKeypair.privateKey, hostPub);
      const roomKeyB64 = await decryptMessage(sharedKey, msg.encryptedRoomKey);
      playerRoomKey = await importRoomKey(roomKeyB64);
      hostConnIdGuess = fromConnId;
      handshaking = false;

      // Announce ourselves to host
      await sendEncrypted(playerRoomKey, {
        type: 'p-join', nick: playerNick, token: playerToken,
      }, fromConnId);
    } catch {
      serverError = t(dict, 'quiz.errorHandshakeFailed');
    }
  }

  // ── Host: encrypted message handling ────────────────────────────────────────

  async function hostHandleEncrypted(fromConnId: string, ciphertext: string, receivedAt: number) {
    if (!hostRoomKey) return;
    let payload: any;
    try {
      const text = await decryptMessage(hostRoomKey, ciphertext);
      payload = JSON.parse(text);
    } catch { return; }

    if (!payload || typeof payload.type !== 'string') return;

    if (payload.type === 'p-join') {
      await hostHandlePlayerJoin(fromConnId, payload.nick, payload.token);
    } else if (payload.type === 'p-answer') {
      await hostHandlePlayerAnswer(fromConnId, payload.index, payload.choice, receivedAt);
    }
  }

  async function hostHandlePlayerJoin(fromConnId: string, nick: string, token: string) {
    nick = String(nick || '').trim().slice(0, NICK_MAX);
    token = String(token || '');
    if (!nick || token.length < 8) return;

    let player = hostPlayers.get(token);
    if (player) {
      player.connId = fromConnId;
      player.nick = nick;
    } else {
      // new player; check nick collision among alive
      for (const p of hostPlayers.values()) {
        if (p.connId && p.nick.toLowerCase() === nick.toLowerCase()) {
          await sendEncrypted(hostRoomKey!, {
            type: 'h-error', code: 'NICK_TAKEN', message: t(dict, 'quiz.errorNickTaken'),
          }, fromConnId);
          return;
        }
      }
      player = { token, connId: fromConnId, nick, score: 0 };
      hostPlayers.set(token, player);
    }
    hostConnToToken.set(fromConnId, token);
    hostPlayers = hostPlayers;
    recomputeLeaderboardFromHost();

    // Confirm join to player
    await sendEncrypted(hostRoomKey!, {
      type: 'h-join-ok', nick: player.nick, score: player.score,
    }, fromConnId);

    // Send full state to this player
    await hostSendStateTo(fromConnId);

    // Broadcast players to all
    await hostBroadcastPlayers();
    persistGameState();
  }

  async function hostHandlePlayerAnswer(fromConnId: string, index: number, choice: number, receivedAt: number) {
    const token = hostConnToToken.get(fromConnId);
    if (!token) return;
    const player = hostPlayers.get(token);
    if (!player) return;

    if (phase !== 'question' || !hostCurrent || hostCurrent.index !== index) return;
    if (![0, 1, 2, 3].includes(choice)) return;
    if (receivedAt < hostCurrent.startedAt) return;
    if (receivedAt > hostCurrent.endsAt) return;
    if (hostCurrent.answers.has(token)) return;

    hostCurrent.answers.set(token, { choice: choice as 0|1|2|3, receivedAt });

    // Ack to that player
    await sendEncrypted(hostRoomKey!, { type: 'h-ack', choice }, fromConnId);

    // If everyone alive answered, auto-reveal
    let aliveCount = 0;
    for (const p of hostPlayers.values()) if (p.connId) aliveCount++;
    if (aliveCount > 0 && hostCurrent.answers.size >= aliveCount) {
      hostReveal();
    }
  }

  // ── Host: game flow ─────────────────────────────────────────────────────────

  function startGame() {
    if (!hostQuiz || phase !== 'lobby') return;
    hostStartQuestionAt(0);
  }

  function hostStartQuestionAt(index: number) {
    if (!hostQuiz) return;
    const q = hostQuiz.questions[index];
    if (!q) return;
    ensureAudio();

    const now = Date.now();
    const startedAt = now + COUNTDOWN_MS;
    const duration = q.duration * 1000;
    hostCurrent = {
      index,
      text: q.text,
      choices: q.choices,
      correctIndex: q.correctIndex,
      duration,
      startedAt,
      endsAt: startedAt + duration,
      answers: new Map(),
    };
    phase = 'question';
    currentIndex = index;
    lastReveal = null;
    myAnswer = null;
    myLastResult = null;
    currentQuestion = {
      index, text: q.text, choices: q.choices, startedAt, duration,
    };

    if (hostQuestionTimeout) clearTimeout(hostQuestionTimeout);
    hostQuestionTimeout = setTimeout(() => hostReveal(), COUNTDOWN_MS + duration + 50);

    startTimer();
    hostBroadcastState();
    persistGameState();
  }

  function hostReveal() {
    if (phase !== 'question' || !hostCurrent) return;
    if (hostQuestionTimeout) { clearTimeout(hostQuestionTimeout); hostQuestionTimeout = null; }

    const q = hostCurrent;
    const counts: [number, number, number, number] = [0, 0, 0, 0];
    for (const a of q.answers.values()) counts[a.choice]++;

    const myResults = new Map<string, { correct: boolean; gained: number }>();
    for (const [token, a] of q.answers) {
      const player = hostPlayers.get(token);
      if (!player) continue;
      const correct = a.choice === q.correctIndex;
      const elapsed = Math.max(0, a.receivedAt - q.startedAt);
      const ratio = Math.min(1, elapsed / q.duration);
      const gained = correct ? Math.max(500, Math.round(1000 - 500 * ratio)) : 0;
      player.score += gained;
      myResults.set(token, { correct, gained });
    }
    hostPlayers = hostPlayers;
    phase = 'reveal';
    lastReveal = { index: q.index, correctIndex: q.correctIndex, perChoiceCounts: counts };
    recomputeLeaderboardFromHost();
    stopTimer();

    hostBroadcastState();

    // Send per-player results
    for (const [token, player] of hostPlayers) {
      if (!player.connId) continue;
      const r = myResults.get(token) ?? { correct: false, gained: 0 };
      sendEncrypted(hostRoomKey!, {
        type: 'h-result', correct: r.correct, gained: r.gained, score: player.score,
      }, player.connId);
    }
    persistGameState();
  }

  function endGame() {
    if (hostQuestionTimeout) { clearTimeout(hostQuestionTimeout); hostQuestionTimeout = null; }
    phase = 'finished';
    hostCurrent = null;
    recomputeLeaderboardFromHost();
    podium = [...leaderboard].slice(0, 10);
    stopTimer();
    playFinalChord();
    hostBroadcastState();
    clearActiveGame();
  }

  function skipOrAdvance() {
    if (role !== 'host') return;
    if (phase === 'question') {
      hostReveal();
    } else if (phase === 'reveal') {
      hostShowLeaderboard();
    } else if (phase === 'leaderboard') {
      if (currentIndex + 1 < questionTotal) {
        hostStartQuestionAt(currentIndex + 1);
      } else {
        endGame();
      }
    }
  }

  function hostShowLeaderboard() {
    if (phase !== 'reveal') return;
    phase = 'leaderboard';
    hostBroadcastState();
    persistGameState();
  }

  // ── Host: broadcast helpers ─────────────────────────────────────────────────

  function recomputeLeaderboardFromHost() {
    const arr: LeaderboardEntry[] = [];
    let i = 0;
    const sorted = [...hostPlayers.values()].sort((a, b) => b.score - a.score);
    for (const p of sorted) {
      i++;
      arr.push({ nick: p.nick, score: p.score, alive: !!p.connId, rank: i });
    }
    leaderboard = arr;
    players = arr;
  }

  async function hostBroadcastPlayers() {
    if (!hostRoomKey) return;
    await sendEncrypted(hostRoomKey, { type: 'h-players', players: leaderboard });
  }

  async function hostBroadcastState() {
    if (!hostRoomKey) return;
    const payload = buildHostStatePayload();
    await sendEncrypted(hostRoomKey, payload);
  }

  async function hostSendStateTo(connId: string) {
    if (!hostRoomKey) return;
    const payload = buildHostStatePayload();
    await sendEncrypted(hostRoomKey, payload, connId);
  }

  function buildHostStatePayload() {
    const p: any = {
      type: 'h-state',
      phase,
      currentIndex,
      questionTotal,
      players: leaderboard,
    };
    if (phase === 'question' && hostCurrent) {
      // Send a relative offset (ms until question starts) instead of an
      // absolute timestamp so each client anchors to their own local clock
      // at receipt — avoids cross-device clock drift desyncing the countdown.
      const now = Date.now();
      p.question = {
        index: hostCurrent.index,
        text: hostCurrent.text,
        choices: hostCurrent.choices,
        startedAtRel: hostCurrent.startedAt - now,
        duration: hostCurrent.duration,
      };
    }
    if (phase === 'reveal' && lastReveal) {
      p.reveal = lastReveal;
    }
    if (phase === 'leaderboard') {
      p.leaderboard = leaderboard;
      if (lastReveal) p.reveal = lastReveal;
    }
    if (phase === 'finished') {
      p.podium = podium;
    }
    return p;
  }

  // ── Player: encrypted message handling ──────────────────────────────────────

  async function playerHandleEncrypted(fromConnId: string, ciphertext: string) {
    if (!playerRoomKey) return;
    // Reject encrypted h-* messages from anyone except the host. Server-added
    // `from` is trusted in the honest-but-curious threat model; this blocks
    // player-vs-player impersonation despite all players sharing the room key.
    if (!hostConnIdGuess || fromConnId !== hostConnIdGuess) return;

    let payload: any;
    try {
      const text = await decryptMessage(playerRoomKey, ciphertext);
      payload = JSON.parse(text);
    } catch { return; }

    if (!payload || typeof payload.type !== 'string') return;

    switch (payload.type) {
      case 'h-state': {
        phase = payload.phase;
        currentIndex = payload.currentIndex ?? -1;
        questionTotal = payload.questionTotal || 0;
        if (Array.isArray(payload.players)) {
          players = payload.players;
          leaderboard = payload.players;
          updateMyScore();
        }
        if (payload.question) {
          // Anchor host-relative offset to our own local clock to avoid
          // cross-device clock drift breaking the countdown.
          const rel = typeof payload.question.startedAtRel === 'number'
            ? payload.question.startedAtRel
            : 0;
          const localStartedAt = Date.now() + rel;
          currentQuestion = {
            index: payload.question.index,
            text: payload.question.text,
            choices: payload.question.choices,
            startedAt: localStartedAt,
            duration: payload.question.duration,
          };
          myAnswer = null;
          myLastResult = null;
          startTimer();
        }
        if (payload.reveal) {
          lastReveal = payload.reveal;
          stopTimer();
        }
        if (payload.leaderboard) {
          leaderboard = payload.leaderboard;
        }
        if (payload.podium) {
          podium = payload.podium;
          stopTimer();
          playFinalChord();
        }
        hostPaused = false;
        return;
      }
      case 'h-players':
        players = payload.players || [];
        leaderboard = payload.players || [];
        updateMyScore();
        return;
      case 'h-join-ok':
        playerNick = payload.nick || playerNick;
        myScore = payload.score || 0;
        return;
      case 'h-ack':
        myAnswer = payload.choice;
        return;
      case 'h-result':
        myLastResult = { correct: payload.correct, gained: payload.gained };
        myScore = payload.score;
        return;
      case 'h-error':
        serverError = payload.message || 'Error';
        if (payload.code === 'NICK_TAKEN') needsNick = true;
        return;
    }
  }

  // ── Persistence ─────────────────────────────────────────────────────────────

  type ActiveGame = {
    roomId: string;
    hostToken: string;
    title: string;
    questions: Question[];
    roomKey: string;
    players: { token: string; nick: string; score: number }[];
    phase: Phase;
    currentIndex: number;
    lastReveal: ServerReveal | null;
    podium: LeaderboardEntry[];
    updatedAt: number;
  };

  function loadActiveGame(): ActiveGame | null {
    if (typeof localStorage === 'undefined') return null;
    try {
      const raw = localStorage.getItem(ACTIVE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as ActiveGame;
      if (parsed.roomId !== roomId) return null;
      if (Date.now() - parsed.updatedAt > ACTIVE_TTL_MS) {
        localStorage.removeItem(ACTIVE_KEY);
        return null;
      }
      return parsed;
    } catch { return null; }
  }

  function persistGameState() {
    if (role !== 'host' || !hostQuiz) return;
    if (typeof localStorage === 'undefined') return;
    if (persistTimeout) clearTimeout(persistTimeout);
    persistTimeout = setTimeout(() => {
      try {
        const data: ActiveGame = {
          roomId,
          hostToken: hostQuiz!.token,
          title: hostQuiz!.title,
          questions: hostQuiz!.questions,
          roomKey: hostRoomKeyB64,
          players: [...hostPlayers.values()].map(p => ({ token: p.token, nick: p.nick, score: p.score })),
          phase,
          currentIndex,
          lastReveal,
          podium,
          updatedAt: Date.now(),
        };
        localStorage.setItem(ACTIVE_KEY, JSON.stringify(data));
      } catch {}
    }, 400);
  }

  function clearActiveGame() {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.removeItem(ACTIVE_KEY); } catch {}
  }

  // ── Player: submit answer ───────────────────────────────────────────────────

  async function submitAnswer(choice: 0 | 1 | 2 | 3) {
    if (!playerRoomKey || phase !== 'question' || myAnswer !== null) return;
    if (countdownNum > 0) return;
    ensureAudio();
    myAnswer = choice;
    await sendEncrypted(playerRoomKey, {
      type: 'p-answer', index: currentIndex, choice,
    }, hostConnIdGuess || undefined);
  }

  function updateMyScore() {
    if (role !== 'player' || !playerNick) return;
    const me = players.find(p => p.nick === playerNick);
    if (me) myScore = me.score;
  }

  function startTimer() {
    stopTimer();
    if (!currentQuestion) return;
    lastCountdownAnnouncement = -1;
    const update = () => {
      if (!currentQuestion) return;
      const now = Date.now();
      const cdLeftMs = currentQuestion.startedAt - now;
      if (cdLeftMs > 0) {
        const num = Math.ceil(cdLeftMs / 1000);
        if (num !== lastCountdownAnnouncement && num >= 1 && num <= 3) {
          playCountdownBeep();
          lastCountdownAnnouncement = num;
        }
        countdownNum = num;
        timeLeft = currentQuestion.duration / 1000;
        return;
      }
      if (countdownNum > 0) {
        countdownNum = 0;
        playGo();
      }
      const elapsed = (now - currentQuestion.startedAt) / 1000;
      const total = currentQuestion.duration / 1000;
      const remaining = Math.max(0, total - elapsed);
      timeLeft = remaining;
      if (remaining <= 5 && remaining > 0 && phase === 'question') {
        playTick();
      }
    };
    update();
    timerInterval = setInterval(update, 100);
  }

  function stopTimer() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  $: skipLabel =
    phase === 'question' ? t(dict, 'quiz.skip') :
    phase === 'reveal' ? t(dict, 'quiz.showLeaderboard') :
    phase === 'leaderboard'
      ? (currentIndex + 1 < questionTotal ? t(dict, 'quiz.nextQuestion') : t(dict, 'quiz.showPodium'))
      : '';

  function getShareUrl(): string {
    if (typeof window === 'undefined') return '';
    const localePrefix = locale === 'en' ? '' : `/${locale}`;
    return `${window.location.origin}${localePrefix}/quiz/${roomId}`;
  }

  async function generateQr() {
    if (typeof window === 'undefined') return;
    try {
      qrSvg = await QRCode.toString(getShareUrl(), {
        type: 'svg',
        errorCorrectionLevel: 'M',
        margin: 1,
        width: 220,
        color: { dark: '#065f46', light: '#ffffff' },
      });
    } catch {
      qrSvg = '';
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(getShareUrl());
      copiedLink = true;
      setTimeout(() => { copiedLink = false; }, 1500);
    } catch {}
  }

  function leaveAndCleanup() {
    if (role === 'host') {
      try { sessionStorage.removeItem(HOST_KEY); } catch {}
      clearActiveGame();
    }
    const localePrefix = locale === 'en' ? '' : `/${locale}`;
    window.location.href = `${localePrefix}/quiz`;
  }

  $: timeLeftCeil = Math.ceil(timeLeft);
  $: timePercent = currentQuestion ? Math.max(0, Math.min(100, (timeLeft * 1000 / currentQuestion.duration) * 100)) : 0;
  $: revealCounts = lastReveal?.perChoiceCounts || [0, 0, 0, 0];
  $: revealMax = Math.max(1, ...revealCounts);
  $: revealTotal = revealCounts.reduce((a, b) => a + b, 0);
  $: progressLabel = questionTotal > 0 ? `${currentIndex + 1} / ${questionTotal}` : '';
  $: timerWarn = timeLeft <= 5 && timeLeft > 0 && phase === 'question';
  $: formattedRoomCode = roomId.length === 6 && /^\d+$/.test(roomId) ? `${roomId.slice(0, 3)} ${roomId.slice(3)}` : roomId.toUpperCase();

  onMount(() => {
    init();
    generateQr();
  });
  onDestroy(() => {
    stopTimer();
    ws?.close();
    if (audioCtx && audioCtx.state !== 'closed') {
      audioCtx.close().catch(() => {});
    }
  });
</script>

<div class="quiz-shell">
  {#if phase === 'question' && countdownNum > 0}
    <div class="quiz-countdown-overlay">
      <div class="quiz-countdown-num quiz-countdown-num-{countdownNum}" key={countdownNum}>{countdownNum}</div>
      <p class="quiz-countdown-label">{t(dict, 'quiz.getReady')}</p>
    </div>
  {/if}

  {#if needsNick}
    <div class="quiz-card max-w-sm mx-auto">
      <div class="text-center space-y-3 mb-5">
        <div class="quiz-roomcode">{formattedRoomCode}</div>
        <h2 class="text-lg font-semibold">{t(dict, 'quiz.enterNickTitle')}</h2>
        <p class="text-xs text-zinc-500 dark:text-zinc-400">{t(dict, 'quiz.enterNickSubtitle')}</p>
      </div>
      <input
        class="input w-full text-center text-lg"
        type="text"
        bind:value={nickInput}
        placeholder={t(dict, 'quiz.nickPlaceholder')}
        maxlength="24"
        autocomplete="off"
        on:keydown={(e) => e.key === 'Enter' && submitNick()}
      />
      {#if nickError}
        <p class="text-xs text-red-500 text-center mt-2">{nickError}</p>
      {/if}
      {#if serverError}
        <p class="text-xs text-red-500 text-center mt-2">{serverError}</p>
      {/if}
      <button class="btn w-full mt-4" on:click={submitNick}>{t(dict, 'quiz.joinAction')} →</button>
    </div>

  {:else if !connected && connecting}
    <div class="quiz-card max-w-sm mx-auto text-center">
      <svg class="animate-spin mx-auto h-6 w-6 text-emerald-500 mb-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
      </svg>
      <p class="text-xs text-zinc-500">{t(dict, 'quiz.connecting')}</p>
    </div>

  {:else if serverError && !connected}
    <div class="quiz-card max-w-sm mx-auto text-center space-y-3">
      <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="mx-auto text-red-500"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      <p class="text-sm font-medium text-red-500">{serverError}</p>
      <button class="btn-outline w-full text-xs" on:click={leaveAndCleanup}>{t(dict, 'quiz.leaveRoom')}</button>
    </div>

  {:else}
    {#if hostPaused && phase !== 'lobby' && phase !== 'finished'}
      <div class="quiz-pause-banner">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
        <span>{t(dict, 'quiz.hostPaused')}</span>
      </div>
    {/if}

    {#if serverError && connected}
      <div class="quiz-error-banner">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <span>{serverError}</span>
        <button on:click={() => serverError = ''} aria-label="Dismiss">
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    {/if}

    <!-- HOST VIEW -->
    {#if role === 'host'}
      {#if phase === 'lobby'}
        <div class="space-y-6">
          <div class="quiz-join-hero">
            <div class="quiz-join-info">
              <p class="text-xs uppercase tracking-widest text-zinc-400 font-semibold">{t(dict, 'quiz.roomCode')}</p>
              <div class="quiz-roomcode-big">{formattedRoomCode}</div>
              <button class="quiz-link-copy" on:click={copyLink}>
                {#if copiedLink}
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-emerald-500"><polyline points="20 6 9 17 4 12"/></svg>
                  <span>{t(dict, 'quiz.copied')}</span>
                {:else}
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                  <span>{getShareUrl().replace(/^https?:\/\//, '')}</span>
                {/if}
              </button>
            </div>
            {#if qrSvg}
              <div class="quiz-qr">
                {@html qrSvg}
              </div>
            {/if}
          </div>

          <div class="quiz-card">
            <div class="flex items-center justify-between mb-3">
              <h3 class="text-sm font-semibold">{t(dict, 'quiz.players')}</h3>
              <span class="text-xs text-zinc-400">{players.filter(p => p.alive).length}</span>
            </div>
            {#if players.length === 0}
              <p class="text-xs text-zinc-400 text-center py-6">{t(dict, 'quiz.waitingForPlayers')}</p>
            {:else}
              <div class="quiz-players">
                {#each players as p}
                  <div class="quiz-player-chip" class:quiz-player-chip--gone={!p.alive}>{p.nick}</div>
                {/each}
              </div>
            {/if}
          </div>

          <div class="quiz-card">
            <p class="text-xs text-zinc-500 dark:text-zinc-400 mb-2">{t(dict, 'quiz.quizTitleLabel')}</p>
            <p class="text-base font-semibold mb-1">{hostQuiz?.title}</p>
            <p class="text-xs text-zinc-400">{hostQuiz?.questions.length} {t(dict, 'quiz.questionsShort')}</p>
          </div>

          <button
            class="btn w-full text-base py-3"
            on:click={startGame}
            disabled={players.filter(p => p.alive).length === 0}
          >
            {t(dict, 'quiz.startGame')} →
          </button>
        </div>

      {:else if phase === 'question' || phase === 'reveal' || phase === 'leaderboard'}
        <div class="space-y-4">
          <div class="quiz-stage-header">
            <div class="quiz-stage-progress">
              <span class="quiz-stage-num">{progressLabel}</span>
              {#if phase === 'question'}
                <span class="quiz-timer-num" class:quiz-timer-num--warn={timerWarn}>{timeLeftCeil}s</span>
              {/if}
            </div>
            <button class="quiz-skip-btn" on:click={skipOrAdvance}>
              <span>{skipLabel}</span>
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/></svg>
            </button>
          </div>

          {#if phase === 'question'}
            <div class="quiz-progress-bar">
              <div class="quiz-progress-fill" style="width: {timePercent}%" class:quiz-progress-fill--warn={timerWarn}></div>
            </div>

            <div class="quiz-card text-center">
              <h2 class="text-xl md:text-2xl font-semibold leading-snug">{currentQuestion?.text}</h2>
            </div>

            <div class="quiz-host-choices">
              {#each currentQuestion?.choices || [] as choice, ci}
                <div class="quiz-host-choice" style="--c: {COLORS[ci].bg}; --cd: {COLORS[ci].dim}">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">{@html ICONS[ci]}</svg>
                  <span>{choice}</span>
                </div>
              {/each}
            </div>

            <div class="quiz-answer-count">
              {#if currentQuestion}
                <span>{leaderboard.filter(p => p.alive).length > 0 ? `${players.filter(p => p.alive).length}` : '0'} {t(dict, 'quiz.players')}</span>
              {/if}
            </div>

          {:else if phase === 'reveal'}
            <div class="quiz-card text-center py-2">
              <h2 class="text-base md:text-lg font-semibold leading-snug">{currentQuestion?.text}</h2>
            </div>

            <div class="quiz-host-choices">
              {#each currentQuestion?.choices || [] as choice, ci}
                <div
                  class="quiz-host-choice quiz-host-choice--reveal"
                  class:quiz-host-choice--correct={lastReveal?.correctIndex === ci}
                  class:quiz-host-choice--wrong={lastReveal && lastReveal.correctIndex !== ci}
                  style="--c: {COLORS[ci].bg}; --cd: {COLORS[ci].dim}"
                >
                  <div class="quiz-reveal-head">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">{@html ICONS[ci]}</svg>
                    <span class="quiz-reveal-text">{choice}</span>
                    {#if lastReveal?.correctIndex === ci}
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="quiz-reveal-check"><polyline points="20 6 9 17 4 12"/></svg>
                    {/if}
                  </div>
                  <div class="quiz-reveal-bar">
                    <div class="quiz-reveal-fill" style="width: {revealTotal > 0 ? (revealCounts[ci] / revealMax) * 100 : 0}%; background: {COLORS[ci].bg}"></div>
                    <span class="quiz-reveal-count">
                      {revealCounts[ci]}{revealTotal > 0 ? ` · ${Math.round((revealCounts[ci] / revealTotal) * 100)}%` : ''}
                    </span>
                  </div>
                </div>
              {/each}
            </div>

          {:else}
            <div class="text-center">
              <p class="text-xs text-zinc-400 uppercase tracking-widest mb-1">{t(dict, 'quiz.afterQuestion')} {currentIndex + 1}</p>
              <h2 class="text-lg font-semibold">{t(dict, 'quiz.leaderboard')}</h2>
            </div>

            <div class="quiz-card">
              <div class="quiz-leaderboard">
                {#each leaderboard.slice(0, 10) as p}
                  <div class="quiz-lb-row">
                    <span class="quiz-lb-rank">{p.rank}</span>
                    <span class="quiz-lb-nick">{p.nick}</span>
                    <span class="quiz-lb-score">{p.score}</span>
                  </div>
                {/each}
              </div>
            </div>
          {/if}
        </div>

      {:else if phase === 'finished'}
        <div class="space-y-5">
          <div class="text-center">
            <h2 class="text-2xl font-bold mb-2">{t(dict, 'quiz.finalResults')}</h2>
            <p class="text-sm text-zinc-500 dark:text-zinc-400">{hostQuiz?.title}</p>
          </div>

          {#if podium.length > 0}
            <div class="quiz-podium">
              {#each podium.slice(0, 3) as p, i}
                <div class="quiz-podium-spot quiz-podium-spot--{i + 1}">
                  <div class="quiz-podium-medal">{['🥇', '🥈', '🥉'][i]}</div>
                  <div class="quiz-podium-nick">{p.nick}</div>
                  <div class="quiz-podium-score">{p.score}</div>
                </div>
              {/each}
            </div>
          {/if}

          {#if podium.length > 3}
            <div class="quiz-card">
              <div class="quiz-leaderboard">
                {#each podium.slice(3) as p}
                  <div class="quiz-lb-row">
                    <span class="quiz-lb-rank">{p.rank}</span>
                    <span class="quiz-lb-nick">{p.nick}</span>
                    <span class="quiz-lb-score">{p.score}</span>
                  </div>
                {/each}
              </div>
            </div>
          {/if}

          <button class="btn w-full" on:click={leaveAndCleanup}>{t(dict, 'quiz.newQuiz')}</button>
        </div>
      {/if}

    <!-- PLAYER VIEW -->
    {:else if role === 'player'}
      {#if phase === 'lobby'}
        <div class="quiz-card max-w-sm mx-auto text-center space-y-4">
          <div class="quiz-roomcode">{formattedRoomCode}</div>
          <div>
            <p class="text-xs text-zinc-400 uppercase tracking-widest mb-1">{t(dict, 'quiz.youAre')}</p>
            <p class="text-lg font-semibold">{playerNick}</p>
          </div>
          <p class="text-xs text-zinc-500 dark:text-zinc-400">{t(dict, 'quiz.waitingForHost')}</p>
          <div class="flex justify-center gap-1">
            <span class="quiz-dot"></span>
            <span class="quiz-dot quiz-dot--2"></span>
            <span class="quiz-dot quiz-dot--3"></span>
          </div>
        </div>

      {:else if phase === 'question'}
        {#if myAnswer === null}
          <div class="quiz-player-stage">
            <div class="quiz-player-fs-header">
              <span class="text-zinc-400">{progressLabel}</span>
              <span class="quiz-timer-num" class:quiz-timer-num--warn={timerWarn}>{timeLeftCeil}s</span>
            </div>
            <div class="quiz-progress-bar">
              <div class="quiz-progress-fill" style="width: {timePercent}%" class:quiz-progress-fill--warn={timerWarn}></div>
            </div>
            <div class="quiz-player-grid">
              {#each [0, 1, 2, 3] as ci}
                <button
                  class="quiz-player-btn"
                  style="--c: {COLORS[ci].bg}"
                  on:click={() => submitAnswer(ci)}
                  aria-label={`Answer ${ci + 1}`}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">{@html ICONS[ci]}</svg>
                </button>
              {/each}
            </div>
          </div>
        {:else}
          <div class="quiz-card text-center space-y-3 py-8">
            <div class="quiz-answered-icon" style="--c: {COLORS[myAnswer].bg}">
              <svg xmlns="http://www.w3.org/2000/svg" width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">{@html ICONS[myAnswer]}</svg>
            </div>
            <p class="text-sm font-medium">{t(dict, 'quiz.answered')}</p>
            <p class="text-xs text-zinc-400">{t(dict, 'quiz.waitingForOthers')}</p>
          </div>
        {/if}

      {:else if phase === 'reveal'}
        <div class="space-y-4">
          {#if myLastResult}
            <div class="quiz-card text-center space-y-2 py-8" class:quiz-result-correct={myLastResult.correct} class:quiz-result-wrong={!myLastResult.correct}>
              <div class="text-5xl mb-2">{myLastResult.correct ? '✓' : '✗'}</div>
              <p class="text-xl font-semibold">
                {myLastResult.correct ? t(dict, 'quiz.correct') : t(dict, 'quiz.wrong')}
              </p>
              {#if myLastResult.gained > 0}
                <p class="text-lg text-emerald-500 font-semibold">+{myLastResult.gained}</p>
              {/if}
              <p class="text-xs text-zinc-400">{t(dict, 'quiz.totalScore')}: <span class="font-semibold text-zinc-700 dark:text-zinc-300">{myScore}</span></p>
            </div>
          {/if}
        </div>

      {:else if phase === 'leaderboard'}
        <div class="space-y-4">
          <div class="text-center">
            <p class="text-xs text-zinc-400 uppercase tracking-widest mb-1">{t(dict, 'quiz.afterQuestion')} {currentIndex + 1}</p>
            <h2 class="text-lg font-semibold">{t(dict, 'quiz.leaderboard')}</h2>
          </div>
          <div class="quiz-card">
            <div class="quiz-leaderboard">
              {#each leaderboard.slice(0, 10) as p}
                <div class="quiz-lb-row" class:quiz-lb-row--me={p.nick === playerNick}>
                  <span class="quiz-lb-rank">{p.rank}</span>
                  <span class="quiz-lb-nick">{p.nick}</span>
                  <span class="quiz-lb-score">{p.score}</span>
                </div>
              {/each}
            </div>
          </div>
        </div>

      {:else if phase === 'finished'}
        <div class="space-y-5">
          <div class="text-center">
            <h2 class="text-2xl font-bold mb-1">{t(dict, 'quiz.finalResults')}</h2>
          </div>

          {#if podium.length > 0}
            <div class="quiz-podium">
              {#each podium.slice(0, 3) as p, i}
                <div class="quiz-podium-spot quiz-podium-spot--{i + 1}" class:quiz-podium-spot--me={p.nick === playerNick}>
                  <div class="quiz-podium-medal">{['🥇', '🥈', '🥉'][i]}</div>
                  <div class="quiz-podium-nick">{p.nick}</div>
                  <div class="quiz-podium-score">{p.score}</div>
                </div>
              {/each}
            </div>
          {/if}

          {#if podium.length > 3}
            <div class="quiz-card">
              <div class="quiz-leaderboard">
                {#each podium.slice(3) as p}
                  <div class="quiz-lb-row" class:quiz-lb-row--me={p.nick === playerNick}>
                    <span class="quiz-lb-rank">{p.rank}</span>
                    <span class="quiz-lb-nick">{p.nick}</span>
                    <span class="quiz-lb-score">{p.score}</span>
                  </div>
                {/each}
              </div>
            </div>
          {/if}

          <button class="btn-outline w-full" on:click={leaveAndCleanup}>{t(dict, 'quiz.leaveRoom')}</button>
        </div>
      {/if}
    {/if}
  {/if}
</div>

<style>
  .quiz-shell {
    display: flex; flex-direction: column;
    min-height: 70vh;
  }
  .quiz-card {
    background: rgba(255, 255, 255, 0.6);
    backdrop-filter: blur(12px);
    border: 1px solid rgba(228, 228, 231, 0.6);
    border-radius: 0.95rem;
    padding: 1.1rem 1.3rem;
  }
  :global(.dark) .quiz-card {
    background: rgba(24, 24, 27, 0.5);
    border-color: rgba(63, 63, 70, 0.4);
  }
  .quiz-roomcode {
    font-family: 'fira-code', monospace;
    font-size: 24px; font-weight: 800;
    letter-spacing: 0.18em;
    color: rgb(16, 185, 129);
  }
  .quiz-roomcode-big {
    font-family: 'fira-code', monospace;
    font-size: 48px; font-weight: 900;
    letter-spacing: 0.12em;
    color: rgb(16, 185, 129);
    text-shadow: 0 0 16px rgba(16, 185, 129, 0.3);
    line-height: 1.1;
    margin: 0.4rem 0;
  }
  .quiz-join-hero {
    display: flex; gap: 1.25rem;
    align-items: center; justify-content: center;
    flex-wrap: wrap;
  }
  .quiz-join-info {
    display: flex; flex-direction: column;
    align-items: center; gap: 0.5rem;
    text-align: center;
    min-width: 0;
  }
  .quiz-qr {
    width: 180px; height: 180px;
    flex-shrink: 0;
    background: white;
    border-radius: 0.7rem;
    padding: 0.5rem;
    box-shadow: 0 6px 24px -8px rgba(16, 185, 129, 0.4);
    border: 2px solid rgba(16, 185, 129, 0.2);
  }
  .quiz-qr :global(svg) {
    width: 100% !important;
    height: 100% !important;
    display: block;
  }
  @media (max-width: 480px) {
    .quiz-qr { width: 140px; height: 140px; }
    .quiz-roomcode-big { font-size: 36px; }
  }
  .quiz-link-copy {
    display: inline-flex; align-items: center; gap: 0.4rem;
    padding: 0.4rem 0.7rem; border-radius: 0.45rem;
    background: rgba(244, 244, 245, 0.6);
    font-size: 11px; font-family: 'fira-code', monospace;
    color: rgb(82, 82, 91);
    transition: background 0.15s;
  }
  :global(.dark) .quiz-link-copy {
    background: rgba(39, 39, 42, 0.5);
    color: rgb(161, 161, 170);
  }
  .quiz-link-copy:hover { background: rgba(16, 185, 129, 0.1); }
  .quiz-pause-banner {
    display: flex; align-items: center; gap: 0.4rem; justify-content: center;
    padding: 0.5rem 0.9rem; margin-bottom: 0.8rem;
    border-radius: 0.55rem;
    background: rgba(245, 158, 11, 0.1);
    border: 1px solid rgba(245, 158, 11, 0.25);
    color: rgb(180, 83, 9);
    font-size: 12px; font-weight: 600;
  }
  :global(.dark) .quiz-pause-banner {
    background: rgba(245, 158, 11, 0.12);
    color: rgb(251, 191, 36);
  }
  .quiz-error-banner {
    display: flex; align-items: center; gap: 0.4rem;
    padding: 0.5rem 0.9rem; margin-bottom: 0.8rem;
    border-radius: 0.55rem;
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.25);
    color: rgb(220, 38, 38);
    font-size: 12px; font-weight: 600;
  }
  :global(.dark) .quiz-error-banner {
    background: rgba(239, 68, 68, 0.12);
    color: rgb(252, 165, 165);
  }
  .quiz-error-banner span { flex: 1; }
  .quiz-error-banner button { color: inherit; opacity: 0.7; }
  .quiz-error-banner button:hover { opacity: 1; }
  .quiz-players {
    display: flex; flex-wrap: wrap; gap: 0.4rem;
  }
  .quiz-player-chip {
    padding: 0.35rem 0.7rem; border-radius: 9999px;
    background: rgba(16, 185, 129, 0.1);
    color: rgb(5, 150, 105);
    font-size: 12px; font-weight: 600;
  }
  :global(.dark) .quiz-player-chip {
    background: rgba(16, 185, 129, 0.15);
    color: rgb(52, 211, 153);
  }
  .quiz-player-chip--gone {
    opacity: 0.4;
    background: rgba(161, 161, 170, 0.15);
    color: rgb(113, 113, 122);
  }
  .quiz-stage-header {
    display: flex; align-items: center; justify-content: space-between;
    gap: 0.5rem;
  }
  .quiz-stage-progress {
    display: flex; align-items: center; gap: 0.7rem;
    font-size: 12px;
  }
  .quiz-stage-num {
    color: rgb(113, 113, 122); font-weight: 600;
    font-family: 'fira-code', monospace;
  }
  .quiz-skip-btn {
    display: inline-flex; align-items: center; gap: 0.4rem;
    padding: 0.4rem 0.85rem; border-radius: 0.5rem;
    background: rgba(16, 185, 129, 0.1);
    border: 1px solid rgba(16, 185, 129, 0.2);
    color: rgb(5, 150, 105);
    font-size: 12px; font-weight: 700;
    transition: background 0.15s, border-color 0.15s;
  }
  :global(.dark) .quiz-skip-btn {
    background: rgba(16, 185, 129, 0.14);
    color: rgb(52, 211, 153);
  }
  .quiz-skip-btn:hover {
    background: rgba(16, 185, 129, 0.16);
    border-color: rgba(16, 185, 129, 0.35);
  }
  .quiz-answer-count {
    text-align: center; font-size: 11px; color: rgb(113, 113, 122);
    text-transform: uppercase; letter-spacing: 0.05em;
  }
  .quiz-correct-pill {
    display: inline-flex; align-items: center; gap: 0.5rem;
    padding: 0.55rem 1rem;
    border-radius: 9999px;
    background: var(--cd);
    color: var(--c);
    font-weight: 700; font-size: 15px;
    border: 2px solid var(--c);
    box-shadow: 0 0 16px -2px var(--c);
  }
  .quiz-progress-bar {
    height: 6px;
    border-radius: 9999px;
    background: rgba(228, 228, 231, 0.5);
    overflow: hidden;
  }
  :global(.dark) .quiz-progress-bar {
    background: rgba(63, 63, 70, 0.4);
  }
  .quiz-progress-fill {
    height: 100%;
    background: linear-gradient(90deg, rgb(16, 185, 129), rgb(34, 211, 238));
    transition: width 0.2s linear;
  }
  .quiz-progress-fill--warn {
    background: linear-gradient(90deg, rgb(251, 191, 36), rgb(239, 68, 68));
    animation: quiz-pulse 0.5s ease-in-out infinite alternate;
  }
  @keyframes quiz-pulse {
    from { opacity: 0.7; }
    to { opacity: 1; }
  }
  .quiz-timer-num {
    font-family: 'fira-code', monospace; font-weight: 700;
    color: rgb(113, 113, 122);
  }
  .quiz-timer-num--warn { color: rgb(239, 68, 68); }
  .quiz-host-choices {
    display: grid; grid-template-columns: 1fr 1fr; gap: 0.6rem;
  }
  .quiz-host-choice {
    display: flex; align-items: center; gap: 0.6rem;
    padding: 0.7rem 0.85rem;
    border-radius: 0.6rem;
    background: var(--cd);
    color: var(--c);
    font-weight: 600; font-size: 14px;
    border: 2px solid transparent;
  }
  .quiz-host-choice--reveal {
    flex-direction: column; align-items: stretch;
    gap: 0.45rem;
    padding: 0.7rem 0.85rem;
  }
  .quiz-reveal-head {
    display: flex; align-items: center; gap: 0.5rem;
  }
  .quiz-reveal-text {
    flex: 1; min-width: 0;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    font-size: 14px; font-weight: 700;
  }
  .quiz-reveal-check {
    color: rgb(16, 185, 129);
    flex-shrink: 0;
  }
  .quiz-host-choice--reveal.quiz-host-choice--correct {
    border-color: rgb(16, 185, 129);
    box-shadow: 0 0 18px rgba(16, 185, 129, 0.4);
    animation: quiz-correct-pulse 1.4s ease-in-out 1;
  }
  .quiz-host-choice--reveal.quiz-host-choice--wrong {
    opacity: 0.4;
  }
  @keyframes quiz-correct-pulse {
    0%, 100% { transform: scale(1); }
    30% { transform: scale(1.04); }
  }
  .quiz-reveal-bar {
    position: relative;
    display: flex; align-items: center;
    height: 18px;
    background: rgba(228, 228, 231, 0.4);
    border-radius: 9999px; overflow: hidden;
  }
  :global(.dark) .quiz-reveal-bar {
    background: rgba(63, 63, 70, 0.4);
  }
  .quiz-reveal-fill {
    position: absolute; left: 0; top: 0; bottom: 0;
    transition: width 0.5s ease-out;
  }
  .quiz-reveal-count {
    position: relative; z-index: 1;
    margin-left: auto; padding-right: 0.5rem;
    font-size: 11px; font-weight: 700;
    color: rgb(63, 63, 70);
  }
  :global(.dark) .quiz-reveal-count { color: rgb(228, 228, 231); }
  .quiz-host-choice--correct {
    border-color: rgb(16, 185, 129);
  }
  .quiz-player-stage {
    position: fixed;
    inset: 0;
    z-index: 40;
    display: flex; flex-direction: column;
    gap: 0.4rem;
    padding: 0.6rem;
    background: rgb(250 250 250);
  }
  :global(.dark) .quiz-player-stage {
    background: rgb(9 9 11);
  }
  .quiz-player-fs-header {
    display: flex; align-items: center; justify-content: space-between;
    font-size: 13px;
    padding: 0.2rem 0.4rem;
  }
  .quiz-player-grid {
    flex: 1; min-height: 0;
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-template-rows: 1fr 1fr;
    gap: 0.5rem;
  }
  .quiz-player-btn {
    display: flex; align-items: center; justify-content: center;
    border-radius: 0.85rem;
    background: var(--c);
    color: white;
    transition: transform 0.1s ease-out;
    box-shadow: 0 6px 20px -8px var(--c);
    width: 100%; height: 100%;
    min-width: 0; min-height: 0;
    padding: 0;
  }
  .quiz-player-btn:active {
    transform: scale(0.97);
  }
  .quiz-player-btn svg {
    width: 38%;
    height: 38%;
    max-width: 96px; max-height: 96px;
  }
  .quiz-countdown-overlay {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    gap: 1rem;
    background: rgba(9, 9, 11, 0.92);
    backdrop-filter: blur(8px);
    color: white;
  }
  .quiz-countdown-num {
    font-family: 'fira-code', monospace;
    font-size: 220px;
    font-weight: 900;
    line-height: 1;
    color: rgb(16, 185, 129);
    text-shadow: 0 0 64px rgba(16, 185, 129, 0.5);
    animation: quiz-countdown-pop 1s ease-out;
  }
  .quiz-countdown-label {
    font-size: 14px;
    text-transform: uppercase;
    letter-spacing: 0.3em;
    color: rgba(255, 255, 255, 0.6);
  }
  @keyframes quiz-countdown-pop {
    0% { transform: scale(0.4); opacity: 0; }
    20% { transform: scale(1.1); opacity: 1; }
    100% { transform: scale(1); opacity: 1; }
  }
  @media (max-width: 480px) {
    .quiz-countdown-num { font-size: 160px; }
  }
  .quiz-answered-icon {
    width: 80px; height: 80px;
    margin: 0 auto;
    border-radius: 9999px;
    background: var(--c);
    color: white;
    display: flex; align-items: center; justify-content: center;
    box-shadow: 0 6px 24px -8px var(--c);
  }
  .quiz-leaderboard {
    display: flex; flex-direction: column; gap: 0.35rem;
  }
  .quiz-lb-row {
    display: grid;
    grid-template-columns: 28px 1fr auto;
    align-items: center; gap: 0.6rem;
    padding: 0.5rem 0.7rem;
    border-radius: 0.5rem;
    background: rgba(244, 244, 245, 0.5);
    font-size: 13px;
  }
  :global(.dark) .quiz-lb-row {
    background: rgba(39, 39, 42, 0.4);
  }
  .quiz-lb-row--me {
    background: rgba(16, 185, 129, 0.12);
    color: rgb(5, 150, 105);
    font-weight: 600;
  }
  :global(.dark) .quiz-lb-row--me {
    background: rgba(16, 185, 129, 0.18);
    color: rgb(52, 211, 153);
  }
  .quiz-lb-rank {
    font-weight: 700;
    color: rgb(113, 113, 122);
  }
  .quiz-lb-nick {
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .quiz-lb-score {
    font-family: 'fira-code', monospace;
    font-weight: 700;
  }
  .quiz-result-correct { background: rgba(16, 185, 129, 0.08); border-color: rgba(16, 185, 129, 0.3); }
  .quiz-result-correct .text-4xl { color: rgb(16, 185, 129); }
  .quiz-result-wrong { background: rgba(239, 68, 68, 0.06); border-color: rgba(239, 68, 68, 0.2); }
  .quiz-result-wrong .text-4xl { color: rgb(239, 68, 68); }
  .quiz-podium {
    display: grid; grid-template-columns: 1fr 1fr 1fr;
    gap: 0.5rem; align-items: end;
    margin: 1rem 0;
  }
  .quiz-podium-spot {
    display: flex; flex-direction: column; align-items: center; gap: 0.3rem;
    padding: 0.85rem 0.5rem;
    border-radius: 0.7rem;
    background: rgba(244, 244, 245, 0.6);
    border: 2px solid transparent;
    text-align: center;
  }
  :global(.dark) .quiz-podium-spot {
    background: rgba(39, 39, 42, 0.5);
  }
  .quiz-podium-spot--1 {
    order: 2;
    background: rgba(251, 191, 36, 0.15);
    border-color: rgba(251, 191, 36, 0.4);
    padding-bottom: 1.5rem;
    transform: translateY(-12px);
  }
  .quiz-podium-spot--2 { order: 1; }
  .quiz-podium-spot--3 { order: 3; }
  .quiz-podium-spot--me {
    box-shadow: 0 0 0 2px rgb(16, 185, 129);
  }
  .quiz-podium-medal {
    font-size: 28px;
  }
  .quiz-podium-nick {
    font-size: 13px; font-weight: 700;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    max-width: 100%;
  }
  .quiz-podium-score {
    font-family: 'fira-code', monospace; font-weight: 700;
    color: rgb(16, 185, 129);
  }
  .quiz-dot {
    width: 6px; height: 6px; border-radius: 9999px;
    background: rgb(16, 185, 129);
    animation: quiz-bounce 1.2s ease-in-out infinite;
    opacity: 0.4;
  }
  .quiz-dot--2 { animation-delay: 0.15s; }
  .quiz-dot--3 { animation-delay: 0.3s; }
  @keyframes quiz-bounce {
    0%, 80%, 100% { opacity: 0.4; transform: translateY(0); }
    40% { opacity: 1; transform: translateY(-3px); }
  }
</style>

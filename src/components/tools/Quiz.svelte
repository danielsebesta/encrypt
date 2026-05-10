<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import PartySocket from 'partysocket';
  import QRCode from 'qrcode';
  import { getTranslations, t } from '../../lib/i18n';

  export let locale = 'en';
  export let roomId = '';
  export let partyHost = 'encrypt-chat.danielsebesta.partykit.dev';

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

  let role: 'pending' | 'host' | 'player' = 'pending';
  let phase: Phase = 'lobby';
  let connected = false;
  let connecting = false;
  let serverError = '';
  let hostPaused = false;

  // Host state
  let hostQuiz: HostQuiz | null = null;

  // Player state
  let needsNick = false;
  let nickInput = '';
  let nickError = '';
  let playerNick = '';
  let playerToken = '';
  let myScore = 0;

  // Game state from server
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
  let answersThisQuestion = 0;

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

  function init() {
    if (typeof window === 'undefined') return;
    const quiz = loadHostQuiz();
    if (quiz) {
      role = 'host';
      hostQuiz = quiz;
      connectWs();
      return;
    }
    role = 'player';
    playerToken = loadPlayerToken();
    const savedNick = loadPlayerNick();
    if (savedNick) {
      playerNick = savedNick;
      nickInput = savedNick;
      connectWs();
    } else {
      needsNick = true;
    }
  }

  function submitNick() {
    nickError = '';
    const trimmed = nickInput.trim().slice(0, 24);
    if (!trimmed) {
      nickError = t(dict, 'quiz.errorNickRequired');
      return;
    }
    playerNick = trimmed;
    savePlayerNick(trimmed);
    needsNick = false;
    connectWs();
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
      sendIdentity();
    });
    ws.addEventListener('close', () => {
      connected = false;
    });
    ws.addEventListener('error', () => {
      connecting = false;
    });
    ws.addEventListener('message', handleMessage);
  }

  function sendIdentity() {
    if (!ws || ws.readyState !== 1) return;
    if (role === 'host' && hostQuiz) {
      ws.send(JSON.stringify({
        type: 'host-claim',
        token: hostQuiz.token,
        total: hostQuiz.questions.length,
      }));
    } else if (role === 'player' && playerNick) {
      ws.send(JSON.stringify({
        type: 'player-join',
        nick: playerNick,
        token: playerToken,
      }));
    }
  }

  function handleMessage(event: MessageEvent) {
    let data: any;
    try { data = JSON.parse(event.data); } catch { return; }
    if (!data || typeof data.type !== 'string') return;

    switch (data.type) {
      case 'hello':
        return;

      case 'presence':
        serverPresence = data.count || 0;
        return;

      case 'state':
        phase = data.phase;
        questionTotal = data.questionTotal || 0;
        currentIndex = data.currentIndex ?? -1;
        hostPaused = !data.hostAlive && phase !== 'lobby' && phase !== 'finished';
        if (data.question) {
          currentQuestion = data.question;
          startTimer();
        }
        if (data.reveal) {
          lastReveal = data.reveal;
        }
        if (Array.isArray(data.leaderboard)) {
          leaderboard = data.leaderboard;
        }
        if (Array.isArray(data.players)) {
          players = data.players;
          updateMyScore();
        }
        if (data.podium) {
          podium = data.podium;
        }
        return;

      case 'players':
        players = data.players || [];
        leaderboard = players;
        updateMyScore();
        return;

      case 'join-ok':
        playerNick = data.nick;
        myScore = data.score || 0;
        return;

      case 'question-content':
        if (role === 'player') {
          currentQuestion = {
            index: data.index,
            text: data.text,
            choices: data.choices,
            startedAt: currentQuestion?.startedAt || Date.now(),
            duration: currentQuestion?.duration || 20000,
          };
        }
        return;

      case 'question-start':
        currentIndex = data.index;
        questionTotal = data.total || questionTotal;
        myAnswer = null;
        myLastResult = null;
        answersThisQuestion = 0;
        if (role === 'host' && hostQuiz) {
          const q = hostQuiz.questions[data.index];
          if (q) {
            currentQuestion = {
              index: data.index,
              text: q.text,
              choices: q.choices,
              startedAt: data.startedAt,
              duration: data.duration,
            };
          }
        } else if (currentQuestion) {
          currentQuestion = { ...currentQuestion, startedAt: data.startedAt, duration: data.duration, index: data.index };
        }
        phase = 'question';
        startTimer();
        return;

      case 'all-answered':
        return;

      case 'answer-ack':
        myAnswer = data.choice;
        return;

      case 'reveal':
        phase = 'reveal';
        lastReveal = {
          index: data.index,
          correctIndex: data.correctIndex,
          perChoiceCounts: data.perChoiceCounts,
        };
        leaderboard = data.leaderboard || [];
        updateMyScore();
        stopTimer();
        return;

      case 'my-result':
        myLastResult = { correct: data.correct, gained: data.gained };
        myScore = data.score;
        return;

      case 'leaderboard':
        phase = 'leaderboard';
        leaderboard = data.leaderboard || [];
        updateMyScore();
        return;

      case 'final':
        phase = 'finished';
        podium = data.podium || [];
        leaderboard = data.podium || [];
        updateMyScore();
        stopTimer();
        playFinalChord();
        return;

      case 'host-paused':
        hostPaused = true;
        return;

      case 'host-resumed':
        hostPaused = false;
        return;

      case 'error':
        serverError = data.message || 'Error';
        if (data.code === 'NICK_TAKEN') {
          needsNick = true;
        } else if (data.code === 'ROOM_TAKEN') {
          serverError = t(dict, 'quiz.errorRoomTaken');
        }
        return;
    }
  }

  function updateMyScore() {
    if (role !== 'player' || !playerNick) return;
    const me = players.find(p => p.nick === playerNick) || leaderboard.find(p => p.nick === playerNick);
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

  function startGame() {
    if (!ws || !hostQuiz || phase !== 'lobby') return;
    startQuestionAt(0);
  }

  function startQuestionAt(index: number) {
    if (!ws || !hostQuiz) return;
    const q = hostQuiz.questions[index];
    if (!q) return;
    ensureAudio();
    ws.send(JSON.stringify({
      type: 'host-start-question',
      index,
      text: q.text,
      choices: q.choices,
      correctIndex: q.correctIndex,
      duration: q.duration * 1000,
    }));
  }

  function reveal() {
    if (!ws || phase !== 'question') return;
    ws.send(JSON.stringify({ type: 'host-reveal' }));
  }

  function endGame() {
    if (!ws) return;
    ws.send(JSON.stringify({ type: 'host-end' }));
  }

  function skipOrAdvance() {
    if (!ws) return;
    if (phase === 'question') {
      reveal();
    } else if (phase === 'reveal') {
      if (currentIndex + 1 < questionTotal) {
        startQuestionAt(currentIndex + 1);
      } else {
        endGame();
      }
    }
  }

  $: skipLabel =
    phase === 'question' ? t(dict, 'quiz.skip') :
    phase === 'reveal'
      ? (currentIndex + 1 < questionTotal ? t(dict, 'quiz.nextQuestion') : t(dict, 'quiz.showPodium'))
      : '';

  function submitAnswer(choice: 0 | 1 | 2 | 3) {
    if (!ws || phase !== 'question' || myAnswer !== null) return;
    ensureAudio();
    myAnswer = choice;
    ws.send(JSON.stringify({ type: 'player-answer', choice }));
  }

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
    }
    const localePrefix = locale === 'en' ? '' : `/${locale}`;
    window.location.href = `${localePrefix}/quiz`;
  }

  $: timeLeftCeil = Math.ceil(timeLeft);
  $: timePercent = currentQuestion ? Math.max(0, Math.min(100, (timeLeft * 1000 / currentQuestion.duration) * 100)) : 0;
  $: revealCounts = lastReveal?.perChoiceCounts || [0, 0, 0, 0];
  $: revealMax = Math.max(1, ...revealCounts);
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

      {:else if phase === 'question' || phase === 'reveal'}
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
          {:else}
            <div class="quiz-card text-center py-3">
              <p class="text-xs text-zinc-400 uppercase tracking-widest mb-1">{t(dict, 'quiz.correctAnswer')}</p>
              {#if lastReveal && currentQuestion}
                <div class="quiz-correct-pill" style="--c: {COLORS[lastReveal.correctIndex].bg}; --cd: {COLORS[lastReveal.correctIndex].dim}">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">{@html ICONS[lastReveal.correctIndex]}</svg>
                  <span>{currentQuestion.choices[lastReveal.correctIndex]}</span>
                </div>
              {/if}
            </div>

            <div class="quiz-card">
              <h3 class="text-xs font-semibold uppercase tracking-widest text-zinc-400 mb-2">{t(dict, 'quiz.leaderboard')}</h3>
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
            <div class="quiz-card text-center space-y-2 py-6" class:quiz-result-correct={myLastResult.correct} class:quiz-result-wrong={!myLastResult.correct}>
              <div class="text-4xl mb-1">{myLastResult.correct ? '✓' : '✗'}</div>
              <p class="text-lg font-semibold">
                {myLastResult.correct ? t(dict, 'quiz.correct') : t(dict, 'quiz.wrong')}
              </p>
              {#if myLastResult.gained > 0}
                <p class="text-sm text-emerald-500">+{myLastResult.gained}</p>
              {/if}
              <p class="text-xs text-zinc-400">{t(dict, 'quiz.totalScore')}: <span class="font-semibold text-zinc-700 dark:text-zinc-300">{myScore}</span></p>
            </div>
          {/if}

          <div class="quiz-card">
            <h3 class="text-xs font-semibold uppercase tracking-widest text-zinc-400 mb-2">{t(dict, 'quiz.leaderboard')}</h3>
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
    gap: 0.4rem;
  }
  .quiz-host-choice--reveal > svg { align-self: center; }
  .quiz-host-choice--reveal > span:first-of-type { font-size: 12px; }
  .quiz-host-choice--reveal.quiz-host-choice--correct {
    border-color: rgb(16, 185, 129);
    box-shadow: 0 0 16px rgba(16, 185, 129, 0.35);
  }
  .quiz-host-choice--reveal.quiz-host-choice--wrong {
    opacity: 0.45;
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

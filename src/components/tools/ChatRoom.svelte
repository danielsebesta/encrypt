<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import PartySocket from 'partysocket';
  import {
    deriveKeyFromPassword,
    encryptMessage, decryptMessage, generateIdentity
  } from '../../lib/chatCrypto';
  import { getTranslations, t } from '../../lib/i18n';

  export let locale = 'en';
  export let roomId = '';
  export let partyHost = 'encrypt-chat.danielsebesta.partykit.dev';

  $: dict = getTranslations(locale);

  type Message = {
    id: string;
    text: string;
    sender: string;
    color: string;
    mine: boolean;
    time: number;
    ttl: number;
    remaining: number;
    replyTo?: { sender: string; text: string };
  };

  let ws: PartySocket | null = null;
  let cryptoKey: CryptoKey | null = null;
  let identity = generateIdentity();
  let messages: Message[] = [];
  let inputText = '';
  let presence = 0;
  let roomLocked = false;
  let connected = false;
  let needsPassword = false;
  let passwordInput = '';
  let passwordError = '';
  let typing: { name: string; color: string } | null = null;
  let typingTimeout: ReturnType<typeof setTimeout>;
  let blurred = false;
  let ttlSeconds = 60;
  let replyingTo: Message | null = null;
  let tickInterval: ReturnType<typeof setInterval>;
  let messagesEl: HTMLElement;

  function scrollToBottom() {
    requestAnimationFrame(() => {
      if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
    });
  }

  const TTL_OPTIONS = [
    { label: '30s', value: 30 },
    { label: '1m', value: 60 },
    { label: '5m', value: 300 },
    { label: '15m', value: 900 },
  ];

  function genId(): string {
    const arr = crypto.getRandomValues(new Uint8Array(8));
    return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
  }

  function init() {
    needsPassword = true;
  }

  async function submitPassword() {
    passwordError = '';
    if (!passwordInput.trim()) { passwordError = t(dict, 'chat.errorEnterPassword'); return; }
    try {
      cryptoKey = await deriveKeyFromPassword(passwordInput, roomId);
      needsPassword = false;
      connectWs();
    } catch {
      passwordError = t(dict, 'chat.errorDeriveKey');
    }
  }

  function connectWs() {
    ws = new PartySocket({
      host: partyHost,
      room: roomId,
    });

    ws.addEventListener('open', () => { connected = true; });
    ws.addEventListener('close', () => { connected = false; });
    ws.addEventListener('message', handleServerMessage);
  }

  async function handleServerMessage(event: MessageEvent) {
    let data: any;
    try { data = JSON.parse(event.data); } catch { return; }

    switch (data.type) {
      case 'init':
        presence = data.presence;
        roomLocked = data.locked;
        break;

      case 'presence':
        presence = data.count;
        break;

      case 'locked':
        roomLocked = true;
        break;

      case 'unlocked':
        roomLocked = false;
        break;

      case 'typing':
        typing = { name: data.name, color: data.color };
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => { typing = null; }, 3000);
        break;

      case 'message':
        if (!cryptoKey) break;
        try {
          const plaintext = await decryptMessage(cryptoKey, data.payload);
          const parsed = JSON.parse(plaintext);
          const msg: Message = {
            id: data.id || genId(),
            text: parsed.text,
            sender: parsed.sender,
            color: parsed.color,
            mine: false,
            time: Date.now(),
            ttl: parsed.ttl || 60,
            remaining: parsed.ttl || 60,
            replyTo: parsed.replyTo,
          };
          messages = [...messages, msg];
          typing = null;
          scrollToBottom();

          // Notification if blurred
          if (blurred) {
            document.title = `(!) encrypt.click/chat`;
          }
        } catch {
          // Wrong password — can't decrypt
        }
        break;

      case 'error':
        passwordError = data.message;
        break;
    }
  }

  async function sendMessage() {
    if (!inputText.trim() || !cryptoKey || !ws) return;

    const payload = {
      text: inputText.trim(),
      sender: identity.name,
      color: identity.color,
      ttl: ttlSeconds,
      replyTo: replyingTo ? { sender: replyingTo.sender, text: replyingTo.text.slice(0, 100) } : undefined,
    };

    const encrypted = await encryptMessage(cryptoKey, JSON.stringify(payload));
    const msgId = genId();

    ws.send(JSON.stringify({ type: 'message', payload: encrypted, id: msgId }));

    // Add to local messages
    messages = [...messages, {
      id: msgId,
      text: inputText.trim(),
      sender: identity.name,
      color: identity.color,
      mine: true,
      time: Date.now(),
      ttl: ttlSeconds,
      remaining: ttlSeconds,
      replyTo: replyingTo ? { sender: replyingTo.sender, text: replyingTo.text.slice(0, 100) } : undefined,
    }];

    inputText = '';
    replyingTo = null;
    scrollToBottom();
  }

  let typingSent = 0;
  function handleTyping() {
    if (!ws || !connected) return;
    const now = Date.now();
    if (now - typingSent > 2000) {
      ws.send(JSON.stringify({ type: 'typing', name: identity.name, color: identity.color }));
      typingSent = now;
    }
  }

  function lockRoom() {
    ws?.send(JSON.stringify({ type: 'lock' }));
  }

  function unlockRoom() {
    ws?.send(JSON.stringify({ type: 'unlock' }));
  }

  function handleVisibility() {
    if (typeof document === 'undefined') return;
    blurred = document.hidden;
    if (!blurred) {
      document.title = 'encrypt.click/chat';
    }
  }

  // TTL countdown tick
  function tick() {
    const now = Date.now();
    let changed = false;
    const alive: Message[] = [];
    for (const msg of messages) {
      const elapsed = (now - msg.time) / 1000;
      const rem = Math.max(0, msg.ttl - elapsed);
      if (rem <= 0) { changed = true; continue; }
      if (rem !== msg.remaining) { msg.remaining = rem; changed = true; }
      alive.push(msg);
    }
    if (changed) messages = alive;
  }

  onMount(() => {
    init();
    tickInterval = setInterval(tick, 200);
    document.addEventListener('visibilitychange', handleVisibility);
  });

  onDestroy(() => {
    ws?.close();
    clearInterval(tickInterval);
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', handleVisibility);
    }
  });
</script>

<div class="chat-container">
  {#if needsPassword}
    <!-- Password prompt -->
    <div class="chat-center">
      <div class="space-y-4 max-w-xs w-full">
        <div class="text-center space-y-2">
          <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="mx-auto text-emerald-500"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          <p class="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t(dict, 'chat.roomRequiresPassword')}</p>
        </div>
        <input
          type="password"
          class="input w-full"
          placeholder={t(dict, 'chat.roomPasswordPlaceholder')}
          bind:value={passwordInput}
          on:keydown={(e) => e.key === 'Enter' && submitPassword()}
        />
        {#if passwordError}
          <p class="text-xs text-red-500">{passwordError}</p>
        {/if}
        <button class="btn w-full" on:click={submitPassword}>{t(dict, 'chat.enterRoom')}</button>
      </div>
    </div>

  {:else}
    <!-- Chat UI -->
    <div class="chat-header">
      <div class="flex items-center gap-2">
        <span class="chat-status" class:chat-status--connected={connected}></span>
        <span class="text-xs text-zinc-500 dark:text-zinc-400">
          {connected ? `${presence} ${t(dict, 'chat.online')}` : t(dict, 'chat.connecting')}
        </span>
      </div>
      <div class="flex items-center gap-2">
        <select class="text-[10px] bg-transparent text-zinc-400 border-none outline-none" bind:value={ttlSeconds}>
          {#each TTL_OPTIONS as opt}
            <option value={opt.value}>{opt.label}</option>
          {/each}
        </select>
        {#if connected}
          <button
            class="text-[10px] font-bold px-2 py-1 rounded {roomLocked ? 'text-amber-500' : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'}"
            on:click={() => roomLocked ? unlockRoom() : lockRoom()}
          >
            {roomLocked ? `🔒 ${t(dict, 'chat.locked')}` : `🔓 ${t(dict, 'chat.lock')}`}
          </button>
        {/if}
      </div>
    </div>

    <!-- Messages -->
    <div class="chat-messages" class:chat-messages--blurred={blurred} bind:this={messagesEl}>
      {#if messages.length === 0}
        <div class="chat-center">
          <p class="text-xs text-zinc-400 dark:text-zinc-500 text-center">
            {t(dict, 'chat.emptyRoomNotice')}<br />
            {t(dict, 'chat.emptyRoomNotice2')}
          </p>
        </div>
      {/if}

      {#each messages as msg (msg.id)}
        <div class="chat-bubble" class:chat-bubble--mine={msg.mine} style="--sender-color: {msg.color}">
          {#if msg.replyTo}
            <div class="chat-reply">
              <span class="font-medium">{msg.replyTo.sender}:</span> {msg.replyTo.text}
            </div>
          {/if}
          {#if !msg.mine}
            <span class="chat-sender" style="color: {msg.color}">{msg.sender}</span>
          {/if}
          <p class="chat-text">{msg.text}</p>
          <div class="chat-meta">
            <span class="chat-ttl-bar" style="width: {(msg.remaining / msg.ttl) * 100}%"></span>
            <span class="text-[9px] text-zinc-400">{Math.ceil(msg.remaining)}s</span>
            <button class="chat-reply-btn" on:click={() => { replyingTo = msg; }}>↩</button>
          </div>
        </div>
      {/each}

      {#if typing}
        <div class="chat-typing">
          <span style="color: {typing.color}">{typing.name}</span> {t(dict, 'chat.isTyping')}
        </div>
      {/if}
    </div>

    <!-- Reply bar -->
    {#if replyingTo}
      <div class="chat-reply-bar">
        <span class="text-[10px] text-zinc-500 truncate flex-1">
          {t(dict, 'chat.replyingTo')} <strong>{replyingTo.sender}</strong>: {replyingTo.text.slice(0, 50)}
        </span>
        <button class="text-[10px] text-red-500 font-bold" on:click={() => { replyingTo = null; }}>✕</button>
      </div>
    {/if}

    <!-- Input -->
    <div class="chat-input">
      <input
        type="text"
        class="chat-input-field"
        placeholder={t(dict, 'chat.messagePlaceholder')}
        bind:value={inputText}
        on:input={handleTyping}
        on:keydown={(e) => e.key === 'Enter' && sendMessage()}
        disabled={!connected}
      />
      <button class="chat-send-btn" on:click={sendMessage} disabled={!connected || !inputText.trim()}>
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
      </button>
    </div>
  {/if}
</div>

<style>
  .chat-container {
    display: flex;
    flex-direction: column;
    height: 70vh;
    max-height: 600px;
    border-radius: 1rem;
    overflow: hidden;
    border: 1px solid rgba(228, 228, 231, 0.6);
    background: rgba(255, 255, 255, 0.6);
    backdrop-filter: blur(12px);
  }

  :global(.dark) .chat-container {
    border-color: rgba(39, 39, 42, 0.5);
    background: rgba(9, 9, 11, 0.6);
  }

  .chat-center {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2rem;
  }

  .chat-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.6rem 1rem;
    border-bottom: 1px solid rgba(228, 228, 231, 0.5);
  }

  :global(.dark) .chat-header {
    border-color: rgba(39, 39, 42, 0.4);
  }

  .chat-status {
    width: 6px;
    height: 6px;
    border-radius: 9999px;
    background: rgb(161, 161, 170);
  }

  .chat-status--connected {
    background: rgb(16, 185, 129);
    box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.2);
  }

  .chat-messages {
    flex: 1;
    overflow-y: auto;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    transition: filter 0.3s;
  }

  .chat-messages--blurred {
    filter: blur(8px);
  }

  .chat-bubble {
    max-width: 80%;
    padding: 0.5rem 0.75rem;
    border-radius: 0.75rem;
    background: rgba(244, 244, 245, 0.8);
    align-self: flex-start;
    position: relative;
  }

  :global(.dark) .chat-bubble {
    background: rgba(39, 39, 42, 0.5);
  }

  .chat-bubble--mine {
    align-self: flex-end;
    background: rgba(16, 185, 129, 0.12);
  }

  :global(.dark) .chat-bubble--mine {
    background: rgba(16, 185, 129, 0.15);
  }

  .chat-sender {
    font-size: 10px;
    font-weight: 700;
    display: block;
    margin-bottom: 2px;
  }

  .chat-text {
    font-size: 13px;
    line-height: 1.5;
    color: rgb(63, 63, 70);
    word-break: break-word;
  }

  :global(.dark) .chat-text {
    color: rgb(212, 212, 216);
  }

  .chat-meta {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-top: 0.25rem;
    position: relative;
  }

  .chat-ttl-bar {
    position: absolute;
    bottom: -4px;
    left: 0;
    height: 2px;
    border-radius: 1px;
    background: rgba(16, 185, 129, 0.4);
    transition: width 0.2s linear;
  }

  .chat-reply-btn {
    font-size: 10px;
    color: rgb(161, 161, 170);
    margin-left: auto;
  }

  .chat-reply-btn:hover {
    color: rgb(16, 185, 129);
  }

  .chat-reply {
    font-size: 10px;
    color: rgb(113, 113, 122);
    padding: 0.25rem 0.5rem;
    margin-bottom: 0.25rem;
    border-left: 2px solid rgba(16, 185, 129, 0.4);
    border-radius: 2px;
  }

  .chat-typing {
    font-size: 11px;
    color: rgb(161, 161, 170);
    padding: 0.25rem 0;
  }

  .chat-reply-bar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 1rem;
    border-top: 1px solid rgba(228, 228, 231, 0.4);
    background: rgba(244, 244, 245, 0.5);
  }

  :global(.dark) .chat-reply-bar {
    border-color: rgba(39, 39, 42, 0.3);
    background: rgba(24, 24, 27, 0.5);
  }

  .chat-input {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.6rem 0.75rem;
    border-top: 1px solid rgba(228, 228, 231, 0.5);
  }

  :global(.dark) .chat-input {
    border-color: rgba(39, 39, 42, 0.4);
  }

  .chat-input-field {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    font-size: 13px;
    color: rgb(24, 24, 27);
    padding: 0.4rem 0;
  }

  :global(.dark) .chat-input-field {
    color: rgb(228, 228, 231);
  }

  .chat-input-field::placeholder {
    color: rgb(161, 161, 170);
  }

  .chat-send-btn {
    padding: 0.4rem;
    border-radius: 0.5rem;
    color: rgb(16, 185, 129);
    transition: background 0.15s;
  }

  .chat-send-btn:hover:not(:disabled) {
    background: rgba(16, 185, 129, 0.1);
  }

  .chat-send-btn:disabled {
    opacity: 0.3;
  }
</style>

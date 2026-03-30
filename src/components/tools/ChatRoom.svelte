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
    initials: string;
    color: string;
    mine: boolean;
    time: number;
    ttl: number;
    remaining: number;
  };

  let ws: PartySocket | null = null;
  let cryptoKey: CryptoKey | null = null;
  let identity = generateIdentity(locale);
  let messages: Message[] = [];
  let inputText = '';
  let connected = false;
  let verified = false;
  let verifying = false;
  let wrongPassword = false;
  let needsPassword = false;
  let passwordInput = '';
  let passwordError = '';
  let typing: { sender: string; initials: string; color: string } | null = null;
  let typingTimeout: ReturnType<typeof setTimeout>;
  let blurred = false;
  let ttlSeconds = 60;
  let decryptFailCount = 0;
  let tickInterval: ReturnType<typeof setInterval>;
  let messagesEl: HTMLElement;

  $: myInitials = getInitials(identity.name);

  function getInitials(name: string): string {
    return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  }

  function esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function parseMarkdown(text: string): string {
    let html = esc(text);
    // Code blocks: ```lang\ncode\n``` → <pre><code>
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) =>
      `<pre class="chat-code-block"><code>${code.trim()}</code></pre>`);
    // Inline code: `code`
    html = html.replace(/`([^`]+)`/g, '<code class="chat-code-inline">$1</code>');
    // Bold italic: ***text*** or ___text___
    html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    html = html.replace(/___(.+?)___/g, '<strong><em>$1</em></strong>');
    // Bold: **text** or __text__
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
    // Italic: *text* or _text_
    html = html.replace(/(?<!\w)\*(.+?)\*(?!\w)/g, '<em>$1</em>');
    html = html.replace(/(?<!\w)_(.+?)_(?!\w)/g, '<em>$1</em>');
    // Strikethrough: ~~text~~
    html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');
    // Spoiler: ||text|| → click to reveal
    html = html.replace(/\|\|(.+?)\|\|/g, '<span class="chat-spoiler" onclick="this.classList.toggle(\'revealed\')">$1</span>');
    // Blockquote: > text (at line start)
    html = html.replace(/(^|\n)&gt; (.+)/g, '$1<blockquote class="chat-quote">$2</blockquote>');
    // Newlines
    html = html.replace(/\n/g, '<br>');
    return html;
  }

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

  async function initChat() {
    if (typeof window === 'undefined') return;
    // Check sessionStorage for password from ChatCreate
    const stored = sessionStorage.getItem('chat-password');
    if (stored) {
      sessionStorage.removeItem('chat-password');
      passwordInput = stored;
      await enterWithPassword(stored);
    } else {
      needsPassword = true;
    }
  }

  async function submitPassword() {
    passwordError = '';
    if (!passwordInput.trim()) { passwordError = t(dict, 'chat.errorEnterPassword'); return; }
    await enterWithPassword(passwordInput.trim());
  }

  async function enterWithPassword(pwd: string) {
    try {
      cryptoKey = await deriveKeyFromPassword(pwd, roomId);
      needsPassword = false;
      connectWs();
    } catch {
      passwordError = t(dict, 'chat.errorDeriveKey');
      needsPassword = true;
    }
  }

  function connectWs() {
    verifying = true;
    wrongPassword = false;
    ws = new PartySocket({ host: partyHost, room: roomId });
    ws.addEventListener('open', async () => {
      connected = true;
      if (cryptoKey) {
        const verifyPayload = await encryptMessage(cryptoKey, JSON.stringify({ type: 'verify', sender: identity.name, color: identity.color }));
        ws!.send(JSON.stringify({ type: 'message', payload: verifyPayload, id: 'verify-' + genId() }));
        // If alone in room, auto-verify (no one to respond)
        setTimeout(() => { if (verifying && !verified) { verified = true; verifying = false; } }, 2000);
      }
    });
    ws.addEventListener('close', () => { connected = false; });
    ws.addEventListener('message', handleServerMessage);
  }

  async function handleServerMessage(event: MessageEvent) {
    let data: any;
    try { data = JSON.parse(event.data); } catch { return; }

    if (data.type !== 'message') return;
    if (!cryptoKey) return;

    try {
      const plaintext = await decryptMessage(cryptoKey, data.payload);
      const parsed = JSON.parse(plaintext);

      // Typing indicator
      if (parsed.type === 'typing') {
        typing = { sender: parsed.sender, initials: getInitials(parsed.sender), color: parsed.color };
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => { typing = null; }, 3000);
        return;
      }

      // Verify message — someone joined with correct password
      if (parsed.type === 'verify') {
        if (verifying) { verified = true; verifying = false; }
        // Show system message that someone joined
        messages = [...messages, {
          id: genId(), text: `${parsed.sender} joined`, sender: '', initials: '→',
          color: 'rgb(16,185,129)', mine: false, time: Date.now(), ttl: 15, remaining: 15,
        }];
        scrollToBottom();
        return;
      }

      if (!verified) { verified = true; verifying = false; }

      const msg: Message = {
        id: data.id || genId(),
        text: parsed.text,
        sender: parsed.sender,
        initials: getInitials(parsed.sender),
        color: parsed.color,
        mine: false,
        time: Date.now(),
        ttl: parsed.ttl || 60,
        remaining: parsed.ttl || 60,
      };
      messages = [...messages, msg];
      typing = null;
      scrollToBottom();

      if (blurred) document.title = `(!) encrypt.click/chat`;
    } catch {
      // Failed to decrypt — if we're still verifying, it's wrong password
      if (verifying) {
        wrongPassword = true;
        verifying = false;
        ws?.close();
      }
      // If already verified, someone with wrong password tried to join — show notice
      if (verified) {
        messages = [...messages, {
          id: genId(), text: t(dict, 'chat.someoneTriedJoin'), sender: '', initials: '!',
          color: 'rgb(239,68,68)', mine: false, time: Date.now(), ttl: 10, remaining: 10,
        }];
        scrollToBottom();
      }
    }
  }

  async function sendMessage() {
    if (!inputText.trim() || !cryptoKey || !ws) return;

    const payload = {
      text: inputText.trim(),
      sender: identity.name,
      color: identity.color,
      ttl: ttlSeconds,
    };

    const encrypted = await encryptMessage(cryptoKey, JSON.stringify(payload));
    const msgId = genId();
    ws.send(JSON.stringify({ type: 'message', payload: encrypted, id: msgId }));

    messages = [...messages, {
      id: msgId,
      text: inputText.trim(),
      sender: identity.name,
      initials: myInitials,
      color: identity.color,
      mine: true,
      time: Date.now(),
      ttl: ttlSeconds,
      remaining: ttlSeconds,
    }];

    inputText = '';
    scrollToBottom();
  }

  let typingSent = 0;
  async function handleTyping() {
    if (!ws || !connected || !cryptoKey) return;
    const now = Date.now();
    if (now - typingSent > 2000) {
      // Send typing indicator as encrypted message (no leaking to wrong-password users)
      const payload = await encryptMessage(cryptoKey, JSON.stringify({ type: 'typing', sender: identity.name, color: identity.color }));
      ws.send(JSON.stringify({ type: 'message', payload, id: 'typing-' + genId() }));
      typingSent = now;
    }
  }

  function handleVisibility() {
    if (typeof document === 'undefined') return;
    blurred = document.hidden;
    if (!blurred) document.title = 'encrypt.click/chat';
  }

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
    initChat();
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
  {#if wrongPassword}
    <div class="chat-center">
      <div class="space-y-4 max-w-xs w-full text-center">
        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="mx-auto text-red-500"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <p class="text-sm font-medium text-red-500">{t(dict, 'chat.wrongPassword')}</p>
        <button class="btn-outline w-full text-xs" on:click={() => { wrongPassword = false; needsPassword = true; passwordInput = ''; }}>{t(dict, 'chat.tryAgain')}</button>
      </div>
    </div>

  {:else if needsPassword}
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

  {:else if verifying}
    <div class="chat-center">
      <div class="text-center space-y-2">
        <svg class="animate-spin mx-auto h-6 w-6 text-emerald-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
        <p class="text-xs text-zinc-400">{t(dict, 'chat.connecting')}</p>
      </div>
    </div>

  {:else}
    <div class="chat-header">
      <div class="flex items-center gap-2">
        <span class="chat-status" class:chat-status--connected={connected}></span>
        <span class="text-xs text-zinc-500 dark:text-zinc-400">
          {connected ? t(dict, 'chat.connected') : t(dict, 'chat.connecting')}
        </span>
      </div>
      <div class="flex items-center gap-2">
        <select class="text-[10px] bg-transparent text-zinc-400 border-none outline-none" bind:value={ttlSeconds}>
          {#each TTL_OPTIONS as opt}
            <option value={opt.value}>{opt.label}</option>
          {/each}
        </select>
      </div>
    </div>

    <div class="chat-messages" class:chat-messages--blurred={blurred} bind:this={messagesEl}>
      {#if messages.length === 0}
        <div class="chat-center">
          <p class="text-xs text-zinc-400 dark:text-zinc-500 text-center">
            {t(dict, 'chat.emptyRoom')}<br />
            {t(dict, 'chat.noHistory')}
          </p>
        </div>
      {/if}

      {#each messages as msg (msg.id)}
        <div class="chat-bubble" class:chat-bubble--mine={msg.mine}>
          <div class="flex items-start gap-2">
            {#if !msg.mine}
              <div class="chat-avatar" style="background: {msg.color}">{msg.initials}</div>
            {/if}
            <div class="flex-1 min-w-0">
              <span class="chat-sender" style="color: {msg.mine ? 'rgb(16,185,129)' : msg.color}">{msg.sender}</span>
              <p class="chat-text">{@html parseMarkdown(msg.text)}</p>
            </div>
            <div class="chat-timer" title="{Math.ceil(msg.remaining)}s">
              <svg class="chat-timer__ring" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2" opacity="0.1" />
                <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"
                  stroke-dasharray="62.83"
                  stroke-dashoffset={62.83 * (1 - msg.remaining / msg.ttl)}
                  stroke-linecap="round"
                  transform="rotate(-90 12 12)" />
              </svg>
              <span class="chat-timer__num">{Math.ceil(msg.remaining)}</span>
            </div>
          </div>
        </div>
      {/each}

      {#if typing}
        <div class="chat-typing">
          <div class="chat-avatar chat-avatar--sm" style="background: {typing.color}">{typing.initials}</div>
          <span style="color: {typing.color}">{typing.sender}</span> {t(dict, 'chat.isTyping')}
        </div>
      {/if}

    </div>

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
  :global(.dark) .chat-header { border-color: rgba(39, 39, 42, 0.4); }
  .chat-status {
    width: 6px; height: 6px; border-radius: 9999px;
    background: rgb(161, 161, 170);
  }
  .chat-status--connected {
    background: rgb(16, 185, 129);
    box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.2);
  }
  .chat-messages {
    flex: 1; overflow-y: auto; padding: 1rem;
    display: flex; flex-direction: column; gap: 0.5rem;
    transition: filter 0.3s;
  }
  .chat-messages--blurred { filter: blur(8px); }
  .chat-avatar {
    width: 28px; height: 28px; border-radius: 8px;
    display: flex; align-items: center; justify-content: center;
    font-size: 10px; font-weight: 800; color: white;
    flex-shrink: 0; letter-spacing: 0.02em;
    box-shadow: 0 2px 8px rgba(0,0,0,0.12);
  }
  .chat-avatar--sm {
    width: 18px; height: 18px; border-radius: 5px; font-size: 7px;
  }
  .chat-bubble {
    max-width: 85%; padding: 0.4rem 0.6rem; border-radius: 0.75rem;
    background: rgba(244, 244, 245, 0.8); align-self: flex-start;
  }
  :global(.dark) .chat-bubble { background: rgba(39, 39, 42, 0.5); }
  .chat-bubble--mine {
    align-self: flex-end;
    background: rgba(16, 185, 129, 0.12);
  }
  :global(.dark) .chat-bubble--mine { background: rgba(16, 185, 129, 0.15); }
  .chat-sender { font-size: 10px; font-weight: 700; display: block; margin-bottom: 1px; }
  .chat-text {
    font-size: 13px; line-height: 1.4; color: rgb(63, 63, 70); word-break: break-word;
  }
  :global(.dark) .chat-text { color: rgb(212, 212, 216); }
  .chat-timer {
    position: relative; width: 28px; height: 28px; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
  }
  .chat-timer__ring {
    position: absolute; inset: 0; width: 100%; height: 100%;
    color: rgb(16, 185, 129);
  }
  .chat-timer__num {
    font-size: 8px; font-weight: 700; color: rgb(161, 161, 170);
    position: relative; z-index: 1;
  }
  .chat-text :global(strong) { font-weight: 700; }
  .chat-text :global(em) { font-style: italic; }
  .chat-text :global(del) { text-decoration: line-through; opacity: 0.6; }
  .chat-text :global(.chat-code-inline) {
    font-family: 'fira-code', monospace; font-size: 11px;
    background: rgba(16, 185, 129, 0.08); border-radius: 3px;
    padding: 1px 4px;
  }
  :global(.dark) .chat-text :global(.chat-code-inline) {
    background: rgba(16, 185, 129, 0.12);
  }
  .chat-text :global(.chat-code-block) {
    font-family: 'fira-code', monospace; font-size: 11px;
    background: rgba(0, 0, 0, 0.04); border-radius: 6px;
    padding: 6px 8px; margin: 4px 0; overflow-x: auto;
    white-space: pre-wrap; word-break: break-all;
  }
  :global(.dark) .chat-text :global(.chat-code-block) {
    background: rgba(255, 255, 255, 0.05);
  }
  .chat-text :global(.chat-spoiler) {
    background: rgb(63, 63, 70); color: transparent; border-radius: 3px;
    padding: 0 3px; cursor: pointer; transition: all 0.2s;
  }
  .chat-text :global(.chat-spoiler.revealed) {
    background: rgba(16, 185, 129, 0.1); color: inherit;
  }
  .chat-text :global(.chat-quote) {
    border-left: 3px solid rgba(16, 185, 129, 0.4);
    padding-left: 8px; margin: 2px 0;
    color: rgb(113, 113, 122);
  }
  .chat-typing {
    font-size: 11px; color: rgb(161, 161, 170); padding: 0.25rem 0;
    display: flex; align-items: center; gap: 0.4rem;
  }
  .chat-wrong-password {
    display: flex; align-items: center; gap: 0.4rem;
    font-size: 11px; color: rgb(239, 68, 68);
    padding: 0.5rem 0.75rem; margin-top: 0.25rem;
    border-radius: 0.5rem;
    background: rgba(239, 68, 68, 0.08);
  }
  .chat-input {
    display: flex; align-items: center; gap: 0.5rem;
    padding: 0.6rem 0.75rem;
    border-top: 1px solid rgba(228, 228, 231, 0.5);
  }
  :global(.dark) .chat-input { border-color: rgba(39, 39, 42, 0.4); }
  .chat-input-field {
    flex: 1; background: transparent; border: none; outline: none;
    font-size: 13px; color: rgb(24, 24, 27); padding: 0.4rem 0;
  }
  :global(.dark) .chat-input-field { color: rgb(228, 228, 231); }
  .chat-input-field::placeholder { color: rgb(161, 161, 170); }
  .chat-send-btn {
    padding: 0.4rem; border-radius: 0.5rem;
    color: rgb(16, 185, 129); transition: background 0.15s;
  }
  .chat-send-btn:hover:not(:disabled) { background: rgba(16, 185, 129, 0.1); }
  .chat-send-btn:disabled { opacity: 0.3; }
</style>

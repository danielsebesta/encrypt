<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import PartySocket from 'partysocket';
  import * as Y from 'yjs';
  import { Editor } from '@tiptap/core';
  import StarterKit from '@tiptap/starter-kit';
  import Collaboration from '@tiptap/extension-collaboration';
  import {
    deriveKeyFromPassword, encryptMessage, decryptMessage,
    encryptBytes, decryptBytes,
    generateIdentity, nameToGradient,
  } from '../../lib/deckCrypto';
  import { getTranslations, t } from '../../lib/i18n';

  export let locale = 'en';
  export let roomId = '';
  export let partyHost = 'encrypt-chat.danielsebesta.partykit.dev';

  $: dict = getTranslations(locale);

  const HEARTBEAT_INTERVAL_MS = 45000;

  let ws: PartySocket | null = null;
  let cryptoKey: CryptoKey | null = null;
  let identity = generateIdentity(locale);
  let myInitials = getInitials(identity.name);

  let connected = false;
  let verified = false;
  let verifying = false;
  let wrongPassword = false;
  let needsPassword = false;
  let passwordInput = '';
  let passwordError = '';
  let serverPresence = 0;
  let onlineUsers: { id: string; name: string; initials: string; color: string }[] = [];

  let sharePassword = '';
  let shareCopiedLink = false;
  let shareCopiedPass = false;
  let shareDismissed = false;

  let ydoc: Y.Doc;
  let yslides: Y.Array<string>;
  let editor: Editor | null = null;
  let editorEl: HTMLDivElement;
  let pageHidden = false;
  let heartbeatInterval: ReturnType<typeof setInterval> | undefined;
  let presentMode = false;

  let pendingUpdates: Uint8Array[] = [];
  let updateFlushTimer: ReturnType<typeof setTimeout> | null = null;
  const UPDATE_BATCH_MS = 200;

  // local reactive view of slide ids (mirrors yslides)
  let slideIds: string[] = [];
  let activeSlideIndex = 0;
  let slideVersion = 0;

  function getInitials(name: string): string {
    return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  }
  function genId(): string {
    const arr = crypto.getRandomValues(new Uint8Array(8));
    return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
  }

  async function initRoom() {
    if (typeof window === 'undefined') return;
    const stored = sessionStorage.getItem('deck-password');
    const sharePass = sessionStorage.getItem('deck-share-password');
    if (sharePass) {
      sharePassword = sharePass;
      sessionStorage.removeItem('deck-share-password');
    }
    if (stored) {
      sessionStorage.removeItem('deck-password');
      passwordInput = stored;
      await enterWithPassword(stored);
    } else {
      needsPassword = true;
    }
  }

  async function submitPassword() {
    passwordError = '';
    if (!passwordInput.trim()) { passwordError = t(dict, 'deck.errorEnterPassword'); return; }
    await enterWithPassword(passwordInput.trim());
  }

  async function enterWithPassword(pwd: string) {
    try {
      cryptoKey = await deriveKeyFromPassword(pwd, roomId);
      needsPassword = false;
      setupYjs();
      connectWs();
    } catch {
      passwordError = t(dict, 'deck.errorDeriveKey');
      needsPassword = true;
    }
  }

  function flushPendingUpdates() {
    updateFlushTimer = null;
    if (pendingUpdates.length === 0 || !cryptoKey || !ws || !verified) {
      pendingUpdates = [];
      return;
    }
    const merged = pendingUpdates.length === 1 ? pendingUpdates[0] : Y.mergeUpdates(pendingUpdates);
    pendingUpdates = [];
    sendDocUpdate(merged);
  }

  function setupYjs() {
    ydoc = new Y.Doc();
    yslides = ydoc.getArray('slides');
    ydoc.on('update', (update: Uint8Array, origin: any) => {
      if (origin === 'remote') return;
      if (!cryptoKey || !ws || !verified) return;
      pendingUpdates.push(update);
      if (!updateFlushTimer) {
        updateFlushTimer = setTimeout(flushPendingUpdates, UPDATE_BATCH_MS);
      }
    });
    yslides.observe(() => {
      slideIds = yslides.toArray();
      slideVersion++;
      if (slideIds.length === 0 && verified) {
        // first user → seed first slide
        addSlide();
      } else if (activeSlideIndex >= slideIds.length) {
        activeSlideIndex = Math.max(0, slideIds.length - 1);
        remountEditor();
      }
    });
  }

  function getSlideFragment(id: string): Y.XmlFragment {
    return ydoc.getXmlFragment(`slide_${id}`);
  }

  function addSlide() {
    if (!ydoc) return;
    const id = genId();
    yslides.push([id]);
    activeSlideIndex = yslides.length - 1;
    remountEditor();
  }

  function deleteSlide(idx: number) {
    if (!ydoc || yslides.length <= 1) return; // keep at least one
    yslides.delete(idx, 1);
    if (activeSlideIndex >= yslides.length) activeSlideIndex = yslides.length - 1;
    remountEditor();
  }

  function moveSlide(from: number, to: number) {
    if (!ydoc || from === to || from < 0 || to < 0 || from >= yslides.length || to >= yslides.length) return;
    const id = yslides.get(from);
    ydoc.transact(() => {
      yslides.delete(from, 1);
      yslides.insert(to, [id]);
    });
    activeSlideIndex = to;
    remountEditor();
  }

  function selectSlide(idx: number) {
    if (idx === activeSlideIndex) return;
    activeSlideIndex = idx;
    remountEditor();
  }

  async function remountEditor() {
    editor?.destroy();
    editor = null;
    await tick();
    mountEditor();
  }

  function mountEditor() {
    if (!editorEl || !ydoc || slideIds.length === 0) return;
    const id = slideIds[activeSlideIndex];
    if (!id) return;
    const fragment = getSlideFragment(id);
    editor = new Editor({
      element: editorEl,
      extensions: [
        StarterKit.configure({ history: false }),
        Collaboration.configure({ document: ydoc, fragment }),
      ],
      editorProps: {
        attributes: {
          class: 'deck-prose',
          spellcheck: 'false',
          'data-1p-ignore': '',
        },
      },
    });
  }

  $: if (verified && editorEl && !editor && slideIds.length > 0) mountEditor();

  // get a tiny preview of slide content for the sidebar (first text node)
  function slidePreview(id: string): string {
    if (!ydoc) return '';
    try {
      const fragment = getSlideFragment(id);
      const text = fragment.toString().replace(/<[^>]*>/g, '').trim();
      return text.length > 40 ? text.slice(0, 40) + '…' : text;
    } catch { return ''; }
  }

  async function sendDocUpdate(update: Uint8Array) {
    if (!cryptoKey || !ws) return;
    try {
      const payload = await encryptBytes(cryptoKey, update);
      ws.send(JSON.stringify({ type: 'envelope', kind: 'doc', payload, id: genId() }));
    } catch {}
  }

  function connectWs() {
    verifying = true;
    wrongPassword = false;
    ws = new PartySocket({
      host: partyHost,
      room: roomId,
      party: 'deck',
      minReconnectionDelay: 500,
      maxReconnectionDelay: 8000,
      reconnectionDelayGrowFactor: 1.4,
      connectionTimeout: 8000,
      maxRetries: Infinity,
    });
    ws.addEventListener('open', async () => {
      connected = true;
      if (cryptoKey) {
        const verifyPayload = await encryptMessage(cryptoKey,
          JSON.stringify({ type: 'verify', sender: identity.name, color: identity.color }));
        ws!.send(JSON.stringify({ type: 'envelope', kind: 'verify', payload: verifyPayload, id: 'verify-' + genId() }));
      }
    });
    ws.addEventListener('close', () => { connected = false; });
    ws.addEventListener('error', () => {
      if (verifying) { wrongPassword = true; verifying = false; }
    });
    ws.addEventListener('message', handleServerMessage);

    if (heartbeatInterval) clearInterval(heartbeatInterval);
    heartbeatInterval = setInterval(() => {
      if (pageHidden) return;
      if (ws && ws.readyState === 1) {
        try { ws.send(JSON.stringify({ type: 'ping', t: Date.now() })); } catch {}
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  async function handleServerMessage(event: MessageEvent) {
    let data: any;
    try { data = JSON.parse(event.data); } catch { return; }

    if (data.type === 'init') {
      serverPresence = data.presence;
      if (verifying && serverPresence <= 1) {
        verified = true; verifying = false;
        // alone → make sure we have at least one slide
        if (yslides && yslides.length === 0) addSlide();
      } else if (verifying && serverPresence > 1) {
        setTimeout(() => {
          if (verifying && !verified) { wrongPassword = true; verifying = false; ws?.close(); }
        }, 4000);
      }
      return;
    }
    if (data.type === 'presence') { serverPresence = data.count; return; }
    if (data.type === 'peer-leave') {
      onlineUsers = onlineUsers.filter(u => u.id !== data.id);
      return;
    }
    if (data.type !== 'envelope') return;
    if (!cryptoKey) return;

    try {
      if (data.kind === 'doc') {
        const update = await decryptBytes(cryptoKey, data.payload);
        Y.applyUpdate(ydoc, update, 'remote');
        if (verifying) {
          verified = true; verifying = false;
          if (yslides.length === 0) addSlide();
        }
        return;
      }
      if (data.kind === 'verify') {
        const text = await decryptMessage(cryptoKey, data.payload);
        const parsed = JSON.parse(text);
        if (verifying) { verified = true; verifying = false; }
        addOnlineUser(data.from || parsed.sender, parsed.sender, parsed.color);
        if (verified && cryptoKey && ws) {
          const ack = await encryptMessage(cryptoKey,
            JSON.stringify({ type: 'verify-ack', sender: identity.name, color: identity.color }));
          ws.send(JSON.stringify({ type: 'envelope', kind: 'verify-ack', payload: ack, id: 'vack-' + genId() }));
          const state = Y.encodeStateAsUpdate(ydoc);
          await sendDocUpdate(state);
        }
        return;
      }
      if (data.kind === 'verify-ack') {
        const text = await decryptMessage(cryptoKey, data.payload);
        const parsed = JSON.parse(text);
        if (verifying) { verified = true; verifying = false; }
        addOnlineUser(data.from || parsed.sender, parsed.sender, parsed.color);
        return;
      }
    } catch {}
  }

  function addOnlineUser(id: string, name: string, color: string) {
    if (!onlineUsers.find(u => u.name === name)) {
      onlineUsers = [...onlineUsers, { id: id || name, name, initials: getInitials(name), color }];
    }
  }

  async function copyShareLink() {
    try { await navigator.clipboard.writeText(window.location.href); shareCopiedLink = true; setTimeout(() => { shareCopiedLink = false; }, 1500); } catch {}
  }
  async function copySharePassword() {
    try { await navigator.clipboard.writeText(sharePassword); shareCopiedPass = true; setTimeout(() => { shareCopiedPass = false; }, 1500); } catch {}
  }

  function handleVisibility() {
    if (typeof document === 'undefined') return;
    pageHidden = document.hidden;
  }
  function beforeUnloadHandler(e: BeforeUnloadEvent) {
    e.preventDefault();
    e.returnValue = '';
  }
  $: if (typeof window !== 'undefined') {
    if (verified) window.addEventListener('beforeunload', beforeUnloadHandler);
    else window.removeEventListener('beforeunload', beforeUnloadHandler);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (!presentMode) return;
    if (e.key === 'Escape') { presentMode = false; return; }
    if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') {
      e.preventDefault();
      if (activeSlideIndex < slideIds.length - 1) selectSlide(activeSlideIndex + 1);
    } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
      e.preventDefault();
      if (activeSlideIndex > 0) selectSlide(activeSlideIndex - 1);
    }
  }

  function togglePresent() { presentMode = !presentMode; }

  onMount(() => {
    initRoom();
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', handleVisibility);
    if (typeof window !== 'undefined') window.addEventListener('keydown', handleKeydown);
  });

  onDestroy(() => {
    editor?.destroy();
    ws?.close();
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', handleVisibility);
    if (typeof window !== 'undefined') {
      window.removeEventListener('beforeunload', beforeUnloadHandler);
      window.removeEventListener('keydown', handleKeydown);
    }
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    ydoc?.destroy();
  });
</script>

<div class="deck-container" class:deck-container--present={presentMode}>
  {#if wrongPassword}
    <div class="deck-center">
      <div class="space-y-4 max-w-xs w-full text-center">
        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="mx-auto text-red-500"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <p class="text-sm font-medium text-red-500">{t(dict, 'deck.wrongPassword')}</p>
        <p class="text-xs text-zinc-400 dark:text-zinc-500 leading-relaxed">{t(dict, 'deck.wrongPasswordDetail')}</p>
        <button class="btn-outline w-full text-xs" on:click={() => { wrongPassword = false; needsPassword = true; passwordInput = ''; }}>{t(dict, 'deck.tryAgain')}</button>
      </div>
    </div>
  {:else if needsPassword}
    <div class="deck-center">
      <div class="space-y-4 max-w-xs w-full">
        <div class="text-center space-y-2">
          <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="mx-auto text-emerald-500"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          <p class="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t(dict, 'deck.roomRequiresPassword')}</p>
          <p class="text-[10px] text-zinc-400 dark:text-zinc-500 leading-relaxed">{t(dict, 'deck.roomPasswordHint')}</p>
        </div>
        <input
          type="password"
          class="input w-full"
          placeholder={t(dict, 'deck.roomPasswordPlaceholder')}
          bind:value={passwordInput}
          on:keydown={(e) => e.key === 'Enter' && submitPassword()}
          autocomplete="off"
          data-lpignore="true"
          data-1p-ignore
          data-bwignore="true"
        />
        {#if passwordError}<p class="text-xs text-red-500">{passwordError}</p>{/if}
        <button class="btn w-full" on:click={submitPassword}>{t(dict, 'deck.enterRoom')}</button>
      </div>
    </div>
  {:else if verifying}
    <div class="deck-center">
      <div class="text-center space-y-2">
        <svg class="animate-spin mx-auto h-6 w-6 text-emerald-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
        <p class="text-xs text-zinc-400">{serverPresence > 1 ? t(dict, 'deck.verifyingPassword') : t(dict, 'deck.verifyingAlone')}</p>
      </div>
    </div>
  {:else if presentMode}
    <div class="deck-present">
      <div class="deck-present-slide">
        <div class="deck-present-num">{activeSlideIndex + 1} / {slideIds.length}</div>
        <div bind:this={editorEl} class="deck-present-content"></div>
      </div>
      <button class="deck-present-exit" on:click={togglePresent} aria-label={t(dict, 'deck.exitPresent')}>
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  {:else}
    <div class="deck-header">
      <div class="flex items-center gap-2">
        <span class="deck-status" class:deck-status--connected={connected}></span>
        <div class="flex items-center -space-x-1.5">
          <div class="deck-avatar deck-avatar--sm" style="background: {nameToGradient(identity.name)}" title={identity.name}>{myInitials}</div>
          {#each onlineUsers as user}
            <div class="deck-avatar deck-avatar--sm" style="background: {nameToGradient(user.name)}" title={user.name}>{user.initials}</div>
          {/each}
        </div>
      </div>
      <div class="flex items-center gap-2">
        <button class="deck-btn-tiny" on:click={togglePresent} title={t(dict, 'deck.present')}>
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          {t(dict, 'deck.present')}
        </button>
      </div>
    </div>

    {#if sharePassword && !shareDismissed}
      <div class="deck-share-banner">
        <div class="flex items-center justify-between mb-2">
          <span class="text-[10px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">{t(dict, 'deck.sharePasswordWarning')}</span>
          <button class="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors" on:click={() => { shareDismissed = true; }} aria-label="Close">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="flex items-center gap-1.5 mb-1.5">
          <span class="text-[10px] text-zinc-400 w-8 shrink-0">{t(dict, 'deck.roomLink')}</span>
          <code class="deck-share-value">{typeof window !== 'undefined' ? window.location.href : ''}</code>
          <button class="deck-share-copy" on:click={copyShareLink} aria-label="Copy link">
            {#if shareCopiedLink}
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-emerald-500"><polyline points="20 6 9 17 4 12"/></svg>
            {:else}
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            {/if}
          </button>
        </div>
        <div class="flex items-center gap-1.5">
          <span class="text-[10px] text-zinc-400 w-8 shrink-0">{t(dict, 'deck.password')}</span>
          <code class="deck-share-value">{sharePassword}</code>
          <button class="deck-share-copy" on:click={copySharePassword} aria-label="Copy password">
            {#if shareCopiedPass}
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-emerald-500"><polyline points="20 6 9 17 4 12"/></svg>
            {:else}
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            {/if}
          </button>
        </div>
      </div>
    {/if}

    <div class="deck-body">
      <aside class="deck-sidebar">
        <div class="deck-sidebar-list">
          {#each slideIds as id, i (id)}
            {@const _ = slideVersion}
            <button
              class="deck-thumb"
              class:deck-thumb--active={i === activeSlideIndex}
              on:click={() => selectSlide(i)}
              draggable="true"
              on:dragstart={(e) => e.dataTransfer?.setData('text/plain', String(i))}
              on:dragover={(e) => e.preventDefault()}
              on:drop={(e) => { e.preventDefault(); const from = parseInt(e.dataTransfer?.getData('text/plain') ?? '-1', 10); if (!Number.isNaN(from)) moveSlide(from, i); }}
              aria-label={`Slide ${i + 1}`}
            >
              <span class="deck-thumb-num">{i + 1}</span>
              <span class="deck-thumb-preview">{slidePreview(id) || t(dict, 'deck.emptySlide')}</span>
              {#if slideIds.length > 1}
                <span
                  class="deck-thumb-del"
                  role="button"
                  tabindex="0"
                  on:click|stopPropagation={() => deleteSlide(i)}
                  on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); deleteSlide(i); } }}
                  aria-label={t(dict, 'deck.deleteSlide')}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </span>
              {/if}
            </button>
          {/each}
        </div>
        <button class="deck-add" on:click={addSlide}>
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          {t(dict, 'deck.addSlide')}
        </button>
      </aside>

      <div class="deck-stage">
        <div class="deck-slide" bind:this={editorEl}></div>
      </div>
    </div>
  {/if}
</div>

<style>
  .deck-container {
    display: flex;
    flex-direction: column;
    height: 80vh;
    max-height: 820px;
    border-radius: 1rem;
    overflow: hidden;
    border: 1px solid rgba(228, 228, 231, 0.6);
    background: rgba(255, 255, 255, 0.6);
    backdrop-filter: blur(12px);
  }
  .deck-container--present {
    height: 100vh; max-height: none; border-radius: 0; border: 0;
    background: rgb(15, 15, 20); position: fixed; inset: 0; z-index: 100;
  }
  :global(.dark) .deck-container {
    border-color: rgba(39, 39, 42, 0.5);
    background: rgba(9, 9, 11, 0.6);
  }
  .deck-center {
    flex: 1;
    display: flex; align-items: center; justify-content: center;
    padding: 2rem;
    min-height: 60vh;
  }
  .deck-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 0.6rem 1rem;
    border-bottom: 1px solid rgba(228, 228, 231, 0.5);
    background: rgba(255,255,255,0.4);
  }
  :global(.dark) .deck-header { border-color: rgba(39, 39, 42, 0.4); background: rgba(24,24,27,0.4); }
  .deck-status {
    width: 8px; height: 8px; border-radius: 9999px;
    background: rgb(245, 158, 11);
    animation: deck-pulse 1.2s ease-in-out infinite;
  }
  .deck-status--connected {
    background: rgb(16, 185, 129);
    box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.2);
    animation: none;
  }
  @keyframes deck-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
  .deck-avatar {
    width: 24px; height: 24px; border-radius: 9999px;
    display: flex; align-items: center; justify-content: center;
    font-size: 9px; font-weight: 800; color: white;
    flex-shrink: 0; letter-spacing: 0.02em;
    box-shadow: 0 2px 8px rgba(0,0,0,0.12);
  }
  .deck-btn-tiny {
    display: inline-flex; align-items: center; gap: 0.3rem;
    padding: 0.3rem 0.6rem;
    font-size: 11px; font-weight: 600;
    color: rgb(82, 82, 91);
    border-radius: 0.4rem;
    transition: background 0.15s, color 0.15s;
  }
  :global(.dark) .deck-btn-tiny { color: rgb(212, 212, 216); }
  .deck-btn-tiny:hover {
    background: rgba(16, 185, 129, 0.1);
    color: rgb(16, 185, 129);
  }
  .deck-share-banner {
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid rgba(16, 185, 129, 0.15);
    background: rgba(16, 185, 129, 0.04);
  }
  :global(.dark) .deck-share-banner {
    background: rgba(16, 185, 129, 0.06);
    border-color: rgba(16, 185, 129, 0.1);
  }
  .deck-share-value {
    flex: 1; min-width: 0;
    font-size: 12px; font-family: 'fira-code', monospace;
    color: rgb(63, 63, 70); background: rgba(244, 244, 245, 0.8);
    padding: 4px 8px; border-radius: 6px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  :global(.dark) .deck-share-value {
    color: rgb(212, 212, 216);
    background: rgba(39, 39, 42, 0.6);
  }
  .deck-share-copy {
    flex-shrink: 0; padding: 2px;
    color: rgb(161, 161, 170); transition: color 0.15s;
  }
  .deck-share-copy:hover { color: rgb(16, 185, 129); }

  .deck-body {
    flex: 1;
    display: flex;
    overflow: hidden;
  }
  .deck-sidebar {
    width: 200px;
    flex-shrink: 0;
    border-right: 1px solid rgba(228, 228, 231, 0.5);
    background: rgba(244, 244, 245, 0.5);
    display: flex; flex-direction: column;
    overflow: hidden;
  }
  :global(.dark) .deck-sidebar {
    border-right-color: rgba(39, 39, 42, 0.4);
    background: rgba(24, 24, 27, 0.4);
  }
  .deck-sidebar-list {
    flex: 1;
    overflow-y: auto;
    padding: 0.5rem;
    display: flex; flex-direction: column; gap: 0.4rem;
  }
  .deck-thumb {
    position: relative;
    display: flex; align-items: flex-start; gap: 0.5rem;
    padding: 0.5rem 0.6rem;
    text-align: left;
    background: white;
    border: 1px solid rgba(228, 228, 231, 0.6);
    border-radius: 0.45rem;
    transition: border-color 0.15s, background 0.15s;
    cursor: pointer;
    min-height: 50px;
  }
  :global(.dark) .deck-thumb {
    background: rgba(39, 39, 42, 0.4);
    border-color: rgba(63, 63, 70, 0.5);
  }
  .deck-thumb:hover {
    border-color: rgba(16, 185, 129, 0.4);
  }
  .deck-thumb--active {
    border-color: rgb(16, 185, 129);
    background: rgba(16, 185, 129, 0.06);
  }
  :global(.dark) .deck-thumb--active {
    background: rgba(16, 185, 129, 0.1);
  }
  .deck-thumb-num {
    flex-shrink: 0;
    font-size: 11px; font-weight: 700;
    color: rgb(113, 113, 122);
    width: 18px;
  }
  .deck-thumb--active .deck-thumb-num { color: rgb(16, 185, 129); }
  .deck-thumb-preview {
    flex: 1;
    font-size: 11px;
    color: rgb(82, 82, 91);
    line-height: 1.35;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    word-break: break-word;
  }
  :global(.dark) .deck-thumb-preview { color: rgb(212, 212, 216); }
  .deck-thumb-del {
    position: absolute;
    top: 4px; right: 4px;
    padding: 2px;
    color: rgb(161, 161, 170);
    border-radius: 4px;
    opacity: 0;
    transition: opacity 0.15s, background 0.15s, color 0.15s;
    cursor: pointer;
    line-height: 0;
    display: inline-flex;
  }
  .deck-thumb:hover .deck-thumb-del { opacity: 1; }
  .deck-thumb-del:hover {
    background: rgba(239, 68, 68, 0.1);
    color: rgb(239, 68, 68);
  }
  .deck-add {
    display: flex; align-items: center; justify-content: center; gap: 0.4rem;
    margin: 0.5rem;
    padding: 0.6rem;
    background: rgba(16, 185, 129, 0.08);
    color: rgb(16, 185, 129);
    border-radius: 0.45rem;
    font-size: 12px; font-weight: 600;
    transition: background 0.15s;
  }
  .deck-add:hover { background: rgba(16, 185, 129, 0.15); }

  .deck-stage {
    flex: 1;
    display: flex; align-items: center; justify-content: center;
    padding: 2rem;
    overflow: auto;
    background: rgba(244, 244, 245, 0.3);
  }
  :global(.dark) .deck-stage { background: rgba(9, 9, 11, 0.3); }
  .deck-slide {
    width: 100%;
    max-width: 800px;
    aspect-ratio: 16 / 9;
    background: white;
    border-radius: 0.5rem;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
    padding: 3rem 4rem;
    overflow: auto;
  }
  :global(.dark) .deck-slide {
    background: rgb(24, 24, 27);
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
  }

  /* Present mode */
  .deck-present {
    flex: 1;
    display: flex; align-items: center; justify-content: center;
    background: rgb(15, 15, 20);
    color: white;
    position: relative;
  }
  .deck-present-slide {
    width: 90%;
    max-width: 1280px;
    aspect-ratio: 16 / 9;
    background: white;
    color: rgb(24, 24, 27);
    border-radius: 0.5rem;
    padding: 4rem 5rem;
    overflow: auto;
    position: relative;
  }
  .deck-present-num {
    position: absolute;
    bottom: 1rem; right: 1.5rem;
    font-size: 12px; font-weight: 700;
    color: rgb(161, 161, 170);
  }
  .deck-present-content { height: 100%; }
  .deck-present-exit {
    position: absolute;
    top: 1rem; right: 1rem;
    width: 36px; height: 36px;
    border-radius: 9999px;
    color: white;
    background: rgba(255,255,255,0.1);
    display: flex; align-items: center; justify-content: center;
    transition: background 0.15s;
  }
  .deck-present-exit:hover { background: rgba(255,255,255,0.2); }

  /* Tiptap prose styles inside slide */
  :global(.deck-prose) {
    outline: none;
    font-size: 18px;
    line-height: 1.55;
    color: rgb(24, 24, 27);
    height: 100%;
  }
  :global(.dark) :global(.deck-prose) { color: rgb(228, 228, 231); }
  :global(.deck-prose h1) { font-size: 2.5rem; font-weight: 800; margin: 0 0 1.25rem; line-height: 1.15; }
  :global(.deck-prose h2) { font-size: 1.875rem; font-weight: 700; margin: 1rem 0 0.75rem; }
  :global(.deck-prose h3) { font-size: 1.5rem; font-weight: 700; margin: 0.85rem 0 0.5rem; }
  :global(.deck-prose p) { margin: 0.5rem 0; }
  :global(.deck-prose ul), :global(.deck-prose ol) { margin: 0.5rem 0 0.5rem 1.5rem; }
  :global(.deck-prose ul) { list-style: disc; }
  :global(.deck-prose ol) { list-style: decimal; }
  :global(.deck-prose code) {
    font-family: 'fira-code', monospace; font-size: 0.875em;
    background: rgba(16, 185, 129, 0.08); border-radius: 4px;
    padding: 2px 5px;
  }
  :global(.dark) :global(.deck-prose code) { background: rgba(16, 185, 129, 0.12); }
  :global(.deck-prose blockquote) {
    border-left: 3px solid rgba(16, 185, 129, 0.5);
    padding-left: 0.75rem;
    margin: 0.5rem 0;
    color: rgb(113, 113, 122);
  }
  :global(.deck-prose strong) { font-weight: 700; }
  :global(.deck-prose em) { font-style: italic; }
  :global(.deck-prose hr) {
    border: none; border-top: 2px solid rgba(228, 228, 231, 0.7);
    margin: 1.25rem 0;
  }
</style>
